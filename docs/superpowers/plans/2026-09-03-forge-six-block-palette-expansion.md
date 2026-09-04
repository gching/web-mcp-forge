# Forge Six-Block Builder Palette Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Forge's validated Builder Palette from 27 to 33 entries with Oak Stairs, Oak Pole, Glass Pane, Slate Roof Tile, Green Concrete, and a decorative Oak Door.

**Architecture:** Keep block identity, geometry, state capabilities, and palette authorization in the Rust Registry. Move Forge palette texture application behind one awaited client helper so Texture Readiness covers the complete 33-block visual contract; the existing server metadata continues to drive Player Context, request parsing, and all four WebMCP operation schemas without adding UI or tools.

**Tech Stack:** Rust/serde/Voxelize Registry and voxel packing; TypeScript/Three.js/Vitest; Vite example client; Codex in-app Browser and `@voxelize/agent` for live acceptance.

**Spec:** `docs/superpowers/specs/2026-09-03-forge-six-block-palette-expansion-design.md`

## Global Constraints

- Keep exactly two page-local WebMCP tools: `get_player_context` and `build_structure`.
- Preserve Registry IDs 13131 for renamed `Oak Stairs`, 45 for `Oak Pole`, and 24 for renamed `Slate Roof Tile`.
- Assign unique new Registry IDs 161 to `Glass Pane`, 86 to `Green Concrete`, and 47 to `Oak Door`.
- Append the six canonical names after the existing 27 Builder Palette entries in this exact order: `Oak Stairs`, `Oak Pole`, `Glass Pane`, `Slate Roof Tile`, `Green Concrete`, `Oak Door`.
- Keep Oak Stairs horizontally rotatable through `yRotation` only; do not enable full-axis `rotation`.
- Keep Oak Door decorative and non-interactive; two identically rotated voxels form a two-block-tall door.
- Do not add automatic pane, pole, door, or stair neighbor behavior.
- Do not authorize Water, demo blocks, debug blocks, or novelty blocks for mutation.
- Preserve the Build Request language, complete preflight, 10,000-write ceiling, Voxelize last-write-wins behavior, and Build Acceptance semantics.
- Add no palette UI, inventory, new WebMCP tool, texture-pack loader, generated asset system, or compatibility aliases.
- Do not touch unrelated untracked `.scratch/` content.

---

### Task 1: Define the Six Blocks and Publish the 33-Entry Server Palette

**Files:**
- Modify: `examples/server/registry.rs:21-130`
- Modify: `examples/server/registry.rs:213-246`
- Modify: `examples/server/registry.rs:470-705`
- Test: `examples/server/registry.rs:833-883`

**Interfaces:**
- Produces: `FORGE_BUILDER_PALETTE: [ForgeBuilderPaletteEntry; 33]`.
- Produces: Registry blocks named `Oak Stairs`, `Oak Pole`, `Glass Pane`, `Slate Roof Tile`, `Green Concrete`, and `Oak Door` with the IDs and capabilities fixed by the design.
- Preserves: `forge_build_palette(&Registry) -> Result<ForgeBuildPalette, String>` as the sole metadata derivation path.

- [ ] **Step 1: Extend the exact palette snapshot test and add Registry-behavior assertions**

Rename `builder_palette_serializes_the_exact_authoritative_27_blocks_in_order` to `builder_palette_serializes_the_exact_authoritative_33_blocks_in_order`. Append these exact objects to the existing expected JSON array:

```rust
{ "id": 13131, "name": "Oak Stairs", "category": "wood", "capabilities": { "stage": true, "rotation": false, "yRotation": true } },
{ "id": 45, "name": "Oak Pole", "category": "wood", "capabilities": { "stage": true, "rotation": true, "yRotation": false } },
{ "id": 161, "name": "Glass Pane", "category": "detail", "capabilities": { "stage": true, "rotation": false, "yRotation": true } },
{ "id": 24, "name": "Slate Roof Tile", "category": "stone", "capabilities": { "stage": true, "rotation": false, "yRotation": false } },
{ "id": 86, "name": "Green Concrete", "category": "color", "capabilities": { "stage": true, "rotation": false, "yRotation": false } },
{ "id": 47, "name": "Oak Door", "category": "wood", "capabilities": { "stage": true, "rotation": false, "yRotation": true } }
```

