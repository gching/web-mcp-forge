# Split the ChatGPT Site from the Render World Service

The MVP deploys the browser in `examples/client` as a ChatGPT Site and the authoritative Rust server in `examples/server` as one Render World Service. The client connects directly to that service; the architecture adds no remote MCP server, database, background worker, or additional application backend.

## Consequences

The World Service uses one Render persistent disk for Voxelize's existing flat-world save directory so canonical changes survive browser reloads and service restarts. The MVP includes no backup, reset, recovery, or data-migration system.
