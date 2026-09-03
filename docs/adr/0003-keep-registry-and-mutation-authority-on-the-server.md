# Keep registry and mutation authority on the server

The Rust server owns stable block identities, block behavior, persistence, and all World Mutations. The browser decorates the server-provided Registry with Builder Palette visuals and exposes `get_player_context` and `build_structure`, but successful local rendering never substitutes for authoritative server application and read-back.

## Consequences

Client startup must distinguish Registry initialization from Texture Readiness. Mutation acceptance requires authoritative confirmation and visible synchronization, while persistence requires verification after a real reload rather than a successful save response alone.