Add a direct Registry test:

```rust
#[test]
fn palette_expansion_preserves_ids_and_static_behavior() {
    let registry = setup_registry();
    let stairs = registry.get_block_by_name("Oak Stairs");
    let pole = registry.get_block_by_name("Oak Pole");
    let pane = registry.get_block_by_name("Glass Pane");
    let slate = registry.get_block_by_name("Slate Roof Tile");
    let green = registry.get_block_by_name("Green Concrete");
    let door = registry.get_block_by_name("Oak Door");

    assert_eq!((stairs.id, pole.id, pane.id, slate.id, green.id, door.id),
               (13131, 45, 161, 24, 86, 47));
    assert!(!stairs.rotatable && stairs.y_rotatable);
    assert!(pole.rotatable && !pole.y_rotatable);
    assert!(!pane.rotatable && pane.y_rotatable && pane.is_see_through);
    assert_eq!((slate.red_light_level, slate.green_light_level, slate.blue_light_level), (0, 0, 0));
    assert!(!green.rotatable && !green.y_rotatable && !green.is_light);
    assert!(!door.rotatable && door.y_rotatable && !door.is_entity);
}
```

Update the narrow-catalog assertion from 27 to 33.

- [ ] **Step 2: Run the focused server tests and verify the expected failure**

Run:

```bash
cargo test --example demo registry::tests::builder_palette_serializes_the_exact_authoritative_33_blocks_in_order
cargo test --example demo registry::tests::palette_expansion_preserves_ids_and_static_behavior
```

Expected: FAIL because the palette still has 27 entries, the old names remain, and the three new Registry blocks do not exist.

- [ ] **Step 3: Implement the Registry names, IDs, geometry, and behavior**

Rename the existing blocks without changing their IDs:

```rust
Block::new("Oak Stairs")
    .id(13131)
    .aabbs(&stairs_aabbs)
    .faces(&stairs_faces)
    .is_x_transparent(true)
    .is_z_transparent(true)
    .y_rotatable(true)
    .y_rotatable_segments(&YRotatableSegments::Four)
    .build()
```

```rust
Block::new("Slate Roof Tile").id(24).build()
```

Keep the existing `Oak Pole` definition and ID. Add the three new definitions using centered one-eighth-depth geometry for the pane and door:

```rust
let thin_panel_faces = BlockFaces::six_faces()
    .scale_z(0.125)
    .offset_z(0.4375)
    .build();
let thin_panel_aabb = AABB::new()
    .scale_z(0.125)
    .offset_z(0.4375)
    .build();
```

```rust
Block::new("Oak Door")
    .id(47)
    .faces(&thin_panel_faces)
    .aabbs(&[thin_panel_aabb.clone()])
    .is_x_transparent(true)
    .is_z_transparent(true)
    .y_rotatable(true)
    .y_rotatable_segments(&YRotatableSegments::Four)
    .build(),
Block::new("Green Concrete").id(86).build(),
Block::new("Glass Pane")
    .id(161)
    .faces(&thin_panel_faces)
    .aabbs(&[thin_panel_aabb])
    .is_x_transparent(true)
    .is_z_transparent(true)
    .is_transparent(true)
    .is_see_through(true)
    .y_rotatable(true)
    .y_rotatable_segments(&YRotatableSegments::Four)
    .build(),
```

If `AABB` does not implement `Clone`, construct the identical door and pane AABBs separately rather than changing the shared engine type.

- [ ] **Step 4: Append the exact six Builder Palette entries**

Change the constant length to 33 and append:

```rust
ForgeBuilderPaletteEntry { name: "Oak Stairs", category: "wood" },
ForgeBuilderPaletteEntry { name: "Oak Pole", category: "wood" },
ForgeBuilderPaletteEntry { name: "Glass Pane", category: "detail" },
ForgeBuilderPaletteEntry { name: "Slate Roof Tile", category: "stone" },
ForgeBuilderPaletteEntry { name: "Green Concrete", category: "color" },
ForgeBuilderPaletteEntry { name: "Oak Door", category: "wood" },
```

