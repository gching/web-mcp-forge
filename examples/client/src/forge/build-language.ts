export const MAX_BUILD_WRITES = 10_000;

/** A name validated against the received Forge Builder Palette at parse time. */
export type ForgeBlockName = string;
export type VoxelPosition = { x: number; y: number; z: number };
export type BuildStateProperties = Record<string, string | number | boolean>;

export type BuildRequest = {
  origin: VoxelPosition;
  operations: BuildOperation[];
};

export type BuildOperation =
  | FillOperation
  | HollowBoxOperation
  | LineOperation
  | VoxelsOperation;

export type FillOperation = {
  type: "fill";
  at: VoxelPosition;
  size: VoxelPosition;
  block: ForgeBlockName;
  properties?: BuildStateProperties;
};

export type HollowBoxOperation = {
  type: "hollow_box";
  at: VoxelPosition;
  size: VoxelPosition;
  block: ForgeBlockName;
  properties?: BuildStateProperties;
};

export type LineOperation = {
  type: "line";
  from: VoxelPosition;
  to: VoxelPosition;
  block: ForgeBlockName;
  properties?: BuildStateProperties;
};

export type BuildVoxel = {
  at: VoxelPosition;
  block: ForgeBlockName;
  properties?: BuildStateProperties;
};

export type VoxelsOperation = {
  type: "voxels";
  blocks: BuildVoxel[];
};

export type ExpandedBuildWrite = {
  operationIndex: number;
  position: VoxelPosition;
  block: ForgeBlockName;
  properties: BuildStateProperties;
};

export type BuildBounds = { min: VoxelPosition; max: VoxelPosition };

export type InvalidBuildRequest = {
  ok: false;
  error: { code: "invalid_build_request"; message: string };
};

const invalid = (message: string): InvalidBuildRequest => ({
  ok: false,
  error: { code: "invalid_build_request", message },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInvalidBuildRequest = (value: unknown): value is InvalidBuildRequest =>
  isRecord(value) && value.ok === false && isRecord(value.error);

const isSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const hasOnly = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).every((key) => fields.includes(key));

const parsePosition = (
  value: unknown,
  label: string,
): VoxelPosition | InvalidBuildRequest => {
  if (
    !isRecord(value) ||
    !hasOnly(value, ["x", "y", "z"]) ||
    !isSafeInteger(value.x) ||
    !isSafeInteger(value.y) ||
    !isSafeInteger(value.z)
  ) {
    return invalid(
      `${label} must be an object containing three safe integers.`,
    );
  }
  return { x: value.x, y: value.y, z: value.z };
};

const parseProperties = (
  value: unknown,
  label: string,
): BuildStateProperties | InvalidBuildRequest | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalid(`${label} must be an object.`);

  const properties: BuildStateProperties = {};
  for (const [key, property] of Object.entries(value)) {
    if (
      !key ||
      ["__proto__", "prototype", "constructor"].includes(key) ||
      (typeof property !== "string" &&
        typeof property !== "number" &&
        typeof property !== "boolean") ||
      (typeof property === "number" && !Number.isSafeInteger(property))
    ) {
      return invalid(
        `${label} must contain only named scalar state properties with safe integer numbers.`,
      );
    }
    properties[key] = property;
  }
  return properties;
};

const parseBlock = (
  value: unknown,
  label: string,
  allowedBlockNames: ReadonlySet<string>,
): ForgeBlockName | InvalidBuildRequest => {
  if (typeof value === "string" && allowedBlockNames.has(value)) {
    return value;
  }
  return invalid(
    `${label} must be a canonical Forge Builder Palette block name.`,
  );
};

const parseRectangularOperation = (
  value: Record<string, unknown>,
  index: number,
  type: "fill" | "hollow_box",
  allowedBlockNames: ReadonlySet<string>,
): BuildOperation | InvalidBuildRequest => {
  if (
    !hasOnly(value, ["type", "at", "size", "block", "properties"]) ||
    value.type !== type
  ) {
    return invalid(`Operation ${index} contains unsupported fields.`);
  }
  const at = parsePosition(value.at, `Operation ${index}.at`);
  if ("error" in at) return at;
  const size = parsePosition(value.size, `Operation ${index}.size`);
  if ("error" in size) return size;
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
    return invalid(`Operation ${index}.size must contain positive integers.`);
  }
  const block = parseBlock(
    value.block,
    `Operation ${index}.block`,
    allowedBlockNames,
  );
  if (isRecord(block) && "error" in block) return block;
  const properties = parseProperties(
    value.properties,
    `Operation ${index}.properties`,
  );
  if (isInvalidBuildRequest(properties)) return properties;
  return {
    type,
    at,
    size,
    block,
    ...(properties ? { properties } : {}),
  } as BuildOperation;
};

