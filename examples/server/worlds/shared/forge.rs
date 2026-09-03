use std::{collections::HashSet, fs, path::Path, time::Instant};

use hashbrown::HashMap;
use serde::Deserialize;
use serde_json::{Map, Value};
use specs::{ReadExpect, System, WriteExpect};

use voxelize::{
    BlockRotation, BlockUtils, Chunks, ClientFilter, Message, MessageQueues, MessageType,
    MethodProtocol, Registry, Vec2, Vec3, VoxelAccess, VoxelPacker, World, WorldConfig,
};

const MAX_BUILD_WRITES: usize = 10_000;
const BUILD_BATCH_SIZE: usize = 128;
const REVISION_FILE: &str = "forge-revision.json";

const BASE_PALETTE: [&str; 8] = [
    "Air",
    "Dirt",
    "Stone",
    "Grass Block",
    "Grass",
    "Oak Planks",
    "Oak Log",
    "Oak Leaves",
];

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
    operation_index: usize,
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

struct BuildJob {
    request_id: String,
    client_id: String,
    requested: usize,
    writes: Vec<ResolvedWrite>,
    next: usize,
    applied: usize,
    started: Instant,
    bounds: Option<BuildBounds>,
    affected_chunks: Vec<Vec2<i32>>,
    awaiting_commit: Option<(usize, usize, Vec<(Vec3<i32>, u32)>, Instant)>,
}

pub struct ForgeBuildState {
    pub revision: u64,
    active: Option<BuildJob>,
}

impl ForgeBuildState {
    pub fn load(config: &WorldConfig) -> Self {
        let revision = if config.save_dir.is_empty() {
            0
        } else {
            let path = Path::new(&config.save_dir).join(REVISION_FILE);
            fs::read_to_string(path)
                .ok()
                .and_then(|value| serde_json::from_str::<u64>(&value).ok())
                .unwrap_or(0)
        };
        Self {
            revision,
            active: None,
        }
    }
}

pub fn setup_forge_world(world: &mut World) {
    let config = (*world.config()).clone();
    let state = ForgeBuildState::load(&config);
    world.set_extra_init_data("forgeRevision", serde_json::json!(state.revision));
    world.ecs_mut().insert(state);
    world.set_method_handle("forge:build", handle_build);
}

fn handle_build(world: &mut World, client_id: &str, payload: &str) {
    let envelope: BuildEnvelope = match serde_json::from_str(payload) {
        Ok(envelope) => envelope,
        Err(error) => {
            send_result(
                world,
                client_id,
                serde_json::json!({
                    "ok": false,
                    "outcome": "invalid",
                    "requestId": "",
                    "requested": 0,
                    "expanded": 0,
                    "applied": 0,
                    "bounds": Value::Null,
                    "elapsedMs": 0,
                    "revision": current_revision(world),
                    "persistence": "not_started",
                    "error": { "code": "invalid_build_request", "message": error.to_string() },
                }),
            );
            return;
        }
    };

    if envelope.request_id.is_empty() || envelope.request_id.len() > 128 {
        send_result(
            world,
            client_id,
            failure_receipt(
                &envelope.request_id,
                current_revision(world),
                "invalid_build_request",
                "requestId must be a non-empty string no longer than 128 bytes.",
            ),
        );
        return;
    }

    if world.read_resource::<ForgeBuildState>().active.is_some() {
        send_result(
            world,
            client_id,
            serde_json::json!({
                "ok": false,
                "outcome": "busy",
                "requestId": envelope.request_id,
                "requested": 0,
                "expanded": 0,
                "applied": 0,
                "bounds": Value::Null,
                "elapsedMs": 0,
                "revision": current_revision(world),
                "persistence": "not_started",
                "error": { "code": "busy", "message": "Another Forge Build Request is active." },
            }),
        );
        return;
    }

    let (config, registry) = ((*world.config()).clone(), (*world.registry()).clone());
    let preflight_result = {
        let chunks = world.chunks();
        preflight(&envelope.request, &config, &registry, &chunks)
    };
    let (writes, affected_chunks, bounds) = match preflight_result {
        Ok(result) => result,
        Err(error) => {
            send_result(
                world,
                client_id,
                failure_receipt(
                    &envelope.request_id,
                    current_revision(world),
                    "invalid_build_request",
                    &error,
                ),
            );
            return;
        }
    };

    let requested = requested_count(&envelope.request);
    world.write_resource::<ForgeBuildState>().active = Some(BuildJob {
        request_id: envelope.request_id,
        client_id: client_id.to_owned(),
        requested,
        writes,
        next: 0,
        applied: 0,
        started: Instant::now(),
        bounds,
        affected_chunks,
        awaiting_commit: None,
    });
}