- [ ] **Step 5: Run all demo Registry tests**

Run:

```bash
cargo test --example demo registry::tests
```

Expected: PASS, including exact ordering, stable IDs, unique IDs, capabilities, and catalog-width assertions.

- [ ] **Step 6: Commit the server Registry slice**

```bash
git add examples/server/registry.rs
git commit -m "feat(forge): add six Builder Palette blocks"
```

---

### Task 2: Prove Authoritative Build Resolution for the New Blocks

**Files:**
- Modify: `examples/server/worlds/shared/forge.rs:980-1015`

**Interfaces:**
- Consumes: the 33-entry `forge_build_palette(&Registry)` contract from Task 1.
- Preserves: `resolve_block(name, properties, registry) -> Result<u32, String>` and existing Voxel packing.
- Produces: regression proof that the four orientable additions accept only their supported state properties.

- [ ] **Step 1: Add failing resolver tests for all six names and orientations**

Extend the existing resolver tests with:

```rust
#[test]
fn resolve_block_accepts_all_six_palette_additions() {
    let registry = crate::registry::setup_registry();
    for name in [
        "Oak Stairs",
        "Oak Pole",
        "Glass Pane",
        "Slate Roof Tile",
        "Green Concrete",
        "Oak Door",
    ] {
        assert!(resolve_block(name, &Map::new(), &registry).is_ok(), "{name}");
    }

    let quarter_turn = Map::from_iter([
        ("yRotation".to_owned(), Value::Number(4.into())),
    ]);
    for name in ["Oak Stairs", "Glass Pane", "Oak Door"] {
        assert!(resolve_block(name, &quarter_turn, &registry).is_ok(), "{name}");
    }

    let horizontal_pole = Map::from_iter([
        ("rotation".to_owned(), Value::String("PX".to_owned())),
    ]);
    assert!(resolve_block("Oak Pole", &horizontal_pole, &registry).is_ok());
}
```

Add negative assertions that `rotation` fails for Oak Stairs and `yRotation` fails for Oak Pole.

- [ ] **Step 2: Run the focused tests and verify their initial state**

Run:

```bash
cargo test --example demo forge::tests::resolve_block
```

Expected before Task 1: FAIL for unavailable names. Expected after Task 1: PASS without production changes because `resolve_block` already derives authorization and capabilities from the Registry-authored palette.

- [ ] **Step 3: Inspect the passing behavior and keep the resolver unchanged**

Confirm the production resolver still:

- checks membership through `forge_build_palette`;
- validates `stage`, `rotation`, and `yRotation` against Registry capabilities; and
- returns a packed numeric voxel using the Registry ID.

Do not add a second allowlist or block-name switch.

- [ ] **Step 4: Commit the authoritative-resolution coverage**

```bash
git add examples/server/worlds/shared/forge.rs
git commit -m "test(forge): cover expanded palette resolution"
```

---

### Task 3: Make the 33-Block Frontend Texture Contract Explicit and Awaited

**Files:**
- Create: `examples/client/src/forge/palette-textures.ts`
- Create: `examples/client/src/forge/palette-textures.test.ts`
- Modify: `examples/client/src/world.ts:5-36`
- Modify: `examples/client/src/world.ts:120-225`

**Interfaces:**
- Produces: `applyForgeBuilderPaletteTextures(world, sources): Promise<void>`.
- Consumes: existing Vite asset URLs plus a procedural `THREE.Color` for Green Concrete.
- Guarantees: the promise resolves only after every image required by the 33-entry Builder Palette has loaded and every configured face binding has been applied.

- [ ] **Step 1: Write a failing texture-contract test using an injected fake world**

Create `palette-textures.test.ts` with a fake loader and texture writer:

