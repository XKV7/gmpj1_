import * as THREE from 'three';
import { Noise } from '../core/rng';
import { clamp, smoothstep } from '../core/math';
import { EDGE_STORM_R, HARD_LIMIT_R, RiverSpec, StormSpec, WorldData } from './worldgen';
import { PALETTES } from './biomes';
import { FOG_PARS, G, NOISE_GLSL } from '../render/uniforms';

export interface Thermal {
  x: number;
  z: number;
  baseY: number;
  topY: number;
  radius: number;
  strength: number;
  color: THREE.Color;
}

export interface River {
  spec: RiverSpec;
  samples: THREE.Vector3[];
  tangents: THREE.Vector3[];
  length: number;
  box: THREE.Box3;
}

export interface WindSample {
  wind: THREE.Vector3;
  riverWind: THREE.Vector3; // part of `wind` contributed by wind rivers
  thermal: number; // 0..1 how much inside a thermal
  river: number; // 0..1 inside a wind river
  riverIndex: number;
  storm: number; // 0..1 storm intensity
  turbulence: number;
}

const RIVER_SAMPLES = 256;
const PATH_POINTS = 64;

export class WindSystem {
  thermals: Thermal[] = [];
  rivers: River[] = [];
  storms: StormSpec[];
  stormFactor = 1; // 0 after the ending
  dayFactor = 1;
  ambientDir = new THREE.Vector2(1, 0);
  ambientSpeed = 4;
  private noise = new Noise(77);
  private tmp = new THREE.Vector3();

  constructor(world: WorldData) {
    this.storms = world.storms;
    for (const I of world.islands) {
      const s = I.spec;
      const strength = s.role === 'sky' ? 9 : 6.5 + (s.radius / 150) * 3 + (s.biome === 'canyon' ? 1.5 : 0);
      const off = s.role === 'hub' || s.role === 'village' ? 0.35 : 0.15;
      const a = (s.seed % 628) / 100;
      this.thermals.push({
        x: s.x + Math.cos(a) * s.radius * off,
        z: s.z + Math.sin(a) * s.radius * off,
        baseY: s.y + Math.min(I.maxTop, 30) - 10,
        topY: s.y + I.maxTop + 320 + s.radius,
        radius: s.radius * 0.45 + 22,
        strength,
        color: PALETTES[s.biome].thermal.clone(),
      });
    }
    // Free-standing thermals over the cloud sea between islands (helps long trips).
    for (let k = 0; k < 10; k++) {
      const a = k * 2.399;
      const d = 500 + (k * 173) % 1500;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (world.islands.some((i) => Math.hypot(i.spec.x - x, i.spec.z - z) < i.spec.radius + 120)) continue;
      if (Math.hypot(x - world.eye.x, z - world.eye.z) < 650) continue;
      this.thermals.push({ x, z, baseY: 80, topY: 650, radius: 45, strength: 6, color: new THREE.Color(0xfff6e0) });
    }
    for (let k = 0; k < 3; k++) {
      const a = Math.atan2(-world.eye.z, -world.eye.x) + (k - 1) * 0.5;
      this.thermals.push({ x: world.eye.x + Math.cos(a) * 640, z: world.eye.z + Math.sin(a) * 640, baseY: 150, topY: 820, radius: 50, strength: 8, color: new THREE.Color(0xe8e0ff) });
    }
    for (const spec of world.rivers) {
      const curve = new THREE.CatmullRomCurve3(spec.points, false, 'centripetal');
      const samples: THREE.Vector3[] = [];
      const tangents: THREE.Vector3[] = [];
      for (let i = 0; i < RIVER_SAMPLES; i++) {
        const t = i / (RIVER_SAMPLES - 1);
        samples.push(curve.getPointAt(t));
        tangents.push(curve.getTangentAt(t).normalize());
      }
      const box = new THREE.Box3().setFromPoints(samples).expandByScalar(spec.radius * 2);
      this.rivers.push({ spec, samples, tangents, length: curve.getLength(), box });
    }
  }

  update(time: number, sunUp: number): void {
    this.dayFactor = 0.65 + 0.35 * clamp(sunUp, 0, 1);
    const a = 0.6 + Math.sin(time * 0.01) * 0.8;
    this.ambientDir.set(Math.cos(a), Math.sin(a));
    this.ambientSpeed = 3.5 + 2 * Math.sin(time * 0.037);
    G.uWind.value.copy(this.ambientDir).multiplyScalar(0.6 + this.ambientSpeed * 0.1);
  }

