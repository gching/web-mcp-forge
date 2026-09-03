import { describe, expect, it } from "vitest";

import { parseForgeBuildPalette } from "./palette";

const knownBlocks = new Map([
  ["Air", { id: 0, name: "Air" }],
  ["Glass", { id: 160, name: "Glass" }],
  ["Oak Log", { id: 43, name: "Oak Log" }],
]);

const lookup = (name: string) => knownBlocks.get(name);

const builderPalette = {
  blocks: [
    {
      id: 0,
      name: "Air",
      category: "utility",
      capabilities: { stage: true, rotation: false, yRotation: false },
    },
    {
      id: 160,
      name: "Glass",
      category: "detail",
      capabilities: { stage: true, rotation: false, yRotation: false },
    },
    {
      id: 43,
      name: "Oak Log",
      category: "wood",
      capabilities: { stage: true, rotation: true, yRotation: false },
    },
  ],
};

describe("parseForgeBuildPalette", () => {
  it("preserves server order, category, and Registry-derived capabilities", () => {
    expect(parseForgeBuildPalette(builderPalette, lookup)).toEqual(
      builderPalette,
    );
  });

  it("rejects missing, malformed, empty, and duplicate metadata", () => {
    const duplicate = structuredClone(builderPalette);
    duplicate.blocks.push(structuredClone(duplicate.blocks[1]));

    for (const metadata of [
      undefined,
      {},
      { blocks: [] },
      { blocks: [{ name: "Air" }] },
      duplicate,
    ]) {
      expect(() => parseForgeBuildPalette(metadata, lookup)).toThrow();
    }
  });

  it("rejects a palette block that is unknown to or differs from the Registry", () => {
    const unknown = structuredClone(builderPalette);
    unknown.blocks[1].name = "Water";
    const wrongId = structuredClone(builderPalette);
    wrongId.blocks[1].id = 150;

    expect(() => parseForgeBuildPalette(unknown, lookup)).toThrow(/Registry/);
    expect(() => parseForgeBuildPalette(wrongId, lookup)).toThrow(/Registry/);
  });
});