```ts
it("loads and applies every expanded-palette visual before resolving", async () => {
  const TEST_SOURCES = forgePaletteTextureSourceKeys.reduce(
    (sources, key) => ({ ...sources, [key]: `${key}.png` }),
    {},
  ) as ForgePaletteTextureSources;
  TEST_SOURCES.greenConcrete = new THREE.Color("#4F9D55");
  const loaded: string[] = [];
  const applied: Array<{ idOrName: string; faceNames: string | string[]; source: unknown }> = [];
  const world = {
    loader: {
      loadImage: async (url: string) => {
        loaded.push(url);
        return { url } as unknown as HTMLImageElement;
      },
    },
    getBlockByName: (name: string) => ({
      name,
      faces: ["px", "nx", "py", "ny", "pz", "nz", "one", "two"]
        .map((faceName) => ({ name: faceName })),
    }),
    applyBlockTexture: (idOrName: string, faceNames: string | string[], source: unknown) => {
      applied.push({ idOrName, faceNames, source });
    },
  };

  await applyForgeBuilderPaletteTextures(world, TEST_SOURCES);

  expect(applied.map((entry) => entry.idOrName)).toEqual(expect.arrayContaining([
    "Oak Stairs",
    "Oak Pole",
    "Glass Pane",
    "Slate Roof Tile",
    "Green Concrete",
    "Oak Door",
  ]));
  expect(applied.find((entry) => entry.idOrName === "Oak Pole")?.source)
    .toEqual({ url: TEST_SOURCES.oakLogSide });
  expect(loaded).toEqual(expect.arrayContaining([
    TEST_SOURCES.oakPlanks,
    TEST_SOURCES.oakLogSide,
    TEST_SOURCES.oakLogTop,
    TEST_SOURCES.glass,
    TEST_SOURCES.slate,
  ]));
});
```

Add a rejection test in which `loadImage` throws for the glass URL and assert `applyForgeBuilderPaletteTextures` rejects before Texture Readiness can be marked.

Add two fail-closed cases: `getBlockByName("Glass Pane")` returns `undefined`, and a returned `Glass Pane` omits one configured face. Both calls must reject before applying any textures.

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run:

```bash
pnpm exec vitest run examples/client/src/forge/palette-textures.test.ts
```

Expected: FAIL because `palette-textures.ts` does not exist.

- [ ] **Step 3: Implement the application-level texture helper**

Define a narrow injected world interface rather than changing shared `@voxelize/core` texture APIs:

```ts
type ForgeTextureSource = string | THREE.Color;

export const forgePaletteTextureSourceKeys = [
  "dirt", "grassTop", "grassSide", "grassPlant", "stone", "sand", "snow",
  "granite", "graphite", "marble", "oakPlanks", "oakLogSide", "oakLogTop",
  "oakLeaves", "birchLogSide", "birchLogTop", "glass", "ivory", "slate",
  "orangeConcrete", "blueConcrete", "redConcrete", "whiteConcrete",
  "yellowConcrete", "blackConcrete", "greenConcrete",
] as const;

export type ForgePaletteTextureSources = Record<
  (typeof forgePaletteTextureSourceKeys)[number],
  ForgeTextureSource
>;

type ForgeTextureWorld = {
  loader: { loadImage: (url: string) => Promise<HTMLImageElement> };
  getBlockByName: (name: string) =>
    | { name: string; faces: Array<{ name: string }> }
    | undefined;
  applyBlockTexture: (
    idOrName: string,
    faceNames: string | string[],
    source: THREE.Color | HTMLImageElement,
  ) => void;
};

export const applyForgeBuilderPaletteTextures = async (
  world: ForgeTextureWorld,
  sources: ForgePaletteTextureSources,
) => {
  const imageUrls = [...new Set(Object.values(sources).filter(
    (source): source is string => typeof source === "string",
  ))];
  const loaded = new Map(
    await Promise.all(imageUrls.map(async (url) => [url, await world.loader.loadImage(url)] as const)),
  );
  const source = (value: ForgeTextureSource) =>
    typeof value === "string" ? loaded.get(value)! : value;

  for (const binding of forgePaletteTextureBindings(sources)) {
    world.applyBlockTexture(binding.idOrName, binding.faceNames, source(binding.source));
  }
};
```

