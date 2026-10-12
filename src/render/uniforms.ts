import * as THREE from 'three';

/**
 * Global uniforms shared (by reference) between every patched material and custom shader.
 * Updated once per frame by the environment system.
 */
export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uMoonDir: { value: new THREE.Vector3(-0.3, -0.8, -0.2).normalize() },
  uNight: { value: 0 },
  uFogColor: { value: new THREE.Color(0.75, 0.82, 0.92) },
  uFogSunColor: { value: new THREE.Color(1.0, 0.9, 0.8) },
  uFogLowColor: { value: new THREE.Color(0.95, 0.95, 0.97) },
  uFogDensity: { value: 0.00028 },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uAmbient: { value: new THREE.Color(0.55, 0.6, 0.75) },
  uRimColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
  uPlayerPos: { value: new THREE.Vector3() },
  uWind: { value: new THREE.Vector2(1, 0.3) },
  uStorm: { value: 1 },
};

/** GLSL: uniform declarations + height fog function usable in any shader. */
export const FOG_PARS = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uFogLowColor;
uniform float uFogDensity;
uniform vec3 uSunDir;
vec3 fogColorFor(vec3 vdir, float h) {
  vec2 a = normalize(vdir.xz + vec2(1e-4));
  vec2 b = normalize(uSunDir.xz + vec2(1e-4));
  float s = pow(max(dot(a, b), 0.0), 3.0);
  vec3 c = mix(uFogColor, uFogSunColor, s);
  return mix(c, uFogLowColor, clamp(1.0 - h / 300.0, 0.0, 1.0) * 0.4);
}
float fogAmount(float dist, float h) {
  float dens = uFogDensity * (0.5 + 1.6 * exp(-max(h - 30.0, 0.0) * 0.006));
  return 1.0 - exp(-dist * dens);
}
vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float f = fogAmount(dist, min(wpos.y, cameraPosition.y + 200.0));
  return mix(col, fogColorFor(d / max(dist, 1e-3), wpos.y), f);
}
`;

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
`;
