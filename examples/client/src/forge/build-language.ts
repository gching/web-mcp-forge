import { z } from "zod/v4";

export const MAX_BUILD_WRITES = 10_000;

/** A name validated against the received Forge Builder Palette at parse time. */
export type ForgeBlockName = string;

const UNSAFE_STATE_PROPERTY_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const BUILD_REQUEST_MESSAGE =
  "Build Requests must contain only origin and a non-empty operations array.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeIntegerSchema = z.number().int().safe();
const positiveSafeIntegerSchema = safeIntegerSchema.positive();

const voxelPositionSchema = z.strictObject({
  x: safeIntegerSchema,
  y: safeIntegerSchema,
  z: safeIntegerSchema,
});

const positiveVoxelPositionSchema = z.strictObject({
  x: positiveSafeIntegerSchema,
  y: positiveSafeIntegerSchema,
  z: positiveSafeIntegerSchema,
});

const buildStateScalarSchema = z.union([
  z.string(),
  safeIntegerSchema,
  z.boolean(),
]);

const safeStatePropertyKeySchema = z
  .string()
  .min(1)
  .regex(/^(?!(?:__proto__|prototype|constructor)$).+/);

const INVALID_PROPERTIES_SENTINEL = "__forge_invalid_properties__";

const guardStateProperties = (input: unknown) => {
  if (!isRecord(input)) return input;

  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return INVALID_PROPERTIES_SENTINEL;
  }

  for (const key of Object.getOwnPropertyNames(input)) {
    if (!key || UNSAFE_STATE_PROPERTY_KEYS.has(key)) {
      return INVALID_PROPERTIES_SENTINEL;
    }
  }

  return input;
};

const buildStatePropertiesSchema = z.preprocess(
  guardStateProperties,
  z.record(safeStatePropertyKeySchema, buildStateScalarSchema),
);

const blockNameSchema = (allowedBlockNames: ReadonlySet<string>) => {
  const blockNames = Array.from(allowedBlockNames);
  return blockNames.length === 0
    ? z.never()
    : z.enum([blockNames[0], ...blockNames.slice(1)]);
};

const fillOperationSchema = (
  block: ReturnType<typeof blockNameSchema>,
) =>
  z.strictObject({
    type: z.literal("fill"),
    at: voxelPositionSchema,
    size: positiveVoxelPositionSchema,
    block,
    properties: buildStatePropertiesSchema.optional(),
  });

const hollowBoxOperationSchema = (
  block: ReturnType<typeof blockNameSchema>,
) =>
  z.strictObject({
    type: z.literal("hollow_box"),
    at: voxelPositionSchema,
    size: positiveVoxelPositionSchema,
    block,
    properties: buildStatePropertiesSchema.optional(),
  });

const lineOperationSchema = (block: ReturnType<typeof blockNameSchema>) =>
  z.strictObject({
    type: z.literal("line"),
    from: voxelPositionSchema,
    to: voxelPositionSchema,
    block,
    properties: buildStatePropertiesSchema.optional(),
  });

const buildVoxelSchema = (block: ReturnType<typeof blockNameSchema>) =>
  z.strictObject({
    at: voxelPositionSchema,
    block,
    properties: buildStatePropertiesSchema.optional(),
  });

const voxelsOperationSchema = (block: ReturnType<typeof blockNameSchema>) =>
  z.strictObject({
    type: z.literal("voxels"),
    blocks: z.array(buildVoxelSchema(block)).min(1),
  });

const buildOperationSchema = (block: ReturnType<typeof blockNameSchema>) =>
  z.discriminatedUnion("type", [
    fillOperationSchema(block),
    hollowBoxOperationSchema(block),
    lineOperationSchema(block),
    voxelsOperationSchema(block),
  ]);

export const buildRequestSchema = (allowedBlockNames: ReadonlySet<string>) =>
  z.strictObject({
    origin: voxelPositionSchema,
    operations: z.array(buildOperationSchema(blockNameSchema(allowedBlockNames))).min(1),
  });

export type VoxelPosition = z.infer<typeof voxelPositionSchema>;
export type BuildStateProperties = z.infer<typeof buildStatePropertiesSchema>;
export type FillOperation = z.infer<ReturnType<typeof fillOperationSchema>>;
export type HollowBoxOperation = z.infer<
  ReturnType<typeof hollowBoxOperationSchema>