Before loading images, validate every binding against `world.getBlockByName(binding.idOrName)` and the returned face-name set. Throw an error naming the missing Registry block or face. This is required because the shared `applyBlockTexture` helper silently returns when no matching face exists; Forge Texture Readiness must fail closed instead.

The binding manifest must cover all 32 visible palette entries (`Air` has no texture), including these exact new/changed bindings:

```ts
const ALL_FACES = ["px", "nx", "py", "ny", "pz", "nz"];
const SIDE_FACES = ["px", "nx", "pz", "nz"];

type ForgePaletteTextureBinding = {
  idOrName: string;
  faceNames: string | string[];
  source: ForgeTextureSource;
};

export const forgePaletteTextureBindings = (
  sources: ForgePaletteTextureSources,
): ForgePaletteTextureBinding[] => [
{ idOrName: "Oak Stairs", faceNames: ALL_FACES, source: sources.oakPlanks },
{ idOrName: "Oak Pole", faceNames: SIDE_FACES, source: sources.oakLogSide },
{ idOrName: "Oak Pole", faceNames: ["py", "ny"], source: sources.oakLogTop },
{ idOrName: "Glass Pane", faceNames: ALL_FACES, source: sources.glass },
{ idOrName: "Slate Roof Tile", faceNames: ALL_FACES, source: sources.slate },
{ idOrName: "Green Concrete", faceNames: ALL_FACES, source: sources.greenConcrete },
{ idOrName: "Oak Door", faceNames: ALL_FACES, source: sources.oakPlanks },
];
```

Include the existing 25 non-Air palette visuals in the same returned array rather than leaving duplicate palette bindings in `world.ts`.

Pass `new THREE.Color("#4F9D55")` as `greenConcrete`. Do not import or generate a new green PNG.

- [ ] **Step 4: Replace the inline Forge palette bindings in `world.ts`**

Remove the Forge palette entries from the large demo `applyBlockTextures` array, including the obsolete `Oak Pole`/`TestImage` binding and old `Slate` name. Keep unrelated demo-only bindings in place.

Call the new helper from `setupWorld` and await it:

```ts
await applyForgeBuilderPaletteTextures(world, {
  dirt: DirtImage,
  grassTop: GrassBlockImage,
  grassSide: GrassBlockSideImage,
  grassPlant: GrassImage,
  stone: StoneImage,
  sand: SandImage,
  snow: SnowImage,
  granite: GraniteImage,
  graphite: GraphiteImage,
  marble: MarbleImage,
  oakPlanks: OakPlanksImage,
  oakLogSide: OakSideImage,
  oakLogTop: OakTopImage,
  oakLeaves: OakLeavesImage,
  birchLogSide: BirchSideImage,
  birchLogTop: BirchTopImage,
  glass: GlassImage,
  ivory: IvoryBlockImage,
  orangeConcrete: OrangeConcreteImage,
  blueConcrete: BlueConcrete,
  redConcrete: RedConcreteImage,
  whiteConcrete: WhiteConcreteImage,
  yellowConcrete: YellowConcreteImage,
  blackConcrete: BlackConcreteImage,
  greenConcrete: new THREE.Color("#4F9D55"),
  slate: SlateImage,
});
```

Include the existing procedural Torch, Ember Lamp, and Azure Lamp colors in the helper's binding manifest. `setupWorld` must reject if any required palette image fails to load; `main.ts` must continue calling `markTextureReadinessComplete()` only after the awaited `setupWorld(world)` completes.

- [ ] **Step 5: Run frontend texture tests and the client build**

Run:

```bash
pnpm exec vitest run examples/client/src/forge/palette-textures.test.ts
cd examples/client && pnpm build
```

Expected: PASS; the build contains no missing imports or stale `Stairs`/`Slate` palette references.

- [ ] **Step 6: Commit the frontend texture slice**

```bash
git add examples/client/src/forge/palette-textures.ts examples/client/src/forge/palette-textures.test.ts examples/client/src/world.ts
git commit -m "feat(forge): render expanded Builder Palette"
```

