import * as THREE from 'three';
import { RNG } from '../core/rng';
import { TAU } from '../core/math';
import { Island } from './island';
import { PALETTES } from './biomes';
import { makeToon, makeUnlit } from '../render/toon';
import { G } from '../render/uniforms';
import * as Geo from './geometry';
import type { LighthouseSpec, WorldData } from './worldgen';

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  bottom: number;
  top: number;
}

export interface IslandDecor {
  island: Island;
  near: THREE.Group;
  far: THREE.Group;
  mailbox: THREE.Vector3 | null;
  villagerSpot: THREE.Vector3 | null;
  extraSpots: THREE.Vector3[];
  board: THREE.Vector3 | null;
}

/** Shared materials (one program each). */
export class DecorMaterials {
  island = makeToon({ vertexColors: true, rim: 0.12 });
  grass = makeToon({ vertexColors: true, anim: 'grass', side: THREE.DoubleSide, rim: 0.0, watercolor: 0.6 });
  tree = makeToon({ vertexColors: true, anim: 'tree', rim: 0.18 });
  solid = makeToon({ vertexColors: true, rim: 0.15 });
  flower = makeToon({ vertexColors: true, anim: 'grass', rim: 0.1 });
  flag = makeToon({ vertexColors: true, anim: 'flag', side: THREE.DoubleSide, rim: 0.1 });
  debris = makeToon({ vertexColors: true, anim: 'bob', rim: 0.15 });
  moonflower = makeToon({ vertexColors: true, anim: 'bloom', rim: 0.3 });
  crystal = makeToon({ vertexColors: true, rim: 0.5 });
  windowGlow = makeUnlit(0x3a4a6a);
  lampGlow = makeUnlit(0x6a6a7a);
  beam: THREE.ShaderMaterial;

  constructor() {
    this.moonflower.emissive = new THREE.Color(0x000000);
    this.crystal.emissive = new THREE.Color(0x000000);
    this.beam = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uNight: G.uNight, uTime: G.uTime },
      vertexShader: /* glsl */ `
        varying float vY;
        varying vec3 vN;
        varying vec3 vW;
        void main() {
          vY = uv.y;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vY;
        varying vec3 vN;
        varying vec3 vW;
        void main() {
          vec3 v = normalize(cameraPosition - vW);
          float edge = pow(abs(dot(normalize(vN), v)), 1.5);
          float a = (pow(1.0 - vY, 1.6) * 0.85 + 0.05) * edge * uNight * 0.38;
          gl_FragColor = vec4(vec3(1.0, 0.92, 0.7) * a, 1.0);
        }`,
    });
  }

  update(night: number): void {
    const day = new THREE.Color(0x9fb4d0);
    const lit = new THREE.Color(0xffc870).multiplyScalar(2.6);
    this.windowGlow.color.copy(day).lerp(lit, Math.min(1, night * 1.4));
    this.lampGlow.color.copy(new THREE.Color(0x7a7486)).lerp(lit, Math.min(1, night * 1.4));
    this.moonflower.emissive.setRGB(0.25 * night, 0.45 * night, 0.75 * night);
    this.crystal.emissive.setRGB(0.15 + 0.3 * night, 0.25 + 0.4 * night, 0.45 + 0.6 * night);
  }
}

