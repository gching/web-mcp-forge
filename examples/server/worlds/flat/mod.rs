use voxelize::{FlatlandStage, Registry, World, WorldConfig};

pub fn setup_flat_world(registry: &Registry, save_dir: &str) -> World {
    let config = WorldConfig::new()
        .preload(true)
        .preload_radius(2)
        .min_chunk([-50, -50])
        .max_chunk([50, 50])
        .saving(true)
        .save_interval(1)
        .save_dir(save_dir)
        .time_per_day(24000)
        .default_time(12000.0)
        .build();

    let mut world = World::new("flat", &config);
    let stone = registry.get_block_by_name("Stone");

    world
        .pipeline_mut()
        .add_stage(FlatlandStage::new().add_soiling(stone.id, 50));

    world
}
