use std::io;

use registry::setup_registry;
use voxelize::{Server, Voxelize};
use worlds::flat::setup_flat_world;

mod deployment_config;
mod registry;
mod worlds;

#[cfg(test)]
mod deployment_config_tests;

#[cfg(test)]
mod forge_e2e_tests;

fn build_forge_server(deployment: &deployment_config::DeploymentConfig) -> Server {
    let registry = setup_registry();
    let mut server = Server::new()
        .addr("0.0.0.0")
        .port(deployment.port)
        .secret(&deployment.secret)
        .registry(&registry)
        .build();

    server
        .add_world(setup_flat_world(
            &registry,
            &deployment.world_save_dir("flat"),
        ))
        .expect("Could not create flat world.");

    server
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let deployment = deployment_config::DeploymentConfig::from_env()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;

    Voxelize::run(build_forge_server(&deployment)).await
}

#[cfg(test)]
mod forge_server_tests {
    use super::{build_forge_server, deployment_config::DeploymentConfig};

    #[actix_web::test]
    async fn forge_server_contains_only_the_flat_world() {
        let deployment = DeploymentConfig::from_lookup(|key| match key {
            "PORT" => Some("4000".to_owned()),
            "VOXELIZE_SECRET" => Some("test".to_owned()),
            "VOXELIZE_DATA_DIR" => Some("target/forge-server-contract".to_owned()),
            _ => None,
        })
        .expect("valid test deployment configuration");
        let server = build_forge_server(&deployment);

        let mut worlds = server.worlds.keys().cloned().collect::<Vec<_>>();
        worlds.sort();

        assert_eq!(worlds, vec!["flat"]);
    }
}