  /** Nearest river param for a point; returns distance and index. */
  riverQuery(p: THREE.Vector3, ri: number): { d: number; i: number } {
    const r = this.rivers[ri];
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < r.samples.length; i += 4) {
      const d = r.samples[i].distanceToSquared(p);
      if (d < best) { best = d; bi = i; }
    }
    const lo = Math.max(0, bi - 4), hi = Math.min(r.samples.length - 1, bi + 4);
    for (let i = lo; i <= hi; i++) {
      const d = r.samples[i].distanceToSquared(p);
      if (d < best) { best = d; bi = i; }
    }
    return { d: Math.sqrt(best), i: bi };
  }

  sample(p: THREE.Vector3, time: number, out: WindSample): WindSample {
    const w = out.wind.set(this.ambientDir.x * this.ambientSpeed, 0, this.ambientDir.y * this.ambientSpeed);
    w.multiplyScalar(smoothstep(0, 400, p.y) * 0.8 + 0.2);
    out.thermal = 0;
    out.river = 0;
    out.riverIndex = -1;
    out.storm = 0;
    out.turbulence = 0;
    out.riverWind.set(0, 0, 0);

    // Thermals.
    for (const t of this.thermals) {
      const dx = p.x - t.x, dz = p.z - t.z;
      const r2 = dx * dx + dz * dz;
      const lim = t.radius * 1.6;
      if (r2 > lim * lim) continue;
      if (p.y < t.baseY - 5 || p.y > t.topY + 100) continue;
      const rr = Math.sqrt(r2) / t.radius;
      const core = Math.exp(-rr * rr * 1.6);
      const hf = smoothstep(t.baseY - 5, t.baseY + 20, p.y) * (1 - smoothstep(t.topY, t.topY + 100, p.y));
      const up = t.strength * this.dayFactor * hf * (core - 0.12 * smoothstep(0.9, 1.4, rr));
      w.y += up;
      // Gentle swirl inside the column.
      w.x += -dz / t.radius * core * 1.2 * hf;
      w.z += dx / t.radius * core * 1.2 * hf;
      out.thermal = Math.max(out.thermal, core * hf);
    }

    // Wind rivers.
    for (let ri = 0; ri < this.rivers.length; ri++) {
      const r = this.rivers[ri];
      if (!r.box.containsPoint(p)) continue;
      const q = this.riverQuery(p, ri);
      const R = r.spec.radius;
      if (q.d > R * 1.8) continue;
      const k = 1 - smoothstep(R * 0.6, R * 1.8, q.d);
      const tan = r.tangents[q.i];
      const edgeFade = smoothstep(0, 10, q.i) * (1 - smoothstep(RIVER_SAMPLES - 10, RIVER_SAMPLES - 1, q.i));
      const s = r.spec.speed * k * edgeFade;
      out.riverWind.addScaledVector(tan, s);
      // Gentle pull toward the core keeps you inside.
      this.tmp.copy(r.samples[q.i]).sub(p);
      out.riverWind.addScaledVector(this.tmp, 0.35 * k * edgeFade);
      w.addScaledVector(tan, s).addScaledVector(this.tmp, 0.35 * k * edgeFade);
      if (k * edgeFade > out.river) {
        out.river = k * edgeFade;
        out.riverIndex = ri;
      }
    }

    // Storms.
    const sf = this.stormFactor;
    if (sf > 0.001) {
      for (const s of this.storms) {
        const dx = p.x - s.x, dz = p.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d > s.outer + 60) continue;
        if (p.y < s.yMin || p.y > s.yMax) continue;
        const tx = -dz / Math.max(d, 1), tz = dx / Math.max(d, 1);
        if (s.kind === 'eye') {
          const wall = smoothstep(s.inner - 40, s.inner + 50, d) * (1 - smoothstep(s.outer - 60, s.outer + 60, d));
          const amt = wall * sf;
          if (amt > 0) {
            w.x += tx * 24 * amt;
            w.z += tz * 24 * amt;
            const n1 = this.noise.n3(p.x * 0.012, p.y * 0.012, time * 0.6);
            const n2 = this.noise.n3(p.x * 0.012 + 40, p.y * 0.012, time * 0.6 + 9);
            const n3 = this.noise.n3(p.x * 0.015, p.z * 0.015, time * 0.9 + 3);
            w.x += n1 * 14 * amt;
            w.z += n2 * 14 * amt;
            w.y += (n3 * 10 + 1.5) * amt;
            out.storm = Math.max(out.storm, amt);
            out.turbulence = Math.max(out.turbulence, amt);
          }
          // Calm, rising eye.
          const eye = 1 - smoothstep(s.inner * 0.5, s.inner, d);
          if (eye > 0 && sf > 0.5) w.y += 4 * eye;
        } else {
          const amt = (1 - smoothstep(s.outer * 0.6, s.outer + 60, d)) * sf;
          if (amt > 0) {
            w.x += (Math.cos(s.dir) * 26 + tx * 8) * amt;
            w.z += (Math.sin(s.dir) * 26 + tz * 8) * amt;
            const n1 = this.noise.n3(p.x * 0.02, p.y * 0.02, time * 0.8);
            const n2 = this.noise.n3(p.z * 0.02, p.y * 0.02 + 20, time * 0.8);
            w.x += n1 * 8 * amt;
            w.z += n2 * 8 * amt;
            w.y += this.noise.n3(p.x * 0.02, p.z * 0.02, time + 5) * 7 * amt;
            out.storm = Math.max(out.storm, amt * 0.8);
            out.turbulence = Math.max(out.turbulence, amt * 0.7);
          }
        }
      }
    }
    // Edge of the world: always stormy, pushes you home.
    const rd = Math.hypot(p.x, p.z);
    if (rd > EDGE_STORM_R) {
      const amt = smoothstep(EDGE_STORM_R, EDGE_STORM_R + 300, rd);
      const n1 = this.noise.n3(p.x * 0.01, p.y * 0.01, time * 0.7);
      const n2 = this.noise.n3(p.z * 0.01, p.y * 0.01 + 50, time * 0.7);
      w.x += n1 * 12 * amt;
      w.z += n2 * 12 * amt;
      w.y += this.noise.n3(p.x * 0.01, p.z * 0.01, time + 1) * 6 * amt;
      const push = smoothstep(EDGE_STORM_R + 150, HARD_LIMIT_R, rd) * 40;
      w.x -= (p.x / rd) * push;
      w.z -= (p.z / rd) * push;
      out.storm = Math.max(out.storm, amt);
      out.turbulence = Math.max(out.turbulence, amt);
    }
    return out;
  }
}