---

### Task 4: Verify the Dynamic Client Contract Uses All 33 Entries

**Files:**
- Modify: `examples/client/src/forge/palette.test.ts`
- Modify: `examples/client/src/forge/build-language.test.ts`
- Modify: `examples/client/src/forge/runtime.test.ts`

**Interfaces:**
- Consumes: server-published `forgeBuildPalette` metadata.
- Preserves: `parseForgeBuildPalette`, `parseBuildRequest`, `buildStructureInputSchema`, and `ForgeRuntime` production APIs unchanged.
- Produces: client regression coverage for the six exact names and capability combinations.

- [ ] **Step 1: Add a 33-entry test palette fixture**

In the test module, define the exact ordered names and added capabilities:

```ts
const EXPANDED_NAMES = [
  "Air", "Dirt", "Grass Block", "Grass", "Sand", "Snow",
  "Stone", "Granite", "Graphite", "Marble",
  "Oak Planks", "Oak Slab Top", "Oak Slab Bottom", "Oak Log", "Oak Leaves", "Birch Log",
  "Glass", "Ivory Block",
  "White Concrete", "Black Concrete", "Red Concrete", "Blue Concrete", "Yellow Concrete", "Orange Concrete",
  "Torch", "Ember Lamp", "Azure Lamp",
  "Oak Stairs", "Oak Pole", "Glass Pane", "Slate Roof Tile", "Green Concrete", "Oak Door",
];
```

Build `ForgeBuildPalette` test metadata with the exact IDs from the design and capabilities from the server snapshot test.

- [ ] **Step 2: Add schema, parser, and Player Context assertions**

Assert that:

```ts
expect(collectBlockEnums(buildStructureInputSchema(expandedPalette)))
  .toEqual([EXPANDED_NAMES, EXPANDED_NAMES, EXPANDED_NAMES, EXPANDED_NAMES]);
expect(parseBuildRequest(sixBlockMixedRequest, new Set(EXPANDED_NAMES)))
  .toMatchObject({ operations: expect.any(Array) });
expect(parseBuildRequest(waterRequest, new Set(EXPANDED_NAMES))).toMatchObject({ ok: false });
expect(runtime.getPlayerContext().availableBlocks).toEqual(expandedPalette.blocks);
```

Use one mixed `voxels` request containing all six additions and properties `yRotation: 4` for Oak Stairs, Glass Pane, and Oak Door plus `rotation: "PX"` for Oak Pole.

- [ ] **Step 3: Run the focused client contract tests**

Run:

```bash
pnpm exec vitest run \
  examples/client/src/forge/palette.test.ts \
  examples/client/src/forge/build-language.test.ts \
  examples/client/src/forge/runtime.test.ts
```

Expected: PASS without adding client-side block switches or fallback names because the production contract is already metadata-driven.

- [ ] **Step 4: Commit the client-contract coverage**

```bash
git add examples/client/src/forge/palette.test.ts examples/client/src/forge/build-language.test.ts examples/client/src/forge/runtime.test.ts
git commit -m "test(forge): verify 33-block client contract"
```

---

### Task 5: Update the Domain Contract and ADR

**Files:**
- Modify: `CONTEXT.md:35-41`
- Modify: `docs/adr/0004-reuse-the-chatgpt-site-arbitrary-building-contract.md:5-9`

**Interfaces:**
- Produces: one canonical documented 33-entry Builder Palette list matching server order and names.
- Preserves: Build Acceptance terminology from ADR 0006.

- [ ] **Step 1: Update the Builder Palette definition**

Change 27 to 33 and append the exact six additions and capability summary. Preserve the distinction between the Registry, Builder Palette, Texture Readiness, Build Request, and Build Acceptance.

- [ ] **Step 2: Update ADR 0004 without rewriting completed history**

Record that the Builder Palette now contains the former 27 entries followed by `Oak Stairs`, `Oak Pole`, `Glass Pane`, `Slate Roof Tile`, `Green Concrete`, and `Oak Door`. State that the server metadata remains authoritative and that the client has no static production allowlist.

