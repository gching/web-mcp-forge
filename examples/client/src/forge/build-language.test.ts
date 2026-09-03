import { describe, expect, it } from "vitest";

import { parseBuildRequest } from "./build-language";

describe("parseBuildRequest", () => {
  it("accepts canonical string block names in line operations", () => {
    expect(
      parseBuildRequest({
        origin: { x: 0, y: 50, z: 0 },
        operations: [
          {
            type: "line",
            from: { x: 3, y: 0, z: -3 },
            to: { x: 5, y: 0, z: -3 },
            block: "Oak Planks",
          },
        ],
      }),
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
