import * as THREE from 'three';
import { Noise, RNG } from '../core/rng';
import { clamp, smoothstep, TAU } from '../core/math';
import { Biome, PALETTES } from './biomes';

export type IslandRole = 'hub' | 'village' | 'moon' | 'sky' | 'plain' | 'satellite';

export interface IslandSpec {
  id: number;
  name: string;
  biome: Biome;
  role: IslandRole;
  villageIndex: number; // -1 if none
  x: number;
  y: number;
  z: number;
  radius: number;
  seed: number;
}

interface Spike {
  t: number;
  a: number;
  len: number;
  w: number;
}

/**
 * A floating island defined by analytic functions (top surface, rock underside, outline).
 * Meshes are generated from the same functions so collision matches rendering.
 */
export class Island {
  readonly spec: IslandSpec;
  readonly noise: Noise;
  readonly cliffH: number;
  private spikes: Spike[] = [];
  private flatR: number;
  private peak: { x: number; z: number; h: number };
  private canyonDir: number;
  maxTop = 0;
  minBottom = 0;
  discovered = false;

  constructor(spec: IslandSpec) {
    this.spec = spec;
    this.noise = new Noise(spec.seed);
    const rng = new RNG(spec.seed ^ 0x5bd1e995);
    const R = spec.radius;
    this.cliffH = rng.range(4, 9) + R * 0.03;
    this.flatR = spec.role === 'hub' ? 0.7 : spec.role === 'village' ? 0.58 : spec.role === 'sky' ? 0.8 : spec.role === 'moon' ? 0.35 : 0;
    this.peak = { x: rng.range(-0.2, 0.2) * R, z: rng.range(-0.2, 0.2) * R, h: R * rng.range(0.45, 0.7) };
    this.canyonDir = rng.range(0, Math.PI);
    // Rock roots under the island.
    this.spikes.push({ t: rng.range(0, 0.15), a: rng.range(0, TAU), len: R * rng.range(0.9, 1.5), w: rng.range(0.4, 0.55) });
    const n = rng.int(4, 8);
    for (let i = 0; i < n; i++) {
      this.spikes.push({ t: rng.range(0.25, 0.8), a: rng.range(0, TAU), len: R * rng.range(0.2, 0.7), w: rng.range(0.14, 0.28) });
    }
    // Estimate extents.
    let mt = -Infinity;
    let mb = Infinity;
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j < 16; j++) {
        const t = i / 16;
        const a = (j / 16) * TAU;
        const r = t * this.boundary(a) * 0.98;
        const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
        mt = Math.max(mt, this.topLocal(lx, lz));
        mb = Math.min(mb, this.bottomLocal(lx, lz));
      }
    }
    this.maxTop = mt;
    this.minBottom = mb;
  }

  get center(): THREE.Vector3 {
    return new THREE.Vector3(this.spec.x, this.spec.y, this.spec.z);
  }

  boundary(a: number): number {
    const R = this.spec.radius;
    const c = Math.cos(a), s = Math.sin(a);
    return R * (1 + 0.17 * this.noise.n2(c * 1.2 + 10, s * 1.2) + 0.06 * this.noise.n2(c * 3 + 20, s * 3));
  }

  /** Normalized radial coordinate (0 center, 1 rim). */
  tAt(lx: number, lz: number): number {
    const r = Math.hypot(lx, lz);
    return r / this.boundary(Math.atan2(lz, lx));
  }

  /** Top surface height relative to spec.y (before rim drop). */
  private terrain(lx: number, lz: number, t: number): number {
    const R = this.spec.radius;
    const nz = this.noise;
    const b = this.spec.biome;
    let h = 0;
    switch (b) {
      case 'meadow':
        h = 7 * nz.fbm2(lx / 70, lz / 70, 4) + 3 * nz.n2(lx / 22, lz / 22);
        break;
      case 'cherry':
        h = 10 * nz.fbm2(lx / 55, lz / 55, 4) + 2 * nz.n2(lx / 15, lz / 15);
        break;
      case 'moonflower':
        h = 5 * nz.fbm2(lx / 50, lz / 50, 3) - 4 * (1 - t * t);
        break;
      case 'ruins': {
        const raw = 10 * nz.fbm2(lx / 60, lz / 60, 3) + 4;
        const q = Math.floor(raw / 3.2) * 3.2;
        const f = raw / 3.2 - Math.floor(raw / 3.2);
        h = q + smoothstep(0.75, 1, f) * 3.2;
        break;
      }
      case 'canyon': {
        const rg = nz.ridge2(lx / 80, lz / 80, 4);
        let raw = 26 * rg + 6 * nz.n2(lx / 30, lz / 30);
        const dx = Math.cos(this.canyonDir), dz = Math.sin(this.canyonDir);
        const dl = Math.abs(-dz * lx + dx * lz);
        raw -= 22 * Math.exp(-((dl / (R * 0.14)) ** 2));
        const step = 5;
        const q = Math.floor(raw / step) * step;
        const f = raw / step - Math.floor(raw / step);
        h = q + smoothstep(0.6, 1, f) * step;
        break;
      }
      case 'alpine': {
        const dx = lx - this.peak.x, dz = lz - this.peak.z;
        const pd = Math.hypot(dx, dz) / R;
        const cone = Math.pow(clamp(1 - pd, 0, 1), 1.5);
        h = this.peak.h * cone * (0.85 + 0.3 * nz.fbm2(lx / 40, lz / 40, 3)) + 18 * nz.ridge2(lx / 50, lz / 50, 3) * cone + 3 * nz.n2(lx / 20, lz / 20);
        break;
      }
      case 'sky':
        h = 2 * nz.fbm2(lx / 40, lz / 40, 2);
        break;
    }
    if (this.flatR > 0) {
      const k = smoothstep(this.flatR, this.flatR * 0.6, t);
      const flat = 1.5 + 0.6 * nz.n2(lx / 30, lz / 30);
      h = h * (1 - k) + flat * k;
    }
    return h;
  }

  topLocal(lx: number, lz: number): number {
    const t = this.tAt(lx, lz);
    const tc = Math.min(t, 1);
    const h = this.terrain(lx, lz, tc);
    const rimDrop = smoothstep(0.8, 1.0, tc) * (2 + this.spec.radius * 0.02);
    const hk = 1 - smoothstep(0.85, 1.0, tc) * 0.35;
    return h * hk - rimDrop;
  }

  bottomLocal(lx: number, lz: number): number {
    const R = this.spec.radius;
    const t = Math.min(this.tAt(lx, lz), 1);
    const a = Math.atan2(lz, lx);
    let depth = R * (0.28 + 0.12 * this.noise.n2(lx / 40 + 50, lz / 40)) * Math.pow(Math.max(1 - t * t, 0), 0.7);
    for (const s of this.spikes) {
      const sx = Math.cos(s.a) * s.t * R, sz = Math.sin(s.a) * s.t * R;
      const d = Math.hypot(lx - sx, lz - sz) / (s.w * R);
      if (d < 1) depth += s.len * Math.pow(1 - d, 1.9);
    }
    depth += 4 * this.noise.n2(Math.cos(a) * 4 + 30, Math.sin(a) * 4 + t * 3);
    return this.topLocal(Math.cos(a) * this.boundary(a), Math.sin(a) * this.boundary(a)) - this.cliffH - Math.max(depth, 0);
  }

  /** World-space top height or null if (x,z) is outside the island outline. */
  surfaceY(wx: number, wz: number, margin = 0): number | null {
    const lx = wx - this.spec.x, lz = wz - this.spec.z;
    const r2 = lx * lx + lz * lz;
    const lim = this.spec.radius * 1.3 + margin;
    if (r2 > lim * lim) return null;
    if (this.tAt(lx, lz) > 1 + margin / this.spec.radius) return null;
    return this.spec.y + this.topLocal(lx, lz);
  }

  bottomY(wx: number, wz: number): number | null {
    const lx = wx - this.spec.x, lz = wz - this.spec.z;
    if (this.tAt(lx, lz) > 1) return null;
    return this.spec.y + this.bottomLocal(lx, lz);
  }

  surfaceNormal(wx: number, wz: number, out = new THREE.Vector3()): THREE.Vector3 {
    const lx = wx - this.spec.x, lz = wz - this.spec.z;
    const e = 0.8;
    const hx = this.topLocal(lx + e, lz) - this.topLocal(lx - e, lz);
    const hz = this.topLocal(lx, lz + e) - this.topLocal(lx, lz - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Random point on the top surface (world coords) satisfying constraints. */
  randomTopPoint(rng: RNG, tMin: number, tMax: number, maxSlope = 0.5): THREE.Vector3 | null {
    for (let k = 0; k < 20; k++) {
      const a = rng.range(0, TAU);
      const t = Math.sqrt(rng.range(tMin * tMin, tMax * tMax));
      const r = t * this.boundary(a);
      const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
      const wx = this.spec.x + lx, wz = this.spec.z + lz;
      const n = this.surfaceNormal(wx, wz);
      if (1 - n.y > maxSlope) continue;
      return new THREE.Vector3(wx, this.spec.y + this.topLocal(lx, lz), wz);
    }
    return null;
  }

  /** Point on the rim in the direction of (dx,dz) (world coords). */
  rimPoint(dx: number, dz: number, inset = 0.96): THREE.Vector3 {
    const a = Math.atan2(dz, dx);
    const r = this.boundary(a) * inset;
    const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
    return new THREE.Vector3(this.spec.x + lx, this.spec.y + this.topLocal(lx, lz), this.spec.z + lz);
  }

  buildGeometry(detail: 'high' | 'low'): THREE.BufferGeometry {
    const R = this.spec.radius;
    const NS = detail === 'high' ? Math.round(clamp(R * 0.55, 40, 84)) : Math.round(clamp(R * 0.16, 14, 26));
    const NT = detail === 'high' ? Math.round(clamp(R * 0.18, 14, 30)) : 6;
    const NC = detail === 'high' ? 4 : 2;
    const NB = detail === 'high' ? Math.round(clamp(R * 0.14, 12, 24)) : 6;
    const pal = PALETTES[this.spec.biome];
    const pos: number[] = [];
    const col: number[] = [];
    const region: number[] = []; // 0 top, 1 cliff, 2 bottom
    const nz = this.noise;
    const tmp = new THREE.Color();

    const pushV = (lx: number, ly: number, lz: number, reg: number): void => {
      pos.push(lx, ly, lz);
      region.push(reg);
    };

    // Top center.
    pushV(0, this.topLocal(0, 0), 0, 0);
    const rings: number[] = [];
    let idx = 1;
    // Top rings.
    for (let i = 1; i <= NT; i++) {
      const t = Math.pow(i / NT, 0.85);
      rings.push(idx);
      for (let j = 0; j < NS; j++) {
        const a = (j / NS) * TAU;
        const r = t * this.boundary(a);
        const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
        pushV(lx, this.topLocal(lx, lz), lz, 0);
        idx++;
      }
    }
    // Cliff rings.
    for (let k = 1; k <= NC; k++) {
      const f = k / NC;
      rings.push(idx);
      for (let j = 0; j < NS; j++) {
        const a = (j / NS) * TAU;
        const b = this.boundary(a);
        const bulge = 1 + 0.035 * Math.sin(f * Math.PI) + 0.02 * nz.n2(a * 3, f * 4);
        const lx = Math.cos(a) * b * bulge, lz = Math.sin(a) * b * bulge;
        const top = this.topLocal(Math.cos(a) * b, Math.sin(a) * b);
        pushV(lx, top - this.cliffH * f, lz, 1);
        idx++;
      }
    }
    // Bottom rings (outer to inner).
    for (let i = 1; i < NB; i++) {
      const t = 1 - Math.pow(i / NB, 1.15);
      rings.push(idx);
      for (let j = 0; j < NS; j++) {
        const a = (j / NS) * TAU;
        const b = this.boundary(a);
        const r = t * b * 0.99;
        let lx = Math.cos(a) * r, lz = Math.sin(a) * r;
        const ly = this.bottomLocal(lx, lz);
        const disp = 0.06 * R * (1 - t) * nz.n3(lx / 25, ly / 25, lz / 25);
        lx += Math.cos(a) * disp;
        lz += Math.sin(a) * disp;
        pushV(lx, ly, lz, 2);
        idx++;
      }
    }
    const bottomCenter = idx;
    pushV(0, this.bottomLocal(0, 0), 0, 2);

    const index: number[] = [];
    // Top fan
    for (let j = 0; j < NS; j++) index.push(0, rings[0] + ((j + 1) % NS), rings[0] + j);
    for (let k = 0; k < rings.length - 1; k++) {
      const a0 = rings[k], a1 = rings[k + 1];
      for (let j = 0; j < NS; j++) {
        const j1 = (j + 1) % NS;
        index.push(a0 + j, a0 + j1, a1 + j);
        index.push(a0 + j1, a1 + j1, a1 + j);
      }
    }
    const last = rings[rings.length - 1];
    for (let j = 0; j < NS; j++) index.push(bottomCenter, last + j, last + ((j + 1) % NS));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // Ensure outward winding (top normals should point up).
    const nAttr = geo.getAttribute('normal');
    if (nAttr.getY(0) < 0) {
      for (let i = 0; i < index.length; i += 3) {
        const t = index[i + 1];
        index[i + 1] = index[i + 2];
        index[i + 2] = t;
      }
      geo.setIndex(index);
      geo.computeVertexNormals();
    }

    // Vertex colors.
    const normals = geo.getAttribute('normal');
    const top = this.maxTop;
    for (let v = 0; v < pos.length / 3; v++) {
      const lx = pos[v * 3], ly = pos[v * 3 + 1], lz = pos[v * 3 + 2];
      const ny = normals.getY(v);
      const reg = region[v];
      if (reg === 0) {
        const n = nz.fbm2(lx / 18 + 100, lz / 18, 3) * 0.5 + 0.5;
        tmp.copy(pal.grassA).lerp(pal.grassB, clamp(n, 0, 1));
        const t = this.tAt(lx, lz);
        const slope = 1 - ny;
        if (this.spec.biome === 'canyon') tmp.lerp(pal.band, clamp(Math.sin(ly * 0.6) * 0.5 + 0.2, 0, 0.6) * smoothstep(0.1, 0.35, slope));
        tmp.lerp(pal.dirt, smoothstep(0.18, 0.4, slope) * 0.9);
        tmp.lerp(pal.cliff, smoothstep(0.4, 0.7, slope));
        tmp.lerp(pal.dirt, smoothstep(0.9, 1.0, t) * 0.8);
        if (this.spec.biome === 'alpine') {
          const snow = smoothstep(top * 0.35, top * 0.55, ly + nz.n2(lx / 12, lz / 12) * 6) * (1 - smoothstep(0.55, 0.8, slope) * 0.6);
          tmp.lerp(new THREE.Color(0xf6f8ff), snow);
        }
        if (this.spec.biome === 'ruins' || this.spec.biome === 'sky') {
          const paved = smoothstep(0.55, 0.75, nz.n2(lx / 9, lz / 9) * 0.5 + 0.5) * (this.spec.biome === 'sky' ? 0.9 : 0.5);
          tmp.lerp(pal.band, paved);
        }
        if (this.spec.role === 'village' || this.spec.role === 'hub') {
          // Dirt paths: radial spokes towards the plaza.
          const a = Math.atan2(lz, lx);
          const spoke = Math.abs(Math.sin(a * 2 + this.spec.seed));
          const path = smoothstep(0.08, 0.0, spoke) * smoothstep(0.2, 0.08, t > 0.7 ? 1 : 0);
          const plaza = smoothstep(0.16, 0.1, t);
          tmp.lerp(pal.dirt, Math.max(path * 0.6, plaza * 0.55));
        }
      } else if (reg === 1) {
        const band = Math.sin(ly * 0.9 + nz.n2(lx / 10, lz / 10) * 2) * 0.5 + 0.5;
        tmp.copy(pal.cliff).lerp(pal.band, band * 0.45);
      } else {
        const depthF = clamp((-ly - this.cliffH) / Math.max(-this.minBottom, 1), 0, 1);
        tmp.copy(pal.rockTop).lerp(pal.rockBottom, Math.pow(depthF, 0.7));
        const band = Math.sin(ly * 0.35 + nz.n3(lx / 20, ly / 20, lz / 20) * 3) * 0.5 + 0.5;
        tmp.lerp(pal.band, band * 0.18 * (1 - depthF));
        tmp.multiplyScalar(0.92 + 0.12 * (nz.n3(lx / 8, ly / 8, lz / 8) * 0.5 + 0.5));
      }
      col.push(tmp.r, tmp.g, tmp.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
}
