uniform vec3 uTopColor;
uniform vec3 uMiddleColor;
uniform vec3 uBottomColor;
uniform float uSkyOffset;
uniform float uVoidOffset;
uniform float uExponent;
uniform float uExponent2;
uniform vec3 uUnderwaterAmbient;
uniform float uUnderwaterFade;

varying vec3 vWorldPosition;

void main() {
  // Sky colors are view-relative. Sampling absolute world coordinates makes
  // the gradient collapse around the origin when a camera-centered dome
  // crosses it, producing a radial seam far from (0, 0, 0).
  vec3 skyPosition = vWorldPosition - cameraPosition;
  float h = normalize(skyPosition + uSkyOffset).y;
  float h2 = normalize(skyPosition + uVoidOffset).y;
  vec3 color = mix(uMiddleColor, uTopColor, max(pow(max(h, 0.0), uExponent), 0.0));
  color = mix(color, uBottomColor, max(pow(max(-h2, 0.0), uExponent2), 0.0));
  color = mix(color, uUnderwaterAmbient, uUnderwaterFade);
  gl_FragColor = vec4(color, 1.0);
}
