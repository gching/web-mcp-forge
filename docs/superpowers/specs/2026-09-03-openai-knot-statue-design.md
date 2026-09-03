# OpenAI-Inspired Knot Statue

## Goal

Place a large, freestanding, OpenAI-inspired knot statue ahead of the current player in the Forge world. The structure should read as a three-dimensional emblem from multiple angles and use only the world's canonical building interface.

## Form and materials

- A three-block stone plinth anchors the piece above the flat terrain.
- Six overlapping graphite arms form a stylized knot around an ivory center.
- Azure Lamp highlights identify selected arm crossings without changing the overall graphite-and-ivory palette.
- The completed statue is approximately 15 blocks wide and 13 blocks tall.

## Placement and behavior

- Read fresh player context immediately before construction.
- Choose a clear surface roughly 10 blocks forward of the player and keep all writes above the terrain surface.
- Submit the statue as ordered, bounded operations through `build_structure`; later material layers define visible overlaps.
- Confirm the resulting revision and visible in-browser state after the write completes.

## Failure handling

- If a write reports a persistence failure but the operation was applied, inspect the live scene and report that persistence is unresolved.
- Do not overwrite unrelated nearby structures or retry broad requests blindly.
