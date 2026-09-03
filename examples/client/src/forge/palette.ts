export type ForgeBuildPaletteCapabilities = {
  stage: boolean;
  rotation: boolean;
  yRotation: boolean;
};

export type ForgeBuildPaletteBlock = {
  id: number;
  name: string;
  category: string;
  capabilities: ForgeBuildPaletteCapabilities;
};

export type ForgeBuildPalette = {
  blocks: ForgeBuildPaletteBlock[];
};

export type ForgeRegistryBlock = {
  id: number;
  name: string;
};

type RegistryLookup = (name: string) => ForgeRegistryBlock | null | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
};

const fail = (message: string): never => {
  throw new Error(`Invalid forgeBuildPalette metadata: ${message}`);
};

const parseCapabilities = (value: unknown): ForgeBuildPaletteCapabilities => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["stage", "rotation", "yRotation"]) ||
    typeof value.stage !== "boolean" ||
    typeof value.rotation !== "boolean" ||
    typeof value.yRotation !== "boolean"
  ) {
    return fail(
      "capabilities must contain only boolean stage, rotation, and yRotation fields.",
    );
  }
  return {
    stage: value.stage,
    rotation: value.rotation,
    yRotation: value.yRotation,
  };
};

const parseBlock = (
  value: unknown,
  index: number,
  lookup: RegistryLookup,
): ForgeBuildPaletteBlock => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "name", "category", "capabilities"]) ||
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id) ||
    value.id < 0 ||
    typeof value.name !== "string" ||
    value.name.trim() === "" ||
    typeof value.category !== "string" ||
    value.category.trim() === ""
  ) {
    return fail(`blocks[${index}] has an invalid shape.`);
  }

  const registryBlock = lookup(value.name);
  if (
    !registryBlock ||
    registryBlock.name !== value.name ||
    registryBlock.id !== value.id
  ) {
    return fail(`blocks[${index}] does not match a joined Registry block.`);
  }

  return {
    id: value.id,
    name: value.name,
    category: value.category,
    capabilities: parseCapabilities(value.capabilities),
  };
};

/**
 * Parse the server-authored Forge Builder Palette after the browser Registry
 * has initialized. No local fallback exists: tools are unavailable if this
 * payload cannot be tied back to the joined authoritative Registry.
 */
export const parseForgeBuildPalette = (
  value: unknown,
  lookup: RegistryLookup,
): ForgeBuildPalette => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["blocks"]) ||
    !Array.isArray(value.blocks) ||
    value.blocks.length === 0
  ) {
    return fail("expected a non-empty blocks array.");
  }

  const names = new Set<string>();
  const ids = new Set<number>();
  const blocks = value.blocks.map((block, index) => {
    const parsed = parseBlock(block, index, lookup);
    if (names.has(parsed.name)) {
      return fail(`blocks[${index}] duplicates name ${parsed.name}.`);
    }
    names.add(parsed.name);
    if (ids.has(parsed.id)) {
      return fail(`blocks[${index}] duplicates Registry ID ${parsed.id}.`);
    }
    ids.add(parsed.id);
    return parsed;
  });

  return { blocks };
};

export const paletteBlockNames = (palette: ForgeBuildPalette) =>
  new Set(palette.blocks.map((block) => block.name));
