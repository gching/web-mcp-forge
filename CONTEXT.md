# Forge on Voxelize

Forge is a shared voxel world in which people and ChatGPT can inspect and change the same server-authoritative environment. The MVP evolves Voxelize's existing example client and server into one narrow deployed product slice.

## Language

**Forge World**:
The single persistent shared world used by the MVP. It is generated from Voxelize's flat-world pipeline and is intentionally open to anonymous participants.
_Avoid_: Demo world, test world, personal world

**Player Context**:
A fresh server-backed description of the player's position, aim, nearby surface, and obstacles. It is advisory context for ChatGPT rather than a boundary on where a later World Mutation may write.
_Avoid_: Game state, camera dump, client context

**Spatial Target**:
The block or surface the player is currently aiming at, expressed in canonical Forge World coordinates.
_Avoid_: Cursor block, selected voxel, aim point

**World Mutation**:
A bounded, validated change applied to the authoritative Forge World and broadcast to connected participants.
_Avoid_: Client edit, renderer update, local placement

**Build Request**:
An absolute origin and ordered list of relative `fill`, `hollow_box`, `line`, or `voxels` operations submitted through `build_structure`. Each block name must be present in the current server-authored Builder Palette metadata.
_Avoid_: Structure Plan, build script, raw edits

**Build Acceptance**:
The immediate account that a Build Request passed complete preflight and all of its resolved writes were submitted to the authoritative Forge World update pipeline. It makes no claim about application, conflicts, world revision, or persistence.
_Avoid_: Build Receipt, success receipt, persistence result

**Registry**:
The server-owned catalog of stable block identities and behavior that is sent to clients when they join the Forge World.
_Avoid_: Texture list, client registry, asset manifest

**Builder Palette**:
The ordered 27-block mutation set derived by the Rust Registry and published as validated `forgeBuildPalette` join metadata. It contains utility `Air`; terrain `Dirt`, `Grass Block`, `Grass`, `Sand`, `Snow`; stone `Stone`, `Granite`, `Graphite`, `Marble`; wood `Oak Planks`, `Oak Slab Top`, `Oak Slab Bottom`, `Oak Log`, `Oak Leaves`, `Birch Log`; detail `Glass`, `Ivory Block`; color `White Concrete`, `Black Concrete`, `Red Concrete`, `Blue Concrete`, `Yellow Concrete`, `Orange Concrete`; and lighting `Torch`, `Ember Lamp`, `Azure Lamp`. Each entry has a canonical ID, category, and `stage`, `rotation`, and `yRotation` capabilities. Missing, malformed, empty, duplicated, or browser-Registry-unknown metadata leaves Forge WebMCP unavailable.
_Avoid_: the previous eight-block mutation whitelist, a full texture pack, a generated client registry, and all demo blocks

**Texture Readiness**:
The client state in which every Builder Palette visual has finished loading and has been applied to the initialized Registry.
_Avoid_: Registry readiness, world connected, assets requested

**ChatGPT Site**:
The deployed Forge browser client that renders the Forge World and registers its page-local WebMCP tools for ChatGPT.
_Avoid_: Remote MCP server, Forge backend, ChatGPT plugin

**World Service**:
The Render-hosted Rust service that owns the Registry, Forge World, connected participants, World Mutations, and persisted world data.
_Avoid_: MCP server, asset server, client backend