fn preflight(
    request: &BuildRequest,
    config: &WorldConfig,
    registry: &Registry,
    chunks: &Chunks,
) -> Result<(Vec<ResolvedWrite>, Vec<Vec2<i32>>, Option<BuildBounds>), String> {
    if request.operations.is_empty() {
        return Err("operations must be a non-empty array.".to_owned());
    }

    let origin = checked_position(&request.origin, "origin")?;
    let mut writes = Vec::new();
    let mut affected_chunks = Vec::new();
    let mut affected_seen = HashSet::new();
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
                checked_shape_count(size, is_hollow)?;
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
                                &mut affected_chunks,
                                &mut affected_seen,
                                &mut bounds,
                                origin,
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
                    &mut affected_chunks,
                    &mut affected_seen,
                    &mut bounds,
                    origin,
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
                        &mut affected_chunks,
                        &mut affected_seen,
                        &mut bounds,
                        origin,
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

    Ok((writes, affected_chunks, bounds))
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

fn checked_shape_count(size: Vec3<i32>, hollow: bool) -> Result<usize, String> {
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
    if !BASE_PALETTE.contains(&name) {
        return Err(format!(
            "block {name:?} is not a canonical Forge Base Palette name."
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
    affected_chunks: &mut Vec<Vec2<i32>>,
    affected_seen: &mut HashSet<Vec2<i32>>,
    bounds: &mut Option<BuildBounds>,
    origin: Vec3<i32>,
    relative: Vec3<i32>,
    operation_index: usize,
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
    if affected_seen.insert(chunk) {
        affected_chunks.push(chunk);
    }
    if let Some(current) = bounds {
        current.include(&position);
    } else {
        *bounds = Some(BuildBounds {
            min: position,
            max: position,
        });
    }
    writes.push(ResolvedWrite {
        operation_index,
        position,
        raw,
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_line(
    writes: &mut Vec<ResolvedWrite>,
    affected_chunks: &mut Vec<Vec2<i32>>,
    affected_seen: &mut HashSet<Vec2<i32>>,
    bounds: &mut Option<BuildBounds>,
    origin: Vec3<i32>,
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
            affected_chunks,
            affected_seen,
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

fn voxel_chunk(position: &Vec3<i32>, chunk_size: usize) -> Vec2<i32> {
    Vec2(
        position.0.div_euclid(chunk_size as i32),
        position.2.div_euclid(chunk_size as i32),
    )
}

fn requested_count(request: &BuildRequest) -> usize {
    request
        .operations
        .iter()
        .map(|operation| match operation {
            BuildOperation::Voxels { blocks } => blocks.len(),
            _ => 1,
        })
        .sum()
}

fn current_revision(world: &World) -> u64 {
    world.read_resource::<ForgeBuildState>().revision
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

fn send_progress(world: &mut MessageQueues, client_id: &str, payload: Value) {
    world.push((
        Message::new(&MessageType::Method)
            .method(MethodProtocol {
                name: "forge:build-progress".to_owned(),
                payload: payload.to_string(),
            })
            .build(),
        ClientFilter::Direct(client_id.to_owned()),
    ));
}

fn send_revision(world: &mut MessageQueues, revision: u64) {
    world.push((
        Message::new(&MessageType::Method)
            .method(MethodProtocol {
                name: "forge:revision".to_owned(),
                payload: serde_json::json!({ "revision": revision }).to_string(),
            })
            .build(),
        ClientFilter::All,
    ));
}

fn failure_receipt(request_id: &str, revision: u64, code: &str, message: &str) -> Value {
    serde_json::json!({
        "ok": false,
        "outcome": "invalid",
        "requestId": request_id,
        "requested": 0,
        "expanded": 0,
        "applied": 0,
        "bounds": Value::Null,
        "elapsedMs": 0,
        "revision": revision,
        "persistence": "not_started",
        "error": { "code": code, "message": message },
    })
}

pub struct ForgeBuildSystem;

impl<'a> System<'a> for ForgeBuildSystem {
    type SystemData = (
        Option<WriteExpect<'a, ForgeBuildState>>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, MessageQueues>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (Some(mut state), config, mut chunks, mut messages) = data else {
            return;
        };
        let Some(mut job) = state.active.take() else {
            return;
        };

        if let Some((start, end, expected, queued_at)) = job.awaiting_commit.take() {
            if queued_at.elapsed().as_secs() >= 5 {
                let failed = job.writes.get(start);
                let receipt = serde_json::json!({
                    "ok": false,
                    "outcome": "partial_failure",
                    "requestId": job.request_id,
                    "requested": job.requested,
                    "expanded": job.writes.len(),
                    "applied": job.applied,
                    "bounds": bounds_value(bounds_for_applied(&job)),
                    "elapsedMs": job.started.elapsed().as_millis(),
                    "revision": state.revision,
                    "persistence": "not_reached",
                    "error": {
                        "code": "runtime_mutation_timeout",
                        "message": "The authoritative chunk mutation did not commit within the server bound.",
                        "operationIndex": failed.map(|write| write.operation_index),
                        "position": failed.map(|write| serde_json::json!({
                            "x": write.position.0,
                            "y": write.position.1,
                            "z": write.position.2,
                        })),
                    },
                });
                let client_id = job.client_id.clone();
                send_queued_result(&mut messages, &client_id, receipt);
                return;
            }
            let committed = expected.iter().all(|(position, raw)| {
                chunks.get_raw_voxel(position.0, position.1, position.2) == *raw
            });
            if !committed {
                job.awaiting_commit = Some((start, end, expected, queued_at));
                state.active = Some(job);
                return;
            }

            job.applied = end;
            let mut persistence_error = None;
            for coords in &job.affected_chunks {
                if !chunks.save(coords) {
                    persistence_error = Some(format!("failed to persist chunk {:?}", coords));
                    break;
                }
            }
            state.revision = state.revision.saturating_add(1);
            if let Err(error) = persist_revision(&config.save_dir, state.revision) {
                persistence_error = Some(error);
            }
            send_revision(&mut messages, state.revision);
            send_progress(
                &mut messages,
                &job.client_id,
                serde_json::json!({
                    "requestId": job.request_id,
                    "applied": job.applied,
                    "total": job.writes.len(),
                    "revision": state.revision,
                }),
            );

            if job.applied == job.writes.len() || persistence_error.is_some() {
                let receipt = receipt_for_job(&job, state.revision, persistence_error);
                let client_id = job.client_id.clone();
                send_queued_result(&mut messages, &client_id, receipt);
                return;
            }
        }

        if job.next >= job.writes.len() {
            state.active = Some(job);
            return;
        }
        let start = job.next;
        let end = (start + BUILD_BATCH_SIZE).min(job.writes.len());
        chunks.update_voxels(
            &job.writes[start..end]
                .iter()
                .map(|write| (write.position, write.raw))
                .collect::<Vec<_>>(),
        );
        let mut expected = HashMap::new();
        for write in &job.writes[start..end] {
            expected.insert(write.position, write.raw);
        }
        job.next = end;
        job.awaiting_commit = Some((start, end, expected.into_iter().collect(), Instant::now()));
        send_progress(
            &mut messages,
            &job.client_id,
            serde_json::json!({
                "requestId": job.request_id,
                "applied": job.applied,
                "total": job.writes.len(),
                "revision": state.revision,
            }),
        );
        state.active = Some(job);
    }
}

fn persist_revision(save_dir: &str, revision: u64) -> Result<(), String> {
    if save_dir.is_empty() {
        return Err("Forge World saving is not configured.".to_owned());
    }
    let path = Path::new(save_dir).join(REVISION_FILE);
    fs::create_dir_all(Path::new(save_dir))
        .map_err(|error| format!("failed to create Forge save directory: {error}"))?;
    fs::write(path, serde_json::to_vec(&revision).unwrap())
        .map_err(|error| format!("failed to persist Forge revision: {error}"))
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

fn bounds_for_applied(job: &BuildJob) -> Option<BuildBounds> {
    let mut bounds = None;
    for write in job.writes.iter().take(job.applied) {
        if let Some(current) = &mut bounds {
            current.include(&write.position);
        } else {
            bounds = Some(BuildBounds {
                min: write.position,
                max: write.position,
            });
        }
    }
    bounds
}

fn receipt_for_job(job: &BuildJob, revision: u64, persistence_error: Option<String>) -> Value {
    let ok = persistence_error.is_none() && job.applied == job.writes.len();
    let error = persistence_error.map(|message| {
        let failed = job.writes.get(job.applied.saturating_sub(1));
        serde_json::json!({
            "code": "persistence_failed",
            "message": message,
            "operationIndex": failed.map(|write| write.operation_index),
            "position": failed.map(|write| serde_json::json!({
                "x": write.position.0,
                "y": write.position.1,
                "z": write.position.2,
            })),
        })
    });
    serde_json::json!({
        "ok": ok,
        "outcome": if ok { "success" } else { "partial_failure" },
        "requestId": job.request_id,
        "requested": job.requested,
        "expanded": job.writes.len(),
        "applied": job.applied,
        "bounds": bounds_value(bounds_for_applied(job).as_ref()),
        "elapsedMs": job.started.elapsed().as_millis(),
        "revision": revision,
        "persistence": if ok { "saved" } else { "failed" },
        "error": error,
    })
}

// The helper keeps the final direct-send call visually parallel to the
// existing `World::send`/`MessageQueues` code while the build system owns the
// queue borrow for the remainder of the tick.
fn send_queued_result(queue: &mut MessageQueues, client_id: &str, payload: Value) {
    queue.push((
        Message::new(&MessageType::Method)
            .method(MethodProtocol {
                name: "forge:build-result".to_owned(),
                payload: payload.to_string(),
            })
            .build(),
        ClientFilter::Direct(client_id.to_owned()),
    ));
}
