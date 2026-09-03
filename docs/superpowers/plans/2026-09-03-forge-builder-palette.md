# Forge Builder Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Forge's hard-coded eight-name mutation policy with a validated, Registry-authored 27-block Builder Palette that drives metadata, WebMCP schemas, request parsing, observation, and live authoritative builds.

**Architecture:** `examples/server/registry.rs` owns the ordered palette manifest and derives each block's identifier and state-property capabilities from the real Rust `Registry`. `forge.rs` validates that manifest once while constructing the Forge World and includes it in join metadata beside `forgeRevision`. A small client palette-contract module validates the received metadata against the joined browser Registry and passes the resulting names/capabilities to the WebMCP schema, build-language parser, context response, and readiness gate.

**Tech Stack:** Rust/serde/voxelize Registry; TypeScript/Vitest/JSON Schema; Vite example client; visible Codex in-app Browser; pnpm and cargo.

**Spec:** Builder Palette contract tracked by [gching/web-mcp-forge#1](https://github.com/gching/web-mcp-forge/issues/1), delegated by the user on 2026-09-03.

## Global Constraints

- Keep exactly two page-local WebMCP tools: `get_player_context` and `build_structure`.
- Do not add assets, fetch textures, or change textures unless a selected block demonstrably lacks a usable existing texture.
- Builder Palette ordered categories and names are exact: utility `Air`; terrain `Dirt`, `Grass Block`, `Grass`, `Sand`, `Snow`; stone `Stone`, `Granite`, `Graphite`, `Marble`; wood `Oak Planks`, `Oak Slab Top`, `Oak Slab Bottom`, `Oak Log`, `Oak Leaves`, `Birch Log`; detail `Glass`, `Ivory Block`; color `White Concrete`, `Black Concrete`, `Red Concrete`, `Blue Concrete`, `Yellow Concrete`, `Orange Concrete`; lighting `Torch`, `Ember Lamp`, `Azure Lamp`.
- Exclude Water, Andesite, Slate, Obsidian, Mushroom, Oak Pole, Stairs, Green Stone, all Biome Test blocks, and novelty/debug blocks from mutation.
- Missing, malformed, duplicate, empty, or client-Registry-unknown palette metadata fails closed: no readiness and no tool registration.
- Preserve the Build Request language, 10,000-write limit, batching, canonical authoritative mutations, receipts, revision handling, and saved-world compatibility.
- Observation is broader than mutation: report all recognized Registry blocks in Spatial Target, `surfaceMap`, obstacles, and agent `blockAt`.
- Update `CONTEXT.md` and ADR 0004 to name and specify the Builder Palette contract.

---

### Task 1: Server Registry Builder Palette Manifest

**Files:**
- Modify: `examples/server/registry.rs:9-67`
- Test: `examples/server/registry.rs:tests`

**Interfaces:**
- Produces `ForgeBuildPalette` serialized as `{ blocks: ForgeBuildPaletteBlock[] }`.
- Each block is `{ id: u32, name: String, category: String, capabilities: { stage: bool, rotation: bool, yRotation: bool } }` in the server-declared order.
- Produces `forge_build_palette(&Registry) -> Result<ForgeBuildPalette, String>` and validates every configured name, canonical ID, and duplicate name/ID before serializing.

- [x] **Step 1: Write the failing server-manifest tests**

```rust
#[test]
fn builder_palette_serializes_the_exact_authoritative_27_blocks_in_order() {
    let value = serde_json::to_value(forge_build_palette(&setup_registry()).unwrap()).unwrap();
    assert_eq!(value["blocks"].as_array().unwrap().len(), 27);
    assert_eq!(value["blocks"][0]["name"], "Air");
    assert_eq!(value["blocks"][15]["name"], "Birch Log");
    assert_eq!(value["blocks"][26]["name"], "Azure Lamp");
    assert_eq!(value["blocks"][13]["capabilities"]["rotation"], true);
}
```

- [x] **Step 2: Run the example unit tests and verify the expected missing-symbol failure**

Run: `cargo test --example demo registry::tests::builder_palette_serializes_the_exact_authoritative_27_blocks_in_order`

Expected: FAIL because `forge_build_palette` does not yet exist.

- [x] **Step 3: Implement the minimal server manifest**

```rust
pub fn forge_build_palette(registry: &Registry) -> Result<ForgeBuildPalette, String> {
    let mut names = HashSet::new();
    let mut ids = HashSet::new();
    FORGE_BUILDER_PALETTE.iter().map(|entry| {
        let block = registry.try_get_block_by_name(entry.name)
            .ok_or_else(|| format!("Forge Builder Palette block is missing: {}", entry.name))?;
        if !names.insert(entry.name) || !ids.insert(block.id) {
            return Err(format!("Forge Builder Palette contains a duplicate name or id: {}", entry.name));
        }
        Ok(ForgeBuildPaletteBlock::from_registry(entry.category, block))
    }).collect()
}
```

Use the explicit 27-entry constant only as the server policy; derive `id`, `rotation`, and `yRotation` from `Block`, and expose `stage: true` because Forge's existing packed-voxel preflight accepts its bounded stage property.

- [x] **Step 4: Run the focused server test and check its result**

Run: `cargo test --example demo registry::tests::builder_palette_serializes_the_exact_authoritative_27_blocks_in_order`

Expected: PASS.

- [x] **Step 5: Add negative Registry validation coverage and run it**

```rust
#[test]
fn builder_palette_rejects_a_missing_registry_block() {
    let mut registry = setup_registry();
    registry.blocks_by_name.remove("glass");
    assert!(forge_build_palette(&registry).unwrap_err().contains("Glass"));
}
```

Run: `cargo test --example demo registry::tests`

Expected: PASS.

- [x] **Step 6: Commit the independently testable server-manifest task**

```bash
git add examples/server/registry.rs
git commit -m "feat(forge): publish Builder Palette from registry"
```

### Task 2: Authoritative Mutation Uses the Builder Palette

**Files:**
- Modify: `examples/server/worlds/shared/forge.rs:1-20,151-159,454-526`
- Test: `examples/server/worlds/shared/forge.rs:tests`

**Interfaces:**
- Consumes `forge_build_palette` from Task 1.
- `setup_forge_world` publishes `forgeBuildPalette` beside `forgeRevision` only after manifest validation succeeds.
- `resolve_block` accepts exactly Builder Palette names; it retains existing `stage`, `rotation`, and `yRotation` validation and packing.

- [x] **Step 1: Write failing direct-resolution tests**

```rust
#[test]
fn resolve_block_accepts_new_builder_materials_and_rotation() {
    let registry = crate::registry::setup_registry();
    assert!(resolve_block("Glass", &Map::new(), &registry).is_ok());
    assert!(resolve_block("Oak Slab Top", &Map::new(), &registry).is_ok());
    assert!(resolve_block("Oak Log", &json_map({"rotation": "PX"}), &registry).is_ok());
}

#[test]
fn resolve_block_rejects_excluded_registry_blocks() {
    assert!(resolve_block("Water", &Map::new(), &crate::registry::setup_registry()).is_err());
}
```

- [x] **Step 2: Run the focused example tests and verify the expected old-allowlist failure**

Run: `cargo test --example demo forge::tests::resolve_block`

Expected: FAIL because new Builder Palette names are not accepted.

- [x] **Step 3: Implement metadata publication and allow-set resolution**

```rust
let palette = forge_build_palette(world.registry()).expect("valid Forge Builder Palette");
world.set_extra_init_data("forgeBuildPalette", serde_json::to_value(palette).expect("palette JSON"));
```

Replace the static mutation lookup with Builder Palette membership from the same server-owned manifest. Do not alter write batching, receipts, persistence, or block IDs.

- [x] **Step 4: Run direct-resolution and all example tests**

Run: `cargo test --example demo`

Expected: PASS.

- [x] **Step 5: Commit the metadata/mutation task**

```bash
git add examples/server/worlds/shared/forge.rs
git commit -m "feat(forge): authorize Builder Palette mutations"
```

### Task 3: Client Palette Contract, Dynamic Parser, and Schemas

**Files:**
- Create: `examples/client/src/forge/palette.ts`
- Create: `examples/client/src/forge/palette.test.ts`
- Modify: `examples/client/src/forge/build-language.ts:1-150`
- Modify: `examples/client/src/forge/build-language.test.ts`
- Modify: `examples/client/src/forge/runtime.ts:1-370,440-680`
- Modify: `examples/client/src/forge/runtime.test.ts`

**Interfaces:**
- `parseForgeBuildPalette(raw, getBlockByName) -> ForgeBuildPalette | Error` rejects missing/malformed/empty/duplicate/unknown data.
- `parseBuildRequest(input, allowedBlockNames)` uses the received palette set for every operation.
- `buildStructureInputSchema(palette)` returns all four operation schemas whose `block.enum` is exactly the palette's ordered names.
- `ForgeRuntime` stores a valid parsed palette only after texture setup; readiness and registration require that palette.

- [x] **Step 1: Write the failing pure client-contract tests**

```ts
it("rejects duplicate, empty, malformed, and Registry-unknown palette metadata", () => {
  for (const metadata of [undefined, { blocks: [] }, duplicatePalette, unknownPalette]) {
    expect(() => parseForgeBuildPalette(metadata, knownRegistry)).toThrow();
  }
});

it("generates each build operation enum from the received Builder Palette", () => {
  const schema = buildStructureInputSchema(builderPalette);
  expect(extractOperationEnums(schema)).toEqual(Array(4).fill(BUILDER_NAMES));
});
```

- [x] **Step 2: Run these tests and verify expected missing-module/symbol failures**

Run: `pnpm exec vitest run examples/client/src/forge/palette.test.ts examples/client/src/forge/runtime.test.ts`

Expected: FAIL because the contract parser and dynamic schema do not exist.

- [x] **Step 3: Implement the fail-closed contract parser and runtime gate**

```ts
const palette = parseForgeBuildPalette(
  this.world.extraInitData.forgeBuildPalette,
  (name) => this.world.getBlockByName(name),
);
this.palette = palette;
```

The parser must require exact scalar shapes, a non-empty category, finite integer IDs matching browser Registry blocks, `stage`/`rotation`/`yRotation` booleans, unique names/IDs, and no unrecognized metadata fields. `registerWhenReady` returns false and agent readiness rejects on invalid palette; it must register neither tool.

- [x] **Step 4: Write failing request-parser cases and implement dynamic allowed-name parsing**

```ts
expect(parseBuildRequest(glassRequest, builderNames)).toMatchObject({ operations: [{ block: "Glass" }] });
expect(parseBuildRequest(waterRequest, builderNames)).toMatchObject({ ok: false });
```

Update static `ForgeBlockName` aliases to runtime `string` names constrained by the supplied validated set. Keep position, property, operation, and expanded-write validation unchanged.

- [x] **Step 5: Run focused TypeScript tests and the example client build**

Run: `pnpm exec vitest run examples/client/src/forge/palette.test.ts examples/client/src/forge/build-language.test.ts examples/client/src/forge/runtime.test.ts`

Expected: PASS.

Run: `cd examples/client && pnpm build`

Expected: exit 0.

- [x] **Step 6: Commit the client contract task**

```bash
git add examples/client/src/forge
git commit -m "feat(forge): drive WebMCP palette from join metadata"
```

### Task 4: Broaden Observation and Context Reporting

**Files:**
- Modify: `examples/client/src/forge/runtime.ts:40-120,524-543,771-842,880-963`
- Modify: `examples/client/src/forge/runtime.test.ts`

**Interfaces:**
- `getPlayerContext()` includes `availableBlocks: ForgeBuildPaletteBlock[]` exactly as validated.
- Spatial Target, `surfaceMap.topBlock`, obstacles, and agent `blockAt` preserve any non-empty Registry block, regardless of Builder Palette membership.
- Agent `blockAt` includes decoded canonical `rotation` and `yRotation` for exact acceptance assertions.

- [x] **Step 1: Write failing observation and capability-reporting tests**

```ts
it("returns Builder Palette categories and rotation capabilities in Player Context", () => {
  expect(runtime.getPlayerContext().availableBlocks).toContainEqual(
    expect.objectContaining({ name: "Oak Log", category: "wood", capabilities: { stage: true, rotation: true, yRotation: false } }),
  );
});

it("reports a recognized excluded Registry block during observation without allowing mutation", () => {
  expect(runtime.getPlayerContext().surfaceMap[0].topBlock).toBe("Water");
  expect(window.__agent__!.blockAt({ x: 0, y: 50, z: 0 })?.name).toBe("Water");
});
```

- [x] **Step 2: Run the focused runtime tests and verify the observation-filter failure**

Run: `pnpm exec vitest run examples/client/src/forge/runtime.test.ts`

Expected: FAIL because current observation filters through the old mutation set.

- [x] **Step 3: Implement broader observation and exact rotation snapshots**

Remove the mutation-palette check from read paths only. Keep the dynamic Builder Palette check in build parsing. Decode both rotation components from `BlockRotation.decode`, and return the validated palette descriptors from Player Context.

- [x] **Step 4: Run focused client tests**

Run: `pnpm exec vitest run examples/client/src/forge/palette.test.ts examples/client/src/forge/build-language.test.ts examples/client/src/forge/runtime.test.ts`

Expected: PASS.

- [x] **Step 5: Commit the reporting task**

```bash
git add examples/client/src/forge
git commit -m "feat(forge): report Builder Palette and all observed blocks"
```

### Task 5: Contract Documentation and Verification

**Files:**
- Modify: `CONTEXT.md:23-36`
- Modify: `docs/adr/0003-keep-registry-and-mutation-authority-on-the-server.md:3-7`
- Modify: `docs/adr/0004-reuse-the-chatgpt-site-arbitrary-building-contract.md:3-7`
- Modify: `docs/superpowers/plans/2026-09-03-forge-builder-palette.md`

**Interfaces:**
- Documentation calls the mutation set **Builder Palette**, gives its exact ordered category/name list, describes `forgeBuildPalette` as server Registry metadata, and records failure-closed client behavior.

- [x] **Step 1: Update documentation following tested implementation**

Replace the former palette language with Builder Palette terms and the exact contract. Preserve terminology for Build Request, Registry, Player Context, World Mutation, and Texture Readiness.

- [x] **Step 2: Run complete static verification**

Run: `cargo test --example demo`

Expected: PASS.

Run: `pnpm test`

Expected: PASS.

Run: `pnpm check`

Expected: PASS.

Run: `cd examples/client && pnpm build`

Expected: exit 0.

- [ ] **Step 3: Commit documentation and plan progress**

```bash
git add CONTEXT.md docs/adr/0004-reuse-the-chatgpt-site-arbitrary-building-contract.md docs/superpowers/plans/2026-09-03-forge-builder-palette.md
git commit -m "docs(forge): specify Builder Palette contract"
```

- [ ] **Step 4: Perform independent two-axis review and repair valid findings**

Compare `HEAD` with starting commit `3c1f6fbdb`; inspect documented standards plus the user-delegated Builder Palette requirements separately. Fix any valid critical or important finding, rerun every affected focused test and the complete verification suite, and commit the repair.

- [ ] **Step 5: Conduct live in-app Browser acceptance**

Run `pnpm demo`; use only visible Codex in-app Browser at `http://localhost:3000`. Enter the flat Forge World and verify exactly two tools; inspect 27 names/dynamic schema and Player Context categories/capabilities. Build a persisted mixed material structure with Glass, slabs, concrete, lights, and rotated logs; assert resulting blocks/rotations through the agent bridge; submit excluded Water and assert zero applied writes; reload the visible browser and reassert blocks, rotations, and revision. Keep a second participant only if the demo exposes one, then stop only task-started processes.

- [ ] **Step 6: Final clean-worktree evidence**

Run: `git status --short && git log --oneline 3c1f6fbdb..HEAD`

Expected: no uncommitted files; logical commits list all completed work.