>;
export type LineOperation = z.infer<ReturnType<typeof lineOperationSchema>>;
export type BuildVoxel = z.infer<ReturnType<typeof buildVoxelSchema>>;
export type VoxelsOperation = z.infer<ReturnType<typeof voxelsOperationSchema>>;
export type BuildOperation = z.infer<ReturnType<typeof buildOperationSchema>>;
export type BuildRequest = z.infer<ReturnType<typeof buildRequestSchema>>;

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

const messageForPosition = (label: string) =>
  `${label} must be an object containing three safe integers.`;

const messageForProperties = (label: string) =>
  `${label} must contain only named scalar state properties with safe integer numbers.`;

const sourceOperation = (input: unknown, index: number) => {
  if (!isRecord(input) || !Array.isArray(input.operations)) return undefined;
  return input.operations[index];
};

const normalizeProperties = (
  properties?: BuildStateProperties,
): BuildStateProperties | undefined =>
  properties ? { ...properties } : undefined;

const normalizeBuildRequest = (request: BuildRequest): BuildRequest => ({
  origin: request.origin,
  operations: request.operations.map((operation) => {
    switch (operation.type) {
      case "fill":
      case "hollow_box":
      case "line":
        return {
          ...operation,
          ...(operation.properties
            ? { properties: normalizeProperties(operation.properties) }
            : {}),
        };
      case "voxels":
        return {
          ...operation,
          blocks: operation.blocks.map((voxel) => ({
            ...voxel,
            ...(voxel.properties
              ? { properties: normalizeProperties(voxel.properties) }
              : {}),
          })),
        };
    }
  }),
});

const mapBuildRequestIssue = (
  input: unknown,
  issue: { code: string; path: PropertyKey[] },
) => {
  const [root, operationIndex, field, nestedIndex, nestedField] = issue.path;

  if (root === "origin") {
    return messageForPosition("origin");
  }

  if (root !== "operations" || typeof operationIndex !== "number") {
    return BUILD_REQUEST_MESSAGE;
  }

  const operation = sourceOperation(input, operationIndex);

  if (
    field === "at" ||
    field === "from" ||
    field === "to" ||
    (field === "blocks" &&
      typeof nestedIndex === "number" &&
      nestedField === "at")
  ) {
    const label =
      field === "blocks"
        ? `Operation ${operationIndex}.blocks[${String(nestedIndex)}].at`
        : `Operation ${operationIndex}.${String(field)}`;
    return messageForPosition(label);
  }

  if (field === "size") {
    return issue.code === "too_small"
      ? `Operation ${operationIndex}.size must contain positive integers.`
      : messageForPosition(`Operation ${operationIndex}.size`);
  }

  if (field === "block") {
    return `Operation ${operationIndex}.block must be a canonical Forge Builder Palette block name.`;
  }

  if (field === "properties") {
    return messageForProperties(`Operation ${operationIndex}.properties`);
  }

  if (field === "blocks" && typeof nestedIndex !== "number") {
    return `Operation ${operationIndex} must be a voxels operation with a non-empty blocks array.`;
  }

  if (field === "blocks" && typeof nestedIndex === "number") {
    if (nestedField === "block") {
      return `Operation ${operationIndex}.blocks[${String(nestedIndex)}].block must be a canonical Forge Builder Palette block name.`;
    }

    if (nestedField === "properties") {
      return messageForProperties(
        `Operation ${operationIndex}.blocks[${String(nestedIndex)}].properties`,
      );
    }

    return `Operation ${operationIndex}.blocks[${String(nestedIndex)}] contains unsupported fields.`;
  }

  if (field === "type") {
    return isRecord(operation) && typeof operation.type === "string"
      ? `Operation ${operationIndex} has an unsupported type.`
      : `Operation ${operationIndex} must be an object with a supported type.`;
  }

  if (
    issue.code === "unrecognized_keys" &&
    isRecord(operation) &&
    operation.type === "voxels"
  ) {
    return `Operation ${operationIndex} must be a voxels operation with a non-empty blocks array.`;
  }

  if (issue.code === "unrecognized_keys") {
    return `Operation ${operationIndex} contains unsupported fields.`;
  }

  return `Operation ${operationIndex} must be an object with a supported type.`;
};

export const parseBuildRequest = (
  input: unknown,
  allowedBlockNames: ReadonlySet<string>,
): BuildRequest | InvalidBuildRequest => {
  if (allowedBlockNames.size === 0) {
    return invalid("Forge Builder Palette names are unavailable.");
  }

  const result = buildRequestSchema(allowedBlockNames).safeParse(input);

  if (!result.success) {
    return invalid(
      mapBuildRequestIssue(input, result.error.issues[0] as never),
    );
  }

  return normalizeBuildRequest(result.data);
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
