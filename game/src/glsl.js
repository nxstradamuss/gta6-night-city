// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Shader prelude shared by every pass: the hash primitives and the fog ramp.

export const GLSL_HASH = `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash31(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
`;

// Fog ramp shared by the lit passes: linear in view distance, squared for a
// soft shoulder. Callers scale the result to their own max density.
export const GLSL_FOG = `
float fogAmt(float d) {
  float f = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  return f * f;
}
`;