export function makeWindSample(): WindSample {
  return { wind: new THREE.Vector3(), riverWind: new THREE.Vector3(), thermal: 0, river: 0, riverIndex: -1, storm: 0, turbulence: 0 };
}

/* ------------------------------------------------------------------ */
/* Visuals                                                             */
/* ------------------------------------------------------------------ */

/** Sparkling streaks flowing along each wind river; positions sampled from a float data texture. */
export function makeRiverStreaks(rivers: River[], density: number): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.PlaneGeometry(1, 1);
  for (const r of rivers) {
    // Path control points as a uniform array (portable: no vertex texture fetch).
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < PATH_POINTS; i++) pts.push(r.samples[Math.round((i / (PATH_POINTS - 1)) * (RIVER_SAMPLES - 1))].clone());
    const count = Math.floor((r.length / 4) * density);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    const aT = new Float32Array(count);
    const aOff = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      aT[i] = Math.random();
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * r.spec.radius * 0.9;
      aOff[i * 3] = Math.cos(ang) * rad;
      aOff[i * 3 + 1] = Math.sin(ang) * rad;
      aOff[i * 3 + 2] = 4 + Math.random() * 10;
    }
    geo.setAttribute('aT', new THREE.InstancedBufferAttribute(aT, 1));
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(aOff, 3));
    geo.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: G.uTime,
        uPts: { value: pts },
        uSpeed: { value: r.spec.speed / r.length },
        uNight: G.uNight,
        uFogColor: G.uFogColor,
        uFogSunColor: G.uFogSunColor,
        uFogLowColor: G.uFogLowColor,
        uFogDensity: G.uFogDensity,
        uSunDir: G.uSunDir,
      },
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute vec3 aOff;
        uniform float uTime;
        uniform float uSpeed;
        uniform vec3 uPts[${PATH_POINTS}];
        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vWorld;
        vec3 pathAt(float t) {
          float f = clamp(t, 0.0, 1.0) * ${(PATH_POINTS - 1).toFixed(1)};
          int i0 = int(floor(f));
          int i1 = min(i0 + 1, ${PATH_POINTS - 1});
          return mix(uPts[i0], uPts[i1], f - float(i0));
        }
        void main() {
          float t = fract(aT + uTime * uSpeed * (0.8 + fract(aT * 17.0) * 0.4));
          vec3 p = pathAt(t);
          vec3 tg = normalize(pathAt(t + 0.01) - pathAt(t - 0.01) + vec3(1e-4));
          vec3 side = normalize(cross(tg, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
          vec3 up = cross(side, tg);
          float wob = sin(uTime * 2.0 + aT * 50.0) * 1.2;
          vec3 c = p + side * (aOff.x + wob) + up * aOff.y;
          vec3 toCam = normalize(cameraPosition - c);
          vec3 w = normalize(cross(tg, toCam) + vec3(1e-4));
          float dcam = length(cameraPosition - c);
          float wd = max(0.7, dcam * 0.0045);
          vec3 world = c + tg * position.x * aOff.z * 1.8 + w * position.y * wd;
          vUv = position.xy + 0.5;
          vAlpha = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.95, 1.0, t));
          vWorld = world;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uNight;
        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vWorld;
        ${FOG_PARS}
        void main() {
          float along = vUv.x;
          float across = abs(vUv.y - 0.5) * 2.0;
          float a = smoothstep(0.0, 0.4, along) * (1.0 - smoothstep(0.6, 1.0, along)) * (1.0 - across * across);
          vec3 col = mix(vec3(0.62, 0.88, 1.0), vec3(0.6, 0.8, 1.0), uNight);
          float dist = length(vWorld - cameraPosition);
          float f = 1.0 - smoothstep(700.0, 2600.0, dist);
          float sparkle = 0.8 + 0.6 * step(0.92, fract(sin(dot(floor(vWorld.xz * 0.2), vec2(12.9, 78.2))) * 43758.5));
          gl_FragColor = vec4(col * sparkle, a * vAlpha * f * 0.75);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    group.add(mesh);
  }
  return group;
}

