import { describe, expect, it, vi } from "vitest";

import { BlockRotation } from "@voxelize/core";

import type { ForgeBuildPalette } from "./palette";
import * as runtimeModule from "./runtime";
import { buildStructureInputSchema, ForgeRuntime } from "./runtime";

const builderPalette: ForgeBuildPalette = {
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectBlockEnums = (value: unknown): string[][] => {
  if (Array.isArray(value)) return value.flatMap(collectBlockEnums);
  if (!isRecord(value)) return [];
  const direct =
    isRecord(value.block) && Array.isArray(value.block.enum)
      ? [value.block.enum.map(String)]
      : [];
  return [...direct, ...Object.values(value).flatMap(collectBlockEnums)];
};

const expectPlainJson = (value: unknown) => {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
};

const expectSafeIntegerPosition = (value: unknown) => {
  expect(value).toMatchObject({
    type: "object",
    required: ["x", "y", "z"],
    additionalProperties: false,
    properties: {
      x: {
        type: "integer",
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      y: {
        type: "integer",
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      z: {
        type: "integer",
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    },
  });
};

const expectPositiveSafeIntegerPosition = (value: unknown) => {
  expect(value).toMatchObject({
    type: "object",
    required: ["x", "y", "z"],
    additionalProperties: false,
    properties: {
      x: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      y: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      z: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    },
  });
};

describe("ForgeRuntime surface sampling", () => {
  it("reports the highest solid block when a tower stands above the floor", () => {
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    const runtime = new ForgeRuntime(
      {} as never,
      {
        extraInitData: {},
        getBlockAt: (_x: number, y: number, _z: number) => ({
          isEmpty: y !== 50 && y !== 68,
        }),
      } as never,
      {} as never,
      {} as never,
      { agentMode: false },
    );

    expect(
      (
        runtime as never as {
          findSurface: (
            y: number,
            x: number,
            z: number,
          ) => { y: number } | null;
        }
      ).findSurface(50, 0, 0),
    ).toEqual({
      x: 0,
      y: 68,
      z: 0,
    });
  });
});

describe("ForgeRuntime Builder Palette contract", () => {
  it("generates strict JSON-serializable build_structure schemas with palette names in server order", () => {
    const names = ["Air", "Glass", "Oak Log"];
    const schema = buildStructureInputSchema(builderPalette);

    expect(collectBlockEnums(schema)).toEqual([names, names, names, names]);
    expect(schema).toMatchObject({
      type: "object",
      required: ["origin", "operations"],
      additionalProperties: false,
      properties: {
        origin: {
          type: "object",
          required: ["x", "y", "z"],
          additionalProperties: false,
        },
        operations: {
          type: "array",
          minItems: 1,
        },
      },
    });
    expectPlainJson(schema);
  });

  it("describes strict valid-operation payloads", () => {
    const schema = buildStructureInputSchema(builderPalette);
    const schemaProperties = schema.properties as Record<string, unknown>;
    const operationSchemas = (
      (
        (schemaProperties.operations as Record<string, unknown>).items as Record<
          string,
          unknown
        >
      ).anyOf as Array<Record<string, unknown>>
    );
    const fillProperties = operationSchemas[0]?.properties as Record<
      string,
      unknown
    >;
    const hollowBoxProperties = operationSchemas[1]?.properties as Record<
      string,
      unknown
    >;
    const lineProperties = operationSchemas[2]?.properties as Record<
      string,
      unknown
    >;
    const voxelsProperties = operationSchemas[3]?.properties as Record<
      string,
      unknown
    >;
    const voxelItemProperties = (
      (voxelsProperties.blocks as Record<string, unknown>).items as Record<
        string,
        unknown
      >
    ).properties as Record<string, unknown>;

    expect(operationSchemas).toHaveLength(4);
    expect(operationSchemas.map((entry) => entry.required)).toEqual([
      ["type", "at", "size", "block"],
      ["type", "at", "size", "block"],
      ["type", "from", "to", "block"],
      ["type", "blocks"],
    ]);
    expect(operationSchemas.map((entry) => entry.additionalProperties)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expectSafeIntegerPosition(schemaProperties.origin);
    expectSafeIntegerPosition(fillProperties.at);
    expectPositiveSafeIntegerPosition(fillProperties.size);
    expectSafeIntegerPosition(hollowBoxProperties.at);
    expectPositiveSafeIntegerPosition(hollowBoxProperties.size);
    expectSafeIntegerPosition(lineProperties.from);
    expectSafeIntegerPosition(lineProperties.to);
    expectSafeIntegerPosition(voxelItemProperties.at);
    expect(schema).not.toHaveProperty("additionalProperties.properties");
  });

  it("exposes a strict empty get_player_context input schema", () => {
    expect(runtimeModule.getPlayerContextInputSchema).toBeDefined();
    expect(runtimeModule.getPlayerContextInputSchema.safeParse({}).success).toBe(
      true,
    );
    expect(
      runtimeModule.getPlayerContextInputSchema.safeParse({ extra: true })
        .success,
    ).toBe(false);
  });

  it("rejects malformed metadata before registering either WebMCP tool", async () => {
    const registerTool = vi.fn();
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("document", { modelContext: { registerTool } });
    const runtime = new ForgeRuntime(
      {
        connected: true,
        joined: true,
        isJoinPending: false,
        isClientOutdated: false,
        joinGeneration: 0,
      } as never,
      {
        isInitialized: true,
        extraInitData: { forgeBuildPalette: { blocks: [] } },
        options: { chunkSize: 16 },
        getChunkByCoords: () => ({ isReady: true }),
        getBlockByName: () => undefined,
      } as never,
      { position: { x: 0, y: 50, z: 0 } } as never,
      {} as never,
      { agentMode: false },
    );

    runtime.markTextureReadinessComplete();

    await expect(runtime.registerWhenReady(1)).resolves.toBe(false);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("keeps tools unavailable when palette registration uses malformed capability keys", async () => {
    const registerTool = vi.fn();
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("document", { modelContext: { registerTool } });
    const runtime = new ForgeRuntime(
      {
        connected: true,
        joined: true,
        isJoinPending: false,
        isClientOutdated: false,
        joinGeneration: 0,
      } as never,
      {
        isInitialized: true,
        extraInitData: {
          forgeRevision: 3,
          forgeBuildPalette: {
            blocks: [
              {
                id: 160,
                name: "Glass",
                category: "detail",
                capabilities: {
                  stage: true,
                  rotation: false,
                  y_rotation: false,
                },
              },
            ],
          },
        },
        options: { chunkSize: 16 },
        getChunkByCoords: () => ({ isReady: true }),
        getBlockByName: (name: string) =>
          name === "Glass" ? { id: 160, name: "Glass" } : undefined,
      } as never,
      { position: { x: 0, y: 50, z: 0 } } as never,
      {} as never,
      { agentMode: false },
    );

    runtime.markTextureReadinessComplete();

    await expect(runtime.registerWhenReady(1)).resolves.toBe(false);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("reports palette capabilities and every observed Registry block", () => {
    const registryBlocks = new Map(
      builderPalette.blocks.map((block) => [block.name, block]),
    );
    const observedBlock = (id: number, name: string) => ({
      id,
      name,
      isEmpty: false,
      isFluid: name === "Water",
      isPassable: false,
    });
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    const runtime = new ForgeRuntime(
      {
        connected: true,
        joined: true,
        isJoinPending: false,
        isClientOutdated: false,
        joinGeneration: 0,
      } as never,
      {
        isInitialized: true,
        extraInitData: { forgeBuildPalette: builderPalette },
        options: { chunkSize: 16 },
        getChunkByCoords: () => ({ isReady: true }),
        getBlockByName: (name: string) => registryBlocks.get(name),
        getBlockAt: (x: number, y: number, z: number) => {
          if (x === 0 && y === 50 && z === 0)
            return observedBlock(150, "Water");
          if (x === 0 && y === 51 && z === 0)
            return observedBlock(23, "Andesite");
          return null;
        },
        getVoxelWaterloggedAt: () => false,
        getVoxelStageAt: () => 0,
        getVoxelRotationAt: () => BlockRotation.encode(2, 0),
      } as never,
      {
        position: { x: 0, y: 52, z: 0 },
        getDirection: () => ({ x: 0, y: -1, z: 0 }),
      } as never,
      { target: [0, 50, 0] } as never,
      { agentMode: true },
    );
    (
      runtime as unknown as {
        findSurface: (
          y: number,
          x: number,
          z: number,
        ) => { x: number; y: number; z: number } | null;
      }
    ).findSurface = (_y, x, z) => (x === 0 && z === 0 ? { x, y: 50, z } : null);
    runtime.markTextureReadinessComplete();

    const context = runtime.getPlayerContext();

    expect(context).not.toHaveProperty("worldRevision");
    expect(context.availableBlocks).toEqual(builderPalette.blocks);
    expect(context.spatialTarget?.block).toMatchObject({
      name: "Water",
      rotation: 2,
    });
    expect(
      context.surfaceMap.find(
        (entry) => entry.offset.x === 0 && entry.offset.z === 0,
      )?.topBlock,
    ).toBe("Water");
    expect(context.obstacles).toContainEqual(
      expect.objectContaining({ block: "Andesite" }),
    );
    expect(window.__agent__?.blockAt({ x: 0, y: 50, z: 0 })).toMatchObject({
      name: "Water",
      rotation: 2,
    });
  });
});

const buildRequest = (block = "Glass") => ({
  origin: { x: 1, y: 50, z: 2 },
  operations: [
    {
      type: "fill",
      at: { x: 0, y: 0, z: 0 },
      size: { x: 1, y: 1, z: 1 },
      block,
    },
  ],
});

const readyRuntime = () => {
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  const registryBlocks = new Map(
    builderPalette.blocks.map((block) => [
      block.name,
      { id: block.id, name: block.name },
    ]),
  );
  const runtime = new ForgeRuntime(
    {
      connected: true,
      joined: true,
      isJoinPending: false,
      isClientOutdated: false,
      joinGeneration: 0,
    } as never,
    {
      isInitialized: true,
      extraInitData: { forgeBuildPalette: builderPalette },
      getBlockByName: (name: string) => registryBlocks.get(name),
    } as never,
    {} as never,
    {} as never,
    { agentMode: false },
  );
  runtime.markTextureReadinessComplete();
  return runtime;
};

const packetRequestId = (packet: unknown) =>
  JSON.parse(String((packet as { method: { payload: string } }).method.payload))
    .requestId as string;

const buildAcceptance = (requestId: string) => ({
  ok: true,
  outcome: "accepted",
  requestId,
  requested: 1,
  expanded: 1,
  submitted: 1,
  bounds: {
    min: { x: 1, y: 50, z: 2 },
    max: { x: 1, y: 50, z: 2 },
  },
  elapsedMs: 1,
});

describe("ForgeRuntime Build Acceptance contract", () => {
  it("returns an exact invalid acceptance for local preflight failures", async () => {
    const runtime = readyRuntime();

    await expect(runtime.buildStructure({})).resolves.toEqual({
      ok: false,
      outcome: "invalid",
      requestId: "",
      requested: 0,
      expanded: 0,
      submitted: 0,
      bounds: null,
      elapsedMs: 0,
      error: {
        code: "invalid_build_request",
        message:
          "Build Requests must contain only origin and a non-empty operations array.",
      },
    });
  });

  it("resolves from a matching acceptance without receipt or revision fields", async () => {
    const runtime = readyRuntime();
    const result = runtime.buildStructure(buildRequest());

    expect(runtime.packets).toHaveLength(1);
    const requestId = packetRequestId(runtime.packets[0]);
    const acceptance = buildAcceptance(requestId);
    runtime.onMessage({
      method: {
        name: "forge:build-result",
        payload: JSON.stringify(acceptance),
      },
    } as never);

    await expect(result).resolves.toEqual(acceptance);
  });

  it("rejects a matching legacy or otherwise forbidden response shape", async () => {
    const runtime = readyRuntime();
    const result = runtime.buildStructure(buildRequest());
    const requestId = packetRequestId(runtime.packets[0]);

    runtime.onMessage({
      method: {
        name: "forge:build-result",
        payload: JSON.stringify({
          ...buildAcceptance(requestId),
          outcome: "busy",
          revision: 4,
          persistence: "not_started",
        }),
      },
    } as never);

    await expect(result).rejects.toThrow(
      "Forge build returned an invalid Build Acceptance.",
    );
  });

  it("rejects a matching acceptance with missing required fields", async () => {
    const runtime = readyRuntime();
    const result = runtime.buildStructure(buildRequest());
    const requestId = packetRequestId(runtime.packets[0]);
    const malformed: Record<string, unknown> = buildAcceptance(requestId);
    delete malformed.submitted;

    runtime.onMessage({
      method: {
        name: "forge:build-result",
        payload: JSON.stringify(malformed),
      },
    } as never);

    await expect(result).rejects.toThrow(
      "Forge build returned an invalid Build Acceptance.",
    );
  });

  it("keeps concurrent request correlations independent", async () => {
    const runtime = readyRuntime();
    const first = runtime.buildStructure(buildRequest("Glass"));
    const second = runtime.buildStructure(buildRequest("Oak Log"));

    expect(runtime.packets).toHaveLength(2);
    const firstId = packetRequestId(runtime.packets[0]);
    const secondId = packetRequestId(runtime.packets[1]);

    runtime.onMessage({
      method: {
        name: "forge:build-result",
        payload: JSON.stringify(buildAcceptance(secondId)),
      },
    } as never);
    runtime.onMessage({
      method: {
        name: "forge:build-result",
        payload: JSON.stringify(buildAcceptance(firstId)),
      },
    } as never);

    await expect(first).resolves.toMatchObject({
      requestId: firstId,
      outcome: "accepted",
    });
    await expect(second).resolves.toMatchObject({
      requestId: secondId,
      outcome: "accepted",
    });
  });

  it("ignores an acceptance for another page or request", async () => {
    const runtime = readyRuntime();
    const result = runtime.buildStructure(buildRequest());
    const requestId = packetRequestId(runtime.packets[0]);

    runtime.onMessage({
      method: {
        name: "forge:build-result",
        payload: JSON.stringify(buildAcceptance("another-page-request")),
      },
    } as never);
    runtime.onMessage({
      method: {
        name: "forge:build-result",
        payload: JSON.stringify(buildAcceptance(requestId)),
      },
    } as never);

    await expect(result).resolves.toMatchObject({ requestId });
  });
});