class Lib {
  grass = Geo.grassTuftGeo();
  flower = Geo.flowerGeo();
  treeRound = Geo.treeRoundGeo(1, 0x7fbf5f);
  treeRound2 = Geo.treeRoundGeo(7, 0x99c95f);
  cherry = Geo.treeRoundGeo(3, 0xffb7cf, 0x7a5560);
  cherry2 = Geo.treeRoundGeo(9, 0xffcfe0, 0x7a5560);
  pine = Geo.treePineGeo(false);
  pineSnow = Geo.treePineGeo(true);
  shrub = Geo.shrubGeo(4, 0xc0b06a);
  rock = Geo.rockGeo(5);
  houses = Geo.ROOF_COLORS.map((c) => Geo.houseGeo(c));
  postOffice = Geo.houseGeo(0xd9554f, true);
  windows = Geo.houseWindowsGeo(false);
  windowsBig = Geo.houseWindowsGeo(true);
  column = Geo.columnGeo(false);
  columnBroken = Geo.columnGeo(true);
  arch = Geo.archGeo();
  mailbox = Geo.mailboxGeo();
  lamp = Geo.lampPostGeo();
  lampGlow = Geo.lampGlowGeo();
  flagPole = Geo.flagPoleGeo();
  flagCloth = Geo.flagClothGeo();
  crystal = Geo.crystalGeo();
  moonflower = Geo.moonflowerGeo();
  board = Geo.questBoardGeo();
  millTower = Geo.windmillTowerGeo();
  millBlades = Geo.windmillBladesGeo();
  lighthouse = Geo.lighthouseGeo(1);
  lighthouseLamp = Geo.lighthouseLampGeo(1);
  debris = [Geo.debrisGeo(11), Geo.debrisGeo(23), Geo.debrisGeo(37)];
}

interface Inst {
  m: THREE.Matrix4;
  c?: THREE.Color;
}

