# Reuse the ChatGPT Site arbitrary-building contract

The Voxelize MVP will preserve the previous Forge arbitrary-building experience as a deployed ChatGPT Site with exactly two page-local WebMCP tools: `get_player_context` and `build_structure`. ChatGPT remains the architect; Forge reports Player Context and mechanically executes Build Requests rather than providing templates, another reasoning model, or Forge-owned design rules.

## Consequences

`build_structure` retains the existing absolute-origin JSON language with ordered relative `fill`, `hollow_box`, `line`, and `voxels` operations, Voxelize block names and state properties, `Air` removal, and a 10,000-expanded-write ceiling. Its accepted names are the current canonical Registry names `Air`, `Dirt`, `Stone`, `Grass Block`, `Grass`, `Oak Planks`, `Oak Log`, and `Oak Leaves`; the MVP adds no `minecraft:*` compatibility namespace. Complete preflight rejects malformed requests and unknown block states before mutation, but valid writes may replace occupied blocks, later writes win, stale context is not rejected, and a runtime failure may leave an honestly reported partial canonical result. Only one Build Request runs at a time; the MVP adds no preview, undo, rollback, conflict protection, atomicity, or recovery feature.
