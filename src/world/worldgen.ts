import * as THREE from 'three';
import { RNG, hashString } from '../core/rng';
import { TAU } from '../core/math';
import { Biome } from './biomes';
import { Island, IslandSpec, IslandRole } from './island';
import type { PuffSpec } from '../render/clouds';

export const WORLD_RADIUS = 2300;
export const EDGE_STORM_R = 2650;
export const HARD_LIMIT_R = 3150;

export interface RiverSpec {
  points: THREE.Vector3[];
  radius: number;
  speed: number;
}

export interface StormSpec {
  kind: 'eye' | 'cell';
  x: number;
  z: number;
  inner: number; // calm radius (eye)
  outer: number;
  dir: number; // tailwind direction for cells
  yMin: number;
  yMax: number;
}

export interface ShardSpec {
  pos: THREE.Vector3;
  hint: string;
}

export interface RaceSpec {
  name: string;
  rings: THREE.Vector3[];
}

export interface BridgeSpec {
  a: number;
  b: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
}

export interface LighthouseSpec {
  island: number;
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

export interface WorldData {
  seed: number;
  islands: Island[];
  bridges: BridgeSpec[];
  rivers: RiverSpec[];
  storms: StormSpec[];
  puffs: PuffSpec[];
  shards: ShardSpec[];
  races: RaceSpec[];
  lighthouses: LighthouseSpec[];
  npcRoutes: THREE.Vector3[][];
  eye: THREE.Vector3;
  hub: Island;
  villages: Island[]; // index = villageIndex
  moon: Island;
  sky: Island;
}

const VILLAGE_DEFS: { name: string; biome: Biome }[] = [
  { name: '들꽃마을', biome: 'meadow' },
  { name: '솔바람마을', biome: 'meadow' },
  { name: '노을언덕', biome: 'cherry' },
  { name: '구름목장', biome: 'meadow' },
  { name: '은하수마을', biome: 'ruins' },
  { name: '메아리골', biome: 'canyon' },
  { name: '눈꽃마을', biome: 'alpine' },
];

const PLAIN_NAMES: Record<Biome, string[]> = {
  meadow: ['푸른언덕', '솜털섬', '나비섬', '민들레섬', '조약돌섬'],
  cherry: ['벚꽃숲', '꽃비섬', '분홍그늘', '봄바람섬'],
  canyon: ['붉은절벽', '바위협곡', '모래바람터', '협곡섬'],
  alpine: ['서리봉우리', '하얀정상', '얼음송곳섬', '눈안개봉'],
  ruins: ['잊힌신전', '옛기둥섬', '이끼유적', '돌바람터'],
  moonflower: ['달꽃섬'],
  sky: ['하늘등대'],
};

export function seedFromString(s: string): number {
  const n = Number(s);
  if (s.trim() !== '' && Number.isFinite(n)) return Math.floor(Math.abs(n)) >>> 0;
  return hashString(s);
}

export function generateWorld(seed: number): WorldData {
  const rng = new RNG(seed);
  const specs: IslandSpec[] = [];
  const nextSeed = (): number => Math.floor(rng.next() * 4294967295);
  const add = (s: Omit<IslandSpec, 'id' | 'seed'>): IslandSpec => {
    const spec: IslandSpec = { ...s, id: specs.length, seed: nextSeed() };
    specs.push(spec);
    return spec;
  };
  const overlaps = (x: number, z: number, r: number, gap: number): boolean =>
    specs.some((s) => Math.hypot(s.x - x, s.z - z) < s.radius + r + gap);

  // Storm eye location.
  const eyeA = rng.range(0, TAU);
  const eye = new THREE.Vector3(Math.cos(eyeA) * 1850, 560, Math.sin(eyeA) * 1850);
  const nearEye = (x: number, z: number, r: number): boolean => Math.hypot(x - eye.x, z - eye.z) < 700 + r;

  const hub = add({ name: '바람마루', biome: 'meadow', role: 'hub', villageIndex: -1, x: 0, y: 400, z: 0, radius: 150 });
  add({ name: '하늘등대', biome: 'sky', role: 'sky', villageIndex: -1, x: eye.x, y: eye.y - 40, z: eye.z, radius: 70 });

  // Villages around the hub, roughly evenly spread, avoiding the storm side for the first ones.
  const villageAngles: number[] = [];
  const baseA = eyeA + Math.PI + rng.range(-0.3, 0.3);
  for (let i = 0; i < VILLAGE_DEFS.length; i++) {
    villageAngles.push(baseA + (i - (VILLAGE_DEFS.length - 1) / 2) * (TAU / (VILLAGE_DEFS.length + 0.6)));
  }
  const villageOrder = [0, 3, 1, 2, 4, 5, 6];
  for (let k = 0; k < VILLAGE_DEFS.length; k++) {
    const vi = villageOrder[k];
    const def = VILLAGE_DEFS[vi];
    let placed = false;
    for (let tries = 0; tries < 200 && !placed; tries++) {
      const a = villageAngles[k] + rng.range(-0.25, 0.25);
      const d = 520 + k * 120 + rng.range(-80, 120);
      const r = rng.range(85, 120);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (overlaps(x, z, r, 120) || nearEye(x, z, r)) continue;
      add({ name: def.name, biome: def.biome, role: 'village', villageIndex: vi, x, y: rng.range(300, 560) + (def.biome === 'alpine' ? 60 : 0), z, radius: r });
      placed = true;
    }
    if (!placed) {
      const a = villageAngles[k];
      add({ name: def.name, biome: def.biome, role: 'village', villageIndex: vi, x: Math.cos(a) * (900 + k * 140), y: 420, z: Math.sin(a) * (900 + k * 140), radius: 90 });
    }
  }

  // Moonflower island: far side, away from storm.
  {
    let placed = false;
    for (let tries = 0; tries < 300 && !placed; tries++) {
      const a = eyeA + Math.PI * rng.range(0.55, 1.45);
      const d = rng.range(1450, 1800);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (overlaps(x, z, 85, 160) || nearEye(x, z, 85)) continue;
      add({ name: '달꽃섬', biome: 'moonflower', role: 'moon', villageIndex: -1, x, y: rng.range(330, 470), z, radius: 85 });
      placed = true;
    }
    if (!placed) add({ name: '달꽃섬', biome: 'moonflower', role: 'moon', villageIndex: -1, x: -eye.x * 0.85, y: 400, z: -eye.z * 0.85, radius: 80 });
  }

  // Satellites next to villages (for rope bridges).
  const villagesNow = specs.filter((s) => s.role === 'village' || s.role === 'hub');
  for (const v of villagesNow) {
    if (!rng.chance(v.role === 'hub' ? 1 : 0.75)) continue;
    for (let tries = 0; tries < 30; tries++) {
      const a = rng.range(0, TAU);
      const r = rng.range(32, 50);
      const d = v.radius + r + rng.range(45, 75);
      const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
      if (overlaps(x, z, r, 40) || nearEye(x, z, r)) continue;
      const biome: Biome = v.biome === 'canyon' ? 'canyon' : v.biome === 'alpine' ? 'alpine' : rng.pick(['meadow', 'cherry'] as const);
      add({ name: '', biome, role: 'satellite', villageIndex: -1, x, y: v.y + rng.range(-6, 6), z, radius: r });
      break;
    }
  }

  // Plain islands of all biomes.
  const biomeCycle: Biome[] = ['cherry', 'canyon', 'alpine', 'ruins', 'meadow', 'cherry', 'canyon', 'alpine', 'ruins', 'meadow', 'cherry', 'ruins', 'alpine', 'canyon', 'meadow', 'cherry'];
  let bc = 0;
  for (let tries = 0; tries < 4000 && specs.length < 34; tries++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.next()) * WORLD_RADIUS;
    const r = rng.range(40, 125);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x, z) + r > WORLD_RADIUS) continue;
    if (overlaps(x, z, r, 110) || nearEye(x, z, r)) continue;
    const biome = biomeCycle[bc++ % biomeCycle.length];
    add({ name: '', biome, role: 'plain', villageIndex: -1, x, y: rng.range(220, 640) + (biome === 'alpine' ? 80 : 0), z, radius: r });
  }

  // Names for unnamed islands.
  const used = new Set(specs.map((s) => s.name).filter((n) => n));
  const counters: Record<string, number> = {};
  for (const s of specs) {
    if (s.name) continue;
    const pool = PLAIN_NAMES[s.biome];
    let name = '';
    for (const cand of pool) if (!used.has(cand)) { name = cand; break; }
    if (!name) {
      counters[s.biome] = (counters[s.biome] ?? 1) + 1;
      name = `${pool[0]} ${counters[s.biome]}`;
    }
    if (s.role === 'satellite') {
      const base = ['작은쉼터', '바람턱', '징검섬', '건넛섬', '오솔섬', '디딤섬', '쉼표섬', '버들섬'];
      for (const cand of base) if (!used.has(cand)) { name = cand; break; }
    }
    used.add(name);
    s.name = name;
  }

  const islands = specs.map((s) => new Island(s));
  const byRole = (role: IslandRole): Island[] => islands.filter((i) => i.spec.role === role);
  const villages: Island[] = [];
  for (const v of byRole('village')) villages[v.spec.villageIndex] = v;
  const moon = byRole('moon')[0];
  const sky = byRole('sky')[0];
  const hubI = islands[hub.id];

  // Bridges between close islands of similar height.
  const bridges: BridgeSpec[] = [];
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      const A = islands[i], B = islands[j];
      if (A.spec.role === 'sky' || B.spec.role === 'sky') continue;
      const dx = B.spec.x - A.spec.x, dz = B.spec.z - A.spec.z;
      const p0 = A.rimPoint(dx, dz, 0.97);
      const p1 = B.rimPoint(-dx, -dz, 0.97);
      const gap = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      if (gap < 150 && Math.abs(p1.y - p0.y) < 22) bridges.push({ a: i, b: j, p0, p1 });
    }
  }

  // Wind rivers: chains of islands, flowing at altitude.
  const rivers: RiverSpec[] = [];
  const makeRiver = (stops: Island[], speed: number): void => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < stops.length; k++) {
      const s = stops[k];
      const off = new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize().multiplyScalar(s.spec.radius * 1.4);
      pts.push(new THREE.Vector3(s.spec.x + off.x, s.spec.y + s.maxTop + rng.range(50, 110), s.spec.z + off.z));
      if (k < stops.length - 1) {
        const n = stops[k + 1];
        const mid = new THREE.Vector3((s.spec.x + n.spec.x) / 2, (s.spec.y + n.spec.y) / 2 + rng.range(20, 90), (s.spec.z + n.spec.z) / 2);
        mid.x += rng.range(-120, 120);
        mid.z += rng.range(-120, 120);
        pts.push(mid);
      }
    }
    rivers.push({ points: pts, radius: 20, speed });
  };
  // Ring-ish river around the hub through villages.
  const sortedV = [...villages].sort((a, b) => Math.atan2(a.spec.z, a.spec.x) - Math.atan2(b.spec.z, b.spec.x));
  makeRiver([hubI, sortedV[0], sortedV[1], sortedV[2]], 34);
  makeRiver([sortedV[3], sortedV[4], sortedV[5], sortedV[6]], 36);
  makeRiver([hubI, nearestTo(islands, moon, hubI), moon], 38);
  // A river that leads toward (not into) the storm eye.
  {
    const dir = new THREE.Vector3(eye.x, 0, eye.z).normalize();
    const start = nearestTo(islands, sky, hubI);
    const end = new THREE.Vector3(eye.x - dir.x * 600, eye.y + 170, eye.z - dir.z * 600);
    const mid = new THREE.Vector3((start.spec.x + end.x) / 2, (start.spec.y + start.maxTop + end.y) / 2 + 60, (start.spec.z + end.z) / 2);
    rivers.push({ points: [new THREE.Vector3(hubI.spec.x, hubI.spec.y + 130, hubI.spec.z), new THREE.Vector3(start.spec.x, start.spec.y + start.maxTop + 80, start.spec.z), mid, end], radius: 22, speed: 40 });
  }
  // A crossing river between distant plains.
  {
    const plains = byRole('plain').sort((a, b) => a.spec.x - b.spec.x);
    if (plains.length >= 4) {
      const a = plains[0], b = plains[Math.floor(plains.length / 3)], c = plains[Math.floor((plains.length * 2) / 3)], d = plains[plains.length - 1];
      makeRiver([a, b, c, d], 35);
    }
  }

  // Storm zones.
  const storms: StormSpec[] = [{ kind: 'eye', x: eye.x, z: eye.z, inner: 230, outer: 520, dir: 0, yMin: -200, yMax: 1400 }];
  for (let k = 0; k < 2; k++) {
    for (let tries = 0; tries < 200; tries++) {
      const a = rng.range(0, TAU);
      const d = rng.range(900, 2000);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x - eye.x, z - eye.z) < 900) continue;
      if (islands.some((i) => Math.hypot(i.spec.x - x, i.spec.z - z) < i.spec.radius + 200)) continue;
      if (storms.some((s) => Math.hypot(s.x - x, s.z - z) < 700)) continue;
      // Tailwind roughly tangential around the hub — a fast shortcut.
      storms.push({ kind: 'cell', x, z, inner: 0, outer: 210, dir: a + Math.PI / 2, yMin: 150, yMax: 900 });
      break;
    }
  }

  // Cloud puffs.
  const puffs: PuffSpec[] = [];
  const cluster = (cx: number, cy: number, cz: number, size: number, dark: number, count: number): void => {
    for (let k = 0; k < count; k++) {
      const r = size * rng.range(0.45, 1.0);
      const ox = rng.range(-1, 1) * size * 1.6, oz = rng.range(-1, 1) * size * 1.2, oy = rng.range(-0.3, 0.5) * size * 0.7;
      puffs.push({ x: cx + ox, y: cy + oy, z: cz + oz, r, dark });
    }
  };
  for (let k = 0; k < 70; k++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.next()) * 2700;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - eye.x, z - eye.z) < 600) continue;
    const low = rng.chance(0.4);
    const y = low ? rng.range(10, 60) : rng.range(180, 900);
    if (!low && islands.some((i) => Math.hypot(i.spec.x - x, i.spec.z - z) < i.spec.radius + 60 && Math.abs(i.spec.y - y) < 120)) continue;
    cluster(x, y, z, rng.range(30, 70) * (low ? 1.6 : 1), 0, rng.int(5, 10));
  }
  // Eye wall.
  for (let layer = 0; layer < 7; layer++) {
    const y = 120 + layer * 140;
    const n = 30;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + layer * 0.37 + rng.range(-0.05, 0.05);
      const rr = rng.range(300, 470);
      puffs.push({ x: eye.x + Math.cos(a) * rr, y: y + rng.range(-40, 40), z: eye.z + Math.sin(a) * rr, r: rng.range(85, 140), dark: 1 });
    }
  }
  // Storm cells.
  for (const s of storms) {
    if (s.kind !== 'cell') continue;
    for (let k = 0; k < 26; k++) {
      const a = rng.range(0, TAU), rr = Math.sqrt(rng.next()) * s.outer;
      puffs.push({ x: s.x + Math.cos(a) * rr, y: rng.range(s.yMin + 80, s.yMax - 80), z: s.z + Math.sin(a) * rr, r: rng.range(55, 95), dark: 0.85 });
    }
  }
  // Outer storm wall.
  for (let layer = 0; layer < 3; layer++) {
    const n = 90;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + layer * 0.21;
      const rr = EDGE_STORM_R + 260 + rng.range(-120, 160) + layer * 80;
      puffs.push({ x: Math.cos(a) * rr, y: 120 + layer * 260 + rng.range(-60, 60), z: Math.sin(a) * rr, r: rng.range(170, 260), dark: 0.9 });
    }
  }

  // Lighthouses guiding toward the moonflower island.
  const lighthouses: LighthouseSpec[] = [];
  {
    const path = islands
      .filter((i) => i !== moon && i !== sky && i !== hubI && i.spec.role !== 'satellite')
      .map((i) => ({ i, d: distToSegment2(i.spec.x, i.spec.z, hubI.spec.x, hubI.spec.z, moon.spec.x, moon.spec.z), along: alongSegment(i.spec.x, i.spec.z, hubI.spec.x, hubI.spec.z, moon.spec.x, moon.spec.z) }))
      .filter((o) => o.d < 450 && o.along > 0.12 && o.along < 0.92)
      .sort((a, b) => a.along - b.along)
      .slice(0, 3)
      .map((o) => o.i);
    const chain = [hubI, ...path, moon];
    for (let k = 0; k < chain.length - 1; k++) {
      const I = chain[k], N = chain[k + 1];
      const p = I.rimPoint(N.spec.x - I.spec.x, N.spec.z - I.spec.z, 0.86);
      lighthouses.push({ island: I.spec.id, pos: p, target: new THREE.Vector3(N.spec.x, N.spec.y + N.maxTop + 20, N.spec.z) });
    }
  }

  // Wind shards (30).
  const shards: ShardSpec[] = [];
  const srng = rng.fork();
  const pool = islands.filter((i) => i !== sky);
  // On island edges / peaks.
  for (let k = 0; k < 9; k++) {
    const I = pool[(k * 7 + 3) % pool.length];
    const p = I.randomTopPoint(srng, 0.6, 0.92, 0.7) ?? I.rimPoint(1, 0);
    p.y += 1.5;
    shards.push({ pos: p, hint: `${I.spec.name}의 가장자리` });
  }
  // Under islands near rock roots.
  for (let k = 0; k < 6; k++) {
    const I = pool[(k * 5 + 1) % pool.length];
    const y = I.spec.y + I.minBottom * 0.55;
    const a = srng.range(0, TAU);
    shards.push({ pos: new THREE.Vector3(I.spec.x + Math.cos(a) * I.spec.radius * 0.45, y, I.spec.z + Math.sin(a) * I.spec.radius * 0.45), hint: `${I.spec.name} 아래 뿌리 사이` });
  }
  // In wind rivers.
  for (let k = 0; k < 6; k++) {
    const r = rivers[k % rivers.length];
    const curve = new THREE.CatmullRomCurve3(r.points);
    shards.push({ pos: curve.getPointAt(0.2 + 0.6 * srng.next()), hint: '바람 강 속' });
  }
  // Storm cells and the eye wall.
  for (let k = 0; k < 4; k++) {
    const s = storms[k % storms.length];
    const a = srng.range(0, TAU);
    const rr = s.kind === 'eye' ? srng.range(300, 450) : srng.range(40, 150);
    shards.push({ pos: new THREE.Vector3(s.x + Math.cos(a) * rr, srng.range(Math.max(s.yMin, 250), Math.min(s.yMax, 800)), s.z + Math.sin(a) * rr), hint: '폭풍 속' });
  }
  // High altitude.
  for (let k = 0; k < 3; k++) {
    const I = pool[(k * 11 + 2) % pool.length];
    shards.push({ pos: new THREE.Vector3(I.spec.x, I.spec.y + I.maxTop + 260 + k * 40, I.spec.z), hint: `${I.spec.name} 하늘 높이` });
  }
  // Under bridges / between islands.
  for (let k = 0; k < 2; k++) {
    if (bridges[k]) {
      const b = bridges[k];
      shards.push({ pos: b.p0.clone().lerp(b.p1, 0.5).add(new THREE.Vector3(0, -14, 0)), hint: '흔들다리 아래' });
    } else {
      const I = pool[(k * 3 + 4) % pool.length];
      shards.push({ pos: new THREE.Vector3(I.spec.x + I.spec.radius + 40, I.spec.y - 20, I.spec.z), hint: `${I.spec.name} 옆 허공` });
    }
  }
  while (shards.length < 30) {
    const I = pool[shards.length % pool.length];
    const p = I.randomTopPoint(srng, 0.3, 0.8, 0.6) ?? I.rimPoint(0, 1);
    p.y += 1.5;
    shards.push({ pos: p, hint: `${I.spec.name} 어딘가` });
  }

  // Ring races.
  const races: RaceSpec[] = [];
  const raceNames = ['초원 일주', '협곡 질주', '구름 미로'];
  const raceStarts = [villages[0] ?? hubI, villages[5] ?? hubI, villages[3] ?? hubI];
  for (let k = 0; k < 3; k++) {
    const start = raceStarts[k];
    const others = islands
      .filter((i) => i !== start && i !== sky && i.spec.role !== 'satellite')
      .sort((a, b) => dist2(a, start) - dist2(b, start))
      .slice(k, k + 3);
    const rings: THREE.Vector3[] = [];
    let prev = new THREE.Vector3(start.spec.x, start.spec.y + start.maxTop + 70, start.spec.z);
    rings.push(prev.clone());
    const stops = [...others, start];
    for (const o of stops) {
      const target = new THREE.Vector3(o.spec.x, o.spec.y + Math.max(o.maxTop, 0) + (k === 2 ? 15 : 45), o.spec.z);
      const side = new THREE.Vector3(target.z - prev.z, 0, prev.x - target.x).normalize();
      const n = 4;
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        const p = prev.clone().lerp(target, t);
        p.addScaledVector(side, Math.sin(t * Math.PI) * (k === 1 ? 70 : 40) * (s % 2 ? 1 : -1));
        p.y += Math.sin(t * Math.PI) * (k === 2 ? -60 : 20);
        if (s === n) p.addScaledVector(side, o.spec.radius * 1.15);
        rings.push(p);
      }
      prev = rings[rings.length - 1].clone();
    }
    // Make sure no ring is buried inside an island.
    for (const r of rings) {
      for (const I of islands) {
        const top = I.surfaceY(r.x, r.z, 20);
        const bot = I.bottomY(r.x, r.z);
        if (top !== null && r.y < top + 18 && (bot === null || r.y > bot - 18)) r.y = top + 22;
      }
    }
    races.push({ name: raceNames[k], rings });
  }

  // NPC courier routes.
  const npcRoutes: THREE.Vector3[][] = [];
  for (let k = 0; k < 4; k++) {
    const a = villages[k % villages.length] ?? hubI;
    const b = villages[(k + 3) % villages.length] ?? hubI;
    const pts = [hubI, a, b].map((I, idx) => new THREE.Vector3(I.spec.x + (idx === 0 ? 0 : 30), I.spec.y + I.maxTop + 60 + k * 15, I.spec.z));
    npcRoutes.push(pts);
  }

  return { seed, islands, bridges, rivers, storms, puffs, shards, races, lighthouses, npcRoutes, eye, hub: hubI, villages, moon, sky };
}

function dist2(a: Island, b: Island): number {
  return (a.spec.x - b.spec.x) ** 2 + (a.spec.z - b.spec.z) ** 2;
}

function nearestTo(islands: Island[], target: Island, from: Island): Island {
  let best = from;
  let bd = Infinity;
  const fx = from.spec.x, fz = from.spec.z;
  const tx = target.spec.x, tz = target.spec.z;
  for (const i of islands) {
    if (i === target || i === from || i.spec.role === 'sky') continue;
    const along = alongSegment(i.spec.x, i.spec.z, fx, fz, tx, tz);
    if (along < 0.2 || along > 0.8) continue;
    const d = distToSegment2(i.spec.x, i.spec.z, fx, fz, tx, tz);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function alongSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  return ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz);
}

function distToSegment2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const t = Math.min(1, Math.max(0, alongSegment(px, pz, ax, az, bx, bz)));
  return Math.hypot(px - (ax + (bx - ax) * t), pz - (az + (bz - az) * t));
}
