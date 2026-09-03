# Forge on Voxelize

Forge is a shared voxel world in which people and ChatGPT can inspect and change the same server-authoritative environment. The MVP evolves Voxelize's existing example client and server into one narrow deployed product slice.

## Language

**Forge World**:
The single persistent shared world used by the MVP. It is generated from Voxelize's flat-world pipeline and is intentionally open to anonymous participants.
_Avoid_: Demo world, test world, personal world

**Player Context**:
A fresh server-backed description of the player's position, aim, nearby surface, obstacles, and current world revision. It is advisory context for ChatGPT rather than a boundary on where a later World Mutation may write.
_Avoid_: Game state, camera dump, client context

**Spatial Target**:
The block or surface the player is currently aiming at, expressed in canonical Forge World coordinates.
_Avoid_: Cursor block, selected voxel, aim point

**World Mutation**:
A bounded, validated change applied to the authoritative Forge World and broadcast to connected participants.
_Avoid_: Client edit, renderer update, local placement

**Build Request**:
An absolute origin and ordered list of relative `fill`, `hollow_box`, `line`, or `voxels` operations submitted through `build_structure`. Blocks are named directly with the canonical Voxelize Registry names `Air`, `Dirt`, `Stone`, `Grass Block`, `Grass`, `Oak Planks`, `Oak Log`, and `Oak Leaves`.
_Avoid_: Structure Plan, build script, raw edits

**Registry**:
The server-owned catalog of stable block identities and behavior that is sent to clients when they join the Forge World.
_Avoid_: Texture list, client registry, asset manifest

**Base Palette**:
The MVP building and terrain set consisting of Dirt, Stone, Grass, Grass Block, Oak Leaves, Oak Log, and Oak Planks, rendered from the nine corresponding 16×16 top, side, and face textures already present under `examples/client/src/assets/pixel-perfection/`.
_Avoid_: Full texture pack, generated registry, all demo blocks

**Texture Readiness**:
The client state in which every Base Palette texture has finished loading and has been applied to the initialized Registry.
_Avoid_: Registry readiness, world connected, assets requested

**ChatGPT Site**:
The deployed Forge browser client that renders the Forge World and registers its page-local WebMCP tools for ChatGPT.
_Avoid_: Remote MCP server, Forge backend, ChatGPT plugin

**World Service**:
The Render-hosted Rust service that owns the Registry, Forge World, connected participants, World Mutations, and persisted world data.
_Avoid_: MCP server, asset server, client backend
