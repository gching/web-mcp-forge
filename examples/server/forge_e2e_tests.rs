use std::fmt::Debug;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use awc::ws::{Frame, Message as WsMessage};
use futures_util::{SinkExt, Stream, StreamExt};
use serde_json::json;
use voxelize::{
    decode_message, encode_message, BoundVoxelize, Message, MessageType, UpdateProtocol, Voxelize,
};

use super::{build_forge_server, deployment_config::DeploymentConfig};

const TEST_VOXEL: (i32, i32, i32) = (1, 50, 1);
const TEST_VOXEL_ID: u32 = 40;

fn fresh_save_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "voxelize-forge-e2e-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock")
            .as_nanos()
    ));
    fs::remove_dir_all(&dir).ok();
    dir
}

fn deployment(data_dir: &PathBuf) -> DeploymentConfig {
    DeploymentConfig::from_lookup(|key| match key {
        "PORT" => Some("1".to_owned()),
        "VOXELIZE_SECRET" => Some("test".to_owned()),
        "VOXELIZE_DATA_DIR" => Some(data_dir.to_str().expect("utf-8 temp path").to_owned()),
        _ => None,
    })
    .expect("valid test configuration")
}

fn join_message() -> Vec<u8> {
    encode_message(
        &Message::new(&MessageType::Join)
            .json(&json!({ "world": "flat", "username": "forge-test" }).to_string())
            .build(),
    )
}

fn load_message() -> Vec<u8> {
    encode_message(
        &Message::new(&MessageType::Load)
            .json(
                &json!({
                    "center": [0, 0],
                    "direction": [0.0, 1.0],
                    "chunks": [[0, 0]]
                })
                .to_string(),
            )
            .build(),
    )
}

fn update_message() -> Vec<u8> {
    encode_message(
        &Message::new(&MessageType::Update)
            .updates(&[UpdateProtocol {
                vx: TEST_VOXEL.0,
                vy: TEST_VOXEL.1,
                vz: TEST_VOXEL.2,
                voxel: TEST_VOXEL_ID,
                light: 0,
            }])
            .build(),
    )
}

async fn wait_for_health(bound: &BoundVoxelize) {
    let url = format!("http://127.0.0.1:{}/health", bound.addr().port());
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Ok(response) = awc::Client::new().get(&url).send().await {
            if response.status().is_success() {
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("Forge test server did not become healthy");
}

async fn next_message<S, E>(connection: &mut S) -> Message
where
    S: Stream<Item = Result<Frame, E>> + Unpin,
    E: Debug,
{
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(30), connection.next())
            .await
            .expect("timed out waiting for a Forge server frame")
            .expect("Forge WebSocket closed")
            .expect("Forge WebSocket protocol error");
        if let Frame::Binary(bytes) = frame {
            if let Ok(message) = decode_message(&bytes) {
                return message;
            }

            let mut decoder = lz4_flex::frame::FrameDecoder::new(&bytes[..]);
            let mut decompressed = Vec::new();
            decoder
                .read_to_end(&mut decompressed)
                .expect("compressed Forge frame should decompress");
            return decode_message(&decompressed).expect("decompressed Forge frame should decode");
        }
    }
}

async fn wait_for_type<S, E>(connection: &mut S, expected: MessageType) -> Message
where
    S: Stream<Item = Result<Frame, E>> + Unpin,
    E: Debug,
{
    loop {
        let message = next_message(connection).await;
        if message.r#type == expected as i32 {
            return message;
        }
    }
}

async fn wait_for_voxel_update<S, E>(connection: &mut S) -> Message
where
    S: Stream<Item = Result<Frame, E>> + Unpin,
    E: Debug,
{
    loop {
        let message = next_message(connection).await;
        if message.r#type == MessageType::Update as i32
            && message.updates.iter().any(|update| {
                (update.vx, update.vy, update.vz, update.voxel)
                    == (TEST_VOXEL.0, TEST_VOXEL.1, TEST_VOXEL.2, TEST_VOXEL_ID)
            })
        {
            return message;
        }
    }
}

fn persisted_voxel(message: &Message) -> Option<u32> {
    let chunk = message
        .chunks
        .iter()
        .find(|chunk| chunk.x == 0 && chunk.z == 0)?;
    let bytes = lz4_flex::block::decompress_size_prepended(&chunk.voxels).ok()?;
    let (vx, vy, vz) = TEST_VOXEL;
    let index = (vx as usize * 256 * 16) + (vy as usize * 16) + vz as usize;
    let start = index * 4;
    let value = bytes.get(start..start + 4)?;
    Some(u32::from_le_bytes(value.try_into().ok()?))
}

async fn start_server(config: &DeploymentConfig) -> BoundVoxelize {
    let mut server = build_forge_server(config);
    server.port = 0;
    let bound = Voxelize::bind(server)
        .await
        .expect("Forge test server binds");
    wait_for_health(&bound).await;
    bound
}

#[actix_web::test]
async fn two_clients_observe_authoritative_mutation_and_disk_restart_readback() {
    let save_dir = fresh_save_dir();
    let config = deployment(&save_dir);

    let bound = start_server(&config).await;
    let url = format!("http://127.0.0.1:{}/ws/?secret=test", bound.addr().port());
    let (_, mut client_a) = awc::Client::new()
        .ws(&url)
        .connect()
        .await
        .expect("client A connects");
    let (_, mut client_b) = awc::Client::new()
        .ws(&url)
        .connect()
        .await
        .expect("client B connects");

    client_a
        .send(WsMessage::Binary(join_message().into()))
        .await
        .expect("client A joins");
    client_b
        .send(WsMessage::Binary(join_message().into()))
        .await
        .expect("client B joins");
    wait_for_type(&mut client_a, MessageType::Init).await;
    wait_for_type(&mut client_b, MessageType::Init).await;

    client_a
        .send(WsMessage::Binary(load_message().into()))
        .await
        .expect("client A requests its chunk");
    client_b
        .send(WsMessage::Binary(load_message().into()))
        .await
        .expect("client B requests its chunk");
    wait_for_type(&mut client_a, MessageType::Load).await;
    wait_for_type(&mut client_b, MessageType::Load).await;

    client_a
        .send(WsMessage::Binary(update_message().into()))
        .await
        .expect("client A sends its block mutation");
    wait_for_voxel_update(&mut client_a).await;
    wait_for_voxel_update(&mut client_b).await;

    let chunk_file = save_dir.join("worlds/flat/chunks/0|0.json");
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline && !chunk_file.exists() {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(chunk_file.exists(), "authoritative mutation was not saved");

    drop(client_a);
    drop(client_b);
    bound
        .stop(false)
        .await
        .expect("first Forge server stops cleanly");

    let bound = start_server(&config).await;
    let url = format!("http://127.0.0.1:{}/ws/?secret=test", bound.addr().port());
    let (_, mut client_c) = awc::Client::new()
        .ws(&url)
        .connect()
        .await
        .expect("client C connects after restart");
    client_c
        .send(WsMessage::Binary(join_message().into()))
        .await
        .expect("client C joins after restart");
    wait_for_type(&mut client_c, MessageType::Init).await;
    client_c
        .send(WsMessage::Binary(load_message().into()))
        .await
        .expect("client C requests the persisted chunk");
    let load = wait_for_type(&mut client_c, MessageType::Load).await;

    assert_eq!(persisted_voxel(&load), Some(TEST_VOXEL_ID));

    drop(client_c);
    bound
        .stop(false)
        .await
        .expect("second Forge server stops cleanly");
    fs::remove_dir_all(save_dir).expect("remove Forge E2E temp save");
}
