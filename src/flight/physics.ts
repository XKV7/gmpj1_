import * as THREE from 'three';

/**
 * Glider flight model.
 * Body axes: forward = -Z, up = +Y, right = +X.
 * Forces per unit mass: lift ⟂ airspeed, induced + parasitic + body drag, gravity, side force.
 * Rotation uses rate commands plus aerodynamic weathervane stability so the
 * nose follows the airflow; holding pitch input therefore holds an angle of attack.
 */

export const GRAVITY = 9.81;

export interface FlightInput {
  pitch: number; // -1..1, + = nose up
  roll: number; // -1..1, + = roll right
  yaw: number; // -1..1, + = yaw right
  dive: number; // 0..1 wings folded
  brake: number; // 0..1 wings spread wide
}

export interface GliderParams {
  liftLevel: number; // 0..3
  speedLevel: number; // 0..3
  stallLevel: number; // 0..3
  massFactor: number; // 1 normal, >1 heavy cargo
}

export const defaultParams = (): GliderParams => ({ liftLevel: 0, speedLevel: 0, stallLevel: 0, massFactor: 1 });

export interface FlightState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  aoa: number;
  sideslip: number;
  airspeed: number;
  stall: number; // 0..1
  gforce: number;
  lift: number;
}

export function makeFlightState(pos = new THREE.Vector3(), vel = new THREE.Vector3(0, 0, -25)): FlightState {
  const quat = new THREE.Quaternion();
  if (vel.lengthSq() > 0.01) {
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), vel.clone().normalize(), new THREE.Vector3(0, 1, 0));
    quat.setFromRotationMatrix(m);
  }
  return { pos: pos.clone(), vel: vel.clone(), quat, aoa: 0, sideslip: 0, airspeed: vel.length(), stall: 0, gforce: 1, lift: 0 };
}

const K_LIFT = 0.03;
const CD0 = 0.017;
const K_IND = 0.1;
const K_BODY = 0.0005;

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vaDir = new THREE.Vector3();
const _liftDir = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _e = new THREE.Euler();

export interface StepInfo {
  stallSpeed: number;
}

export function stallSpeedFor(p: GliderParams, brake: number): number {
  const kL = K_LIFT * (1 + 0.08 * p.liftLevel);
  const area = 1 + 0.25 * brake;
  const clmax = 1.2 + 0.35 * brake + 0.1 * p.stallLevel;
  return Math.sqrt((GRAVITY * p.massFactor) / (kL * area * clmax));
}

export function maxLevelSpeedHint(p: GliderParams): number {
  return 90 + p.speedLevel * 12;
}

