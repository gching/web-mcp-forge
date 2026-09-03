import { describe, expect, it } from "vitest";

import { resolveWorldName } from "./world-selection";

describe("resolveWorldName", () => {
  it("defaults a first visit to the flat world", () => {
    expect(resolveWorldName("", null)).toBe("flat");
  });
});
