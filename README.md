# Forge

Forge is a browser-based voxel world where people can explore, point at a location, and ask ChatGPT to build what they imagine.

Using WebMCP, ChatGPT can understand the player's position, target, and nearby terrain, then construct and modify structures directly in the live world.

## Running locally

### Prerequisites

- Rust 1.90 or newer
- Node.js
- pnpm
- `cargo-watch`
- `wasm-pack`
- `protoc`

### Setup

```bash
pnpm install
pnpm proto
pnpm build
pnpm demo
```

Open [http://localhost:3000](http://localhost:3000).

The browser client runs on port `3000` and the world server runs on port `4000`.

## Deployment

Forge is deployed using:

- [`examples/client`](examples/client) is the deployed **ChatGPT Site** frontend and hosts the WebMCP experience.
- [`examples/server`](examples/server) is the deployed **Render** backend: the authoritative world server and persistent world data.

The WebMCP tool specification starts in
[`examples/client/src/forge/runtime.ts`](examples/client/src/forge/runtime.ts#L340),
at `toolDefinitions`.

## Based on Voxelize

Forge is based on [Voxelize](https://github.com/voxelize/voxelize), an open-source multiplayer voxel engine for the browser.

The original Voxelize copyright and license notice are preserved.

## Assets Used

- [Connection Serif Font](https://fonts2u.com/connection-serif.font), licensed under the SIL Open Font License
- Pixel Perfection by XSSheep, modified and licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

## License

Forge source code is available under the [MIT License](LICENSE).

Third-party assets remain available under their respective licenses.
