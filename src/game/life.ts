import * as THREE from 'three';
import { FOG_PARS, G } from '../render/uniforms';
import { makeToon } from '../render/toon';
import { RNG } from '../core/rng';
import { makeGlider, GliderModel } from '../world/characters';
import type { WorldData } from '../world/worldgen';
import { damp } from '../core/math';

/* ------------------------------------------------------------------ */
/* Collectibles: wind shards + floating feathers                       */
/* ------------------------------------------------------------------ */

export class Collectibles {
  group = new THREE.Group();
  shardMesh: THREE.InstancedMesh;
  featherMesh: THREE.InstancedMesh;
  shardPos: THREE.Vector3[];
  collected: Set<number>;
  feathers: { pos: THREE.Vector3; taken: number }[] = [];
  private dummy = new THREE.Object3D();
  private glowMat: THREE.ShaderMaterial;
  glow: THREE.InstancedMesh;

  constructor(world: WorldData, collected: number[]) {
    this.shardPos = world.shards.map((s) => s.pos.clone());
    this.collected = new Set(collected);
    const sg = new THREE.OctahedronGeometry(1, 0);
    sg.scale(0.7, 1.4, 0.7);
    const sm = makeToon({ color: 0x9fe8ff, rim: 0.8, emissive: 0x3a7a9a });
    this.shardMesh = new THREE.InstancedMesh(sg, sm, this.shardPos.length);
    this.shardMesh.frustumCulled = false;
    this.glowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: G.uTime },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = position.xy;
          vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          c.xy += position.xy * s * 3.0;
          gl_Position = projectionMatrix * c;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          float a = exp(-r * r * 6.0) * (0.55 + 0.25 * sin(uTime * 3.0));
          float rays = pow(abs(cos(atan(vUv.y, vUv.x) * 3.0 + uTime)), 18.0) * exp(-r * 2.5) * 0.5;
          gl_FragColor = vec4(vec3(0.6, 0.9, 1.0) * (a + rays), 1.0);
        }`,
    });
    this.glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), this.glowMat, this.shardPos.length);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 70;
    this.group.add(this.shardMesh, this.glow);

    // Feathers float inside thermals and along wind rivers.
    const rng = new RNG(world.seed ^ 0xfeed);
    for (const I of world.islands) {
      if (I.spec.role === 'sky') continue;
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        this.feathers.push({ pos: new THREE.Vector3(I.spec.x + rng.range(-20, 20), I.spec.y + I.maxTop + rng.range(40, 220), I.spec.z + rng.range(-20, 20)), taken: -1 });
      }
    }
    for (const r of world.rivers) {
      const c = new THREE.CatmullRomCurve3(r.points);
      for (let k = 1; k < 6; k++) this.feathers.push({ pos: c.getPointAt(k / 6), taken: -1 });
    }
    const fg = new THREE.BufferGeometry();
    const fp = [0, 0.9, 0, 0.25, 0.2, 0, 0, -0.9, 0, 0, 0.9, 0, 0, -0.9, 0, -0.22, 0.1, 0];
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.computeVertexNormals();
    const fm = makeToon({ color: 0xfff6dc, side: THREE.DoubleSide, rim: 0.6, emissive: 0x6a5a30 });
    this.featherMesh = new THREE.InstancedMesh(fg, fm, this.feathers.length);
    this.featherMesh.frustumCulled = false;
    this.group.add(this.featherMesh);
  }

  update(time: number): void {
    this.shardPos.forEach((p, i) => {
      const hidden = this.collected.has(i);
      this.dummy.position.copy(p);
      this.dummy.position.y += Math.sin(time * 1.6 + i) * 0.5;
      this.dummy.rotation.set(0, time * 1.4 + i, 0);
      this.dummy.scale.setScalar(hidden ? 0 : 1.3);
      this.dummy.updateMatrix();
      this.shardMesh.setMatrixAt(i, this.dummy.matrix);
      this.glow.setMatrixAt(i, this.dummy.matrix);
    });
    this.shardMesh.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    this.feathers.forEach((f, i) => {
      if (f.taken >= 0 && time - f.taken > 240) f.taken = -1;
      const hidden = f.taken >= 0;
      this.dummy.position.copy(f.pos);
      this.dummy.position.y += Math.sin(time * 1.1 + i * 2) * 0.8;
      this.dummy.rotation.set(Math.sin(time + i) * 0.4, time * 1.2 + i, 0.3);
      this.dummy.scale.setScalar(hidden ? 0 : 1.6);
      this.dummy.updateMatrix();
      this.featherMesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.featherMesh.instanceMatrix.needsUpdate = true;
  }

  /** Returns indexes of shards / feathers picked up at position p. */
  pickup(p: THREE.Vector3, time: number, radius = 5): { shards: number[]; feathers: number } {
    const shards: number[] = [];
    this.shardPos.forEach((s, i) => {
      if (!this.collected.has(i) && s.distanceToSquared(p) < (radius + 1.5) ** 2) {
        this.collected.add(i);
        shards.push(i);
      }
    });
    let feathers = 0;
    for (const f of this.feathers) {
      if (f.taken < 0 && f.pos.distanceToSquared(p) < radius * radius) {
        f.taken = time;
        feathers++;
      }
    }
    return { shards, feathers };
  }
}

/* ------------------------------------------------------------------ */
/* Bird flocks (boids)                                                  */
/* ------------------------------------------------------------------ */

interface Bird {
  p: THREE.Vector3;
  v: THREE.Vector3;
}

interface Flock {
  home: THREE.Vector3;
  radius: number;
  birds: Bird[];
}

export class Birds {
  mesh: THREE.InstancedMesh;
  flocks: Flock[] = [];
  private dummy = new THREE.Object3D();
  private total: number;

  constructor(world: WorldData) {
    const rng = new RNG(world.seed ^ 0xb1d5);
    const homes = [world.hub, ...world.villages.slice(0, 4)].filter(Boolean);
    for (const I of homes) {
      const home = new THREE.Vector3(I.spec.x, I.spec.y + I.maxTop + 35, I.spec.z);
      const birds: Bird[] = [];
      for (let k = 0; k < 18; k++) {
        birds.push({ p: home.clone().add(new THREE.Vector3(rng.range(-30, 30), rng.range(-8, 8), rng.range(-30, 30))), v: new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize().multiplyScalar(9) });
      }
      this.flocks.push({ home, radius: I.spec.radius * 1.1, birds });
    }
    this.total = this.flocks.reduce((a, f) => a + f.birds.length, 0);
    const geo = new THREE.BufferGeometry();
    // Body + two wings (wing verts marked by x distance for flapping).
    const pos = [
      0, 0, -0.5, 0.12, 0, 0.3, -0.12, 0, 0.3,
      0.08, 0, -0.15, 1.0, 0, 0.15, 0.08, 0, 0.25,
      -0.08, 0, -0.15, -0.08, 0, 0.25, -1.0, 0, 0.15,
    ];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const phase = new Float32Array(this.total);
    for (let i = 0; i < this.total; i++) phase[i] = Math.random() * 6.28;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTime: G.uTime, uAmbient: G.uAmbient, uSunColor: G.uSunColor, uFogColor: G.uFogColor, uFogSunColor: G.uFogSunColor, uFogLowColor: G.uFogLowColor, uFogDensity: G.uFogDensity, uSunDir: G.uSunDir },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vW;
        varying float vShade;
        void main() {
          vec3 p = position;
          float span = abs(p.x);
          p.y += sin(uTime * 11.0 + aPhase) * span * 0.55;
          vShade = 0.7 + span * 0.3;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uAmbient;
        uniform vec3 uSunColor;
        varying vec3 vW;
        varying float vShade;
        ${FOG_PARS}
        void main() {
          vec3 col = vec3(0.32, 0.3, 0.36) * (uAmbient * 0.8 + uSunColor * 0.5) * vShade;
          gl_FragColor = vec4(applyFog(col, vW), 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.total);
    this.mesh.frustumCulled = false;
  }

  update(dt: number, player: THREE.Vector3): void {
    const sep = new THREE.Vector3(), ali = new THREE.Vector3(), coh = new THREE.Vector3(), acc = new THREE.Vector3(), d = new THREE.Vector3();
    let idx = 0;
    const step = Math.min(dt, 1 / 30);
    for (const f of this.flocks) {
      const near = f.home.distanceTo(player) < 900;
      for (const b of f.birds) {
        if (near) {
          sep.set(0, 0, 0); ali.set(0, 0, 0); coh.set(0, 0, 0);
          let n = 0;
          for (const o of f.birds) {
            if (o === b) continue;
            d.subVectors(b.p, o.p);
            const dist = d.length();
            if (dist < 16) {
              n++;
              ali.add(o.v);
              coh.add(o.p);
              if (dist < 4) sep.addScaledVector(d, 1 / Math.max(dist * dist, 0.1));
            }
          }
          acc.set(0, 0, 0);
          if (n > 0) {
            ali.divideScalar(n).sub(b.v).multiplyScalar(0.6);
            coh.divideScalar(n).sub(b.p).multiplyScalar(0.25);
            acc.add(ali).add(coh);
          }
          acc.addScaledVector(sep, 18);
          d.subVectors(f.home, b.p);
          const hd = d.length();
          if (hd > f.radius * 0.6) acc.addScaledVector(d, (hd - f.radius * 0.6) * 0.02);
          acc.y += (f.home.y - b.p.y) * 0.08;
          // Scatter away from the player.
          d.subVectors(b.p, player);
          const pd = d.length();
          if (pd < 45) acc.addScaledVector(d.normalize(), (45 - pd) * 1.6).add(new THREE.Vector3(0, (45 - pd) * 0.6, 0));
          b.v.addScaledVector(acc, step);
          const sp = b.v.length();
          const target = pd < 45 ? 20 : 10;
          b.v.multiplyScalar(1 + (target / Math.max(sp, 0.1) - 1) * damp(1.5, step));
        }
        b.p.addScaledVector(b.v, step);
        this.dummy.position.copy(b.p);
        this.dummy.lookAt(b.p.clone().sub(b.v));
        this.dummy.scale.setScalar(1.1);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(idx++, this.dummy.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* Other courier gliders                                               */
/* ------------------------------------------------------------------ */

export class NpcGliders {
  group = new THREE.Group();
  private list: { model: GliderModel; curve: THREE.CatmullRomCurve3; t: number; speed: number; len: number; bank: number }[] = [];

  constructor(world: WorldData) {
    const looks = [
      { primary: 0x9cc7f0, secondary: 0xffffff, pattern: 1 },
      { primary: 0xffc4dc, secondary: 0xffffff, pattern: 3 },
      { primary: 0xa4d77c, secondary: 0xfff1a0, pattern: 2 },
      { primary: 0xffb070, secondary: 0x7a4f8f, pattern: 4 },
    ];
    world.npcRoutes.forEach((pts, i) => {
      const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
      const model = makeGlider(looks[i % looks.length], { robe: [0x7fae6e, 0xd98c5c, 0x6a4f8f, 0x4f6fa8][i % 4], hat: 'cap', hatColor: 0xffd35a });
      this.group.add(model.root);
      this.list.push({ model, curve, t: i / world.npcRoutes.length, speed: 20 + i * 2, len: curve.getLength(), bank: 0 });
    });
  }

  update(dt: number): void {
    for (const n of this.list) {
      n.t = (n.t + (n.speed * dt) / n.len) % 1;
      const p = n.curve.getPointAt(n.t);
      const tan = n.curve.getTangentAt(n.t);
      const tan2 = n.curve.getTangentAt((n.t + 0.01) % 1);
      const turn = tan.x * tan2.z - tan.z * tan2.x;
      n.bank += (Math.max(-0.8, Math.min(0.8, -turn * 60)) - n.bank) * damp(2, dt);
      p.y += Math.sin(n.t * 40) * 1.5;
      n.model.root.position.copy(p);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), tan, new THREE.Vector3(0, 1, 0));
      n.model.root.quaternion.setFromRotationMatrix(m);
      n.model.root.rotateZ(n.bank);
    }
  }
}
