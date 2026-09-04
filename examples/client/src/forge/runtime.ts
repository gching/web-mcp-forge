import { BlockRotation } from "@voxelize/core";
import type * as VOXELIZE from "@voxelize/core";
import { z } from "zod/v4";

import type {
  BuildBounds,
  BuildRequest,
  BuildStateProperties,
  VoxelPosition,
} from "./build-language";
import {
  MAX_BUILD_WRITES,
  buildRequestSchema,
  expandBuildRequest,
  parseBuildRequest,
} from "./build-language";
import {
  type ForgeBuildPalette,
  type ForgeBuildPaletteBlock,
  paletteBlockNames,
  parseForgeBuildPalette,
} from "./palette";

type Message = NonNullable<VOXELIZE.NetIntercept["packets"]>[number];
type ModelContextTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: ModelContextTool) => void | Promise<void>;
};

type ForgeBlockInfo = {
  id: number;
  name: string;
  isEmpty: boolean;
  isFluid: boolean;
  isPassable: boolean;
  isWaterlogged: boolean;
  stage: number;
  rotation: number;
  yRotation: number;
};

type ForgeRaycastHit = {
  block: ForgeBlockInfo | null;
  entity: null;
  position: VoxelPosition;
  distance: number;
  face: ForgeFace;
  normal: VoxelPosition;
};

type ForgeFace = "bottom" | "top" | "north" | "south" | "west" | "east";

type ForgeContext = {
  player: {
    position: VoxelPosition;
    orientation: { yaw: number; pitch: number };
    facing: "north" | "east" | "south" | "west";
    viewDirection: VoxelPosition;
  };
  spatialTarget: (ForgeRaycastHit & { block: ForgeBlockInfo | null }) | null;
  surfaceMap: Array<{
    offset: { x: number; z: number };
    position: VoxelPosition | null;
    height: number | null;
    topBlock: string | null;
  }>;
  obstacles: Array<{
    position: VoxelPosition;
    block: string;
    properties: BuildStateProperties;
  }>;
  availableBlocks: ForgeBuildPaletteBlock[];
};

type BuildAcceptance = {
  ok: true;
  outcome: "accepted";
  requestId: string;
  requested: number;
  expanded: number;
  submitted: number;
  bounds: BuildBounds | null;
  elapsedMs: number;
};

type InvalidBuildAcceptance = {
  ok: false;
  outcome: "invalid";
  requestId: string;
  requested: number;
  expanded: 0;
  submitted: 0;
  bounds: null;
  elapsedMs: number;
  error: { code: "invalid_build_request"; message: string };
};

type BuildResponse = BuildAcceptance | InvalidBuildAcceptance;

type AgentEventListener = (data: unknown) => void;

type ForgeAgentBridge = {
  readonly ready: Promise<void>;
  position: () => VoxelPosition;
  facing: () => { yaw: number; pitch: number };
  raycast: () => ForgeRaycastHit | null;
  blockAt: (position: VoxelPosition) => ForgeBlockInfo | null;
  snapshot: () => Promise<unknown>;
  connection: () => {
    isConnected: boolean;
    isJoined: boolean;
    isJoinPending: boolean;
    isClientOutdated: boolean;
    joinGeneration: number;
    pendingCommandCount: number;
    droppedCommandCount: number;
    serverUrl: string | null;
  };
  chunks: {
    state: (
      target: VoxelPosition | { cx: number; cz: number },
    ) => "loaded" | "pending" | "unloaded";
    waitFor: (
      position: VoxelPosition,
      radius?: number,
      timeoutMs?: number,
    ) => Promise<void>;
    loaded: () => Array<{ cx: number; cz: number }>;
    pending: () => Array<{ cx: number; cz: number }>;
    list: () => Array<{
      coord: { cx: number; cz: number };
      state: "loaded" | "pending" | "unloaded";
    }>;
    waitForPaint: (options?: {
      timeoutMs?: number;
    }) => Promise<{ isSettled: boolean; elapsedMs: number }>;
  };
  call: (method: string, payload: unknown) => Promise<unknown>;
  teleport: (position: VoxelPosition) => Promise<void>;
  face: (input: {
    yaw?: number;
    pitch?: number;
    direction?: VoxelPosition;
  }) => Promise<void>;
  setFlying: (isFlying: boolean) => Promise<void>;
  on: (event: string, listener: AgentEventListener) => () => void;
};

