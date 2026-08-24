import { describe, expect, it } from "vitest";

import SkyFragmentShader from "../../shaders/sky/fragment.glsl?raw";

import { SKY_FOG_FRAGMENT } from "./sky-fog";

describe("camera-relative sky sampling", () => {
  it("removes camera translation before sampling the sky gradient", () => {
    expect(SkyFragmentShader).toContain(
      "vec3 skyPosition = vWorldPosition - cameraPosition;",
    );
    expect(SkyFragmentShader).not.toContain(
      "normalize(vWorldPosition + uSkyOffset)",
    );
  });

  it("samples terrain fog along the view ray instead of in world space", () => {
    expect(SKY_FOG_FRAGMENT).toContain(
      "vec3 skyDomePos = fogRay * uSkyFogDimension;",
    );
    expect(SKY_FOG_FRAGMENT).not.toContain(
      "cameraPosition + fogRay * uSkyFogDimension",
    );
  });
});
