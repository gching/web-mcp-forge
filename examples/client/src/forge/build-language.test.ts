import { describe, expect, it } from "vitest";

import * as buildLanguage from "./build-language";

const allowedBlocks = new Set(["Air", "Glass", "Oak Log", "Oak Planks"]);

describe("build-language Forge build request contracts", () => {
  it("parses all four valid build operations with canonical palette names", () => {
    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 10, y: 50, z: -4 },
          operations: [
            {
              type: "fill",
              at: { x: 0, y: 0, z: 0 },
              size: { x: 2, y: 3, z: 4 },
              block: "Glass",
              properties: { stage: 1, sealed: true, note: "front" },
            },
            {
              type: "hollow_box",
              at: { x: -1, y: 0, z: -1 },
              size: { x: 5, y: 4, z: 5 },
              block: "Air",
            },
            {
              type: "line",
              from: { x: 3, y: 0, z: -3 },
              to: { x: 5, y: 2, z: -1 },
              block: "Oak Planks",
            },
            {
              type: "voxels",
              blocks: [
                {
                  at: { x: 0, y: 0, z: 0 },
                  block: "Oak Log",
                  properties: { axis: "y" },
                },
                {
                  at: { x: 1, y: 0, z: 0 },
                  block: "Glass",
                },
              ],
            },
          ],
        },
        allowedBlocks,
      ),
    ).toEqual({
      origin: { x: 10, y: 50, z: -4 },
      operations: [
        {
          type: "fill",
          at: { x: 0, y: 0, z: 0 },
          size: { x: 2, y: 3, z: 4 },
          block: "Glass",
          properties: { stage: 1, sealed: true, note: "front" },
        },
        {
          type: "hollow_box",
          at: { x: -1, y: 0, z: -1 },
          size: { x: 5, y: 4, z: 5 },
          block: "Air",
        },
        {
          type: "line",
          from: { x: 3, y: 0, z: -3 },
          to: { x: 5, y: 2, z: -1 },
          block: "Oak Planks",
        },
        {
          type: "voxels",
          blocks: [
            {
              at: { x: 0, y: 0, z: 0 },
              block: "Oak Log",
              properties: { axis: "y" },
            },
            {
              at: { x: 1, y: 0, z: 0 },
              block: "Glass",
            },
          ],
        },
      ],
    });
  });

  it("rejects build requests whose block names are not in the received palette", () => {
    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 0, y: 50, z: 0 },
          operations: [
            {
              type: "fill",
              at: { x: 0, y: 0, z: 0 },
              size: { x: 1, y: 1, z: 1 },
              block: "Stone",
            },
          ],
        },
        new Set(["Air", "Glass"]),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_build_request",
        message:
          "Operation 0.block must be a canonical Forge Builder Palette block name.",
      },
    });
  });

  it("rejects unsupported fields, empty arrays, non-positive sizes, unsafe coordinates, invalid state values, and unsafe property names", () => {
    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 0, y: 50, z: 0 },
          operations: [
            {
              type: "fill",
              at: { x: 0, y: 0, z: 0 },
              size: { x: 1, y: 1, z: 1 },
              block: "Glass",
              extra: true,
            },
          ],
        },
        allowedBlocks,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_build_request",
        message: "Operation 0 contains unsupported fields.",
      },
    });

    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 0, y: 50, z: 0 },
          operations: [],
        },
        allowedBlocks,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_build_request",
        message:
          "Build Requests must contain only origin and a non-empty operations array.",
      },
    });

    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 0, y: 50, z: 0 },
          operations: [
            {
              type: "fill",
              at: { x: 0, y: 0, z: 0 },
              size: { x: 1, y: 0, z: 1 },
              block: "Glass",
            },
          ],
        },
        allowedBlocks,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_build_request",
        message: "Operation 0.size must contain positive integers.",
      },
    });

    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 0, y: 50.5, z: 0 },
          operations: [
            {
              type: "line",
              from: { x: 0, y: 0, z: 0 },
              to: { x: Number.MAX_SAFE_INTEGER + 1, y: 1, z: 1 },
              block: "Oak Planks",
            },
          ],
        },
        allowedBlocks,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_build_request",
        message: "origin must be an object containing three safe integers.",
      },
    });

    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 0, y: 50, z: 0 },
          operations: [
            {
              type: "line",
              from: { x: 0, y: 0, z: 0 },
              to: { x: Number.MAX_SAFE_INTEGER + 1, y: 1, z: 1 },
              block: "Oak Planks",
            },
          ],
        },
        allowedBlocks,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_build_request",
        message: "Operation 0.to must be an object containing three safe integers.",
      },
    });

    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 0, y: 50, z: 0 },
          operations: [
            {
              type: "fill",
              at: { x: 0, y: 0, z: 0 },
              size: { x: 1, y: 1, z: 1 },
              block: "Glass",
              properties: { stage: 0.5 },
            },
          ],
        },
        allowedBlocks,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_build_request",
        message:
          "Operation 0.properties must contain only named scalar state properties with safe integer numbers.",
      },
    });

    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 0, y: 50, z: 0 },
          operations: [
            {
              type: "fill",
              at: { x: 0, y: 0, z: 0 },
              size: { x: 1, y: 1, z: 1 },
              block: "Glass",
              properties: { constructor: "stone" },
            },
          ],
        },
        allowedBlocks,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_build_request",
        message:
          "Operation 0.properties must contain only named scalar state properties with safe integer numbers.",
      },
    });

    expect(
      buildLanguage.parseBuildRequest(
        {
          origin: { x: 0, y: 50, z: 0 },
          operations: [
            {
              type: "voxels",
              blocks: [],
            },
          ],
        },
        allowedBlocks,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_build_request",
        message:
          "Operation 0 must be a voxels operation with a non-empty blocks array.",
      },
    });
  });

  it("exposes a strict buildRequestSchema contract for deterministic safeParse behavior", () => {
    expect(buildLanguage.buildRequestSchema).toBeDefined();

    const schemaResult = buildLanguage.buildRequestSchema.safeParse({
      origin: { x: 0, y: 50, z: 0 },
      operations: [
        {
          type: "fill",
          at: { x: 0, y: 0, z: 0 },
          size: { x: 1, y: 1, z: 1 },
          block: "Glass",
          extra: true,
        },
      ],
    });

    expect(schemaResult.success).toBe(false);
  });
});
