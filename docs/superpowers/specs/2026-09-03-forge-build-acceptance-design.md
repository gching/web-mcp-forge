# Forge Build Acceptance design

**Status:** Accepted

**Date:** 2026-09-03

## Decision

Forge `build_structure` adopts Voxelize's native fire-and-forget mutation model. The server completely validates and expands a Build Request, submits every resolved write to the authoritative voxel update pipeline in one World-actor turn, and returns a Build Acceptance immediately. The response makes no claim that the values have been applied, remain present after later writes, or have been durably saved.

Forge adds no active Build Job, FIFO, job store, status tool, conflict accounting, read-back phase, overload policy, or revision. The existing 10,000-expanded-write limit remains the sole Forge admission bound for the MVP.

## Motivation

The current implementation couples an authoritative mutation result to direct synchronous chunk saves. Forge and Voxelize's normal background saver can write the same chunk through the same fixed temporary path, so one writer can report failure even when the other persists the final world. The response then reports `partial_failure` and `persistence_failed` after applied counts and revision have advanced.

The MVP does not need a transactional per-request durability guarantee. Reusing the ordinary Voxelize path removes the competing Forge chunk writer, permits multiple users to submit builds, and gives agents an immediate result whose meaning the server can prove.

## Domain contract

A **Build Acceptance** states that:

1. The whole Build Request passed parsing, bounds, block, state, shape, and expanded-write-limit validation.
2. Every resolved write was submitted to the authoritative Voxelize update pipeline.
3. No write from an invalid Build Request was submitted.

It does not state that the submitted values:

- have completed the per-tick update pipeline;
- are still present after another participant writes the same coordinates;
- were read back by Forge;
- reached durable storage; or
- belong to a committed world revision.

### Accepted response

```json
{
  "ok": true,
  "outcome": "accepted",
  "requestId": "forge-123",
  "requested": 3,
  "expanded": 480,
  "submitted": 480,
  "bounds": {
    "min": { "x": 10, "y": 4, "z": 20 },
    "max": { "x": 29, "y": 15, "z": 39 }
  },
  "elapsedMs": 7
}
```

### Rejected response

```json
{
  "ok": false,
  "outcome": "invalid",
  "requestId": "forge-123",
  "requested": 3,
  "expanded": 0,
  "submitted": 0,
  "bounds": null,
  "elapsedMs": 2,
  "error": {
    "code": "invalid_build_request",
    "message": "Build Request expands beyond the 10000-write limit."
  }
}
```

The public response has no `applied`, `revision`, `persistence`, `partial_failure`, `busy`, or `persistence_failed` state. `requestId` correlates the direct acceptance response; it does not identify retained server-side job state.

## Server flow

```text
forge:build METHOD
  -> parse envelope
  -> completely preflight and expand Build Request
       failure: send invalid Build Acceptance with submitted = 0
  -> submit every resolved write through Chunks::update_voxels
  -> send accepted Build Acceptance to the requesting client
  -> normal ChunkUpdatingSystem applies updates within its tick budget
  -> normal replication broadcasts authoritative voxel changes
  -> normal dirty-chunk path schedules background persistence
```

Submission happens only after complete preflight succeeds. Staging the resolved vector is the acceptance boundary because `Chunks::update_voxels` inserts every supplied absolute value into the World-owned update staging map without a later per-write admission decision.

Forge no longer calls `Chunks::save`, persists `forge-revision.json`, broadcasts `forge:revision`, or waits for authoritative read-back. `ForgeBuildState`, `BuildJob`, progress responses, and the global active-job `busy` response are outside the new model.

## Multiple users and conflicts

The existing `SyncWorld` actor remains the sole mutation coordinator. It handles client messages serially under the World write lock, so simultaneous network arrival does not create concurrent mutation of chunk collections.

Build Requests have no Forge-level FIFO, but actor admission still has an order. Voxelize's staging map is keyed by voxel coordinate. A later staged value replaces an earlier staged or queued value at the same coordinate; disjoint coordinates survive together.

```text
A submits (1,1,1) = Stone and (2,1,1) = Stone
B later submits (2,1,1) = Glass and (3,1,1) = Glass

Both Build Acceptances are successful.
The eventual authoritative values are Stone, Glass, Glass.
```

