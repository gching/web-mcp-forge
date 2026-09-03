use super::deployment_config::DeploymentConfig;

#[test]
fn render_environment_overrides_local_defaults() {
    let config = DeploymentConfig::from_lookup(|key| match key {
        "PORT" => Some("10000".to_owned()),
        "VOXELIZE_SECRET" => Some("render-secret".to_owned()),
        "VOXELIZE_DATA_DIR" => Some("/var/data".to_owned()),
        _ => None,
    })
    .expect("valid Render configuration");

    assert_eq!(config.port, 10_000);
    assert_eq!(config.secret, "render-secret");
    assert_eq!(config.world_save_dir("flat"), "/var/data/worlds/flat");
}

#[test]
fn missing_environment_uses_local_demo_defaults() {
    let config = DeploymentConfig::from_lookup(|_| None).expect("local defaults");

    assert_eq!(config.port, 4_000);
    assert_eq!(
        config.secret,
        "sadaddsdsadsadsadsadsadsadsadsadsaadsdsd212321sadghfhhey54t34dfsfsdfs"
    );
    assert_eq!(config.world_save_dir("test"), "data/worlds/test");
}

#[test]
fn invalid_port_is_rejected_before_the_server_starts() {
    let error =
        DeploymentConfig::from_lookup(|key| (key == "PORT").then(|| "not-a-port".to_owned()))
            .expect_err("invalid ports must fail");

    assert_eq!(error, "PORT must be an integer from 1 through 65535");
}

#[test]
fn zero_port_is_rejected_before_the_server_starts() {
    let error = DeploymentConfig::from_lookup(|key| (key == "PORT").then(|| "0".to_owned()))
        .expect_err("port zero must fail");

    assert_eq!(error, "PORT must be an integer from 1 through 65535");
}

#[test]
fn blank_secret_is_rejected_before_the_server_starts() {
    let error =
        DeploymentConfig::from_lookup(|key| (key == "VOXELIZE_SECRET").then(|| "   ".to_owned()))
            .expect_err("blank secrets must fail");

    assert_eq!(error, "VOXELIZE_SECRET must not be blank");
}