- [ ] **Step 3: Check documentation and name consistency**

Run:

```bash
rg -n '27-block|\[ForgeBuilderPaletteEntry; 27\]|Block::new\("Stairs"\)|Block::new\("Slate"\)' CONTEXT.md docs/adr examples/server examples/client/src
```

Expected: no stale current-contract references. Historical implementation plans may retain 27-block wording because they document completed earlier work.

- [ ] **Step 4: Commit the contract documentation**

```bash
git add CONTEXT.md docs/adr/0004-reuse-the-chatgpt-site-arbitrary-building-contract.md
git commit -m "docs(forge): specify 33-block Builder Palette"
```

---

### Task 6: Full Verification, Independent Review, and Live Acceptance

**Files:**
- Modify only if review or verification finds an in-scope defect in files listed by Tasks 1-5.
- Create: `docs/superpowers/acceptance/2026-09-03-forge-six-block-palette-expansion.md`

**Interfaces:**
- Consumes: the complete 33-block server, frontend, and documentation contract.
- Produces: fresh static, build, replication, reload, and rejection evidence.

- [ ] **Step 1: Run focused and complete static verification**

Run:

```bash
cargo test --example demo registry::tests
cargo test --example demo forge::tests
pnpm exec vitest run \
  examples/client/src/forge/palette-textures.test.ts \
  examples/client/src/forge/palette.test.ts \
  examples/client/src/forge/build-language.test.ts \
  examples/client/src/forge/runtime.test.ts
pnpm test
pnpm check
cd examples/client && pnpm build
```

Expected: every command exits 0. If an environment or toolchain prerequisite blocks a command, record it separately from an assertion failure and do not claim that check passed.

- [ ] **Step 2: Review the implementation against both the spec and repository standards**

Compare the implementation range beginning after design commit `73161c2af`. Verify exact names/IDs, palette ordering, no secondary allowlist, awaited image loading, no test-image pole binding, no interactive door behavior, and no unrelated engine or UI expansion. Repair valid in-scope findings and rerun every affected check.

- [ ] **Step 3: Start the real Forge client/server and verify tool exposure**

Run the repository's documented demo command:

```bash
pnpm demo
```

Open a fresh visible Codex in-app Browser page with agent support at `http://localhost:3000/?agent=true`. Confirm the page reaches visible playable state and exposes exactly `get_player_context` and `build_structure`. Confirm Player Context returns exactly 33 ordered `availableBlocks` entries with the specified capabilities.

- [ ] **Step 4: Build one compact six-material acceptance sample**

Read fresh Player Context and submit one bounded `voxels` Build Request containing:

- horizontally turned `Oak Stairs` with `yRotation: 4`;
- a horizontal `Oak Pole` with `rotation: "PX"`;
- turned `Glass Pane` with `yRotation: 4`;
- a small `Slate Roof Tile` roof section;
- a `Green Concrete` accent; and
- two vertically stacked, identically turned `Oak Door` voxels.

Record the returned Build Acceptance as submission evidence only.

- [ ] **Step 5: Prove rendering, replication, reload, and exclusion separately**

Use the visible page plus a second real browser participant driven through the existing `@voxelize/agent` adapter. Verify every expected coordinate, block name, and orientation after normal replication. Capture paint-settled visible evidence that oak, glass, slate, green, and door/pole geometry render correctly. Reload, regain fresh readiness, and verify the same coordinates and states again.

Submit a one-block `Water` Build Request at a known empty coordinate and verify complete preflight rejects it and the coordinate remains unchanged.

- [ ] **Step 6: Commit only acceptance evidence or required repairs**

```bash
git status --short
git log --oneline 73161c2af..HEAD
```

Preserve unrelated `.scratch/` content. Commit any acceptance document with:

```bash
git add docs/superpowers/acceptance/2026-09-03-forge-six-block-palette-expansion.md
git commit -m "docs(forge): record expanded palette acceptance"
```

Do not create a commit when there is no tracked acceptance artifact or in-scope repair.
