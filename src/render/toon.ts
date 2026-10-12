import * as THREE from 'three';
import { FOG_PARS, G, NOISE_GLSL } from './uniforms';

export type VertexAnim = 'none' | 'grass' | 'tree' | 'flag' | 'bob' | 'bloom' | 'sway';

let gradientMap: THREE.DataTexture | null = null;

/** 3-band painterly toon ramp. */
export function toonGradient(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([118, 118, 118, 255, 182, 182, 182, 255, 236, 236, 236, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientMap = tex;
  return tex;
}

const ANIM_GLSL: Record<VertexAnim, string> = {
  none: '',
  grass: /* glsl */ `
    {
      vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float hh = max(position.y, 0.0);
      float k = hh * hh * 1.6;
      float gust = sin(uTime * 0.9 + ip.x * 0.021 + ip.z * 0.017) * 0.5 + 0.5;
      float w = sin(uTime * 2.6 + ip.x * 0.37 + ip.z * 0.29) * (0.18 + 0.35 * gust);
      transformed.x += (w * uWind.x) * k;
      transformed.z += (w * uWind.y + 0.12 * gust) * k;
      vec3 away = ip - uPlayerPos;
      float pd = length(away);
      if (pd < 3.5) {
        vec2 pdir = normalize(away.xz + vec2(1e-3));
        float push = (1.0 - pd / 3.5) * 0.9 * k;
        transformed.x += pdir.x * push;
        transformed.z += pdir.y * push;
        transformed.y -= push * 0.3;
      }
    }`,
  tree: /* glsl */ `
    {
      vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float k = max(position.y - 1.5, 0.0);
      float s = sin(uTime * 1.3 + ip.x * 0.11 + ip.z * 0.07);
      transformed.x += s * 0.035 * k * uWind.x;
      transformed.z += s * 0.035 * k * uWind.y;
    }`,
  sway: /* glsl */ `
    {
      float k = max(position.y, 0.0);
      transformed.x += sin(uTime * 1.7 + position.z) * 0.02 * k;
    }`,
  flag: /* glsl */ `
    {
      vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float u = max(position.x, 0.0);
      transformed.z += sin(uTime * 7.0 - u * 3.5 + ip.x) * 0.18 * u;
      transformed.y += sin(uTime * 5.0 - u * 2.5 + ip.z) * 0.05 * u;
    }`,
  bob: /* glsl */ `
    {
      vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
      transformed.y += sin(uTime * 0.45 + ph) * 2.2 / max(length(instanceMatrix[1].xyz), 0.01);
    }`,
  bloom: /* glsl */ `
    {
      float open = mix(0.2, 1.0, uNight);
      transformed.xz *= open;
      transformed.y *= mix(0.6, 1.0, uNight);
    }`,
};

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  anim?: VertexAnim;
  side?: THREE.Side;
  rim?: number;
  watercolor?: number;
  emissive?: THREE.ColorRepresentation;
}

/** MeshToonMaterial with height fog, watercolor pigment noise, rim light and optional vertex animation. */
export function makeToon(opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    vertexColors: !!opts.vertexColors,
    gradientMap: toonGradient(),
    side: opts.side ?? THREE.FrontSide,
  });
  if (opts.emissive !== undefined) mat.emissive = new THREE.Color(opts.emissive);
  patchMaterial(mat, opts.anim ?? 'none', opts.rim ?? 0.22, opts.watercolor ?? 1);
  return mat;
}

export function patchMaterial(mat: THREE.Material, anim: VertexAnim = 'none', rim = 0.0, watercolor = 1): void {
  const key = `wc-${anim}-${rim.toFixed(2)}-${watercolor.toFixed(2)}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = G.uTime;
    shader.uniforms.uWind = G.uWind;
    shader.uniforms.uPlayerPos = G.uPlayerPos;
    shader.uniforms.uNight = G.uNight;
    shader.uniforms.uFogColor = G.uFogColor;
    shader.uniforms.uFogSunColor = G.uFogSunColor;
    shader.uniforms.uFogLowColor = G.uFogLowColor;
    shader.uniforms.uFogDensity = G.uFogDensity;
    shader.uniforms.uSunDir = G.uSunDir;
    shader.uniforms.uRimColor = G.uRimColor;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime; uniform vec2 uWind; uniform vec3 uPlayerPos; uniform float uNight;
         varying vec3 vFogWorld;`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${anim === 'none' ? '' : ANIM_GLSL[anim]}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         {
           vec4 fw = vec4(transformed, 1.0);
           #ifdef USE_INSTANCING
             fw = instanceMatrix * fw;
           #endif
           vFogWorld = (modelMatrix * fw).xyz;
         }`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vFogWorld;
         uniform vec3 uRimColor;
         ${FOG_PARS}
         ${NOISE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           float pig = vnoise3(vFogWorld * 0.07) * 0.6 + vnoise3(vFogWorld * 0.31) * 0.4;
           diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * pig, ${watercolor.toFixed(2)});
         }`,
      )
      .replace(
        '#include <opaque_fragment>',
        rim > 0
          ? `{
           vec3 vv = normalize(vViewPosition);
           float fr = pow(1.0 - clamp(abs(dot(normal, vv)), 0.0, 1.0), 3.0);
           outgoingLight += uRimColor * fr * ${rim.toFixed(3)};
         }
         #include <opaque_fragment>`
          : '#include <opaque_fragment>',
      )
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogWorld);');
  };
}

/** Unlit material with fog (for windows, lamps, glowing things). */
export function makeUnlit(color: THREE.ColorRepresentation, opts: { transparent?: boolean; opacity?: number; additive?: boolean; side?: THREE.Side; fog?: boolean } = {}): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: !!opts.transparent || !!opts.additive,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !(opts.transparent || opts.additive),
  });
  if (opts.fog !== false) patchMaterial(mat, 'none', 0, 0);
  return mat;
}