declare global {
  interface Window {
    __agent__?: ForgeAgentBridge;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asMessageMethod = (message: Message) => {
  const candidate = message as Message & {
    method?: { name?: unknown; payload?: unknown };
  };
  if (!candidate.method || typeof candidate.method.name !== "string") {
    return null;
  }
  return {
    name: candidate.method.name,
    payload: candidate.method.payload,
  };
};

const parseMessagePayload = (
  payload: unknown,
): Record<string, unknown> | null => {
  if (typeof payload !== "string") return isRecord(payload) ? payload : null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const invalidBuildAcceptance = (message: string): InvalidBuildAcceptance => ({
  ok: false,
  outcome: "invalid",
  requestId: "",
  requested: 0,
  expanded: 0,
  submitted: 0,
  bounds: null,
  elapsedMs: 0,
  error: { code: "invalid_build_request", message },
});

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  );
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPosition = (value: unknown): value is VoxelPosition => {
  if (!isRecord(value) || !hasExactKeys(value, ["x", "y", "z"])) return false;
  return (
    Number.isSafeInteger(value.x) &&
    Number.isSafeInteger(value.y) &&
    Number.isSafeInteger(value.z)
  );
};

const isBounds = (value: unknown): value is BuildBounds | null => {
  if (value === null) return true;
  if (!isRecord(value) || !hasExactKeys(value, ["min", "max"])) return false;
  return isPosition(value.min) && isPosition(value.max);
};

const parseBuildResponse = (
  value: Record<string, unknown>,
  requestId: string,
): BuildResponse | null => {
  if (value.requestId !== requestId || !isNonNegativeInteger(value.requested)) {
    return null;
  }
  if (
    value.ok === true &&
    value.outcome === "accepted" &&
    hasExactKeys(value, [
      "ok",
      "outcome",
      "requestId",
      "requested",
      "expanded",
      "submitted",
      "bounds",
      "elapsedMs",
    ]) &&
    isNonNegativeInteger(value.expanded) &&
    value.submitted === value.expanded &&
    isBounds(value.bounds) &&
    typeof value.elapsedMs === "number" &&
    Number.isFinite(value.elapsedMs) &&
    value.elapsedMs >= 0
  ) {
    return value as unknown as BuildAcceptance;
  }
  if (
    value.ok === false &&
    value.outcome === "invalid" &&
    hasExactKeys(value, [
      "ok",
      "outcome",
      "requestId",
      "requested",
      "expanded",
      "submitted",
      "bounds",
      "elapsedMs",
      "error",
    ]) &&
    value.expanded === 0 &&
    value.submitted === 0 &&
    value.bounds === null &&
    typeof value.elapsedMs === "number" &&
    Number.isFinite(value.elapsedMs) &&
    value.elapsedMs >= 0 &&
    isRecord(value.error) &&
    hasExactKeys(value.error, ["code", "message"]) &&
    value.error.code === "invalid_build_request" &&
    typeof value.error.message === "string"
  ) {
    return value as unknown as InvalidBuildAcceptance;
  }
  return null;
};

const makeRequestId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `forge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const toPosition = (value: {
  x: number;
  y: number;
  z: number;
}): VoxelPosition => ({
  x: value.x,
  y: value.y,
  z: value.z,
});

const faceForNormal = (normal: VoxelPosition): ForgeFace => {
  if (normal.y < 0) return "bottom";
  if (normal.y > 0) return "top";
  if (normal.x < 0) return "west";
  if (normal.x > 0) return "east";
  if (normal.z < 0) return "north";
  return "south";
};

const cardinalFacing = (yaw: number): "north" | "east" | "south" | "west" => {
  const degrees = ((yaw * 180) / Math.PI) % 360;
  const normalized = (degrees + 360) % 360;
  if (normalized >= 315 || normalized < 45) return "north";
  if (normalized < 135) return "east";
  if (normalized < 225) return "south";
  return "west";
};

const propertySnapshot = (block: ForgeBlockInfo): BuildStateProperties => ({
  stage: block.stage,
  rotation: block.rotation,
  yRotation: block.yRotation,
});

const toDraft7JsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "draft-7" });

export const getPlayerContextInputSchema = z.strictObject({});

export const buildStructureInputSchema = (palette: ForgeBuildPalette) =>
  toDraft7JsonSchema(buildRequestSchema(paletteBlockNames(palette)));

const toolDefinitions = (
  runtime: ForgeRuntime,
  palette: ForgeBuildPalette,
): ModelContextTool[] => [
  {
    name: "get_player_context",
    title: "Get Player Context",
    description:
      "Read fresh Player Context from this page: the live player pose and view, current Spatial Target, a fixed 33-by-33 nearby surface map, non-air obstacles above it, and canonical Forge block names. The observed region is advisory and does not limit a later Build Request.",
    inputSchema: toDraft7JsonSchema(getPlayerContextInputSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    execute: async () => runtime.getPlayerContext(),
  },
  {
    name: "build_structure",
    title: "Build Structure",
    description:
      "Apply an exact ordered Forge Build Request to the authoritative shared world. Requests use one absolute origin and relative fill, hollow_box, line, or voxels operations; later writes win, Air removes blocks, and the expanded request is limited to 10,000 writes.",
    inputSchema: buildStructureInputSchema(palette),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    execute: async (input, options) =>
      runtime.buildStructure(input, options?.signal),
  },
];

export type ForgeRuntimeOptions = {
  agentMode?: boolean;
};

/**
 * The only application-level seam used by Forge WebMCP and test automation.
 * It deliberately owns no identity: the Network and World objects are closed
 * over by the page that created this instance.
 */
export class ForgeRuntime implements VOXELIZE.NetIntercept {
  public packets: Message[] = [];

  private textureReady = false;
  private toolsRegistered = false;
  private palette: ForgeBuildPalette | null = null;
  private paletteError: Error | null = null;
  private readonly pendingBuilds = new Map<
    string,
    {
      packet: Message;
      resolve: (response: BuildResponse) => void;
      reject: (error: Error) => void;
      abortCleanup?: () => void;
    }
  >();
  private readonly agentMode: boolean;
  private readonly agentReady: Promise<void>;
  private resolveAgentReady!: () => void;
  private rejectAgentReady!: (error: Error) => void;
  private readonly listeners = new Map<string, Set<AgentEventListener>>();

  constructor(
    private readonly network: VOXELIZE.Network,
    private readonly world: VOXELIZE.World,
    private readonly controls: VOXELIZE.RigidControls,
    private readonly voxelInteract: VOXELIZE.VoxelInteract,
    options: ForgeRuntimeOptions = {},
  ) {
    this.agentMode = options.agentMode ?? this.readAgentMode();
    this.agentReady = new Promise<void>((resolve, reject) => {
      this.resolveAgentReady = resolve;
      this.rejectAgentReady = reject;
    });

    const previousJoin = network.onJoin;
    network.onJoin = (worldName) => {
      previousJoin?.(worldName);
      this.rejectPendingBuilds(
        new Error("Forge build failed: the Voxelize session rejoined."),
      );
    };
    const previousDisconnect = network.onDisconnect;
    network.onDisconnect = () => {
      previousDisconnect?.();
      this.rejectPendingBuilds(
        new Error("Forge build failed: the Voxelize connection disconnected."),
      );
    };

    window.addEventListener("pagehide", () => {
      this.rejectPendingBuilds(
        new Error("Forge build failed: the page is navigating."),
      );
    });

    if (this.agentMode) {
      this.installAgentBridge();
    }
  }

  /** Call after the page's Builder Palette texture promises have completed. */
  markTextureReadinessComplete() {
    try {
      this.palette = parseForgeBuildPalette(
        this.world.extraInitData.forgeBuildPalette,
        (name) => this.world.getBlockByName(name),
      );
      this.paletteError = null;
      this.textureReady = true;
    } catch (error) {
      this.palette = null;
      this.textureReady = false;
      this.paletteError =
        error instanceof Error ? error : new Error(String(error));
    }
  }

  /** Register page-local tools after the world and texture gates are live. */
  async registerWhenReady(timeoutMs = 30_000): Promise<boolean> {
    if (this.paletteError) {
      if (this.agentMode) this.rejectAgentReady(this.paletteError);
      return false;
    }
    const ready = await this.waitUntil(
      () =>
        this.hasCoreReadiness() &&
        this.observationChunksLoaded(this.playerAnchor()),
      timeoutMs,
    );
    if (!ready) {
      const error = new Error(
        "Forge WebMCP remains unavailable: the page did not reach complete world and chunk readiness.",
      );
      if (this.agentMode) this.rejectAgentReady(error);
      return false;
    }

    this.resolveAgentReady();
    const modelContext = (
      document as Document & { modelContext?: ModelContext }
    ).modelContext;
    if (!modelContext?.registerTool || this.toolsRegistered) return false;

    try {
      for (const tool of toolDefinitions(this, this.requiredPalette())) {
        await modelContext.registerTool(tool);
      }
      this.toolsRegistered = true;
      return true;
    } catch (error) {
      console.error("[Forge] WebMCP registration failed:", error);
      return false;
    }
  }

  onMessage(message: Message) {
    const method = asMessageMethod(message);
    if (!method) return;
    const payload = parseMessagePayload(method.payload);
    if (!payload) return;

    if (method.name !== "forge:build-result") return;
    if (typeof payload.requestId !== "string") return;
    if (!this.pendingBuilds.has(payload.requestId)) return;

    const response = parseBuildResponse(payload, payload.requestId);
    if (!response) {
      this.rejectPendingBuild(
        payload.requestId,
        new Error("Forge build returned an invalid Build Acceptance."),
      );
      return;
    }
    this.emit("build-result", response);
    this.finishPendingBuild(payload.requestId, response);
  }

  getPlayerContext(): ForgeContext {
    this.assertCoreReadiness();
    const player = this.readPlayer();
    const target = this.readSpatialTarget(player.position);
    const anchor = target?.position ?? {
      x: Math.floor(player.position.x),
      y: Math.floor(player.position.y),
      z: Math.floor(player.position.z),
    };
    this.assertObservationChunks(anchor);

    const { surfaceMap, obstacles } = this.readNearbyWorld(anchor);
    return {
      player,
      spatialTarget: target,
      surfaceMap,
      obstacles,
      availableBlocks: this.requiredPalette().blocks,
    };
  }

  async buildStructure(input: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.hasCoreReadiness()) {
      throw new Error(
        "Forge build unavailable: the page is disconnected, rejoining, outdated, or not Builder Palette-ready.",
      );
    }

    const parsed = parseBuildRequest(
      input,
      paletteBlockNames(this.requiredPalette()),
    );
    if ("error" in parsed) return invalidBuildAcceptance(parsed.error.message);

    const writes = expandBuildRequest(parsed);
    if (writes.length > MAX_BUILD_WRITES) {
      return invalidBuildAcceptance(
        `Build Request expands to more than ${MAX_BUILD_WRITES} writes.`,
      );
    }

    return this.dispatchBuild(parsed, signal);
  }

  private dispatchBuild(
    request: BuildRequest,
    signal?: AbortSignal,
  ): Promise<BuildResponse> {
    const requestId = makeRequestId();
    const packet = {
      type: "METHOD",
      method: {
        name: "forge:build",
        payload: JSON.stringify({ requestId, request }),
      },
    } as Message;

    return new Promise<BuildResponse>((resolve, reject) => {
      let abortCleanup: (() => void) | undefined;
      if (signal) {
        const abort = () =>
          this.rejectPendingBuild(
            requestId,
            new Error("Forge build was aborted."),
          );
        if (signal.aborted) {
          reject(new Error("Forge build was aborted."));
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        abortCleanup = () => signal.removeEventListener("abort", abort);
      }

      this.pendingBuilds.set(requestId, {
        packet,
        resolve,
        reject,
        abortCleanup,
      });
      this.packets.push(packet);
    });
  }

  private finishPendingBuild(requestId: string, response: BuildResponse) {
    const pending = this.pendingBuilds.get(requestId);
    if (!pending) return;
    this.pendingBuilds.delete(requestId);
    pending.abortCleanup?.();
    pending.resolve(response);
  }

  private rejectPendingBuild(requestId: string, error: Error) {
    const pending = this.pendingBuilds.get(requestId);
    if (!pending) return;
    this.pendingBuilds.delete(requestId);
    pending.abortCleanup?.();
    this.packets = this.packets.filter((packet) => packet !== pending.packet);
    pending.reject(error);
  }

  private rejectPendingBuilds(error: Error) {
    for (const requestId of [...this.pendingBuilds.keys()]) {
      this.rejectPendingBuild(requestId, error);
    }
  }

  private hasCoreReadiness() {
    return (
      this.network.connected &&
      this.network.joined &&
      !this.network.isJoinPending &&
      !this.network.isClientOutdated &&
      this.world.isInitialized &&
      this.textureReady &&
      this.palette !== null
    );
  }

  private requiredPalette() {
    if (this.palette) return this.palette;
    throw (
      this.paletteError ??
      new Error("Forge Builder Palette metadata is unavailable.")
    );
  }

  private assertCoreReadiness() {
    if (!this.hasCoreReadiness()) {
      throw new Error(
        "Forge Player Context unavailable: the page is not fully connected, joined, initialized, and texture-ready.",
      );
    }
  }

  private playerAnchor() {
    const position = this.controls.position;
    return {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
    };
  }

  private observationChunksLoaded(anchor: VoxelPosition) {
    const { chunkSize } = this.world.options;
    const minChunkX = Math.floor((anchor.x - 16) / chunkSize);
    const maxChunkX = Math.floor((anchor.x + 16) / chunkSize);
    const minChunkZ = Math.floor((anchor.z - 16) / chunkSize);
    const maxChunkZ = Math.floor((anchor.z + 16) / chunkSize);
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        const chunk = this.world.getChunkByCoords(cx, cz);
        if (!chunk || !chunk.isReady) return false;
      }
    }
    return true;
  }

  private assertObservationChunks(anchor: VoxelPosition) {
    if (!this.observationChunksLoaded(anchor)) {
      throw new Error(
        "Forge Player Context unavailable: required 33-by-33 observation chunks are not loaded.",
      );
    }
  }

  private async waitUntil(
    predicate: () => boolean,
    timeoutMs: number,
  ): Promise<boolean> {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (predicate()) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return predicate();
  }

  private readPlayer() {
    const position = toPosition(this.controls.position);
    const direction = this.controls.getDirection();
    const viewDirection = toPosition(direction);
    const yaw = Math.atan2(-viewDirection.x, -viewDirection.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, viewDirection.y)));
    return {
      position,
      orientation: { yaw, pitch },
      facing: cardinalFacing(yaw),
      viewDirection,
    };
  }

  private readSpatialTarget(
    playerPosition: VoxelPosition,
  ): ForgeContext["spatialTarget"] {
    const target = this.voxelInteract.target;
    if (!target) return null;

    const block = this.world.getBlockAt(...target);
    if (!block || block.isEmpty) return null;
    const potential = this.voxelInteract.potential?.voxel;
    const normal = potential
      ? {
          x: potential[0] - target[0],
          y: potential[1] - target[1],
          z: potential[2] - target[2],
        }
      : { x: 0, y: 1, z: 0 };
    const dx = target[0] + 0.5 - playerPosition.x;
    const dy = target[1] + 0.5 - playerPosition.y;
    const dz = target[2] + 0.5 - playerPosition.z;
    return {
      position: { x: target[0], y: target[1], z: target[2] },
      distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
      face: faceForNormal(normal),
      normal,
      entity: null,
      block: this.blockInfo(block, {
        x: target[0],
        y: target[1],
        z: target[2],
      }),
    };
  }

  private readNearbyWorld(anchor: VoxelPosition) {
    const surfaceMap: ForgeContext["surfaceMap"] = [];
    const surfacePositions: Array<VoxelPosition | null> = [];
    for (let x = anchor.x - 16; x <= anchor.x + 16; x++) {
      for (let z = anchor.z - 16; z <= anchor.z + 16; z++) {
        const surface = this.findSurface(anchor.y, x, z);
        surfaceMap.push({
          offset: { x: x - anchor.x, z: z - anchor.z },
          position: surface,
          height: surface?.y ?? null,
          topBlock: surface
            ? (() => {
                return (
                  this.world.getBlockAt(surface.x, surface.y, surface.z)
                    ?.name ?? null
                );
              })()
            : null,
        });
        surfacePositions.push(surface);
      }
    }

    const obstacles: ForgeContext["obstacles"] = [];
    for (const surface of surfacePositions) {
      if (!surface) continue;
      for (let y = surface.y + 1; y <= surface.y + 24; y++) {
        const position = { x: surface.x, y, z: surface.z };
        const block = this.world.getBlockAt(position.x, position.y, position.z);
        if (!block || block.isEmpty) continue;
        const info = this.blockInfo(block, position);
        obstacles.push({
          position,
          block: info.name,
          properties: propertySnapshot(info),
        });
      }
    }
    return { surfaceMap, obstacles };
  }

  private findSurface(
    targetY: number,
    x: number,
    z: number,
  ): VoxelPosition | null {
    for (let y = targetY + 32; y >= targetY - 32; y--) {
      const block = this.world.getBlockAt(x, y, z);
      if (block && !block.isEmpty) return { x, y, z };
    }
    return null;
  }

  private blockInfo(
    block: {
      id: number;
      name: string;
      isEmpty: boolean;
      isFluid: boolean;
      isPassable: boolean;
    },
    position: VoxelPosition,
  ): ForgeBlockInfo {
    const [rotation, yRotation] = BlockRotation.decode(
      this.world.getVoxelRotationAt(position.x, position.y, position.z),
    );
    return {
      id: block.id,
      name: block.name,
      isEmpty: block.isEmpty,
      isFluid: block.isFluid,
      isPassable: block.isPassable,
      isWaterlogged: Boolean(
        this.world.getVoxelWaterloggedAt(position.x, position.y, position.z),
      ),
      stage: this.world.getVoxelStageAt(position.x, position.y, position.z),
      rotation,
      yRotation,
    };
  }

  private emit(event: string, data: unknown) {
    this.listeners.get(event)?.forEach((listener) => listener(data));
  }

  private installAgentBridge() {
    const runtime = this;
    const bridge: ForgeAgentBridge = {
      ready: this.agentReady,
      position: () => runtime.readPlayer().position,
      facing: () => runtime.readPlayer().orientation,
      raycast: () => runtime.readSpatialTarget(runtime.readPlayer().position),
      blockAt: (position) => {
        const block = runtime.world.getBlockAt(
          position.x,
          position.y,
          position.z,
        );
        return block ? runtime.blockInfo(block, position) : null;
      },
      snapshot: async () => runtime.getAgentSnapshot(),
      connection: () => ({
        isConnected: runtime.network.connected,
        isJoined: runtime.network.joined,
        isJoinPending: runtime.network.isJoinPending,
        isClientOutdated: runtime.network.isClientOutdated,
        joinGeneration: runtime.network.joinGeneration,
        pendingCommandCount: runtime.network.pendingCommandCount,
        droppedCommandCount: runtime.network.droppedCommandCount,
        serverUrl: runtime.network.serverUrl,
      }),
      chunks: {
        state: (target) => runtime.chunkState(target),
        waitFor: (position, radius, timeoutMs) =>
          runtime.waitForChunks(position, radius ?? 2, timeoutMs ?? 10_000),
        loaded: () => runtime.loadedChunks(),
        pending: () => runtime.pendingChunks(),
        list: () => runtime.listChunks(),
        waitForPaint: (options) =>
          runtime.waitForPaint(options?.timeoutMs ?? 10_000),
      },
      call: (method, payload) => {
        if (method !== "forge:build") {
          return Promise.reject(
            new Error(
              `Agent mode does not expose ${method} on the Forge page.`,
            ),
          );
        }
        return runtime.buildStructure(payload);
      },
      teleport: async (position) => {
        runtime.controls.teleportToExact(position.x, position.y, position.z);
        await runtime.waitForChunks(position, 2, 10_000);
      },
      face: async (input) => {
        if (input.direction) {
          runtime.controls.setDirection(
            input.direction.x,
            input.direction.y,
            input.direction.z,
          );
        } else {
          const yaw = input.yaw ?? 0;
          const pitch = input.pitch ?? 0;
          runtime.controls.setDirection(
            -Math.sin(yaw) * Math.cos(pitch),
            Math.sin(pitch),
            -Math.cos(yaw) * Math.cos(pitch),
          );
        }
      },
      setFlying: async (isFlying) => {
        const currentlyFlying = runtime.controls.body.gravityMultiplier === 0;
        if (currentlyFlying !== isFlying) runtime.controls.toggleFly();
      },
      on: (event, listener) => {
        const listeners = runtime.listeners.get(event) ?? new Set();
        listeners.add(listener);
        runtime.listeners.set(event, listeners);
        return () => listeners.delete(listener);
      },
    };
    window.__agent__ = bridge;
  }

  private readAgentMode() {
    const query = new URLSearchParams(window.location.search);
    return query.get("agent") === "true" || query.get("testing") === "true";
  }

  private chunkState(target: VoxelPosition | { cx: number; cz: number }) {
    const { cx, cz } =
      "cx" in target
        ? target
        : {
            cx: Math.floor(target.x / this.world.options.chunkSize),
            cz: Math.floor(target.z / this.world.options.chunkSize),
          };
    const chunk = this.world.getChunkByCoords(cx, cz);
    if (chunk?.isReady) return "loaded" as const;
    return this.world.getChunkStatus(cx, cz)
      ? ("pending" as const)
      : ("unloaded" as const);
  }

  private async waitForChunks(
    position: VoxelPosition,
    radius: number,
    timeoutMs: number,
  ) {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      let ready = true;
      const centerX = Math.floor(position.x / this.world.options.chunkSize);
      const centerZ = Math.floor(position.z / this.world.options.chunkSize);
      for (let cx = centerX - radius; cx <= centerX + radius; cx++) {
        for (let cz = centerZ - radius; cz <= centerZ + radius; cz++) {
          if (this.chunkState({ cx, cz }) !== "loaded") ready = false;
        }
      }
      if (ready) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for Forge chunks to load.");
  }

  private loadedChunks() {
    const loaded: Array<{ cx: number; cz: number }> = [];
    this.world.chunkPipeline.forEach("loaded", (name) => {
      const [cx, cz] = name.split(",").map(Number);
      loaded.push({ cx, cz });
    });
    return loaded;
  }

  private pendingChunks() {
    const pending: Array<{ cx: number; cz: number }> = [];
    for (const stage of ["requested", "processing"] as const) {
      this.world.chunkPipeline.forEach(stage, (name) => {
        const [cx, cz] = name.split(",").map(Number);
        pending.push({ cx, cz });
      });
    }
    return pending;
  }

  private listChunks() {
    const loaded = new Set(
      this.loadedChunks().map(({ cx, cz }) => `${cx},${cz}`),
    );
    const pending = new Set(
      this.pendingChunks().map(({ cx, cz }) => `${cx},${cz}`),
    );
    const all = new Set([...loaded, ...pending]);
    return [...all].map((name) => {
      const [cx, cz] = name.split(",").map(Number);
      return {
        coord: { cx, cz },
        state: loaded.has(name) ? ("loaded" as const) : ("pending" as const),
      };
    });
  }

  private async waitForPaint(timeoutMs: number) {
    const startedAt = performance.now();
    let quietFrames = 0;
    while (performance.now() - startedAt < timeoutMs) {
      const counters = this.world.getMemoryCounters();
      const pending =
        counters.blockUpdatesQueue +
        counters.blockUpdatesToEmit +
        counters.lightJobQueue +
        counters.activeLightBatchPendingJobs +
        counters.meshQueue +
        counters.meshWorking +
        counters.urgentMeshQueue +
        counters.urgentMeshWorking;
      quietFrames = pending === 0 ? quietFrames + 1 : 0;
      if (quietFrames >= 2) {
        return { isSettled: true, elapsedMs: performance.now() - startedAt };
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    return { isSettled: false, elapsedMs: performance.now() - startedAt };
  }

  private getAgentSnapshot() {
    const player = this.readPlayer();
    let context: ForgeContext | null = null;
    try {
      context = this.getPlayerContext();
    } catch {
      // Agent health intentionally reports isReady=false through this bridge.
    }
    return {
      position: player.position,
      facing: player.orientation,
      world: this.network.world,
      isReady: context !== null,
      raycast: context?.spatialTarget ?? null,
      chunks: {
        loaded: this.world.chunkPipeline.loadedCount,
        pending:
          this.world.chunkPipeline.requestedCount +
          this.world.chunkPipeline.processingCount,
      },
    };
  }
}