const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function mtx(p: THREE.Vector3, rotY: number, s: number, tilt?: THREE.Vector3): THREE.Matrix4 {
  tmpQ.setFromAxisAngle(UP, rotY);
  if (tilt) {
    const q2 = new THREE.Quaternion().setFromUnitVectors(UP, tilt);
    tmpQ.premultiply(q2);
  }
  tmpS.set(s, s, s);
  return new THREE.Matrix4().compose(p, tmpQ, tmpS);
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Inst[], cast: boolean, receive = true): THREE.InstancedMesh | null {
  if (!items.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    im.setMatrixAt(i, it.m);
    if (it.c) im.setColorAt(i, it.c);
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = receive;
  im.computeBoundingSphere();
  return im;
}

export class WorldDecor {
  mats = new DecorMaterials();
  lib = new Lib();
  decors: IslandDecor[] = [];
  obstacles: Obstacle[] = [];
  windmills: THREE.Object3D[] = [];
  lighthouseLamps: { lamp: THREE.Object3D; beam: THREE.Object3D; base: THREE.Vector3; target: THREE.Vector3 }[] = [];
  root = new THREE.Group();
  debris: THREE.InstancedMesh[] = [];
  /** Sweeping beams of the sky lighthouse, lit by the ending. */
  skyBeams: THREE.Group | null = null;
  skyBeamOn = { value: 0 };

  constructor(private world: WorldData, private grassDensity: number) {
    this.root.add(new THREE.Group());
  }

  decorate(I: Island): IslandDecor {
    const rng = new RNG(I.spec.seed ^ 0xabcdef);
    const pal = PALETTES[I.spec.biome];
    const near = new THREE.Group();
    const far = new THREE.Group();
    const L = this.lib;
    const M = this.mats;
    const R = I.spec.radius;
    const area = Math.PI * R * R;
    const role = I.spec.role;
    const biome = I.spec.biome;
    const occupied: { x: number; z: number; r: number }[] = [];
    const free = (x: number, z: number, r: number): boolean => occupied.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r);
    const at = (t: number, a: number): THREE.Vector3 => {
      const r = t * I.boundary(a);
      const x = I.spec.x + Math.cos(a) * r, z = I.spec.z + Math.sin(a) * r;
      return new THREE.Vector3(x, I.surfaceY(x, z) ?? I.spec.y, z);
    };
    const facing = (p: THREE.Vector3, target: THREE.Vector3): number => Math.atan2(target.x - p.x, target.z - p.z);
    const centerW = new THREE.Vector3(I.spec.x, I.surfaceY(I.spec.x, I.spec.z) ?? I.spec.y, I.spec.z);

    const houses: Inst[][] = Geo.ROOF_COLORS.map(() => []);
    const windows: Inst[] = [];
    const bigHouse: Inst[] = [];
    const bigWindows: Inst[] = [];
    const columns: Inst[] = [];
    const broken: Inst[] = [];
    const arches: Inst[] = [];
    const lamps: Inst[] = [];
    const flags: Inst[] = [];
    const cloths: Inst[] = [];
    const mailboxes: Inst[] = [];
    const boards: Inst[] = [];
    let mailbox: THREE.Vector3 | null = null;
    let villagerSpot: THREE.Vector3 | null = null;
    let board: THREE.Vector3 | null = null;
    const extraSpots: THREE.Vector3[] = [];

    const addObstacle = (p: THREE.Vector3, r: number, h: number): void => {
      this.obstacles.push({ x: p.x, z: p.z, r, bottom: p.y - 1, top: p.y + h });
      occupied.push({ x: p.x, z: p.z, r: r + 1.5 });
    };

    // Village layout.
    if (role === 'village' || role === 'hub') {
      const plaza = centerW.clone();
      occupied.push({ x: plaza.x, z: plaza.z, r: role === 'hub' ? 16 : 9 });
      if (role === 'hub') {
        const po = at(0.02, 0);
        po.x += 0; po.z -= 6;
        po.y = I.surfaceY(po.x, po.z) ?? po.y;
        bigHouse.push({ m: mtx(po, 0, 1) });
        bigWindows.push({ m: mtx(po, 0, 1) });
        this.obstacles.push({ x: po.x, z: po.z, r: 7.5, bottom: po.y - 1, top: po.y + 12 });
        const b = new THREE.Vector3(po.x + 9, 0, po.z + 8);
        b.y = I.surfaceY(b.x, b.z) ?? po.y;
        boards.push({ m: mtx(b, -0.4, 1) });
        board = b;
        villagerSpot = new THREE.Vector3(po.x - 3, 0, po.z + 8);
        villagerSpot.y = I.surfaceY(villagerSpot.x, villagerSpot.z) ?? po.y;
        const s2 = at(0.3, 2.2);
        extraSpots.push(s2);
      } else {
        villagerSpot = plaza.clone().add(new THREE.Vector3(2, 0, 3));
        villagerSpot.y = I.surfaceY(villagerSpot.x, villagerSpot.z) ?? plaza.y;
      }
      const mb = plaza.clone().add(new THREE.Vector3(role === 'hub' ? -8 : -3, 0, role === 'hub' ? 9 : 2));
      mb.y = I.surfaceY(mb.x, mb.z) ?? plaza.y;
      mailboxes.push({ m: mtx(mb, facing(mb, plaza) + Math.PI / 2, 1.2) });
      mailbox = mb;
      const nHouses = role === 'hub' ? 10 : rng.int(5, 8);
      for (let k = 0; k < nHouses; k++) {
        for (let tries = 0; tries < 12; tries++) {
          const a = (k / nHouses) * TAU + rng.range(-0.25, 0.25);
          const t = rng.range(role === 'hub' ? 0.32 : 0.25, role === 'hub' ? 0.55 : 0.5);
          const p = at(t, a);
          if (!free(p.x, p.z, 5)) continue;
          const v = rng.int(0, houses.length - 1);
          const rot = facing(p, plaza);
          houses[v].push({ m: mtx(p, rot, 1) });
          windows.push({ m: mtx(p, rot, 1) });
          addObstacle(p, 4.3, 9);
          // A lamp at the door.
          const lp = p.clone().add(new THREE.Vector3(Math.sin(rot) * 4.5 + Math.cos(rot) * 2.5, 0, Math.cos(rot) * 4.5 - Math.sin(rot) * 2.5));
          lp.y = I.surfaceY(lp.x, lp.z) ?? p.y;
          lamps.push({ m: mtx(lp, 0, 1) });
          break;
        }
      }
      // Flags around plaza.
      const nf = role === 'hub' ? 6 : 3;
      for (let k = 0; k < nf; k++) {
        const a = (k / nf) * TAU + 0.3;
        const p = plaza.clone().add(new THREE.Vector3(Math.cos(a) * (role === 'hub' ? 15 : 7), 0, Math.sin(a) * (role === 'hub' ? 15 : 7)));
        p.y = I.surfaceY(p.x, p.z) ?? plaza.y;
        flags.push({ m: mtx(p, 0, 1) });
        const cm = mtx(p.clone().add(new THREE.Vector3(0, 3.4, 0)), Math.atan2(-G.uWind.value.y, G.uWind.value.x), 1);
        cloths.push({ m: cm, c: new THREE.Color(Geo.ROOF_COLORS[(k + I.spec.id) % Geo.ROOF_COLORS.length]) });
      }
      // Windmills.
      const nm = role === 'hub' ? 2 : rng.int(1, 2);
      for (let k = 0; k < nm; k++) {
        for (let tries = 0; tries < 10; tries++) {
          const p = at(rng.range(0.55, 0.72), rng.range(0, TAU));
          if (!free(p.x, p.z, 4)) continue;
          this.addWindmill(far, p, rng.range(0, TAU));
          addObstacle(p, 3, 12);
          break;
        }
      }
    }

    if (role === 'sky') {
      const lp = centerW.clone();
      const g = new THREE.Mesh(Geo.lighthouseGeo(3.2), M.solid);
      g.position.copy(lp);
      g.castShadow = true;
      g.receiveShadow = true;
      far.add(g);
      const lamp = new THREE.Mesh(Geo.lighthouseLampGeo(3.2), M.lampGlow);
      lamp.position.copy(lp);
      far.add(lamp);
      this.obstacles.push({ x: lp.x, z: lp.z, r: 7.5, bottom: lp.y - 1, top: lp.y + 58 });
      this.skyBeams = this.makeSkyBeams(lp.clone().add(new THREE.Vector3(0, 15.5 * 3.2, 0)));
      far.add(this.skyBeams);
      occupied.push({ x: lp.x, z: lp.z, r: 10 });
      villagerSpot = lp.clone().add(new THREE.Vector3(0, 0, 11));
      villagerSpot.y = I.surfaceY(villagerSpot.x, villagerSpot.z) ?? lp.y;
      const mb = lp.clone().add(new THREE.Vector3(-4, 0, 11));
      mb.y = I.surfaceY(mb.x, mb.z) ?? lp.y;
      mailboxes.push({ m: mtx(mb, 0, 1.2) });
      mailbox = mb;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU;
        const p = at(0.6, a);
        (k % 3 === 0 ? broken : columns).push({ m: mtx(p, a, 1.2) });
      }
    }

    if (role === 'moon') {
      villagerSpot = centerW.clone().add(new THREE.Vector3(3, 0, 0));
      villagerSpot.y = I.surfaceY(villagerSpot.x, villagerSpot.z) ?? centerW.y;
      const mb = centerW.clone().add(new THREE.Vector3(-3, 0, 2));
      mb.y = I.surfaceY(mb.x, mb.z) ?? centerW.y;
      mailboxes.push({ m: mtx(mb, 0, 1.2) });
      mailbox = mb;
      occupied.push({ x: centerW.x, z: centerW.z, r: 6 });
    }

    // Lighthouses on this island.
    for (const lh of this.world.lighthouses) if (lh.island === I.spec.id) this.addLighthouse(far, lh, I);

    // Ruins pieces.
    if (biome === 'ruins' || biome === 'sky') {
      const n = Math.floor(area / 900) + 4;
      for (let k = 0; k < n; k++) {
        const p = I.randomTopPoint(rng, 0.15, 0.85, 0.35);
        if (!p || !free(p.x, p.z, 2)) continue;
        const r = rng.next();
        if (r < 0.3) { columns.push({ m: mtx(p, rng.range(0, TAU), rng.range(0.9, 1.3)) }); addObstacle(p, 0.9, 7); }
        else if (r < 0.75) { broken.push({ m: mtx(p, rng.range(0, TAU), rng.range(0.9, 1.3)) }); addObstacle(p, 0.9, 4); }
        else { arches.push({ m: mtx(p, rng.range(0, TAU), rng.range(0.9, 1.2)) }); occupied.push({ x: p.x, z: p.z, r: 4 }); }
      }
    }

    // Trees and vegetation.
    const trees: Inst[] = [], trees2: Inst[] = [], pines: Inst[] = [], shrubs: Inst[] = [], rocks: Inst[] = [], grass: Inst[] = [], flowers: Inst[] = [], crystals: Inst[] = [], mflowers: Inst[] = [];
    const treeDensity = { meadow: 1 / 700, cherry: 1 / 260, canyon: 1 / 2500, alpine: 1 / 420, ruins: 1 / 1100, moonflower: 1 / 2000, sky: 0 }[biome];
    const nTrees = Math.floor(area * treeDensity * (role === 'village' || role === 'hub' ? 0.6 : 1));
    for (let k = 0; k < nTrees; k++) {
      const p = I.randomTopPoint(rng, role === 'village' || role === 'hub' ? 0.5 : 0.05, 0.9, 0.35);
      if (!p || !free(p.x, p.z, 2.5)) continue;
      const s = rng.range(0.8, 1.35);
      const it = { m: mtx(p.clone().add(new THREE.Vector3(0, -0.2, 0)), rng.range(0, TAU), s), c: new THREE.Color().setHSL(0, 0, rng.range(0.85, 1.05)) };
      occupied.push({ x: p.x, z: p.z, r: 1.2 });
      this.obstacles.push({ x: p.x, z: p.z, r: 0.6 * s, bottom: p.y - 1, top: p.y + 5.5 * s });
      if (biome === 'cherry' || (biome === 'meadow' && I.spec.villageIndex === 2)) (rng.chance(0.5) ? trees : trees2).push(it);
      else if (biome === 'alpine') pines.push(it);
      else if (biome === 'canyon') shrubs.push(it);
      else (rng.chance(0.5) ? trees : trees2).push(it);
    }
    const treeGeoA = biome === 'cherry' ? L.cherry : L.treeRound;
    const treeGeoB = biome === 'cherry' ? L.cherry2 : L.treeRound2;

    const nRocks = Math.floor(area / (biome === 'canyon' ? 260 : biome === 'alpine' ? 500 : 1400));
    for (let k = 0; k < nRocks; k++) {
      const p = I.randomTopPoint(rng, 0.1, 0.95, 0.8);
      if (!p || !free(p.x, p.z, 1.5)) continue;
      const s = rng.range(0.6, biome === 'canyon' ? 3.2 : 2);
      rocks.push({ m: mtx(p, rng.range(0, TAU), s, I.surfaceNormal(p.x, p.z)), c: pal.rock.clone().multiplyScalar(rng.range(0.85, 1.1)) });
    }

    const grassRate = { meadow: 1 / 9, cherry: 1 / 11, canyon: 1 / 45, alpine: 1 / 26, ruins: 1 / 12, moonflower: 1 / 10, sky: 1 / 14 }[biome];
    const nGrass = Math.floor(area * grassRate * this.grassDensity);
    for (let k = 0; k < nGrass; k++) {
      const p = I.randomTopPoint(rng, 0, 0.97, 0.45);
      if (!p) continue;
      if (role === 'hub' || role === 'village') {
        let blocked = false;
        for (const o of occupied) if (Math.hypot(o.x - p.x, o.z - p.z) < o.r * 0.8) { blocked = true; break; }
        if (blocked) continue;
      }
      if (biome === 'alpine' && p.y - I.spec.y > I.maxTop * 0.35) continue;
      const tint = pal.bladeTint.clone().multiplyScalar(rng.range(0.82, 1.12));
      grass.push({ m: mtx(p.clone().add(new THREE.Vector3(0, -0.05, 0)), rng.range(0, TAU), rng.range(0.55, 1.05)), c: tint });
    }
    const nFlowers = Math.floor(nGrass * (biome === 'meadow' || biome === 'cherry' ? 0.12 : 0.04));
    for (let k = 0; k < nFlowers; k++) {
      const p = I.randomTopPoint(rng, 0, 0.95, 0.3);
      if (!p) continue;
      flowers.push({ m: mtx(p, rng.range(0, TAU), rng.range(0.8, 1.4)), c: rng.pick(pal.flowers).clone() });
    }
    if (biome === 'moonflower') {
      for (let k = 0; k < Math.floor(area / 25); k++) {
        const p = I.randomTopPoint(rng, 0, 0.92, 0.4);
        if (!p) continue;
        mflowers.push({ m: mtx(p, rng.range(0, TAU), rng.range(0.9, 1.6)) });
      }
      for (let k = 0; k < 14; k++) {
        const p = I.randomTopPoint(rng, 0.3, 0.9, 0.5);
        if (!p) continue;
        crystals.push({ m: mtx(p, rng.range(0, TAU), rng.range(1, 2.4)), c: new THREE.Color().setHSL(0.6 + rng.range(-0.05, 0.08), 0.6, 0.8) });
      }
    }
    if (biome === 'alpine' || biome === 'ruins') {
      for (let k = 0; k < Math.floor(area / 6000); k++) {
        const p = I.randomTopPoint(rng, 0.2, 0.9, 0.6);
        if (!p) continue;
        crystals.push({ m: mtx(p, rng.range(0, TAU), rng.range(0.6, 1.2)), c: new THREE.Color(0xcfe3ff) });
      }
    }

    const addTo = (g: THREE.Group, m: THREE.InstancedMesh | null): void => {
      if (m) g.add(m);
    };
    houses.forEach((h, i) => addTo(far, instanced(L.houses[i], M.solid, h, true)));
    addTo(far, instanced(L.windows, M.windowGlow, windows, false, false));
    addTo(far, instanced(L.postOffice, M.solid, bigHouse, true));
    addTo(far, instanced(L.windowsBig, M.windowGlow, bigWindows, false, false));
    addTo(far, instanced(treeGeoA, M.tree, trees, true));
    addTo(far, instanced(treeGeoB, M.tree, trees2, true));
    addTo(far, instanced(biome === 'alpine' ? L.pineSnow : L.pine, M.tree, pines, true));
    addTo(far, instanced(L.column, M.solid, columns, true));
    addTo(far, instanced(L.columnBroken, M.solid, broken, true));
    addTo(far, instanced(L.arch, M.solid, arches, true));
    addTo(near, instanced(L.shrub, M.tree, shrubs, true));
    addTo(near, instanced(L.rock, M.solid, rocks, true));
    addTo(near, instanced(L.grass, M.grass, grass, false));
    addTo(near, instanced(L.flower, M.flower, flowers, false));
    addTo(near, instanced(L.lamp, M.solid, lamps, true));
    addTo(near, instanced(L.lampGlow, M.lampGlow, lamps, false, false));
    addTo(near, instanced(L.flagPole, M.solid, flags, true));
    addTo(near, instanced(L.flagCloth, M.flag, cloths, false));
    addTo(near, instanced(L.mailbox, M.solid, mailboxes, true));
    addTo(near, instanced(L.board, M.solid, boards, true));
    addTo(near, instanced(L.moonflower, M.moonflower, mflowers, false));
    addTo(far, instanced(L.crystal, M.crystal, crystals, true));

    const d: IslandDecor = { island: I, near, far, mailbox, villagerSpot, extraSpots, board };
    this.decors.push(d);
    return d;
  }

  private makeSkyBeams(at: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(at);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uOn: this.skyBeamOn, uTime: G.uTime },
      vertexShader: /* glsl */ `
        varying float vY;
        varying vec3 vN;
        varying vec3 vW;
        void main() {
          vY = uv.y;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOn;
        varying float vY;
        varying vec3 vN;
        varying vec3 vW;
        void main() {
          vec3 v = normalize(cameraPosition - vW);
          float edge = pow(abs(dot(normalize(vN), v)), 1.2);
          float a = (pow(1.0 - vY, 1.4) * 0.9 + 0.06) * edge * uOn * 0.26;
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.72) * a, 1.0);
        }`,
    });
    const geo = new THREE.CylinderGeometry(40, 2, 900, 20, 1, true);
    geo.translate(0, 450, 0);
    geo.rotateX(Math.PI / 2);
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = k * Math.PI;
      m.rotation.x = -0.08;
      m.frustumCulled = false;
      g.add(m);
    }
    const halo = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), mat);
    g.add(halo);
    return g;
  }

  addWindmill(parent: THREE.Group, p: THREE.Vector3, rot: number): void {
    const g = new THREE.Group();
    g.position.copy(p);
    g.rotation.y = rot;
    const tower = new THREE.Mesh(this.lib.millTower, this.mats.solid);
    tower.castShadow = true;
    tower.receiveShadow = true;
    const blades = new THREE.Mesh(this.lib.millBlades, this.mats.solid);
    blades.position.set(0, 8.2, 2.5);
    blades.castShadow = true;
    g.add(tower, blades);
    parent.add(g);
    this.windmills.push(blades);
  }

  addLighthouse(parent: THREE.Group, lh: LighthouseSpec, I: Island): void {
    const g = new THREE.Group();
    g.position.copy(lh.pos);
    const tower = new THREE.Mesh(this.lib.lighthouse, this.mats.solid);
    tower.castShadow = true;
    tower.receiveShadow = true;
    const lamp = new THREE.Mesh(this.lib.lighthouseLamp, this.mats.lampGlow);
    g.add(tower, lamp);
    const beamGeo = new THREE.CylinderGeometry(9, 0.6, 140, 16, 1, true);
    beamGeo.translate(0, 70, 0);
    beamGeo.rotateX(Math.PI / 2);
    const beam = new THREE.Mesh(beamGeo, this.mats.beam);
    beam.position.set(0, 15.5, 0);
    beam.frustumCulled = false;
    g.add(beam);
    parent.add(g);
    this.obstacles.push({ x: lh.pos.x, z: lh.pos.z, r: 2.4, bottom: lh.pos.y - 1, top: lh.pos.y + 18 });
    this.lighthouseLamps.push({ lamp, beam, base: lh.pos.clone().add(new THREE.Vector3(0, 15.5, 0)), target: lh.target.clone() });
    void I;
  }

  /** Floating rock debris drifting around islands. */
  buildDebris(): THREE.Group {
    const g = new THREE.Group();
    const rng = new RNG(this.world.seed ^ 0x1234);
    const items: Inst[][] = [[], [], []];
    for (const I of this.world.islands) {
      const n = Math.floor(I.spec.radius / 10) + 3;
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, TAU);
        const d = I.spec.radius * rng.range(1.15, 1.9);
        const p = new THREE.Vector3(I.spec.x + Math.cos(a) * d, I.spec.y + rng.range(-60, 25), I.spec.z + Math.sin(a) * d);
        const s = rng.range(0.6, 4);
        items[k % 3].push({ m: mtx(p, rng.range(0, TAU), s), c: new THREE.Color().setHSL(0, 0, rng.range(0.85, 1.05)) });
      }
    }
    items.forEach((it, i) => {
      const m = instanced(this.lib.debris[i], this.mats.debris, it, true);
      if (m) {
        g.add(m);
        this.debris.push(m);
      }
    });
    return g;
  }

  update(dt: number, time: number, night: number, camPos: THREE.Vector3): void {
    this.mats.update(night);
    for (const b of this.windmills) b.rotation.z -= dt * 0.9;
    if (this.skyBeams) {
      this.skyBeams.visible = this.skyBeamOn.value > 0.01;
      this.skyBeams.rotation.y += dt * 0.35;
    }
    for (const l of this.lighthouseLamps) {
      const dir = l.target.clone().sub(l.base).normalize();
      const sweep = Math.sin(time * 0.6) * 0.18;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sweep);
      l.beam.quaternion.copy(q2.multiply(q));
      l.beam.visible = night > 0.05;
      void camPos;
    }
  }
}