Forge does not report a conflict, supersession, or partial outcome. If large builds are processed across multiple ticks, the observable world may be temporarily partial. The final values follow the order in which Voxelize stages and processes coordinate updates, not client wall-clock timestamps.

## Persistence

The normal Voxelize update system marks changed chunks dirty. Its saving system snapshots dirty chunks and sends them to `BackgroundChunkSaver`, which is the sole chunk-file writer under this design. Forge makes no additional direct save.

Persistence remains eventual and world-scoped. A Build Acceptance is already final from the tool's perspective if the process later exits or background persistence fails. Those failures belong in server logs and operational monitoring rather than a retroactive per-request response.

This design removes the specific competing-writer race that produced false `persistence_failed` receipts. It does not add a durability acknowledgement to ordinary Voxelize persistence.

## Player Context and revision

Player Context remains a fresh observation of player pose, Spatial Target, nearby surface, obstacles, and the current authoritative world visible to the client. The MVP removes `forgeRevision` join metadata, `worldRevision` from Player Context, revision progress/result fields, revision broadcasts, and `forge-revision.json`.

The previous revision counted only completed Forge builds, did not cover ordinary player edits, and was not supplied back as an enforced Build Request precondition. Redefining it as an acceptance sequence would add semantics without protecting conflicts, so the MVP removes it.

## Client behavior

The page-local WebMCP tool still sends a Forge-specific METHOD containing a generated `requestId`. The server sends one direct Build Acceptance after rejection or successful submission, and the client resolves the matching tool call.

The client does not wait for progress, read-back, revision, or persistence. It has no job polling or timeout sized for build execution. An agent may call `get_player_context` later to observe the current combined world, but that observation is not a per-request verification or durability proof.

## Failure behavior

| Point | Result |
|---|---|
| Malformed envelope or request | `invalid`, `submitted: 0` |
| Invalid block, state, bounds, or shape | `invalid`, `submitted: 0` |
| More than 10,000 expanded writes | `invalid`, `submitted: 0` |
| Another Build Request is being handled | Normal actor ordering; no `busy` result |
| Later write targets the same voxel | Both requests accepted; later Voxelize value wins |
| Runtime stops after acceptance | No retroactive Build Acceptance change |
| Background save fails | World-level log/monitoring failure; no per-request result |

## Tests

### Server contract

1. A valid multi-operation request stages every expanded write and returns `accepted` with `submitted == expanded`.
2. Every preflight error returns `invalid`, `submitted == 0`, and leaves the staging/update collections unchanged.
3. A request expanding to 10,001 writes is rejected without mutation; 10,000 remains accepted.
4. Two clients submitting disjoint builds both receive `accepted`, and processing produces the union.
5. Two clients submitting overlapping builds both receive `accepted`; the value staged later by the World actor is authoritative at the overlap.
6. A second request never receives the former global `busy` result.
7. Accepted writes become dirty chunks through the ordinary update system and reach the background saving path without a direct Forge save.

### Client contract

1. `build_structure` resolves from the matching Build Acceptance.
2. Accepted and invalid responses form a discriminated union with the exact allowed fields.
3. The tool result exposes `submitted` and omits `applied`, `revision`, and `persistence`.
4. Player Context and join-readiness tests do not require `forgeRevision`.
5. Multiple independent clients can hold and resolve their own request correlations.

### Integration acceptance

1. Two live clients submit disjoint structures and converge on their union.
2. Two live clients submit overlapping structures, both receive Build Acceptance, and both converge on Voxelize's last-write-wins result.
3. After normal background saving has had time to run, a real server restart reloads the final combined world. This proves world-level eventual persistence, not a guarantee made by either Build Acceptance.
4. Rapid Forge and ordinary player writes produce no competing direct/background temporary-file failure because Forge uses no direct chunk writer.

## Deferred work

Per-request durable receipts, job status, conflict attribution, rollback, undo, enforced revision preconditions, global backpressure, rate limiting, and transactional multi-chunk persistence remain outside the MVP. Add them only in response to a demonstrated product or operational requirement.
