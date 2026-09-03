import { describe, expect, it } from "vitest";

import {
  FORGE_PALETTE,
  FORGE_TEXTURE_DIMENSION,
  PALETTE_NAMES,
} from "./palette";

describe("Forge base palette", () => {
  it("contains only the seven placeable MVP blocks", () => {
    expect(PALETTE_NAMES).toEqual([
      "Dirt",
      "Stone",
      "Grass Block",
      "Grass",
      "Oak Planks",
      "Oak Log",
      "Oak Leaves",
    ]);
    expect(FORGE_PALETTE).toHaveLength(7);
  });

  it("uses the crisp 16px texture contract", () => {
    expect(FORGE_TEXTURE_DIMENSION).toBe(16);
    expect(
      new Set(FORGE_PALETTE.flatMap((entry) => Object.values(entry.textures))),
    ).toHaveLength(9);
  });
});
