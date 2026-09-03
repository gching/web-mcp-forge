import dirtTexture from "../assets/pixel-perfection/dirt.png";
import grassTexture from "../assets/pixel-perfection/grass.png";
import grassSideTexture from "../assets/pixel-perfection/grass_side.png";
import grassTopTexture from "../assets/pixel-perfection/grass_top.png";
import leavesOakTexture from "../assets/pixel-perfection/leaves_oak.png";
import logOakSideTexture from "../assets/pixel-perfection/log_oak_side.png";
import logOakTopTexture from "../assets/pixel-perfection/log_oak_top.png";
import planksOakTexture from "../assets/pixel-perfection/planks_oak.png";
import stoneTexture from "../assets/pixel-perfection/stone.png";

export const FORGE_TEXTURE_DIMENSION = 16;

export type ForgePaletteEntry = {
  name: string;
  textures: Record<string, string>;
};

export const FORGE_PALETTE: ForgePaletteEntry[] = [
  { name: "Dirt", textures: { all: dirtTexture } },
  { name: "Stone", textures: { all: stoneTexture } },
  {
    name: "Grass Block",
    textures: {
      top: grassTopTexture,
      side: grassSideTexture,
      bottom: dirtTexture,
    },
  },
  { name: "Grass", textures: { all: grassTexture } },
  { name: "Oak Planks", textures: { all: planksOakTexture } },
  {
    name: "Oak Log",
    textures: { side: logOakSideTexture, top: logOakTopTexture, bottom: logOakTopTexture },
  },
  { name: "Oak Leaves", textures: { all: leavesOakTexture } },
];

export const PALETTE_NAMES = FORGE_PALETTE.map(({ name }) => name);

export const FORGE_FACE_NAMES = {
  all: ["px", "nx", "py", "ny", "pz", "nz"],
  sides: ["px", "nx", "pz", "nz"],
  top: ["py"],
  bottom: ["ny"],
};