/** Advance the glider by dt seconds (call with dt <= 1/60 for stability). */
export function stepFlight(s: FlightState, input: FlightInput, wind: THREE.Vector3, p: GliderParams, dt: number, shake = 0, rand: () => number = Math.random): void {
  _fwd.set(0, 0, -1).applyQuaternion(s.quat);
  _up.set(0, 1, 0).applyQuaternion(s.quat);
  _right.set(1, 0, 0).applyQuaternion(s.quat);

  _va.copy(s.vel).sub(wind);
  const speed = _va.length();
  s.airspeed = speed;
  if (speed > 0.01) _vaDir.copy(_va).divideScalar(speed);
  else _vaDir.copy(_fwd);

  const vf = _va.dot(_fwd);
  const vu = _va.dot(_up);
  const vr = _va.dot(_right);
  const aoa = Math.atan2(-vu, Math.max(Math.abs(vf), 0.01) * Math.sign(vf || 1));
  const beta = Math.atan2(vr, Math.max(Math.abs(vf), 0.01));
  s.aoa = aoa;
  s.sideslip = beta;

  const dive = input.dive, brake = input.brake;
  const kL = K_LIFT * (1 + 0.08 * p.liftLevel);
  const area = (1 - 0.55 * dive) * (1 + 0.25 * brake);
  const clmax = 1.2 + 0.35 * brake + 0.1 * p.stallLevel;
  const aStall = 0.26 + 0.05 * brake + 0.03 * p.stallLevel;
  let cl: number;
  if (aoa < aStall) cl = Math.max(-0.35, Math.min(clmax, 0.25 + 4.0 * aoa));
  else cl = clmax * Math.max(0.35, 1 - (aoa - aStall) * 3);
  if (vf < 0) cl = 0;

  const vs = stallSpeedFor(p, brake);
  const stallA = smooth(aStall, aStall + 0.12, aoa);
  const stallV = smooth(vs * 0.95, vs * 0.7, speed) * (dive > 0.5 ? 0.3 : 1);
  s.stall = Math.min(1, Math.max(stallA, stallV));

  const mass = p.massFactor;
  const q = speed * speed;
  // Lift direction: perpendicular to airflow, within the plane spanned by airflow and body up.
  _liftDir.crossVectors(_right, _vaDir);
  if (_liftDir.lengthSq() < 1e-6) _liftDir.copy(_up);
  _liftDir.normalize();
  const L = (kL * area * cl * q) / mass;
  s.lift = L;
  const cd = CD0 + K_IND * cl * cl + 0.09 * brake;
  const kBody = (K_BODY / (1 + 0.18 * p.speedLevel)) * (1 - 0.2 * dive);
  const D = (kL * area * cd * q + kBody * q) / mass;

  _acc.set(0, -GRAVITY, 0);
  _acc.addScaledVector(_liftDir, L);
  _acc.addScaledVector(_vaDir, -D);
  // Side force: fuselage/fins resist sideslip (makes yaw + bank turn the path).
  _acc.addScaledVector(_right, -vr * 0.6 * Math.min(1, speed / 10));

  const aeroAcc = _acc.clone().add(new THREE.Vector3(0, GRAVITY, 0));
  s.gforce = aeroAcc.length() / GRAVITY;

  s.vel.addScaledVector(_acc, dt);
  s.pos.addScaledVector(s.vel, dt);

  // ---- Rotation ----
  const auth = Math.min(1, speed / 14);
  const stab = Math.min(1, speed / 8);
  const aTrim = 0.06 + 0.1 * brake - 0.11 * dive;
  let pitchRate = input.pitch * 1.5 * (0.35 + 0.65 * auth) - 4.2 * (aoa - aTrim) * stab;
  // Stall: nose drops, buffeting.
  pitchRate -= s.stall * 1.4;
  // With very little airflow, gravity tips the nose down.
  if (speed < 6) pitchRate -= (1 - speed / 6) * 1.2 * Math.max(0, _fwd.y + 0.3);
  const bank = Math.asin(Math.max(-1, Math.min(1, -_right.y)));
  let rollRate = input.roll * 2.5 * (0.3 + 0.7 * auth);
  if (Math.abs(input.roll) < 0.1) rollRate += -bank * 1.1 * auth;
  // Keep banks within a comfortable range.
  if (Math.abs(bank) > 1.25 && Math.sign(input.roll) === Math.sign(bank)) rollRate *= 0.2;
  const yawRate = input.yaw * 0.9 * (0.3 + 0.7 * auth) + 3.2 * beta * stab;

  const sh = (s.stall * 0.6 + shake) * 0.9;
  const jx = sh ? (rand() - 0.5) * sh : 0;
  const jy = sh ? (rand() - 0.5) * sh * 0.5 : 0;
  const jz = sh ? (rand() - 0.5) * sh * 1.2 : 0;

  _e.set((pitchRate + jx) * dt, (-yawRate + jy) * dt, (-rollRate + jz) * dt, 'XYZ');
  _dq.setFromEuler(_e);
  s.quat.multiply(_dq).normalize();
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Total specific energy (per unit mass): kinetic + potential. */
export function specificEnergy(s: FlightState): number {
  return 0.5 * s.vel.lengthSq() + GRAVITY * s.pos.y;
}

export function bankAngle(q: THREE.Quaternion): number {
  const r = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  return Math.asin(Math.max(-1, Math.min(1, -r.y)));
}
