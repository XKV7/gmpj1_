import * as THREE from 'three';
import type { BridgeSpec } from './worldgen';
import { plankGeo } from './geometry';

interface BridgeRuntime {
  spec: BridgeSpec;
  planks: number;
  sag: number;
  offset: number; // first instance index
  dir: THREE.Vector3;
  side: THREE.Vector3;
  length: number;
  phase: number;
}

/** Swaying rope bridges; planks are instanced and re-posed every frame (cheap: a few hundred matrices). */
export class Bridges {
  group = new THREE.Group();
  private list: BridgeRuntime[] = [];
  private planks: THREE.InstancedMesh;
  private ropes: THREE.LineSegments;
  private ropePos: Float32Array;
  private sway = 0;
  private time = 0;
  private dummy = new THREE.Object3D();

  constructor(specs: BridgeSpec[], plankMat: THREE.Material) {
    let total = 0;
    for (const s of specs) {
      const len = s.p0.distanceTo(s.p1);
      const n = Math.max(6, Math.floor(len / 0.95));
      const dir = s.p1.clone().sub(s.p0);
      const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      this.list.push({
        spec: s,
        planks: n,
        sag: Math.min(9, len * 0.08),
        offset: total,
        dir: dir.normalize(),
        side: new THREE.Vector3(-flat.z, 0, flat.x),
        length: len,
        phase: Math.random() * 6,
      });
      total += n;
    }
    this.planks = new THREE.InstancedMesh(plankGeo(), plankMat, Math.max(total, 1));
    this.planks.count = total;
    this.planks.castShadow = true;
    this.planks.receiveShadow = true;
    this.planks.frustumCulled = false;
    this.group.add(this.planks);
    const segs = this.list.reduce((a, b) => a + (b.planks + 1) * 2 + (b.planks + 1), 0);
    this.ropePos = new Float32Array(Math.max(segs, 1) * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.ropePos, 3));
    this.ropes = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x6b5446 }));
    this.ropes.frustumCulled = false;
    this.group.add(this.ropes);
    this.update(0);
  }

  /** Point on bridge deck at param s (0..1). */
  private deck(b: BridgeRuntime, s: number, out: THREE.Vector3): THREE.Vector3 {
    out.copy(b.spec.p0).lerp(b.spec.p1, s);
    const env = Math.sin(Math.PI * s);
    out.y -= b.sag * env;
    out.addScaledVector(b.side, Math.sin(this.time * 1.1 + b.phase) * 0.6 * env * (1 + this.sway));
    out.y += Math.sin(this.time * 1.7 + b.phase + s * 4) * 0.15 * env;
    return out;
  }

  /** Deck height below (x,z) if standing on a bridge, else null. */
  heightAt(x: number, y: number, z: number): number | null {
    const tmp = new THREE.Vector3();
    for (const b of this.list) {
      const p0 = b.spec.p0;
      const dx = b.spec.p1.x - p0.x, dz = b.spec.p1.z - p0.z;
      const l2 = dx * dx + dz * dz;
      const s = ((x - p0.x) * dx + (z - p0.z) * dz) / l2;
      if (s < -0.02 || s > 1.02) continue;
      const sc = Math.min(1, Math.max(0, s));
      this.deck(b, sc, tmp);
      const lat = Math.abs((x - tmp.x) * b.side.x + (z - tmp.z) * b.side.z);
      if (lat > 1.5) continue;
      if (y < tmp.y - 2.5 || y > tmp.y + 3) continue;
      return tmp.y + 0.1;
    }
    return null;
  }

  update(dt: number, playerOnBridge = false): void {
    this.time += dt;
    this.sway += ((playerOnBridge ? 1 : 0) - this.sway) * Math.min(1, dt * 2);
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    let ri = 0;
    const rp = this.ropePos;
    const pushSeg = (a: THREE.Vector3, b2: THREE.Vector3): void => {
      rp[ri++] = a.x; rp[ri++] = a.y; rp[ri++] = a.z;
      rp[ri++] = b2.x; rp[ri++] = b2.y; rp[ri++] = b2.z;
    };
    for (const b of this.list) {
      const yaw = Math.atan2(b.side.x, b.side.z);
      let prevL: THREE.Vector3 | null = null;
      let prevR: THREE.Vector3 | null = null;
      for (let i = 0; i <= b.planks; i++) {
        const s = i / b.planks;
        this.deck(b, s, p);
        if (i < b.planks) {
          this.deck(b, (i + 0.5) / b.planks, q);
          this.dummy.position.copy(q);
          this.dummy.rotation.set(0, yaw, 0);
          this.dummy.rotateZ(Math.sin(this.time * 2 + i) * 0.03);
          this.dummy.updateMatrix();
          this.planks.setMatrixAt(b.offset + i, this.dummy.matrix);
        }
        const env = Math.sin(Math.PI * s);
        const L = p.clone().addScaledVector(b.side, 1.35).add(new THREE.Vector3(0, 1.1 + env * b.sag * 0.15, 0));
        const R = p.clone().addScaledVector(b.side, -1.35).add(new THREE.Vector3(0, 1.1 + env * b.sag * 0.15, 0));
        if (prevL && prevR) {
          pushSeg(prevL, L);
          pushSeg(prevR, R);
        }
        // Vertical hangers.
        pushSeg(L, p.clone().addScaledVector(b.side, 1.3));
        prevL = L;
        prevR = R;
      }
    }
    this.planks.instanceMatrix.needsUpdate = true;
    const attr = this.ropes.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.ropes.geometry.setDrawRange(0, ri / 3);
  }
}
