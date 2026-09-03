# Voxelize Agent Package Fit for Forge WebMCP

Date: 2026-09-03

## Question

Can `@voxelize/agent` simplify the Forge MVP's page-local WebMCP implementation, especially the planned `get_player_context` and `build_structure` tools?

## Conclusion

Yes, but only at two seams:

1. its bridge contracts are a useful reference for a small shared browser observation adapter; and
2. its Puppeteer driver and scenario helpers can become the deployed-world acceptance harness.

It is not an LLM agent, a WebMCP implementation, a second game client, or a server RPC layer. Forge should not put the agent daemon in the product request path, and should not implement the full `AgentBridge` for the MVP.

The main architecture gap remains a correlated request/reply protocol for authoritative builds. Voxelize's browser `Method.call()` queues a one-way `METHOD` packet, and the Rust method handler returns `()`. A successful JavaScript call therefore proves dispatch, not server application. Forge needs to add a `requestId` to each build request and have the Rust handler enqueue a direct `METHOD` result to the initiating Voxelize client. A small Forge-specific `NetIntercept` can resolve or reject the pending WebMCP promise when the matching result arrives.

## What the package is

`@voxelize/agent` launches a real Chromium player with Puppeteer and optionally exposes it through a loopback Fastify daemon. The package depends on Puppeteer, Fastify, and Zod rather than `@voxelize/core` ([package.json](../../packages/agent/package.json#L1-L52)).

The flow is:

1. `Agent.launch()` starts Chromium, seeds a per-daemon player ID, navigates to `/<world>?agent=true`, and waits for the page to install `window.__agent__` ([agent.ts](../../packages/agent/src/agent.ts#L237-L329)).
2. The page owns the actual `AgentBridge` implementation. The package only declares the contract and calls it through `page.evaluate()` ([bridge.ts](../../packages/agent/src/bridge.ts#L544-L648), [agent.ts](../../packages/agent/src/agent.ts#L716-L786)).
3. The optional daemon maps local HTTP routes such as `/healthz`, `/snapshot`, `/block`, `/screenshot`, and `/act` to those browser calls ([daemon.ts](../../packages/agent/src/daemon.ts#L623-L663), [daemon.ts](../../packages/agent/src/daemon.ts#L711-L813)).
4. Scenario helpers use application-defined methods such as `test:fill`; the agent package does not supply those server handlers ([scenario.ts](../../packages/agent/src/scenario.ts#L132-L178)).

The stock example client currently does not install `window.__agent__`. Searching `examples/client` and `packages/core` finds no `AgentBridge` or `__agent__` implementation. Adopting the package for QA therefore requires a browser-side adapter, but not necessarily the complete interface.

## What we should reuse

### 1. One shared Forge client adapter

Create a narrow Forge-owned browser adapter over the current example's `World`, `Network`, controls/raycast, Registry, `Method`, and `Events` objects. It should be the only place that interprets Voxelize runtime state.

The two product WebMCP tools call that adapter directly:

- `get_player_context` reads an observation snapshot;
- `build_structure` invokes a correlated authoritative mutation and awaits its receipt.

The optional test bridge calls the same adapter. This avoids implementing Player Context once for WebMCP and again for browser automation.

Useful `AgentBridge` ideas for the observation side are:

- pose, facing, raycast, block metadata, nearby entities, and loaded/pending chunks from `Snapshot` ([bridge.ts](../../packages/agent/src/bridge.ts#L9-L79));
- connected, joined, rejoining, outdated-client, join-generation, and pending/dropped command facts from `ConnectionSnapshot` ([bridge.ts](../../packages/agent/src/bridge.ts#L93-L121)); and
- a paint-settle primitive that drains chunk update/light/mesh work and observes two quiet frames before visual assertions ([bridge.ts](../../packages/agent/src/bridge.ts#L383-L397)).

Do not expose the whole agent snapshot as the WebMCP result. Player Context still needs the agreed Forge contract, including the bounded surface map and canonical Registry names.

### 2. Chain-wide readiness

The package's strongest pattern is that readiness is not one boolean. Its health check requires the browser, page, bridge, and world to all be alive and ready ([README.md](../../packages/agent/README.md#L17-L40)). Forge should similarly refuse WebMCP calls until the page is connected, joined, has current world/chunk data, and has completed Texture Readiness. Texture Readiness is Forge-specific and is not supplied by the agent health contract.

For `build_structure`, a disconnected or rejoining connection should fail before dispatch. The agent contract accurately distinguishes a command that was sent from one merely queued ([bridge.ts](../../packages/agent/src/bridge.ts#L93-L121)), but queueing a destructive WebMCP build across reconnect would make the eventual receipt and visible result ambiguous.

### 3. Acceptance tooling

After the Forge adapter exists, implement only the test bridge subset needed by acceptance, rather than promising the full `AgentBridge`:

- `ready`
- `snapshot()` / `position()` / `facing()` / `raycast()` / `blockAt()`
- `connection()`
- `chunks.waitFor()` and `chunks.waitForPaint()`
- `call()` if it returns the Forge correlated receipt

Then `@voxelize/agent` can supply a second real participant, reconnect/reload checks, exact block reads, screenshots, and paint-settled visual evidence. Its isolated arena lifecycle and teardown pattern is also reusable for deterministic build scenarios ([scenario.ts](../../packages/agent/src/scenario.ts#L546-L639)).

Keep the daemon loopback-only. It is a development and acceptance control plane, not the public ChatGPT Site API.

## What it does not simplify

The package does not implement or remove the need for:

- `document.modelContext` tool registration and WebMCP schemas;
- the 33 by 33 Player Context surface/obstacle calculation;
- the Forge Build Request parser and expansion for `fill`, `hollow_box`, `line`, and `voxels`;
- Registry-name and block-state validation;
- the Rust authoritative mutation executor, persistence, serialization, and world revision;
- honest batching, progress, partial-failure reporting, and the 10,000-write limit; or
- the Build Receipt returned to ChatGPT.

## The request/reply seam Forge still needs

`Method.call()` returns the packet it queued; it has no response listener or promise ([method.ts](../../packages/core/src/core/method.ts#L33-L56)). On the server, `set_method_handle` registers `Fn(&mut World, &str, &str)` and `on_method` invokes it without a return channel ([handles.rs](../../server/world/handles.rs#L34-L41), [inbound.rs](../../server/world/inbound.rs#L246-L276)).

Voxelize already demonstrates the minimum primitive needed for an application-level reply. The built-in ping handler receives a `METHOD`, creates a `vox-builtin:pong` `METHOD`, and pushes it through `MessageQueues` with `ClientFilter::Direct(client_id)` ([mod.rs](../../server/world/mod.rs#L464-L474)). The browser network accepts composable intercepts with an incoming `onMessage` handler and outgoing packet queue ([intercept.ts](../../packages/core/src/core/network/intercept.ts#L3-L38), [index.ts](../../packages/core/src/core/network/index.ts#L602-L620)). Forge should use those seams rather than change generic Voxelize RPC semantics.

Recommended MVP protocol:

```text
WebMCP build_structure
  -> Forge NetIntercept creates requestId and queues forge:build METHOD
  -> Rust validates, expands, mutates, persists, increments revision
  -> Rust queues forge:build-result METHOD with { requestId, receipt }
       through MessageQueues + ClientFilter::Direct(client_id)
  -> Forge NetIntercept matches requestId and resolves the WebMCP promise
```

The browser adapter should own timeout, duplicate-response, navigation, and disconnect cleanup. The server receipt should own canonical facts: accepted/rejected state, expanded/applied counts, revision, bounds, and partial failure when relevant. Generic `Method.call()` can remain available for ordinary fire-and-forget game actions; it should not be the WebMCP completion boundary.

This keeps the change in the example/application layer. Adding generic request/response RPC to Voxelize core would be cleaner as an upstream feature, but it is a broader engine change than the MVP requires. A separate public HTTP mutation API would duplicate the active Voxelize session boundary and is not recommended.

## Recommended Tickets 3-7

### Ticket 3: Expose Player Context through one Forge client adapter

Implement the narrow observation adapter and register `get_player_context`. Borrow the agent package's readiness, connection, snapshot, and chunk-settle concepts, while preserving the agreed Forge response schema. Keep `window.__agent__` out of this product ticket; the later acceptance ticket can wrap the same adapter without changing it.

### Ticket 4: Prove one correlated authoritative mutation

Before the full build language, implement a Forge-specific `NetIntercept`, `forge:build` request IDs, direct result `METHOD` messages, browser promise correlation, server validation, one simple `voxels` operation, persistence, read-back, and a minimal Build Receipt. This retires the highest-risk cross-language seam early.

### Ticket 5: Add the complete Build Request language

Add `fill`, `hollow_box`, `line`, and `voxels`; canonical Registry names and states; deterministic expansion; preflight; ordered last-write-wins behavior; `Air`; and the 10,000-expanded-write ceiling.

### Ticket 6: Make large operations and failures honest

Add one-at-a-time execution, bounded batching, progress, final revision, and explicit partial-result reporting. Fail destructive calls while disconnected/rejoining rather than inheriting command queueing.

### Ticket 7: Add agent-backed deployed acceptance

Install only the narrow QA bridge subset and use `@voxelize/agent` for a second participant, exact block assertions, reconnect/reload persistence, paint-settled screenshots, and scenario cleanup. Finish with the deployed ChatGPT Site invoking both page-local tools against the Render world service.

## Decision impact

The agent package does not collapse Tickets 3-7 into fewer product tasks. It makes their boundaries cleaner:

- Tickets 3-6 build the actual product path.
- Ticket 7 reuses the package instead of creating a bespoke browser/multiplayer acceptance framework.
- The same Forge adapter serves WebMCP and QA, so observation and readiness logic are not duplicated.

The new dependency order should be `3 -> 4 -> 5 -> 6 -> 7`, with Ticket 4 explicitly proving request/reply correlation before the full arbitrary-building implementation.