/** Rising petals / sparkles marking thermals + faint shimmering haze columns. */
export function makeThermalVisuals(thermals: Thermal[], density: number): THREE.Group {
  const group = new THREE.Group();
  const perThermal = Math.floor(70 * density);
  const n = thermals.length * perThermal;
  const pos = new Float32Array(n * 3);
  const params = new Float32Array(n * 4);
  const cols = new Float32Array(n * 3);
  let k = 0;
  for (const t of thermals) {
    for (let i = 0; i < perThermal; i++) {
      pos[k * 3] = t.x;
      pos[k * 3 + 1] = t.baseY;
      pos[k * 3 + 2] = t.z;
      params[k * 4] = t.radius * Math.sqrt(Math.random()) * 0.9;
      params[k * 4 + 1] = Math.random() * Math.PI * 2;
      params[k * 4 + 2] = Math.min(t.topY - t.baseY, 380);
      params[k * 4 + 3] = Math.random();
      cols[k * 3] = t.color.r;
      cols[k * 3 + 1] = t.color.g;
      cols[k * 3 + 2] = t.color.b;
      k++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
  geo.setAttribute('aColor', new THREE.BufferAttribute(cols, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: G.uTime, uNight: G.uNight, uDay: { value: 1 }, uPixel: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aParams;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uPixel;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRot;
      void main() {
        float h = aParams.z;
        float rise = mod(aParams.w * h + uTime * (6.0 + aParams.w * 4.0), h);
        float ang = aParams.y + uTime * 0.35 + rise * 0.01;
        vec3 p = position + vec3(cos(ang) * aParams.x, rise, sin(ang) * aParams.x);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        gl_PointSize = clamp(1100.0 * uPixel / dist, 1.5, 28.0 * uPixel);
        vAlpha = smoothstep(0.0, 25.0, rise) * (1.0 - smoothstep(h * 0.7, h, rise)) * (1.0 - smoothstep(700.0, 1400.0, dist));
        vColor = aColor;
        vRot = aParams.w * 6.28 + uTime * (1.0 + aParams.w);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      uniform float uDay;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRot;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float s = sin(vRot), co = cos(vRot);
        c = vec2(c.x * co - c.y * s, c.x * s + c.y * co);
        float d = length(c * vec2(1.0, 2.0));
        float a = smoothstep(0.5, 0.25, d) * vAlpha;
        vec3 col = vColor * mix(1.15, 0.55, uNight);
        gl_FragColor = vec4(col, a * mix(0.85, 0.45, uNight) * uDay);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 55;
  group.add(points);

  // Haze columns.
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
  cyl.translate(0, 0.5, 0);
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: G.uTime, uDay: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDay;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      ${NOISE_GLSL}
      void main() {
        float n = vnoise(vec2(vUv.x * 18.0, vUv.y * 6.0 - uTime * 0.5));
        float streak = smoothstep(0.55, 0.9, n);
        float fadeY = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.5, 1.0, vUv.y));
        vec3 v = normalize(cameraPosition - vWorld);
        float edge = 1.0 - abs(dot(normalize(vN), v));
        float dist = length(cameraPosition - vWorld);
        float a = streak * fadeY * edge * 0.07 * uDay * (1.0 - smoothstep(500.0, 1200.0, dist));
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a, 1.0);
      }`,
  });
  const haze = new THREE.InstancedMesh(cyl, hazeMat, thermals.length);
  const m = new THREE.Matrix4();
  thermals.forEach((t, i) => {
    m.makeScale(t.radius * 0.8, Math.min(t.topY - t.baseY, 380), t.radius * 0.8);
    m.setPosition(t.x, t.baseY, t.z);
    haze.setMatrixAt(i, m);
  });
  haze.frustumCulled = false;
  haze.renderOrder = 54;
  group.add(haze);
  group.userData.points = mat;
  group.userData.haze = hazeMat;
  return group;
}
