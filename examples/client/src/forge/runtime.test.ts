import { describe, expect, it, vi } from "vitest";

import { ForgeRuntime } from "./runtime";

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

    expect((runtime as never as { findSurface: (y: number, x: number, z: number) => { y: number } | null }).findSurface(50, 0, 0)).toEqual({
      x: 0,
      y: 68,
      z: 0,
    });
  });
});
