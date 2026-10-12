import * as THREE from 'three';
import { FlightInput, FlightState, GliderParams, makeFlightState, stepFlight } from './physics';
import { GliderModel, Person, animatePerson, makeGlider, makePerson } from '../world/characters';
import type { Island } from '../world/island';
import { clamp, damp } from '../core/math';

export interface Ground {
  y: number;
  normal: THREE.Vector3;
  island: Island | null;
  bridge: boolean;
}

export interface Contact {
  kind: 'top' | 'side' | 'obstacle';
  surfaceY: number;
  push: THREE.Vector3; // direction to push out
}

export interface WorldQuery {
  groundBelow(x: number, y: number, z: number): Ground | null;
  contact(p: THREE.Vector3, vel: THREE.Vector3): Contact | null;
  pushOutObstacles(p: THREE.Vector3, radius: number): void;
  safeSpot(p: THREE.Vector3): THREE.Vector3;
}

export type PlayerMode = 'walk' | 'fly' | 'stunned';

export type PlayerEvent =
  | { type: 'land'; sink: number; speed: number }
  | { type: 'crash'; speed: number }
  | { type: 'takeoff'; jump: boolean }
  | { type: 'bump' };

export interface WalkInput {
  moveX: number; // strafe
  moveZ: number; // forward
  run: boolean;
  jump: boolean;
  takeoff: boolean;
  camYaw: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  mode: PlayerMode = 'walk';
  flight: FlightState = makeFlightState(new THREE.Vector3(), new THREE.Vector3(0, 0, -20));
  glider: GliderModel;
  walker: Person;
  root = new THREE.Group();
  walkPos = new THREE.Vector3();
  walkVel = new THREE.Vector3();
  facing = 0; // yaw of walker (radians, 0 = +Z)
  onGround = true;
  ground: Ground | null = null;
  stunTime = 0;
  airTime = 0;
  fold = 0;
  spread = 0;
  private walkAnim = 0;
  private animT = 0;
  private respawn = new THREE.Vector3();
  private crashCooldown = 0;
  lastLandingSink = 0;

  constructor() {
    this.glider = makeGlider({ primary: 0xf4f1ea, secondary: 0xd9665c, pattern: 0 }, { robe: 0x4f8fc9, hat: 'cap', hatColor: 0xd9665c, scarf: 0xffd35a });
    this.walker = makePerson({ robe: 0x4f8fc9, hat: 'cap', hatColor: 0xd9665c, scarf: 0xffd35a, backpack: true });
    this.root.add(this.glider.root, this.walker.root);
    this.glider.root.visible = false;
  }

  get position(): THREE.Vector3 {
    return this.mode === 'fly' ? this.flight.pos : this.walkPos;
  }

  get velocity(): THREE.Vector3 {
    return this.mode === 'fly' ? this.flight.vel : this.walkVel;
  }

  placeOnGround(p: THREE.Vector3, facing = 0): void {
    this.mode = 'walk';
    this.walkPos.copy(p);
    this.walkVel.set(0, 0, 0);
    this.facing = facing;
    this.onGround = true;
    this.glider.root.visible = false;
    this.walker.root.visible = true;
  }

  startFlying(pos: THREE.Vector3, vel: THREE.Vector3): void {
    this.mode = 'fly';
    this.flight = makeFlightState(pos, vel);
    this.airTime = 0;
    this.glider.root.visible = true;
    this.walker.root.visible = false;
  }

