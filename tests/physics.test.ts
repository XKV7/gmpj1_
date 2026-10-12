import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FlightInput, GliderParams, bankAngle, defaultParams, makeFlightState, specificEnergy, stallSpeedFor, stepFlight } from '../src/flight/physics';

const noInput = (): FlightInput => ({ pitch: 0, roll: 0, yaw: 0, dive: 0, brake: 0 });
const calm = new THREE.Vector3();
const DT = 1 / 120;

function simulate(seconds: number, input: FlightInput, params: GliderParams = defaultParams(), wind = calm, start = new THREE.Vector3(0, 1000, 0), v0 = new THREE.Vector3(0, 0, -30)) {
  const s = makeFlightState(start, v0);
  const n = Math.round(seconds / DT);
  let maxStall = 0;
  for (let i = 0; i < n; i++) {
    stepFlight(s, input, wind, params, DT, 0, () => 0.5);
    maxStall = Math.max(maxStall, s.stall);
  }
  return { s, maxStall };
}

describe('glider flight model', () => {
  it('settles into a shallow glide with a sensible glide ratio', () => {
    const { s } = simulate(40, noInput());
    const horiz = Math.hypot(s.vel.x, s.vel.z);
    const sink = -s.vel.y;
    expect(sink).toBeGreaterThan(0.5);
    const ratio = horiz / sink;
    expect(ratio).toBeGreaterThan(5);
    expect(ratio).toBeLessThan(20);
    expect(s.airspeed).toBeGreaterThan(15);
    expect(s.airspeed).toBeLessThan(45);
  });

  it('folding the wings (dive) trades altitude for speed', () => {
    const glide = simulate(8, noInput()).s;
    const dive = simulate(8, { ...noInput(), dive: 1, pitch: -0.6 }).s;
    expect(dive.airspeed).toBeGreaterThan(glide.airspeed + 10);
    expect(dive.pos.y).toBeLessThan(glide.pos.y);
  });

  it('pulling up converts speed back into altitude (energy exchange)', () => {
    const s = makeFlightState(new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, 0, -60));
    const e0 = specificEnergy(s);
    const y0 = s.pos.y;
    for (let i = 0; i < 240; i++) stepFlight(s, { ...noInput(), pitch: 1 }, calm, defaultParams(), DT, 0, () => 0.5);
    expect(s.pos.y).toBeGreaterThan(y0 + 20);
    expect(s.vel.length()).toBeLessThan(60);
    // Drag loses some energy, but the bulk is conserved over a short zoom climb.
    expect(specificEnergy(s)).toBeGreaterThan(e0 * 0.85);
    expect(specificEnergy(s)).toBeLessThanOrEqual(e0 + 1);
  });

  it('stalls when too slow and the nose drops', () => {
    const s = makeFlightState(new THREE.Vector3(0, 800, 0), new THREE.Vector3(0, 0, -9));
    let maxStall = 0;
    for (let i = 0; i < 120; i++) {
      stepFlight(s, { ...noInput(), pitch: 1 }, calm, defaultParams(), DT, 0, () => 0.5);
      maxStall = Math.max(maxStall, s.stall);
    }
    expect(maxStall).toBeGreaterThan(0.5);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.quat);
    expect(fwd.y).toBeLessThan(0.2);
    // ...and recovers speed afterwards.
    for (let i = 0; i < 600; i++) stepFlight(s, noInput(), calm, defaultParams(), DT, 0, () => 0.5);
    expect(s.airspeed).toBeGreaterThan(stallSpeedFor(defaultParams(), 0));
  });

  it('climbs inside a thermal', () => {
    const up = new THREE.Vector3(0, 8, 0);
    const { s } = simulate(30, noInput(), defaultParams(), up);
    expect(s.pos.y).toBeGreaterThan(1000);
  });

  it('heavy cargo sinks faster', () => {
    const light = simulate(30, noInput()).s;
    const heavy = simulate(30, noInput(), { ...defaultParams(), massFactor: 1.45 }).s;
    expect(heavy.pos.y).toBeLessThan(light.pos.y);
  });

  it('lift upgrades lower the stall speed', () => {
    expect(stallSpeedFor({ ...defaultParams(), liftLevel: 3, stallLevel: 3 }, 0)).toBeLessThan(stallSpeedFor(defaultParams(), 0));
  });

  it('banking turns the flight path and auto-levels when released', () => {
    const s = makeFlightState(new THREE.Vector3(0, 1000, 0), new THREE.Vector3(0, 0, -30));
    for (let i = 0; i < 60; i++) stepFlight(s, { ...noInput(), roll: 1 }, calm, defaultParams(), DT, 0, () => 0.5);
    expect(bankAngle(s.quat)).toBeGreaterThan(0.3);
    for (let i = 0; i < 360; i++) stepFlight(s, { ...noInput(), pitch: 0.2 }, calm, defaultParams(), DT, 0, () => 0.5);
    // Path turned right (+X).
    expect(s.vel.x).toBeGreaterThan(3);
    for (let i = 0; i < 600; i++) stepFlight(s, noInput(), calm, defaultParams(), DT, 0, () => 0.5);
    expect(Math.abs(bankAngle(s.quat))).toBeLessThan(0.15);
  });

  it('a wind river carries the glider along', () => {
    const tail = new THREE.Vector3(0, 0, -35);
    const { s } = simulate(10, noInput(), defaultParams(), tail);
    const still = simulate(10, noInput()).s;
    expect(-s.pos.z).toBeGreaterThan(-still.pos.z + 200);
  });
});
