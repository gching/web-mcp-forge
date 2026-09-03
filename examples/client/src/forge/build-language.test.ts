import { describe, expect, it } from "vitest";

import { parseBuildRequest } from "./build-language";

describe("parseBuildRequest", () => {
  it("uses the received Builder Palette names instead of a static client list", () => {
    const glassRequest = {
      origin: { x: 0, y: 50, z: 0 },
      operations: [
        {
          type: "fill",
          at: { x: 0, y: 0, z: 0 },
          size: { x: 1, y: 1, z: 1 },
          block: "Glass",
        },
      ],
    };

    expect(
      parseBuildRequest(glassRequest, new Set(["Air", "Glass"])),
    ).toMatchObject({ operations: [{ block: "Glass" }] });
    expect(
      parseBuildRequest(
        {
          ...glassRequest,
          operations: [{ ...glassRequest.operations[0], block: "Oak Planks" }],
        },
        new Set(["Air", "Glass"]),
      ),
    ).toMatchObject({ ok: false });
  });

  it("accepts canonical string block names in line operations", () => {
    expect(
      parseBuildRequest(
        {
          origin: { x: 0, y: 50, z: 0 },
          operations: [
            {
              type: "line",
              from: { x: 3, y: 0, z: -3 },
              to: { x: 5, y: 0, z: -3 },
              block: "Oak Planks",
            },
          ],
        },
        new Set(["Air", "Oak Planks"]),
      ),
    ).toEqual({
      origin: { x: 0, y: 50, z: 0 },
      operations: [
        {
          type: "line",
          from: { x: 3, y: 0, z: -3 },
          to: { x: 5, y: 0, z: -3 },
          block: "Oak Planks",
        },
      ],
    });
  });
});