  updateWalk(dt: number, inp: WalkInput, q: WorldQuery, events: PlayerEvent[]): void {
    const speed = inp.run ? 8.5 : 4.6;
    const sin = Math.sin(inp.camYaw), cos = Math.cos(inp.camYaw);
    // camYaw: camera looks toward (-sin, -cos) in xz (camera behind player).
    const fx = -sin, fz = -cos;
    const rx = cos, rz = -sin;
    let mx = fx * inp.moveZ + rx * inp.moveX;
    let mz = fz * inp.moveZ + rz * inp.moveX;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const target = new THREE.Vector3(mx * speed, 0, mz * speed);
    const k = damp(this.onGround ? 12 : 2, dt);
    this.walkVel.x += (target.x - this.walkVel.x) * k;
    this.walkVel.z += (target.z - this.walkVel.z) * k;
    if (ml > 0.1) {
      const want = Math.atan2(mx, mz);
      let d = want - this.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.facing += d * damp(12, dt);
    }
    if (this.onGround && inp.jump) {
      this.walkVel.y = 6.5;
      this.onGround = false;
      events.push({ type: 'takeoff', jump: true });
    }
    if (inp.takeoff) {
      const dir = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
      const v = dir.multiplyScalar(24).add(new THREE.Vector3(0, 15, 0));
      this.startFlying(this.walkPos.clone().add(new THREE.Vector3(0, 2.5, 0)), v);
      this.flight.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(Math.sin(this.facing), 0.05, Math.cos(this.facing)), UP));
      events.push({ type: 'takeoff', jump: false });
      return;
    }
    this.walkVel.y -= 22 * dt;
    const next = this.walkPos.clone().addScaledVector(this.walkVel, dt);
    // Slope limit.
    const gNext = q.groundBelow(next.x, next.y + 1.2, next.z);
    if (gNext && this.onGround && gNext.normal.y < 0.62 && gNext.y > this.walkPos.y + 0.3) {
      next.x = this.walkPos.x;
      next.z = this.walkPos.z;
      this.walkVel.x *= 0.2;
      this.walkVel.z *= 0.2;
    }
    q.pushOutObstacles(next, 0.5);
    const g = q.groundBelow(next.x, next.y + 1.2, next.z);
    this.ground = g;
    if (g && next.y <= g.y + (this.onGround ? 0.6 : 0.05) && this.walkVel.y <= 0.5) {
      next.y = g.y;
      this.walkVel.y = 0;
      this.onGround = true;
      this.respawn.copy(next);
    } else {
      this.onGround = false;
    }
    this.walkPos.copy(next);
    if (!this.onGround) {
      this.airTime += dt;
      const below = g ? next.y - g.y : Infinity;
      if ((this.walkVel.y < -5 && below > 3) || below > 7 && this.airTime > 0.25) {
        // Auto-deploy the glider when falling off a ledge.
        const dir = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
        const v = dir.multiplyScalar(Math.max(16, Math.hypot(this.walkVel.x, this.walkVel.z) * 2 + 12));
        v.y = Math.min(this.walkVel.y, -2);
        this.startFlying(this.walkPos.clone().add(new THREE.Vector3(0, 1, 0)), v);
        events.push({ type: 'takeoff', jump: false });
        return;
      }
    } else this.airTime = 0;
    if (this.walkPos.y < -50) {
      this.placeOnGround(this.respawn.clone(), this.facing);
    }
    this.walkAnim += (Math.min(1, Math.hypot(this.walkVel.x, this.walkVel.z) / 6) - this.walkAnim) * damp(10, dt);
  }

  updateFly(dt: number, input: FlightInput, wind: THREE.Vector3, params: GliderParams, shake: number, q: WorldQuery, events: PlayerEvent[]): void {
    this.airTime += dt;
    this.crashCooldown -= dt;
    const s = this.flight;
    const prev = s.pos.clone();
    // Landing assist near the ground: cushion the descent and level out.
    const g = q.groundBelow(s.pos.x, s.pos.y, s.pos.z);
    const speed = s.vel.length();
    if (g && this.airTime > 0.8) {
      const h = s.pos.y - g.y;
      if (h < 10 && speed < 22 && s.vel.y < 0) {
        const kk = (1 - h / 10) * damp(3, dt);
        s.vel.y += (-1.8 - s.vel.y) * kk;
        s.vel.x *= 1 - 0.25 * dt * (1 - h / 10);
        s.vel.z *= 1 - 0.25 * dt * (1 - h / 10);
        // Level the wings.
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
        const flat = new THREE.Vector3(fwd.x, 0.05, fwd.z).normalize();
        const targetQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), flat, UP));
        s.quat.slerp(targetQ, kk * 0.8);
      }
    }
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < sub; i++) stepFlight(s, input, wind, params, dt / sub, shake);
    this.fold += (input.dive - this.fold) * damp(8, dt);
    this.spread += (input.brake - this.spread) * damp(8, dt);

    const c = q.contact(s.pos, s.vel);
    if (c) {
      const sp = s.vel.length();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat);
      if (c.kind === 'top' && prev.y >= c.surfaceY - 1.5) {
        const sink = Math.max(0, -s.vel.y);
        const horiz = Math.hypot(s.vel.x, s.vel.z);
        if (horiz < 32 && sink < 9 && up.y > 0.3) {
          const fwd = new THREE.Vector3(s.vel.x, 0, s.vel.z);
          this.placeOnGround(new THREE.Vector3(s.pos.x, c.surfaceY, s.pos.z), fwd.lengthSq() > 0.01 ? Math.atan2(fwd.x, fwd.z) : this.facing);
          this.walkVel.set(s.vel.x * 0.35, 0, s.vel.z * 0.35);
          this.lastLandingSink = sink;
          events.push({ type: 'land', sink, speed: horiz });
          return;
        }
        this.crash(q, events, sp);
        return;
      }
      if (sp > 15 && this.crashCooldown <= 0 && this.airTime > 1.2) {
        this.crash(q, events, sp);
        return;
      }
      // Gentle bump: push out and deflect.
      s.pos.copy(prev).addScaledVector(c.push, 0.6);
      const vn = s.vel.dot(c.push);
      if (vn < 0) s.vel.addScaledVector(c.push, -vn * 1.4);
      s.vel.multiplyScalar(0.8);
      events.push({ type: 'bump' });
    }
  }

  knockOut(spot: THREE.Vector3, time: number): void {
    this.mode = 'stunned';
    this.stunTime = time;
    this.respawn.copy(spot);
    this.flight.vel.set(0, 0, 0);
  }

  private crash(q: WorldQuery, events: PlayerEvent[], speed: number): void {
    events.push({ type: 'crash', speed });
    this.mode = 'stunned';
    this.stunTime = 2.6;
    this.respawn.copy(q.safeSpot(this.flight.pos));
    this.flight.vel.set(0, 0, 0);
  }

  updateStun(dt: number): boolean {
    this.stunTime -= dt;
    if (this.stunTime <= 0) {
      this.placeOnGround(this.respawn.clone(), this.facing);
      this.crashCooldown = 2;
      return true;
    }
    return false;
  }

  syncVisuals(dt: number): void {
    this.animT += dt;
    if (this.mode === 'fly' || this.mode === 'stunned') {
      this.glider.root.visible = this.mode === 'fly';
      this.walker.root.visible = false;
      this.glider.root.position.copy(this.flight.pos);
      this.glider.root.quaternion.copy(this.flight.quat);
      this.glider.setFold(this.fold, this.spread);
      // Rider shifts weight with roll.
      this.glider.rider.root.position.x = clamp(-this.flight.sideslip * 2, -0.3, 0.3);
    } else {
      this.glider.root.visible = false;
      this.walker.root.visible = true;
      this.walker.root.position.copy(this.walkPos);
      this.walker.root.rotation.y = this.facing;
      animatePerson(this.walker, this.animT, this.onGround ? this.walkAnim : 0.2);
      if (!this.onGround) {
        this.walker.armL.rotation.z = 0.8;
        this.walker.armR.rotation.z = -0.8;
      }
    }
  }
}
