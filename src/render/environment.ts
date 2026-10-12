import * as THREE from 'three';
import { G } from './uniforms';
import { CloudU } from './clouds';
import { skyRadiance, sunlightColor } from './sky';
import { clamp, smoothstep } from '../core/math';

export const DAY_LENGTH = 720; // seconds per in-game day

/** Day/night cycle: sun & moon, lights, fog/cloud colours, post-grade targets. */
export class Environment {
  timeOfDay = 0.3; // 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset
  sun = new THREE.DirectionalLight(0xffffff, 2.2);
  hemi = new THREE.HemisphereLight(0xbfd4ff, 0x8a7a6a, 1.0);
  night = 0;
  sunUp = 1;
  exposure = 1;
  saturation = 1.05;
  tint = new THREE.Color(1, 1, 1);
  frozen = false;
  private shadowTarget = new THREE.Object3D();

  constructor(shadows: boolean, mapSize: number) {
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    const c = this.sun.shadow.camera;
    c.left = -110; c.right = 110; c.top = 110; c.bottom = -110; c.near = 1; c.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.sun.target = this.shadowTarget;
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.sun, this.hemi, this.shadowTarget);
  }

  setShadows(on: boolean, size: number): void {
    this.sun.castShadow = on;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  isNight(): boolean {
    return G.uSunDir.value.y < -0.04;
  }

  update(dt: number, focus: THREE.Vector3): void {
    if (!this.frozen) this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1;
    const phi = (this.timeOfDay - 0.25) * Math.PI * 2;
    const sd = G.uSunDir.value.set(Math.cos(phi), Math.sin(phi) * 0.92, 0.38).normalize();
    G.uMoonDir.value.set(-Math.cos(phi) * 0.9, -Math.sin(phi) * 0.85, -0.3).normalize();
    const sy = sd.y;
    this.sunUp = smoothstep(-0.05, 0.25, sy);
    this.night = 1 - smoothstep(-0.18, 0.02, sy);
    G.uNight.value = this.night;

    const sdArr: [number, number, number] = [sd.x, sd.y, sd.z];
    const toward = skyRadiance([sd.x, 0.04, sd.z].map((v, i) => (i === 1 ? v : v)) as [number, number, number], sdArr);
    const away = skyRadiance([-sd.x, 0.04, -sd.z], sdArr);
    const zen = skyRadiance([0, 1, 0], sdArr);
    const norm = (v: number[], k = 1): THREE.Color => new THREE.Color(v[0] * k, v[1] * k, v[2] * k);
    G.uFogSunColor.value.copy(norm(toward));
    G.uFogColor.value.copy(norm(away));
    const low = norm(away).lerp(new THREE.Color(1, 1, 1).multiplyScalar(0.25 + 0.75 * this.sunUp), 0.45);
    G.uFogLowColor.value.copy(low);

    const sl = sunlightColor(sy);
    const sunCol = new THREE.Color(sl[0], sl[1], sl[2]);
    const moonCol = new THREE.Color(0.35, 0.42, 0.65);
    const moonAmt = this.night;
    const lightCol = sunCol.clone().multiplyScalar(1.0).add(moonCol.clone().multiplyScalar(moonAmt * 0.55));
    G.uSunColor.value.copy(lightCol);
    const amb = norm(zen).lerp(norm(away), 0.4).multiplyScalar(1.25);
    amb.r = Math.max(amb.r, 0.09);
    amb.g = Math.max(amb.g, 0.1);
    amb.b = Math.max(amb.b, 0.18);
    G.uAmbient.value.copy(amb);
    G.uRimColor.value.copy(sunCol).lerp(new THREE.Color(0.5, 0.6, 0.9), moonAmt).multiplyScalar(0.8);

    // Light direction: sun by day, moon by night.
    const useMoon = sy < -0.02;
    const ldir = useMoon ? G.uMoonDir.value : sd;
    const sunI = useMoon ? 0.55 : 2.4 * smoothstep(-0.02, 0.15, sy) + 0.1;
    this.sun.color.copy(useMoon ? moonCol : sunCol.clone().multiplyScalar(1 / Math.max(0.3, Math.max(sunCol.r, sunCol.g, sunCol.b))));
    this.sun.intensity = sunI;
    this.hemi.color.copy(amb).multiplyScalar(1.2);
    this.hemi.groundColor.copy(amb).multiplyScalar(0.55).lerp(new THREE.Color(0.55, 0.45, 0.4), 0.3 * this.sunUp);
    this.hemi.intensity = 1.4 + this.night * 0.4;

    // Shadow camera follows focus, snapped to texels to avoid shimmering.
    const size = 220 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / size) * size;
    const fz = Math.round(focus.z / size) * size;
    this.shadowTarget.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + ldir.x * 400, focus.y + Math.max(ldir.y, 0.15) * 400, fz + ldir.z * 400);
    this.shadowTarget.updateMatrixWorld();

    // Clouds.
    const cl = sunCol.clone().multiplyScalar(1.05).add(norm(zen).multiplyScalar(0.35));
    cl.r = Math.max(cl.r, 0.2 + 0.1 * (1 - this.night));
    cl.g = Math.max(cl.g, 0.22);
    cl.b = Math.max(cl.b, 0.32);
    CloudU.uCloudLit.value.copy(cl);
    CloudU.uCloudShade.value.copy(amb).multiplyScalar(0.85).lerp(new THREE.Color(0.55, 0.5, 0.75), 0.25 * this.sunUp);

    // Grade.
    this.exposure = 1.0 + this.night * 0.55;
    const golden = smoothstep(0.35, 0.02, Math.abs(sy - 0.08)) * (1 - this.night);
    this.tint.setRGB(1 + golden * 0.06, 1 + golden * 0.01, 1 - golden * 0.05 + this.night * 0.06);
    this.saturation = 1.16 + golden * 0.08 - this.night * 0.1;
    G.uFogDensity.value = 0.0002 + this.night * 0.00005;
    void clamp;
  }
}