const parseLineOperation = (
  value: Record<string, unknown>,
  index: number,
  allowedBlockNames: ReadonlySet<string>,
): BuildOperation | InvalidBuildRequest => {
  if (
    !hasOnly(value, ["type", "from", "to", "block", "properties"]) ||
    value.type !== "line"
  ) {
    return invalid(`Operation ${index} contains unsupported fields.`);
  }
  const from = parsePosition(value.from, `Operation ${index}.from`);
  if ("error" in from) return from;
  const to = parsePosition(value.to, `Operation ${index}.to`);
  if ("error" in to) return to;
  const block = parseBlock(
    value.block,
    `Operation ${index}.block`,
    allowedBlockNames,
  );
  if (isRecord(block) && "error" in block) return block;
  const properties = parseProperties(
    value.properties,
    `Operation ${index}.properties`,
  );
  if (isInvalidBuildRequest(properties)) return properties;
  return {
    type: "line",
    from,
    to,
    block,
    ...(properties ? { properties } : {}),
  };
};

const parseVoxelsOperation = (
  value: Record<string, unknown>,
  index: number,
  allowedBlockNames: ReadonlySet<string>,
): BuildOperation | InvalidBuildRequest => {
  if (
    !hasOnly(value, ["type", "blocks"]) ||
    value.type !== "voxels" ||
    !Array.isArray(value.blocks) ||
    value.blocks.length === 0
  ) {
    return invalid(
      `Operation ${index} must be a voxels operation with a non-empty blocks array.`,
    );
  }

  const blocks: BuildVoxel[] = [];
  for (let blockIndex = 0; blockIndex < value.blocks.length; blockIndex++) {
    const source = value.blocks[blockIndex];
    if (!isRecord(source) || !hasOnly(source, ["at", "block", "properties"])) {
      return invalid(
        `Operation ${index}.blocks[${blockIndex}] contains unsupported fields.`,
      );
    }
    const at = parsePosition(
      source.at,
      `Operation ${index}.blocks[${blockIndex}].at`,
    );
    if ("error" in at) return at;
    const block = parseBlock(
      source.block,
      `Operation ${index}.blocks[${blockIndex}].block`,
      allowedBlockNames,
    );
    if (isRecord(block) && "error" in block) return block;
    const properties = parseProperties(
      source.properties,
      `Operation ${index}.blocks[${blockIndex}].properties`,
    );
    if (isInvalidBuildRequest(properties)) return properties;
    blocks.push({
      at,
      block,
      ...(properties ? { properties } : {}),
    });
  }
  return { type: "voxels", blocks };
};

export const parseBuildRequest = (
  input: unknown,
  allowedBlockNames: ReadonlySet<string>,
): BuildRequest | InvalidBuildRequest => {
  if (allowedBlockNames.size === 0) {
    return invalid("Forge Builder Palette names are unavailable.");
  }
  if (
    !isRecord(input) ||
    !hasOnly(input, ["origin", "operations"]) ||
    !Array.isArray(input.operations) ||
    input.operations.length === 0
  ) {
    return invalid(
      "Build Requests must contain only origin and a non-empty operations array.",
    );
  }

  const origin = parsePosition(input.origin, "origin");
  if ("error" in origin) return origin;

  const operations: BuildOperation[] = [];
  for (let index = 0; index < input.operations.length; index++) {
    const operation = input.operations[index];
    if (!isRecord(operation) || typeof operation.type !== "string") {
      return invalid(
        `Operation ${index} must be an object with a supported type.`,
      );
    }
    const parsed =
      operation.type === "fill" || operation.type === "hollow_box"
        ? parseRectangularOperation(
            operation,
            index,
            operation.type,
            allowedBlockNames,
          )
        : operation.type === "line"
          ? parseLineOperation(operation, index, allowedBlockNames)
          : operation.type === "voxels"
            ? parseVoxelsOperation(operation, index, allowedBlockNames)
            : invalid(`Operation ${index} has an unsupported type.`);
    if ("error" in parsed) return parsed;
    operations.push(parsed);
  }
  return { origin, operations };
};

const absolutePosition = (
  origin: VoxelPosition,
  relative: VoxelPosition,
): VoxelPosition => ({
  x: origin.x + relative.x,
  y: origin.y + relative.y,
  z: origin.z + relative.z,
});

const appendWrite = (
  writes: ExpandedBuildWrite[],
  write: ExpandedBuildWrite,
  maximumWrites: number,
) => {
  if (writes.length >= maximumWrites) return false;
  writes.push(write);
  return true;
};

