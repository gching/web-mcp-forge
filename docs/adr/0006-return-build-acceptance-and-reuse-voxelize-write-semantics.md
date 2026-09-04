# Return Build Acceptance and reuse Voxelize write semantics

Forge `build_structure` will completely preflight a Build Request, submit every resolved write to the authoritative Voxelize update pipeline, and immediately return a Build Acceptance. Multiple accepted requests use the World actor's existing serial admission and per-voxel last-write-wins behavior; Forge adds no active-job gate, FIFO, job status, conflict accounting, read-back, revision, or per-request persistence result. This deliberately favors the multiplayer engine's native fire-and-forget model over a transactional Build Receipt.

This decision supersedes ADR 0003 only where mutation acceptance required authoritative read-back, and ADR 0004 where it required one active Build Request and an honestly reported runtime partial result. Server authority, complete preflight, the 10,000-write ceiling, and the Build Request language remain unchanged.

## Consequences

`ok: true` means fully validated and submitted, never applied or durably saved. Forge stops writing chunks and its revision file directly; ordinary dirty-chunk persistence has one background writer. Later accepted writes may replace earlier writes, background persistence failures remain world-level operational failures, and fresh Player Context—not a Forge revision—is the agent's observational source.
