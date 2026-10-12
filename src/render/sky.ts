import * as THREE from 'three';
import { G, NOISE_GLSL } from './uniforms';

/**
 * Analytic single-scattering style sky. The same model is mirrored on the CPU
 * (skyRadiance) so fog, ambient light and cloud tints match the dome exactly.
 */
const BR: [number, number, number] = [0.16, 0.4, 1.0];

const SKY_FUNC = /* glsl */ `
const vec3 BR = vec3(0.16, 0.40, 1.0);
float hg(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}
vec3 skyRadiance(vec3 d, vec3 sd) {
  float yc = max(d.y, 0.0);
  float sy = sd.y;
  float odSun = 1.0 / (max(sy, 0.0) + 0.06);
  vec3 Ls = exp(-BR * 0.22 * odSun * mix(1.0, 0.42, sqrt(yc)));
  float odView = 1.0 / (yc + 0.1);
  vec3 scat = 1.0 - exp(-BR * odView * 0.55);
  float mu = dot(d, sd);
  float ray = 0.8 + 0.25 * mu * mu;
  float mie = hg(mu, 0.76);
  float dayAmt = smoothstep(-0.2, 0.08, sy);
  vec3 sky = Ls * scat * ray * 1.1 + Ls * mie * (0.25 + 1.2 * (1.0 - yc)) * 0.6;
  sky *= dayAmt;
  float twi = smoothstep(-0.22, -0.02, sy) * smoothstep(0.3, 0.0, sy);
  float anti = 0.5 - 0.5 * mu;
  sky += twi * vec3(0.55, 0.32, 0.62) * (1.0 - yc) * (0.35 + 0.5 * anti) * 0.7;
  sky += twi * vec3(1.0, 0.45, 0.25) * pow(max(mu, 0.0), 4.0) * (1.0 - yc) * 0.8;
  vec3 night = mix(vec3(0.06, 0.08, 0.19), vec3(0.012, 0.018, 0.06), sqrt(yc));
  sky += night * (1.0 - dayAmt);
  return sky;
}
`;

