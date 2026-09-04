# Forge Six-Block Builder Palette Expansion Design

## Goal

Expand Forge's server-authored Builder Palette from 27 to 33 blocks with six simple, deterministic building materials that improve roofs, windows, railings, color work, and recognizable entrances without introducing interactive or simulation-heavy behavior.

## Scope

The expansion adds these canonical Registry names in this order after the current 27 entries:

1. `Oak Stairs`
2. `Oak Pole`
3. `Glass Pane`
4. `Slate Roof Tile`
5. `Green Concrete`
6. `Oak Door`

The existing two-tool WebMCP surface remains unchanged: `get_player_context` and `build_structure`. The server Registry remains the source of truth for block identity, geometry, state capabilities, persistence, and Builder Palette metadata. The browser continues to validate that metadata against its joined Registry and derive Player Context and every `build_structure` block enum from it.

## Registry identities and compatibility

Persisted voxels store numeric block IDs, so existing identities are preserved where a demo block is promoted or renamed:

| Canonical name | Registry ID | Source | Category |
| --- | ---: | --- | --- |
| `Oak Stairs` | 13131 | Rename existing `Stairs` | `wood` |
| `Oak Pole` | 45 | Promote existing block | `wood` |
| `Glass Pane` | 161 | New block adjacent to `Glass` 160 | `detail` |
| `Slate Roof Tile` | 24 | Rename existing `Slate` and remove blue light | `stone` |
| `Green Concrete` | 86 | New block following concrete IDs 80-85 | `color` |
| `Oak Door` | 47 | New block following existing wood IDs 40-46 | `wood` |

Renaming `Stairs` and `Slate` changes their Registry lookup names but not their saved voxel IDs. All Forge code, tests, texture bindings, and documentation must use only the new canonical names after the migration. No aliases are added to the Builder Palette or WebMCP schema.

## Block behavior

### Oak Stairs

Reuse the existing two-AABB stair geometry, four-way `yRotation`, transparency flags, and ID 13131. Bind all stair faces to the existing oak-planks texture. The block is static and has no neighbor-aware corner transformation.

### Oak Pole

Reuse the existing centered 0.4-by-1.0-by-0.4 geometry, collision box, full `rotation` support, and ID 45. Replace the current `cat.jpeg` side-face binding with oak-log side textures and bind the positive and negative Y faces to the oak-log top texture. The block does not connect automatically to adjacent poles or fences.

### Glass Pane

Add a centered, one-eighth-block-thick vertical pane using ID 161. It is transparent, see-through, and four-way `yRotation` capable. Bind every face to the existing glass texture. It remains a single straight segment and does not connect automatically to neighboring panes.

### Slate Roof Tile

Rename `Slate` to `Slate Roof Tile` while preserving ID 24 and its existing slate texture. Keep it as an ordinary full cube so ChatGPT can construct stepped or layered roofs using the existing Build Request language. Remove `blue_light_level(10)`; the block is non-emissive and produces no colored light.

### Green Concrete

Add an ordinary opaque full cube using ID 86. Give it no rotation, light, entity, fluid, or dynamic-pattern behavior. Bind all faces to one Forge-controlled flat green color through `THREE.Color`; do not add a new asset pipeline or derive an image from an asset with unclear reuse rights.

### Oak Door

Add a centered, one-eighth-block-thick vertical panel using ID 47. It is four-way `yRotation` capable and uses the existing oak-planks texture on every face. It is decorative and non-interactive: it has no open/closed state, hinge, handle, automatic pairing, block entity, or neighbor rule. ChatGPT creates a two-block-tall doorway by placing two identically rotated `Oak Door` voxels vertically.

## Builder Palette contract

Append the six entries to the server-owned `FORGE_BUILDER_PALETTE` in the stated order, increasing the exact count from 27 to 33. Capabilities continue to be derived from the Registry:

| Block | `stage` | `rotation` | `yRotation` |
| --- | --- | --- | --- |
| `Oak Stairs` | `true` | `false` | `true` |
| `Oak Pole` | `true` | `true` | `false` |
| `Glass Pane` | `true` | `false` | `true` |
| `Slate Roof Tile` | `true` | `false` | `false` |
| `Green Concrete` | `true` | `false` | `false` |
| `Oak Door` | `true` | `false` | `true` |

The existing fail-closed behavior remains: missing, malformed, duplicate, empty, or browser-Registry-unknown palette metadata prevents Texture Readiness and registers neither WebMCP tool. Unknown names and unsupported state properties are rejected during complete Build Request preflight.

## Texture Readiness

Texture setup must explicitly cover all six additions before Forge reports Texture Readiness:

- `Oak Stairs`: existing oak-planks texture on every face.
- `Oak Pole`: existing oak-log side and top textures on the appropriate faces.
- `Glass Pane`: existing glass texture on every face.
- `Slate Roof Tile`: existing slate texture on every face.
- `Green Concrete`: one procedural green color on every face.
- `Oak Door`: existing oak-planks texture on every face.

Any missing Registry name, face, or failed image application keeps Forge unavailable. The change does not add a texture-pack system, asset fetching, generated assets, or optional fallback visuals.

## Build and observation behavior

All six blocks work with the existing `fill`, `hollow_box`, `line`, and `voxels` operations. Later writes retain normal Voxelize last-write-wins behavior, and `Air` remains the removal block. Build Acceptance continues to mean validated and submitted, not applied, conflict-free, or persisted.

Player Context returns the exact ordered 33-block palette and capabilities. Spatial Target, surface-map, obstacle, and agent observation remain broader than the Builder Palette and continue reporting other recognized Registry blocks without authorizing their mutation.

## Verification

Static verification must prove:

- the Registry contains the exact 33-entry palette in order with unique names and IDs;
- IDs 24, 45, and 13131 remain stable through the renames/promotions;
- IDs 47, 86, and 161 are unique;
- Registry-derived capabilities match the table above;
- each of the four WebMCP operation schemas enumerates exactly the same 33 names;
- the parser accepts all six additions and continues rejecting `Water` and debug/novelty blocks;
- texture setup covers every new name and no longer binds `Oak Pole` to `cat.jpeg`;
- rotated stair, pole, pane, and door requests resolve to the intended packed state; and
- existing 27-block requests and saved-world loading remain compatible.

Live acceptance must use the real Forge page and authoritative Forge World to:

1. confirm exactly `get_player_context` and `build_structure` are registered;
2. confirm Player Context exposes the ordered 33-block palette;
3. build one compact sample containing all six additions, including non-default orientations for stairs, pole, pane, and door;
4. verify the sample through a second connected client after normal replication;
5. reload and verify the exact block IDs/names and relevant rotations again; and
6. confirm a `Water` Build Request still fails complete preflight without mutation.

Build Acceptance alone is insufficient evidence for replication or persistence; those claims require the corresponding fresh observations.

## Explicit non-goals

- Opening or closing doors.
- Hinges, handles, two-block pairing, or door block entities.
- Automatic pane, pole, fence, stair-corner, or neighbor connections.
- Water or other fluid mutation.
- New light sources or changes to the existing torch and lamp behavior.
- A texture-pack loader, asset generator, inventory UI, or Registry editor.
- Compatibility aliases for the previous `Stairs` and `Slate` names.
- Preview, undo, rollback, conflict detection, or changes to Build Acceptance semantics.