const addRectangularWrites = (
  writes: ExpandedBuildWrite[],
  operationIndex: number,
  origin: VoxelPosition,
  operation: FillOperation | HollowBoxOperation,
  maximumWrites: number,
) => {
  for (let x = 0; x < operation.size.x; x++) {
    for (let y = 0; y < operation.size.y; y++) {
      for (let z = 0; z < operation.size.z; z++) {
        const isInterior =
          x !== 0 &&
          y !== 0 &&
          z !== 0 &&
          x !== operation.size.x - 1 &&
          y !== operation.size.y - 1 &&
          z !== operation.size.z - 1;
        if (operation.type === "hollow_box" && isInterior) continue;
        if (
          !appendWrite(
            writes,
            {
              operationIndex,
              position: absolutePosition(origin, {
                x: operation.at.x + x,
                y: operation.at.y + y,
                z: operation.at.z + z,
              }),
              block: operation.block,
              properties: operation.properties ?? {},
            },
            maximumWrites,
          )
        ) {
          return;
        }
      }
    }
  }
};

// 3D Bresenham is dominant-axis based; ties are resolved x, then y, then z.
// Both client preflight and the authoritative Rust executor use this order.
const addLineWrites = (
  writes: ExpandedBuildWrite[],
  operationIndex: number,
  origin: VoxelPosition,
  operation: LineOperation,
  maximumWrites: number,
) => {
  let { x, y, z } = operation.from;
  const dx = Math.abs(operation.to.x - operation.from.x);
  const dy = Math.abs(operation.to.y - operation.from.y);
  const dz = Math.abs(operation.to.z - operation.from.z);
  const sx = operation.from.x < operation.to.x ? 1 : -1;
  const sy = operation.from.y < operation.to.y ? 1 : -1;
  const sz = operation.from.z < operation.to.z ? 1 : -1;
  const add = () =>
    appendWrite(
      writes,
      {
        operationIndex,
        position: absolutePosition(origin, { x, y, z }),
        block: operation.block,
        properties: operation.properties ?? {},
      },
      maximumWrites,
    );

  if (dx >= dy && dx >= dz) {
    let py = 2 * dy - dx;
    let pz = 2 * dz - dx;
    for (let i = 0; i <= dx; i++) {
      if (!add()) return;
      if (py >= 0) {
        y += sy;
        py -= 2 * dx;
      }
      if (pz >= 0) {
        z += sz;
        pz -= 2 * dx;
      }
      x += sx;
      py += 2 * dy;
      pz += 2 * dz;
    }
  } else if (dy >= dx && dy >= dz) {
    let px = 2 * dx - dy;
    let pz = 2 * dz - dy;
    for (let i = 0; i <= dy; i++) {
      if (!add()) return;
      if (px >= 0) {
        x += sx;
        px -= 2 * dy;
      }
      if (pz >= 0) {
        z += sz;
        pz -= 2 * dy;
      }
      y += sy;
      px += 2 * dx;
      pz += 2 * dz;
    }
  } else {
    let px = 2 * dx - dz;
    let py = 2 * dy - dz;
    for (let i = 0; i <= dz; i++) {
      if (!add()) return;
      if (px >= 0) {
        x += sx;
        px -= 2 * dz;
      }
      if (py >= 0) {
        y += sy;
        py -= 2 * dz;
      }
      z += sz;
      px += 2 * dx;
      py += 2 * dy;
    }
  }
};

export const expandBuildRequest = (
  request: BuildRequest,
  maximumWrites = MAX_BUILD_WRITES + 1,
): ExpandedBuildWrite[] => {
  const writes: ExpandedBuildWrite[] = [];
  for (const [operationIndex, operation] of request.operations.entries()) {
    if (writes.length >= maximumWrites) return writes;
    switch (operation.type) {
      case "fill":
      case "hollow_box":
        addRectangularWrites(
          writes,
          operationIndex,
          request.origin,
          operation,
          maximumWrites,
        );
        break;
      case "line":
        addLineWrites(
          writes,
          operationIndex,
          request.origin,
          operation,
          maximumWrites,
        );
        break;
      case "voxels":
        for (const voxel of operation.blocks) {
          if (
            !appendWrite(
              writes,
              {
                operationIndex,
                position: absolutePosition(request.origin, voxel.at),
                block: voxel.block,
                properties: voxel.properties ?? {},
              },
              maximumWrites,
            )
          ) {
            return writes;
          }
        }
        break;
    }
  }
  return writes;
};

export const boundsForWrites = (
  writes: ExpandedBuildWrite[],
): BuildBounds | null => {
  if (writes.length === 0) return null;
  const first = writes[0].position;
  const min = { ...first };
  const max = { ...first };
  for (const write of writes.slice(1)) {
    min.x = Math.min(min.x, write.position.x);
    min.y = Math.min(min.y, write.position.y);
    min.z = Math.min(min.z, write.position.z);
    max.x = Math.max(max.x, write.position.x);
    max.y = Math.max(max.y, write.position.y);
    max.z = Math.max(max.z, write.position.z);
  }
  return { min, max };
};
