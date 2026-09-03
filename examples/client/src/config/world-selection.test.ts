import { describe, expect, it } from "vitest";

import {
  resolveWorldName,
  WORLD_SELECTION_STORAGE_KEY,
} from "./world-selection";

describe("resolveWorldName", () => {
  it("defaults a first visit to the flat world", () => {
    expect(resolveWorldName("", null)).toBe("flat");
  });

  it("does not reuse the legacy terrain-default preference", () => {
    expect(WORLD_SELECTION_STORAGE_KEY).not.toBe("voxelize-world");
  });
});
