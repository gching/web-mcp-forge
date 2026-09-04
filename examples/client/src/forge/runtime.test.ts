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
    const operationSchemas = (
      (
        ((schema.properties as Record<string, unknown>).operations as Record<
          string,
          unknown
        >).items as Record<string, unknown>
      ).oneOf as Array<Record<string, unknown>>
    );

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
        extraInitData: { forgeRevision: 3, forgeBuildPalette: { blocks: [] } },
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
        extraInitData: { forgeRevision: 8, forgeBuildPalette: builderPalette },
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
