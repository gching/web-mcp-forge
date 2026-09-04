use std::time::Instant;

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::registry::forge_build_palette;
use voxelize::{
    BlockRotation, Chunks, ClientFilter, Message, MessageQueues, MessageType, MethodProtocol,
    Registry, Vec2, Vec3, VoxelPacker, World, WorldConfig,
};

const MAX_BUILD_WRITES: usize = 10_000;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Position {
    x: i64,
    y: i64,
    z: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BuildRequest {
    origin: Position,
    operations: Vec<BuildOperation>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum BuildOperation {
    #[serde(rename = "fill")]
    Fill {
        at: Position,
        size: Position,
        block: String,
        #[serde(default)]
        properties: Map<String, Value>,
    },
    #[serde(rename = "hollow_box")]
    HollowBox {
        at: Position,
        size: Position,
        block: String,
        #[serde(default)]
        properties: Map<String, Value>,
    },
    #[serde(rename = "line")]
    Line {
        from: Position,
        to: Position,
        block: String,
        #[serde(default)]
        properties: Map<String, Value>,
    },
    #[serde(rename = "voxels")]
    Voxels { blocks: Vec<BuildVoxel> },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BuildVoxel {
    at: Position,
    block: String,
    #[serde(default)]
    properties: Map<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BuildEnvelope {
    #[serde(rename = "requestId")]
    request_id: String,
    request: BuildRequest,
}

#[derive(Clone)]
struct ResolvedWrite {
    position: Vec3<i32>,
    raw: u32,
}

#[derive(Clone)]
struct BuildBounds {
    min: Vec3<i32>,
    max: Vec3<i32>,
}

impl BuildBounds {
    fn include(&mut self, position: &Vec3<i32>) {
        self.min.0 = self.min.0.min(position.0);
        self.min.1 = self.min.1.min(position.1);
        self.min.2 = self.min.2.min(position.2);
        self.max.0 = self.max.0.max(position.0);
        self.max.1 = self.max.1.max(position.1);
        self.max.2 = self.max.2.max(position.2);
    }
}

pub fn setup_forge_world(world: &mut World) {
    world.set_extra_init_data_provider("forgeBuildPalette", |world| {
        let registry = world.registry();
        serde_json::to_value(
            forge_build_palette(&registry)
                .expect("Forge Builder Palette must validate against the server Registry"),
        )
        .expect("Forge Builder Palette must serialize into join metadata")
    });
    world.set_method_handle("forge:build", handle_build);
}

fn handle_build(world: &mut World, client_id: &str, payload: &str) {
    let started = Instant::now();
    let payload_value: Value = match serde_json::from_str(payload) {
        Ok(payload_value) => payload_value,
        Err(error) => {
            send_result(
                world,
                client_id,
                invalid_response(
                    "",
                    0,
                    "invalid_build_request",
                    &error.to_string(),
                    started.elapsed().as_millis(),
                ),
            );
            return;
        }
    };
    let (payload_request_id, payload_requested) = request_metadata(&payload_value);
    let envelope: BuildEnvelope = match serde_json::from_value(payload_value) {
        Ok(envelope) => envelope,
        Err(error) => {
            send_result(
                world,
                client_id,
                invalid_response(
                    &payload_request_id,
                    payload_requested,
                    "invalid_build_request",
                    &error.to_string(),
                    started.elapsed().as_millis(),
                ),
            );
            return;
        }
    };

    if envelope.request_id.is_empty() || envelope.request_id.len() > 128 {
        send_result(
            world,
            client_id,
            invalid_response(
                &envelope.request_id,
                requested_count(&envelope.request),
                "invalid_build_request",
                "requestId must be a non-empty string no longer than 128 bytes.",
                started.elapsed().as_millis(),
            ),
        );
        return;
    }

    let requested = requested_count(&envelope.request);
    let (config, registry) = ((*world.config()).clone(), (*world.registry()).clone());
    let preflight_result = {
        let chunks = world.chunks();
        preflight(&envelope.request, &config, &registry, &chunks)
    };
    let (writes, bounds) = match preflight_result {
        Ok(result) => result,
        Err(error) => {
            send_result(
                world,
                client_id,
                invalid_response(
                    &envelope.request_id,
                    requested,
                    "invalid_build_request",
                    &error,
                    started.elapsed().as_millis(),
                ),
            );
            return;
        }
    };

    submit_resolved_writes(&mut world.chunks_mut(), &writes);
    send_result(
        world,
        client_id,
        accepted_response(
            &envelope.request_id,
            requested,
            writes.len(),
            bounds.as_ref(),
            started.elapsed().as_millis(),
        ),
    );
}

fn preflight(
    request: &BuildRequest,
    config: &WorldConfig,
    registry: &Registry,
    chunks: &Chunks,
) -> Result<(Vec<ResolvedWrite>, Option<BuildBounds>), String> {
    if request.operations.is_empty() {
        return Err("operations must be a non-empty array.".to_owned());
    }

    let origin = checked_position(&request.origin, "origin")?;
    let mut writes = Vec::new();
    let mut bounds: Option<BuildBounds> = None;

    for (operation_index, operation) in request.operations.iter().enumerate() {
        match operation {
            BuildOperation::Fill {
                at,
                size,
                block,
                properties,
            }
            | BuildOperation::HollowBox {
                at,
                size,
                block,
                properties,
            } => {
                let at = checked_position(at, &format!("operation {operation_index}.at"))?;
                let size = checked_position(size, &format!("operation {operation_index}.size"))?;
                if size.0 <= 0 || size.1 <= 0 || size.2 <= 0 {
                    return Err(format!(
                        "operation {operation_index}.size must be positive."
                    ));
                }
                let block = resolve_block(block, properties, registry)?;
                let is_hollow = matches!(operation, BuildOperation::HollowBox { .. });
                checked_shape_count(&size, is_hollow)?;
                let mut emitted = 0usize;
                for x in 0..size.0 {
                    for y in 0..size.1 {
                        for z in 0..size.2 {
                            let interior = x != 0
                                && y != 0
                                && z != 0
                                && x != size.0 - 1
                                && y != size.1 - 1
                                && z != size.2 - 1;
                            if is_hollow && interior {
                                continue;
                            }
                            append_write(
                                &mut writes,
                                &mut bounds,
                                &origin,
                                Vec3(
                                    at.0.checked_add(x).ok_or_else(|| {
                                        format!("operation {operation_index}.at plus x overflowed.")
                                    })?,
                                    at.1.checked_add(y).ok_or_else(|| {
                                        format!("operation {operation_index}.at plus y overflowed.")
                                    })?,
                                    at.2.checked_add(z).ok_or_else(|| {
                                        format!("operation {operation_index}.at plus z overflowed.")
                                    })?,
                                ),
                                operation_index,
                                block,
                                config,
                                chunks,
                            )?;
                            emitted += 1;
                            if writes.len() > MAX_BUILD_WRITES {
                                return Err(format!(
                                    "Build Request expands beyond the {MAX_BUILD_WRITES}-write limit."
                                ));
                            }
                        }
                    }
                }
                if emitted == 0 {
                    return Err(format!("operation {operation_index} emits no writes."));
                }
            }
            BuildOperation::Line {
                from,
                to,
                block,
                properties,
            } => {
                let from = checked_position(from, &format!("operation {operation_index}.from"))?;
                let to = checked_position(to, &format!("operation {operation_index}.to"))?;
                let line_length = (to.0 as i64 - from.0 as i64)
                    .unsigned_abs()
                    .max((to.1 as i64 - from.1 as i64).unsigned_abs())
                    .max((to.2 as i64 - from.2 as i64).unsigned_abs())
                    + 1;
                if line_length > MAX_BUILD_WRITES as u64 {
                    return Err(format!(
                        "line operation {operation_index} expands beyond the {MAX_BUILD_WRITES}-write limit."
                    ));
                }
                let block = resolve_block(block, properties, registry)?;
                append_line(
                    &mut writes,
                    &mut bounds,
                    &origin,
                    from,
                    to,
                    operation_index,
                    block,
                    config,
                    chunks,
                )?;
            }
            BuildOperation::Voxels { blocks } => {
                if blocks.is_empty() {
                    return Err(format!(
                        "operation {operation_index}.blocks must be non-empty."
                    ));
                }
                for voxel in blocks {
                    let at = checked_position(
                        &voxel.at,
                        &format!("operation {operation_index}.voxel.at"),
                    )?;
                    let block = resolve_block(&voxel.block, &voxel.properties, registry)?;
                    append_write(
                        &mut writes,
                        &mut bounds,
                        &origin,
                        at,
                        operation_index,
                        block,
                        config,
                        chunks,
                    )?;
                }
            }
        }
    }

    if writes.is_empty() {
        return Err("Build Request emits no writes.".to_owned());
    }
    if writes.len() > MAX_BUILD_WRITES {
        return Err(format!(
            "Build Request expands beyond the {MAX_BUILD_WRITES}-write limit."
        ));
    }

    Ok((writes, bounds))
}

fn checked_position(position: &Position, label: &str) -> Result<Vec3<i32>, String> {
    let convert = |value: i64, axis: &str| {
        i32::try_from(value)
            .map_err(|_| format!("{label}.{axis} must fit a 32-bit world coordinate."))
    };
    Ok(Vec3(
        convert(position.x, "x")?,
        convert(position.y, "y")?,
        convert(position.z, "z")?,
    ))
}

fn checked_shape_count(size: &Vec3<i32>, hollow: bool) -> Result<usize, String> {
    let total = (size.0 as u64)
        .checked_mul(size.1 as u64)
        .and_then(|value| value.checked_mul(size.2 as u64))
        .ok_or_else(|| "shape dimensions overflow the expansion counter.".to_owned())?;
    let interior = if hollow && size.0 > 2 && size.1 > 2 && size.2 > 2 {
        ((size.0 - 2) as u64)
            .checked_mul((size.1 - 2) as u64)
            .and_then(|value| value.checked_mul((size.2 - 2) as u64))
            .ok_or_else(|| "shape dimensions overflow the expansion counter.".to_owned())?
    } else {
        0
    };
    let count = total.saturating_sub(interior);
    if count == 0 || count > MAX_BUILD_WRITES as u64 {
        return Err(format!(
            "shape expands beyond the {MAX_BUILD_WRITES}-write limit."
        ));
    }
    Ok(count as usize)
}

fn resolve_block(
    name: &str,
    properties: &Map<String, Value>,
    registry: &Registry,
) -> Result<u32, String> {
    let palette = forge_build_palette(registry)
        .map_err(|error| format!("Forge Builder Palette is unavailable: {error}"))?;
    if !palette.blocks.iter().any(|entry| entry.name == name) {
        return Err(format!(
            "block {name:?} is not a canonical Forge Builder Palette name."
        ));
    }
    let block = registry
        .try_get_block_by_name(name)
        .ok_or_else(|| format!("block {name:?} is missing from the server Registry."))?;

    let mut rotation = 0u32;
    let mut y_rotation = 0u32;
    let mut stage = 0u32;
    for (key, value) in properties {
        match key.as_str() {
            "stage" => {
                stage = value
                    .as_u64()
                    .filter(|value| *value <= 15)
                    .ok_or_else(|| "stage must be an integer from 0 through 15.".to_owned())?
                    as u32;
            }
            "yRotation" => {
                if !block.y_rotatable {
                    return Err(format!("block {name:?} does not support yRotation."));
                }
                y_rotation =
                    value.as_u64().filter(|value| *value < 16).ok_or_else(|| {
                        "yRotation must be an integer from 0 through 15.".to_owned()
                    })? as u32;
            }
            "rotation" => {
                if !block.rotatable {
                    return Err(format!("block {name:?} does not support rotation."));
                }
                rotation = match value {
                    Value::String(axis) => match axis.as_str() {
                        "PY" => 0,
                        "NY" => 1,
                        "PX" => 2,
                        "NX" => 3,
                        "PZ" => 4,
                        "NZ" => 5,
                        _ => {
                            return Err(
                                "rotation must be one of PY, NY, PX, NX, PZ, or NZ.".to_owned()
                            )
                        }
                    },
                    Value::Number(number) => {
                        number.as_u64().filter(|value| *value < 6).ok_or_else(|| {
                            "rotation must be an axis name or integer 0 through 5.".to_owned()
                        })? as u32
                    }
                    _ => {
                        return Err(
                            "rotation must be an axis name or integer 0 through 5.".to_owned()
                        )
                    }
                };
            }
            _ => {
                return Err(format!(
                    "unsupported state property {key:?} for block {name:?}."
                ))
            }
        }
    }

    Ok(VoxelPacker::new()
        .with_id(block.id)
        .with_rotation(BlockRotation::encode(rotation, y_rotation))
        .with_stage(stage)
        .pack())
}

#[allow(clippy::too_many_arguments)]
fn append_write(
    writes: &mut Vec<ResolvedWrite>,
    bounds: &mut Option<BuildBounds>,
    origin: &Vec3<i32>,
    relative: Vec3<i32>,
    _operation_index: usize,
    raw: u32,
    config: &WorldConfig,
    chunks: &Chunks,
) -> Result<(), String> {
    if writes.len() >= MAX_BUILD_WRITES {
        return Err(format!(
            "Build Request expands beyond the {MAX_BUILD_WRITES}-write limit."
        ));
    }
    let position = Vec3(
        origin
            .0
            .checked_add(relative.0)
            .ok_or_else(|| "origin plus operation x coordinate overflowed.".to_owned())?,
        origin
            .1
            .checked_add(relative.1)
            .ok_or_else(|| "origin plus operation y coordinate overflowed.".to_owned())?,
        origin
            .2
            .checked_add(relative.2)
            .ok_or_else(|| "origin plus operation z coordinate overflowed.".to_owned())?,
    );
    if position.1 < 0 || position.1 >= config.max_height as i32 {
        return Err(format!(
            "voxel {:?} is outside the world's vertical bounds.",
            position
        ));
    }
    let chunk = voxel_chunk(&position, config.chunk_size);
    if !chunks.is_within_world(&chunk) || !chunks.is_chunk_ready(&chunk) {
        return Err(format!(
            "required chunk {:?} is not ready in the Forge World.",
            chunk
        ));
    }
    for light_chunk in chunks.light_traversed_chunks(&chunk) {
        if !chunks.is_chunk_ready(&light_chunk) {
            return Err(format!(
                "required lighting chunk {:?} is not ready.",
                light_chunk
            ));
        }
    }
    if let Some(current) = bounds {
        current.include(&position);
    } else {
        *bounds = Some(BuildBounds {
            min: position.clone(),
            max: position.clone(),
        });
    }
    writes.push(ResolvedWrite { position, raw });
    Ok(())
}

// Keep this in lockstep with the page expansion: dominant-axis Bresenham,
// resolving equal axes in x, then y, then z order.
#[allow(clippy::too_many_arguments)]
fn append_line(
    writes: &mut Vec<ResolvedWrite>,
    bounds: &mut Option<BuildBounds>,
    origin: &Vec3<i32>,
    from: Vec3<i32>,
    to: Vec3<i32>,
    operation_index: usize,
    raw: u32,
    config: &WorldConfig,
    chunks: &Chunks,
) -> Result<(), String> {
    let mut x = from.0;
    let mut y = from.1;
    let mut z = from.2;
    let dx = (to.0 - from.0).abs();
    let dy = (to.1 - from.1).abs();
    let dz = (to.2 - from.2).abs();
    let sx = if from.0 < to.0 { 1 } else { -1 };
    let sy = if from.1 < to.1 { 1 } else { -1 };
    let sz = if from.2 < to.2 { 1 } else { -1 };
    let mut append = |x: i32, y: i32, z: i32| {
        append_write(
            writes,
            bounds,
            origin,
            Vec3(x, y, z),
            operation_index,
            raw,
            config,
            chunks,
        )
    };

    if dx >= dy && dx >= dz {
        let mut py = 2 * dy - dx;
        let mut pz = 2 * dz - dx;
        for _ in 0..=dx {
            append(x, y, z)?;
            if py >= 0 {
                y += sy;
                py -= 2 * dx;
            }
            if pz >= 0 {
                z += sz;
                pz -= 2 * dx;
            }
            x += sx;
            py += 2 * dy;
            pz += 2 * dz;
        }
    } else if dy >= dx && dy >= dz {
        let mut px = 2 * dx - dy;
        let mut pz = 2 * dz - dy;
        for _ in 0..=dy {
            append(x, y, z)?;
            if px >= 0 {
                x += sx;
                px -= 2 * dy;
            }
            if pz >= 0 {
                z += sz;
                pz -= 2 * dy;
            }
            y += sy;
            px += 2 * dx;
            pz += 2 * dz;
        }
    } else {
        let mut px = 2 * dx - dz;
        let mut py = 2 * dy - dz;
        for _ in 0..=dz {
            append(x, y, z)?;
            if px >= 0 {
                x += sx;
                px -= 2 * dz;
            }
            if py >= 0 {
                y += sy;
                py -= 2 * dz;
            }
            z += sz;
            px += 2 * dx;
            py += 2 * dy;
        }
    }
    Ok(())
}

fn requested_count(request: &BuildRequest) -> usize {
    request.operations.len()
}

fn request_metadata(payload: &Value) -> (String, usize) {
    let Some(payload) = payload.as_object() else {
        return (String::new(), 0);
    };
    let request_id = payload
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let requested = payload
        .get("request")
        .and_then(Value::as_object)
        .and_then(|request| request.get("operations"))
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    (request_id, requested)
}

fn voxel_chunk(position: &Vec3<i32>, chunk_size: usize) -> Vec2<i32> {
    Vec2(
        position.0.div_euclid(chunk_size as i32),
        position.2.div_euclid(chunk_size as i32),
    )
}

fn send_result(world: &mut World, client_id: &str, payload: Value) {
    world.write_resource::<MessageQueues>().push((
        Message::new(&MessageType::Method)
            .method(MethodProtocol {
                name: "forge:build-result".to_owned(),
                payload: payload.to_string(),
            })
            .build(),
        ClientFilter::Direct(client_id.to_owned()),
    ));
}

fn submit_resolved_writes(chunks: &mut Chunks, writes: &[ResolvedWrite]) {
    let updates: Vec<_> = writes
        .iter()
        .map(|write| (write.position.clone(), write.raw))
        .collect();
    chunks.update_voxels(&updates);
}

fn bounds_value(bounds: Option<&BuildBounds>) -> Value {
    match bounds {
        Some(bounds) => serde_json::json!({
            "min": { "x": bounds.min.0, "y": bounds.min.1, "z": bounds.min.2 },
            "max": { "x": bounds.max.0, "y": bounds.max.1, "z": bounds.max.2 },
        }),
        None => Value::Null,
    }
}

fn accepted_response(
    request_id: &str,
    requested: usize,
    expanded: usize,
    bounds: Option<&BuildBounds>,
    elapsed_ms: u128,
) -> Value {
    serde_json::json!({
        "ok": true,
        "outcome": "accepted",
        "requestId": request_id,
        "requested": requested,
        "expanded": expanded,
        "submitted": expanded,
        "bounds": bounds_value(bounds),
        "elapsedMs": elapsed_ms,
    })
}

fn invalid_response(
    request_id: &str,
    requested: usize,
    code: &str,
    message: &str,
    elapsed_ms: u128,
) -> Value {
    serde_json::json!({
        "ok": false,
        "outcome": "invalid",
        "requestId": request_id,
        "requested": requested,
        "expanded": 0,
        "submitted": 0,
        "bounds": Value::Null,
        "elapsedMs": elapsed_ms,
        "error": { "code": code, "message": message },
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, Value};

    use super::{
        accepted_response, handle_build, invalid_response, requested_count, resolve_block,
        submit_resolved_writes, BlockRotation, BuildBounds, BuildEnvelope, BuildOperation,
        BuildRequest, BuildVoxel, Position, ResolvedWrite, VoxelPacker,
    };

    fn ready_world() -> voxelize::World {
        let config = voxelize::WorldConfig::new()
            .min_chunk([0, 0])
            .max_chunk([0, 0])
            .chunk_size(16)
            .max_height(64)
            .build();
        let mut world = voxelize::World::new("forge-test", &config);
        world.ecs_mut().insert(crate::registry::setup_registry());

        let mut chunk = voxelize::Chunk::new(
            "0,0",
            0,
            0,
            &voxelize::ChunkOptions {
                size: 16,
                max_height: 64,
                sub_chunks: 1,
            },
        );
        chunk.status = voxelize::ChunkStatus::Ready;
        world.chunks_mut().add(chunk);
        world
    }

    fn queued_response(world: &mut voxelize::World) -> Value {
        let messages = world
            .write_resource::<voxelize::MessageQueues>()
            .drain_prioritized();
        let message = messages
            .into_iter()
            .next()
            .expect("Forge handler must queue one direct response")
            .0;
        let method = message
            .method
            .expect("Forge response must be a method message");
        serde_json::from_str(&method.payload).expect("Forge response must be JSON")
    }

    #[test]
    fn handle_build_accepts_two_clients_in_actor_order_and_queues_correlated_results() {
        let mut world = ready_world();
        let first = serde_json::json!({
            "requestId": "forge-a",
            "request": {
                "origin": { "x": 1, "y": 50, "z": 1 },
                "operations": [{
                    "type": "voxels",
                    "blocks": [{ "at": { "x": 0, "y": 0, "z": 0 }, "block": "Glass" }]
                }]
            }
        });
        let second = serde_json::json!({
            "requestId": "forge-b",
            "request": {
                "origin": { "x": 1, "y": 50, "z": 1 },
                "operations": [{
                    "type": "voxels",
                    "blocks": [
                        { "at": { "x": 0, "y": 0, "z": 0 }, "block": "Oak Log" },
                        { "at": { "x": 1, "y": 0, "z": 0 }, "block": "Oak Log" }
                    ]
                }]
            }
        });

        handle_build(&mut world, "client-a", &first.to_string());
        let first_response = queued_response(&mut world);
        handle_build(&mut world, "client-b", &second.to_string());
        let second_response = queued_response(&mut world);

        assert_eq!(first_response["outcome"], "accepted");
        assert_eq!(first_response["requestId"], "forge-a");
        assert_eq!(first_response["requested"], 1);
        assert_eq!(first_response["expanded"], 1);
        assert_eq!(first_response["submitted"], 1);
        assert_eq!(second_response["outcome"], "accepted");
        assert_eq!(second_response["requestId"], "forge-b");

        assert_eq!(
            world
                .chunks()
                .pending_updates_in_bounds(&voxelize::Vec3(1, 50, 1), &voxelize::Vec3(2, 50, 1),),
            hashbrown::HashMap::from_iter([
                (voxelize::Vec3(1, 50, 1), 43),
                (voxelize::Vec3(2, 50, 1), 43),
            ])
        );
    }

    #[test]
    fn handle_build_invalid_requests_do_not_submit_partial_writes() {
        let mut world = ready_world();
        let payload = serde_json::json!({
            "requestId": "forge-invalid",
            "request": {
                "origin": { "x": 1, "y": 50, "z": 1 },
                "operations": [{
                    "type": "voxels",
                    "blocks": [
                        { "at": { "x": 0, "y": 0, "z": 0 }, "block": "Glass" },
                        { "at": { "x": 1, "y": 0, "z": 0 }, "block": "Water" }
                    ]
                }]
            }
        });

        handle_build(&mut world, "client-a", &payload.to_string());
        let response = queued_response(&mut world);

        assert_eq!(response["ok"], false);
        assert_eq!(response["outcome"], "invalid");
        assert_eq!(response["requestId"], "forge-invalid");
        assert_eq!(response["submitted"], 0);
        assert_eq!(world.chunks().pending_updates_count(), 0);
    }

    #[test]
    fn accepted_requests_share_the_authoritative_last_write_wins_projection() {
        let mut chunks = voxelize::Chunks::new(&voxelize::WorldConfig::new().build());
        let first = vec![
            ResolvedWrite {
                position: voxelize::Vec3(1, 50, 1),
                raw: 11,
            },
            ResolvedWrite {
                position: voxelize::Vec3(2, 50, 1),
                raw: 11,
            },
        ];
        let second = vec![
            ResolvedWrite {
                position: voxelize::Vec3(2, 50, 1),
                raw: 22,
            },
            ResolvedWrite {
                position: voxelize::Vec3(3, 50, 1),
                raw: 22,
            },
        ];

        submit_resolved_writes(&mut chunks, &first);
        submit_resolved_writes(&mut chunks, &second);

        assert_eq!(
            chunks.pending_updates_in_bounds(&voxelize::Vec3(1, 50, 1), &voxelize::Vec3(3, 50, 1),),
            hashbrown::HashMap::from_iter([
                (voxelize::Vec3(1, 50, 1), 11),
                (voxelize::Vec3(2, 50, 1), 22),
                (voxelize::Vec3(3, 50, 1), 22),
            ])
        );
    }

    #[test]
    fn the_expansion_limit_accepts_10000_and_rejects_10001_writes() {
        assert_eq!(
            super::checked_shape_count(&voxelize::Vec3(10_000, 1, 1), false),
            Ok(10_000)
        );
        assert!(super::checked_shape_count(&voxelize::Vec3(10_001, 1, 1), false).is_err());
    }

    #[test]
    fn accepted_response_is_the_exact_build_acceptance_contract() {
        let bounds = BuildBounds {
            min: voxelize::Vec3(10, 4, 20),
            max: voxelize::Vec3(29, 15, 39),
        };

        assert_eq!(
            accepted_response("forge-123", 3, 480, Some(&bounds), 7),
            serde_json::json!({
                "ok": true,
                "outcome": "accepted",
                "requestId": "forge-123",
                "requested": 3,
                "expanded": 480,
                "submitted": 480,
                "bounds": {
                    "min": { "x": 10, "y": 4, "z": 20 },
                    "max": { "x": 29, "y": 15, "z": 39 },
                },
                "elapsedMs": 7,
            })
        );
    }

    #[test]
    fn invalid_response_is_the_exact_non_submitting_contract() {
        assert_eq!(
            invalid_response(
                "forge-123",
                3,
                "invalid_build_request",
                "Build Request expands beyond the 10000-write limit.",
                2,
            ),
            serde_json::json!({
                "ok": false,
                "outcome": "invalid",
                "requestId": "forge-123",
                "requested": 3,
                "expanded": 0,
                "submitted": 0,
                "bounds": Value::Null,
                "elapsedMs": 2,
                "error": {
                    "code": "invalid_build_request",
                    "message": "Build Request expands beyond the 10000-write limit.",
                },
            })
        );
    }

    #[test]
    fn requested_counts_build_operations_not_individual_voxels() {
        let request = BuildRequest {
            origin: Position { x: 0, y: 50, z: 0 },
            operations: vec![BuildOperation::Voxels {
                blocks: vec![
                    BuildVoxel {
                        at: Position { x: 0, y: 0, z: 0 },
                        block: "Glass".to_owned(),
                        properties: Map::new(),
                    },
                    BuildVoxel {
                        at: Position { x: 1, y: 0, z: 0 },
                        block: "Glass".to_owned(),
                        properties: Map::new(),
                    },
                ],
            }],
        };

        assert_eq!(requested_count(&request), 1);
    }

    #[test]
    fn malformed_nested_requests_retain_the_outer_request_id() {
        let payload = serde_json::json!({
            "requestId": "forge-123",
            "request": {
                "origin": { "x": 0, "y": 50, "z": 0 },
                "operations": [{ "type": "fill", "size": "not-a-position" }],
            },
        });

        let (request_id, requested) = super::request_metadata(&payload);
        let error = serde_json::from_value::<BuildEnvelope>(payload).expect_err("invalid request");

        assert_eq!(request_id, "forge-123");
        assert_eq!(requested, 1);
        assert!(error.to_string().contains("invalid type"));
    }

    #[test]
    fn resolve_block_accepts_new_builder_materials_and_rotated_logs() {
        let registry = crate::registry::setup_registry();

        for name in [
            "Glass",
            "Oak Slab Top",
            "Blue Concrete",
            "Ember Lamp",
            "Azure Lamp",
        ] {
            assert!(
                resolve_block(name, &Map::new(), &registry).is_ok(),
                "{name} must be accepted by the Forge Builder Palette"
            );
        }

        let properties = Map::from_iter([("rotation".to_owned(), Value::String("PX".to_owned()))]);
        assert_eq!(
            resolve_block("Oak Log", &properties, &registry).unwrap(),
            VoxelPacker::new()
                .with_id(43)
                .with_rotation(BlockRotation::encode(2, 0))
                .pack()
        );
    }

    #[test]
    fn resolve_block_rejects_excluded_registry_blocks() {
        let error = resolve_block("Water", &Map::new(), &crate::registry::setup_registry())
            .expect_err("Water must remain outside the Forge Builder Palette");

        assert!(error.contains("Palette"));
    }
}
