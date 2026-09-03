import type { World } from "@voxelize/core";

import { FORGE_FACE_NAMES, FORGE_PALETTE } from "./palette";

const DIAGONAL_FACE_NAMES = ["one1", "one2", "two1", "two2"];

export async function setupForgeTextures(world: World): Promise<void> {
  const sources = [
    ...new Set(FORGE_PALETTE.flatMap((entry) => Object.values(entry.textures))),
  ];
  const loaded = new Map(
    await Promise.all(
      sources.map(async (source) => [source, await world.loader.loadImage(source)] as const),
    ),
  );

  for (const entry of FORGE_PALETTE) {
    const block = world.getBlockByName(entry.name);
    for (const [faceGroup, source] of Object.entries(entry.textures)) {
      const faceNames =
        faceGroup === "all"
          ? entry.name === "Grass"
            ? DIAGONAL_FACE_NAMES
            : FORGE_FACE_NAMES.all
          : faceGroup === "side"
            ? FORGE_FACE_NAMES.sides
            : faceGroup === "top"
              ? FORGE_FACE_NAMES.top
              : FORGE_FACE_NAMES.bottom;

      world.applyBlockTexture(block.id, faceNames, loaded.get(source)!);
    }
  }
}
