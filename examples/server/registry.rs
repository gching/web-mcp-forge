use voxelize::{AABBServerExt, Block, BlockFaces, Registry, AABB};

pub const AIR_ID: u32 = 0;
pub const DIRT_ID: u32 = 1;
pub const STONE_ID: u32 = 2;
pub const GRASS_BLOCK_ID: u32 = 4;
pub const OAK_PLANKS_ID: u32 = 40;
pub const OAK_LOG_ID: u32 = 43;
pub const OAK_LEAVES_ID: u32 = 44;
pub const GRASS_ID: u32 = 1000;

pub const FORGE_BLOCK_NAMES: [&str; 8] = [
    "Air",
    "Dirt",
    "Stone",
    "Grass Block",
    "Grass",
    "Oak Planks",
    "Oak Log",
    "Oak Leaves",
];

const PLANT_SCALE: f32 = 0.6;

pub fn setup_registry() -> Registry {
    let mut registry = Registry::new();
    let grass_faces = BlockFaces::diagonal_faces()
        .scale_horizontal(PLANT_SCALE)
        .scale_vertical(PLANT_SCALE)
        .build();

    registry.register_blocks(&[
        Block::new("Dirt").id(DIRT_ID).build(),
        Block::new("Stone").id(STONE_ID).build(),
        Block::new("Grass Block").id(GRASS_BLOCK_ID).build(),
        Block::new("Oak Planks").id(OAK_PLANKS_ID).build(),
        Block::new("Oak Log").id(OAK_LOG_ID).rotatable(true).build(),
        Block::new("Oak Leaves")
            .id(OAK_LEAVES_ID)
            .is_transparent(true)
            .is_see_through(true)
            .transparent_standalone(true)
            .build(),
        Block::new("Grass")
            .id(GRASS_ID)
            .aabbs(&[AABB::from_faces(&grass_faces)])
            .is_passable(true)
            .faces(&grass_faces)
            .is_transparent(true)
            .is_see_through(true)
            .transparent_standalone(true)
            .build(),
    ]);

    registry
}

#[cfg(test)]
mod tests {
    use super::{setup_registry, FORGE_BLOCK_NAMES};

    #[test]
    fn exposes_only_the_forge_base_palette_with_stable_ids() {
        let registry = setup_registry();
        let mut blocks = registry
            .blocks_by_id
            .values()
            .map(|block| (block.id, block.name.as_str()))
            .collect::<Vec<_>>();
        blocks.sort_unstable_by_key(|(id, _)| *id);

        assert_eq!(
            blocks,
            vec![
                (0, FORGE_BLOCK_NAMES[0]),
                (1, FORGE_BLOCK_NAMES[1]),
                (2, FORGE_BLOCK_NAMES[2]),
                (4, FORGE_BLOCK_NAMES[3]),
                (40, FORGE_BLOCK_NAMES[5]),
                (43, FORGE_BLOCK_NAMES[6]),
                (44, FORGE_BLOCK_NAMES[7]),
                (1000, FORGE_BLOCK_NAMES[4]),
            ]
        );
    }
}
