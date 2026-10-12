import * as THREE from 'three';
import { FOG_PARS, G, NOISE_GLSL } from './uniforms';

export const CloudU = {
  uCloudLit: { value: new THREE.Color(1, 0.98, 0.95) },
  uCloudShade: { value: new THREE.Color(0.62, 0.66, 0.82) },
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
};

export const CLOUD_SEA_Y = 0;

/** Multi-layer noise cloud sea that follows the camera horizontally. */
export class CloudSea {
  group = new THREE.Group();
  private layers: THREE.Mesh[] = [];

  constructor(layerCount: number) {
    const geo = new THREE.PlaneGeometry(26000, 26000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const n = Math.max(2, layerCount + 1);
    for (let i = 0; i < n; i++) {
      const bottom = i === n - 1;
      const t = i / (n - 1);
      const y = CLOUD_SEA_Y - t * 70;
      const mat = new THREE.ShaderMaterial({
        transparent: !bottom,
        depthWrite: bottom,
        uniforms: {
          uTime: G.uTime,
          uSunDir: G.uSunDir,
          uFogColor: G.uFogColor,
          uFogSunColor: G.uFogSunColor,
          uFogLowColor: G.uFogLowColor,
          uFogDensity: G.uFogDensity,
          uCloudLit: CloudU.uCloudLit,
          uCloudShade: CloudU.uCloudShade,
          uLayer: { value: t },
          uCover: { value: bottom ? -1 : 0.44 + t * 0.12 },
          uSpeed: { value: 1 - t * 0.5 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uCloudLit;
          uniform vec3 uCloudShade;
          uniform float uLayer;
          uniform float uCover;
          uniform float uSpeed;
          varying vec3 vWorld;
          ${FOG_PARS}
          ${NOISE_GLSL}
          void main() {
            vec2 drift = vec2(uTime * 0.9, uTime * 0.45) * uSpeed;
            vec2 p = (vWorld.xz + drift) * 0.0016 + uLayer * 3.7;
            float n = fbm2(p);
            float n2 = fbm2(p * 3.3 + 11.0);
            float big = vnoise(p * 0.21 + 3.0);
            float v = n * 0.75 + n2 * 0.35 + big * 0.35 - 0.2;
            float dens = smoothstep(uCover, uCover + 0.22, v);
            if (uCover < 0.0) dens = 1.0;
            vec2 sdir = normalize(uSunDir.xz + vec2(1e-4)) * 0.05;
            float nl = fbm2(p + sdir) * 0.75 + fbm2((p + sdir) * 3.3 + 11.0) * 0.35;
            float lit = clamp(0.55 + (v - (nl + big * 0.35 - 0.2)) * 9.0, 0.0, 1.0);
            // Billows: brighter crowns where density is high, shaded valleys between.
            float crown = smoothstep(0.35, 0.95, n2 + big * 0.4);
            lit = lit * mix(0.55, 1.0, crown) * mix(1.0, 0.5, uLayer);
            float sunUp = smoothstep(-0.15, 0.25, uSunDir.y);
            vec3 col = mix(uCloudShade * 0.82, uCloudLit, pow(lit, 1.3) * (0.3 + 0.7 * sunUp) + 0.08);
            col *= mix(1.0, 0.72, uLayer);
            float edge = smoothstep(0.0, 0.5, dens) * (1.0 - smoothstep(0.5, 1.0, dens));
            col += uCloudLit * edge * 0.1 * (1.0 - uLayer);
            vec3 d = vWorld - cameraPosition;
            float dist = length(d);
            float f = 1.0 - exp(-dist * uFogDensity * 1.1);
            // Far away the sea melts into the sky's horizon colour (no visible plane edge).
            vec3 far = fogColorFor(d / dist, 600.0);
            col = mix(col, mix(fogColorFor(d / dist, 0.0), far, smoothstep(2000.0, 9000.0, dist)), f);
            dens *= 1.0 - smoothstep(9000.0, 12500.0, dist);
            float a = dens;
            if (a < 0.01) discard;
            gl_FragColor = vec4(col, a);
          }`,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.renderOrder = bottom ? -900 : 10 - i;
      m.frustumCulled = false;
      this.layers.push(m);
      this.group.add(m);
    }
  }

  update(cam: THREE.Vector3): void {
    const sx = Math.round(cam.x / 200) * 200;
    const sz = Math.round(cam.z / 200) * 200;
    for (const l of this.layers) {
      l.position.x = sx;
      l.position.z = sz;
    }
  }
}

export interface PuffSpec {
  x: number;
  y: number;
  z: number;
  r: number;
  dark: number; // 0 normal, 1 storm
}

/** Camera-facing soft cloud billboards, sorted back-to-front. */
export class CloudPuffs {
  mesh: THREE.Mesh;
  specs: PuffSpec[];
  private geo: THREE.InstancedBufferGeometry;
  private offsets: Float32Array;
  private params: Float32Array;
  private order: number[];
  private dists: Float32Array;
  private frame = 0;
  readonly mat: THREE.ShaderMaterial;

  constructor(specs: PuffSpec[]) {
    this.specs = specs;
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.offsets = new Float32Array(specs.length * 3);
    this.params = new Float32Array(specs.length * 3);
    this.order = specs.map((_, i) => i);
    this.dists = new Float32Array(specs.length);
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(this.offsets, 3));
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(this.params, 3));
    geo.instanceCount = specs.length;
    this.geo = geo;
    this.writeAttributes();
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: G.uTime,
        uSunDir: G.uSunDir,
        uFogColor: G.uFogColor,
        uFogSunColor: G.uFogSunColor,
        uFogLowColor: G.uFogLowColor,
        uFogDensity: G.uFogDensity,
        uCloudLit: CloudU.uCloudLit,
        uCloudShade: CloudU.uCloudShade,
        uSunView: CloudU.uSunView,
        uStorm: G.uStorm,
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec3 aParams; // radius, dark, seed
        uniform float uTime;
        uniform float uStorm;
        varying vec2 vUv;
        varying vec3 vCenter;
        varying vec3 vParams;
        varying float vFade;
        void main() {
          vec3 c = aOffset;
          c.x += sin(uTime * 0.05 + aParams.z * 10.0) * 6.0;
          c.y += sin(uTime * 0.08 + aParams.z * 20.0) * 2.0;
          float r = aParams.x * mix(1.0, uStorm, step(0.5, aParams.y));
          vec4 mv = viewMatrix * vec4(c, 1.0);
          float camDist = length(mv.xyz);
          vFade = smoothstep(r * 0.25, r * 1.1, camDist);
          mv.xy += position.xy * r;
          vUv = position.xy;
          vCenter = c;
          vParams = aParams;
          gl_Position = projectionMatrix * mv;
          if (r < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudShade;
        uniform vec3 uSunView;
        varying vec2 vUv;
        varying vec3 vCenter;
        varying vec3 vParams;
        varying float vFade;
        ${FOG_PARS}
        ${NOISE_GLSL}
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float seed = vParams.z * 31.0;
          float n = fbm2(vUv * 1.8 + seed + uTime * 0.01);
          float shape = (1.0 - r) + (n - 0.5) * 0.75;
          float a = smoothstep(0.02, 0.38, shape) * smoothstep(1.0, 0.72, r);
          if (a < 0.01) discard;
          vec3 nv = normalize(vec3(vUv * 0.9 + (n - 0.5) * 0.4, sqrt(max(1.0 - r * r, 0.0)) + 0.2));
          float l = clamp(dot(nv, normalize(uSunView)) * 0.5 + 0.55, 0.0, 1.0);
          float sunUp = smoothstep(-0.15, 0.25, uSunDir.y);
          vec3 col = mix(uCloudShade, uCloudLit, l * (0.3 + 0.7 * sunUp) + 0.1);
          float rimL = smoothstep(0.55, 1.0, r) * max(dot(normalize(vUv + 1e-4), normalize(uSunView.xy + 1e-4)), 0.0);
          col += uCloudLit * rimL * 0.35 * sunUp;
          col *= mix(1.0, 0.86, smoothstep(0.0, 1.0, -vUv.y) * 0.6);
          float dark = vParams.y;
          col = mix(col, col * vec3(0.3, 0.3, 0.42) + vec3(0.02, 0.02, 0.05), dark);
          col = applyFog(col, vCenter);
          gl_FragColor = vec4(col, a * vFade * mix(0.92, 0.97, dark));
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
  }

  private writeAttributes(): void {
    for (let k = 0; k < this.order.length; k++) {
      const s = this.specs[this.order[k]];
      this.offsets[k * 3] = s.x;
      this.offsets[k * 3 + 1] = s.y;
      this.offsets[k * 3 + 2] = s.z;
      this.params[k * 3] = s.r;
      this.params[k * 3 + 1] = s.dark;
      this.params[k * 3 + 2] = ((this.order[k] * 0.6180339) % 1 + 1) % 1;
    }
    (this.geo.getAttribute('aOffset') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aParams') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  update(camera: THREE.Camera): void {
    const v = G.uSunDir.value.clone().transformDirection(camera.matrixWorldInverse);
    CloudU.uSunView.value.copy(v);
    if (this.frame++ % 6 !== 0) return;
    const cp = camera.position;
    for (let i = 0; i < this.specs.length; i++) {
      const s = this.specs[i];
      const dx = s.x - cp.x, dy = s.y - cp.y, dz = s.z - cp.z;
      this.dists[i] = dx * dx + dy * dy + dz * dz;
    }
    this.order.sort((a, b) => this.dists[b] - this.dists[a]);
    this.writeAttributes();
  }

  /** 0..1: how deep the point is inside any cloud puff. */
  insideAmount(p: THREE.Vector3, stormScale: number): number {
    let best = 0;
    for (const s of this.specs) {
      const r = s.r * (s.dark > 0.5 ? stormScale : 1) * 0.72;
      if (r < 1) continue;
      const dx = s.x - p.x, dy = s.y - p.y, dz = s.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r * r) {
        const v = 1 - Math.sqrt(d2) / r;
        if (v > best) best = v;
      }
    }
    return Math.min(1, best * 2.2);
  }
}