export function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uSunDir: G.uSunDir,
      uMoonDir: G.uMoonDir,
      uTime: G.uTime,
      uNight: G.uNight,
      uStorm: G.uStorm,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform float uTime;
      uniform float uNight;
      uniform float uStorm;
      varying vec3 vDir;
      ${NOISE_GLSL}
      ${SKY_FUNC}
      void main() {
        vec3 d = normalize(vDir);
        vec3 dd = vec3(d.x, max(d.y, 0.0), d.z);
        vec3 col = skyRadiance(normalize(dd + vec3(0.0, 0.001, 0.0)), uSunDir);
        float mu = dot(d, uSunDir);
        float yc = max(d.y, 0.0);

        // Painterly cirrus wisps.
        if (d.y > 0.0) {
          vec2 cp = d.xz / (d.y + 0.18) * 1.4 + vec2(uTime * 0.004, uTime * 0.002);
          float c = fbm2(cp * vec2(1.0, 2.6));
          c = smoothstep(0.5, 0.85, c) * smoothstep(0.0, 0.25, d.y);
          vec3 Ls = exp(-BR * 0.22 / (max(uSunDir.y, 0.0) + 0.06) * 0.7);
          vec3 ccol = mix(vec3(0.25, 0.28, 0.42), Ls * 1.2 + vec3(0.12, 0.1, 0.16), smoothstep(-0.15, 0.1, uSunDir.y));
          col = mix(col, ccol, c * 0.55);
        }

        // Stars.
        float nightAmt = uNight;
        if (nightAmt > 0.01 && d.y > -0.05) {
          vec3 q = d * 170.0;
          vec3 cell = floor(q);
          float h = hash13(cell);
          vec3 jit = vec3(hash13(cell + 7.1), hash13(cell + 13.7), hash13(cell + 29.3));
          float dist = length(fract(q) - jit);
          float star = step(0.972, h) * smoothstep(0.16, 0.0, dist);
          float tw = 0.6 + 0.4 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
          vec3 sc = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash13(cell + 3.3));
          col += sc * star * tw * nightAmt * 2.4 * smoothstep(-0.05, 0.2, d.y);
          // Milky band
          float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.2, 1.0))) * 3.0, 2.0));
          col += vec3(0.12, 0.12, 0.2) * band * fbm2(d.xy * 6.0 + d.z * 3.0) * nightAmt;
        }

        // Sun disk + glow.
        vec3 Lsun = exp(-BR * 0.22 / (max(uSunDir.y, 0.0) + 0.06));
        float disk = smoothstep(0.99955, 0.99975, mu);
        col += Lsun * disk * 18.0 * smoothstep(-0.05, 0.02, uSunDir.y);
        col += Lsun * pow(max(mu, 0.0), 220.0) * 1.2 * smoothstep(-0.1, 0.05, uSunDir.y);

        // Moon.
        float mm = dot(d, uMoonDir);
        float moonDisk = smoothstep(0.99935, 0.9996, mm);
        if (moonDisk > 0.0) {
          vec3 t1 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
          vec3 t2 = cross(t1, uMoonDir);
          vec2 mp = vec2(dot(d, t1), dot(d, t2)) / 0.028;
          float crater = vnoise(mp * 3.0) * 0.25 + vnoise(mp * 8.0) * 0.12;
          float phase = smoothstep(-0.3, 0.4, mp.x + 0.35);
          vec3 mc = vec3(1.0, 0.97, 0.88) * (0.75 - crater) * (0.25 + 0.75 * phase);
          col = mix(col, mc * 2.2, moonDisk * smoothstep(-0.05, 0.05, uMoonDir.y));
        }
        col += vec3(0.5, 0.55, 0.75) * pow(max(mm, 0.0), 300.0) * 0.6 * uNight;
        col += vec3(0.25, 0.3, 0.45) * pow(max(mm, 0.0), 12.0) * 0.12 * uNight;

        // Below the horizon blend toward a soft haze (cloud sea covers most of it).

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(9000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

/* ---------------- CPU mirror ---------------- */

type V3 = [number, number, number];

function hg(mu: number, g: number): number {
  const g2 = g * g;
  return (1 - g2) / (12.566 * Math.pow(1 + g2 - 2 * g * mu, 1.5));
}
const sstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function skyRadiance(d: V3, sd: V3): V3 {
  const yc = Math.max(d[1], 0);
  const sy = sd[1];
  const odSun = 1 / (Math.max(sy, 0) + 0.06);
  const k = 0.22 * odSun * (1 + (0.42 - 1) * Math.sqrt(yc));
  const odView = 1 / (yc + 0.1);
  const mu = d[0] * sd[0] + d[1] * sd[1] + d[2] * sd[2];
  const ray = 0.8 + 0.25 * mu * mu;
  const mie = hg(mu, 0.76);
  const dayAmt = sstep(-0.2, 0.08, sy);
  const twi = sstep(-0.22, -0.02, sy) * sstep(0.3, 0.0, sy);
  const anti = 0.5 - 0.5 * mu;
  const tw1: V3 = [0.55, 0.32, 0.62];
  const tw2: V3 = [1.0, 0.45, 0.25];
  const n0: V3 = [0.06, 0.08, 0.19];
  const n1: V3 = [0.012, 0.018, 0.06];
  const out: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const Ls = Math.exp(-BR[i] * k);
    const scat = 1 - Math.exp(-BR[i] * odView * 0.55);
    let s = Ls * scat * ray * 1.1 + Ls * mie * (0.25 + 1.2 * (1 - yc)) * 0.6;
    s *= dayAmt;
    s += twi * tw1[i] * (1 - yc) * (0.35 + 0.5 * anti) * 0.7;
    s += twi * tw2[i] * Math.pow(Math.max(mu, 0), 4) * (1 - yc) * 0.8;
    const night = n0[i] + (n1[i] - n0[i]) * Math.sqrt(yc);
    s += night * (1 - dayAmt);
    out[i] = s;
  }
  return out;
}

export function sunlightColor(sunY: number): V3 {
  const od = 1 / (Math.max(sunY, 0) + 0.06);
  const f = sstep(-0.08, 0.06, sunY);
  return [Math.exp(-BR[0] * 0.22 * od) * f, Math.exp(-BR[1] * 0.22 * od) * f, Math.exp(-BR[2] * 0.22 * od) * f];
}
