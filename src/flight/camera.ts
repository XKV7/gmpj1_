import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import type { Player, WorldQuery } from './player';
import { bankAngle } from './physics';

export type CamMode = 'third' | 'first';

/** Spring-follow camera for flight and walking, plus free/photo and scripted modes. */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode: CamMode = 'third';
  yaw = 0;
  pitch = 0.25;
  distance = 8;
  lookYaw = 0; // flight free-look offset
  lookPitch = 0;
  baseFov = 62;
  /** Keep the chase camera level (pointer-aim mode): the screen horizon stays put. */
  levelFollow = false;
  speedFov = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private roll = 0;
  private initialized = false;
  private shake = 0;
  // free camera
  freePos = new THREE.Vector3();
  freeYaw = 0;
  freePitch = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.5, 30000);
  }

  addShake(a: number): void {
    this.shake = Math.max(this.shake, a);
  }

  reset(): void {
    this.initialized = false;
  }

  update(dt: number, p: Player, q: WorldQuery): void {
    const cam = this.camera;
    const target = new THREE.Vector3();
    const desired = new THREE.Vector3();
    let fovTarget = this.baseFov;
    let rollTarget = 0;
    if (p.mode === 'fly' || p.mode === 'stunned') {
      const s = p.flight;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
      const vdir = s.vel.lengthSq() > 1 ? s.vel.clone().normalize() : fwd.clone();
      const dir = fwd.clone().lerp(vdir, 0.55).normalize();
      const speed = s.vel.length();
      const k = clamp((speed - 20) / 60, 0, 1);
      fovTarget = this.baseFov + k * 20;
      this.speedFov = k;
      if (this.mode === 'first') {
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat);
        cam.position.copy(s.pos).addScaledVector(up, 0.9).addScaledVector(fwd, -0.4);
        const q2 = s.quat.clone();
        cam.quaternion.slerp(q2, this.initialized ? damp(14, dt) : 1);
        cam.fov = lerp(cam.fov, fovTarget + 6, damp(3, dt));
        cam.updateProjectionMatrix();
        this.pos.copy(cam.position);
        this.initialized = true;
        this.applyShake(dt);
        return;
      }
      const dist = 10.5 + k * 6;
      const flat = new THREE.Vector3(dir.x, 0, dir.z);
      if (flat.lengthSq() < 0.01) flat.set(fwd.x, 0, fwd.z);
      flat.normalize();
      // Free-look rotates the offset around the glider.
      const offDir = flat.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw);
      const elev = (this.levelFollow ? 0 : clamp(dir.y * 0.6, -0.5, 0.6)) - this.lookPitch;
      desired.copy(s.pos).addScaledVector(offDir, -dist * Math.cos(elev)).add(new THREE.Vector3(0, 3.6 + dist * Math.sin(-elev) * 0.6, 0));
      if (this.levelFollow) target.copy(s.pos).addScaledVector(flat, 14).add(new THREE.Vector3(0, 2.2, 0));
      else target.copy(s.pos).addScaledVector(dir, 10).add(new THREE.Vector3(0, 1.2, 0));
      rollTarget = bankAngle(s.quat) * (this.levelFollow ? 0.15 : 0.35);
      const stiff = p.mode === 'stunned' ? 1.5 : 7;
      if (!this.initialized) { this.pos.copy(desired); this.look.copy(target); }
      this.pos.lerp(desired, damp(stiff, dt));
      this.look.lerp(target, damp(10, dt));
      this.yaw = Math.atan2(-flat.x, -flat.z);
    } else {
      const pos = p.walkPos;
      target.copy(pos).add(new THREE.Vector3(0, 1.6, 0));
      if (this.mode === 'first') {
        cam.position.copy(pos).add(new THREE.Vector3(0, 1.7, 0));
        cam.rotation.set(-this.pitch * 0.8, this.yaw + Math.PI, 0, 'YXZ');
        cam.rotation.y = this.yaw;
        const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
        cam.up.set(0, 1, 0);
        cam.lookAt(cam.position.clone().add(look));
        cam.fov = lerp(cam.fov, this.baseFov + 4, damp(3, dt));
        cam.updateProjectionMatrix();
        this.pos.copy(cam.position);
        this.initialized = true;
        return;
      }
      const d = this.distance;
      desired.set(
        pos.x + Math.sin(this.yaw) * Math.cos(this.pitch) * d,
        pos.y + 1.6 + Math.sin(this.pitch) * d,
        pos.z + Math.cos(this.yaw) * Math.cos(this.pitch) * d,
      );
      const g = q.groundBelow(desired.x, desired.y + 3, desired.z);
      if (g && desired.y < g.y + 1.2) desired.y = g.y + 1.2;
      if (!this.initialized) { this.pos.copy(desired); this.look.copy(target); }
      this.pos.lerp(desired, damp(12, dt));
      this.look.lerp(target, damp(16, dt));
      fovTarget = this.baseFov;
      this.speedFov = 0;
    }
    this.initialized = true;
    this.roll = lerp(this.roll, rollTarget, damp(4, dt));
    cam.position.copy(this.pos);
    const up = new THREE.Vector3(Math.sin(this.roll) * 1, Math.cos(this.roll), 0);
    // Rotate roll around viewing axis.
    const viewDir = this.look.clone().sub(this.pos).normalize();
    const right = new THREE.Vector3().crossVectors(viewDir, new THREE.Vector3(0, 1, 0)).normalize();
    cam.up.set(0, 1, 0).multiplyScalar(up.y).addScaledVector(right, -up.x).normalize();
    cam.lookAt(this.look);
    cam.fov = lerp(cam.fov, fovTarget, damp(2.5, dt));
    cam.updateProjectionMatrix();
    this.applyShake(dt);
  }

  private applyShake(dt: number): void {
    if (this.shake > 0.001) {
      const s = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.rotateZ((Math.random() - 0.5) * s * 0.02);
      this.shake *= Math.exp(-dt * 5);
    }
  }

  /** Orbit around a point (title screen / ending). */
  orbit(center: THREE.Vector3, radius: number, height: number, angle: number, lookOffset = new THREE.Vector3()): void {
    const cam = this.camera;
    cam.position.set(center.x + Math.cos(angle) * radius, center.y + height, center.z + Math.sin(angle) * radius);
    cam.up.set(0, 1, 0);
    cam.lookAt(center.clone().add(lookOffset));
    cam.fov = this.baseFov;
    cam.updateProjectionMatrix();
    this.initialized = false;
  }

  updateFree(dt: number, move: THREE.Vector3, dYaw: number, dPitch: number, fast: boolean): void {
    this.freeYaw -= dYaw;
    this.freePitch = clamp(this.freePitch - dPitch, -1.5, 1.5);
    const cam = this.camera;
    cam.rotation.set(this.freePitch, this.freeYaw, 0, 'YXZ');
    const v = move.clone().applyEuler(cam.rotation).multiplyScalar((fast ? 60 : 15) * dt);
    this.freePos.add(v);
    cam.position.copy(this.freePos);
    cam.up.set(0, 1, 0);
    cam.updateProjectionMatrix();
    this.initialized = false;
  }

  enterFree(): void {
    const cam = this.camera;
    this.freePos.copy(cam.position);
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.freeYaw = e.y;
    this.freePitch = e.x;
  }
}
