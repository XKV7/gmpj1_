import * as THREE from 'three';
import { FOG_PARS, G } from '../render/uniforms';

/** Flight rings (express routes, races, race start gates). One instanced draw call. */
export class RingSet {
  mesh: THREE.InstancedMesh;
  private colors: THREE.InstancedBufferAttribute;
  private states: Float32Array;
  rings: { pos: THREE.Vector3; normal: THREE.Vector3; radius: number }[] = [];
  next = 0;
  private dummy = new THREE.Object3D();
  private max: number;

  constructor(max = 64) {
    this.max = max;
    const geo = new THREE.TorusGeometry(1, 0.07, 8, 40);
    this.states = new Float32Array(max);
    const inst = geo;
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    const st = new THREE.InstancedBufferAttribute(this.states, 1);
    inst.setAttribute('aColor', this.colors);
    inst.setAttribute('aState', st);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: G.uTime, uFogColor: G.uFogColor, uFogSunColor: G.uFogSunColor, uFogLowColor: G.uFogLowColor, uFogDensity: G.uFogDensity, uSunDir: G.uSunDir },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aState;
        uniform float uTime;
        varying vec3 vColor;
        varying float vState;
        varying vec3 vW;
        void main() {
          vColor = aColor;
          vState = aState;
          float pulse = aState > 1.5 ? 1.0 + sin(uTime * 5.0) * 0.06 : 1.0;
          vec4 w = modelMatrix * instanceMatrix * vec4(position * pulse, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vState;
        varying vec3 vW;
        ${FOG_PARS}
        void main() {
          if (vState < 0.5) discard;
          float a = vState > 1.5 ? 0.95 : 0.4;
          vec3 c = vColor * (vState > 1.5 ? 2.2 : 1.0);
          float dist = length(vW - cameraPosition);
          float f = fogAmount(dist, vW.y) * 0.6;
          gl_FragColor = vec4(mix(c, fogColorFor(normalize(vW - cameraPosition), vW.y), f), a);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(inst, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
  }

  set(points: THREE.Vector3[], color: THREE.ColorRepresentation, radius = 9): void {
    const c = new THREE.Color(color);
    this.rings = [];
    const n = Math.min(points.length, this.max);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const nb = points[Math.min(i + 1, n - 1)];
      const pb = points[Math.max(i - 1, 0)];
      const dir = nb.clone().sub(pb);
      if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
      dir.normalize();
      this.rings.push({ pos: p.clone(), normal: dir, radius });
      this.dummy.position.copy(p);
      this.dummy.lookAt(p.clone().add(dir));
      this.dummy.scale.setScalar(radius);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.colors.setXYZ(i, c.r, c.g, c.b);
    }
    this.mesh.count = n;
    this.next = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colors.needsUpdate = true;
    this.refresh();
  }

  clear(): void {
    this.rings = [];
    this.mesh.count = 0;
    this.next = 0;
  }

  /** Static gates where every ring is "active" (race starts). */
  setGates(points: THREE.Vector3[], color: THREE.ColorRepresentation, radius: number): void {
    this.set(points, color, radius);
    for (let i = 0; i < this.rings.length; i++) this.states[i] = 2;
    (this.mesh.geometry.getAttribute('aState') as THREE.BufferAttribute).needsUpdate = true;
  }

  refresh(): void {
    for (let i = 0; i < this.max; i++) this.states[i] = i < this.next ? 0 : i === this.next ? 2 : i < this.next + 4 ? 1 : 0;
    (this.mesh.geometry.getAttribute('aState') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Check whether the segment a→b passes through ring `i`. */
  crosses(i: number, a: THREE.Vector3, b: THREE.Vector3, slack = 1.3): boolean {
    const r = this.rings[i];
    if (!r) return false;
    const da = a.clone().sub(r.pos).dot(r.normal);
    const db = b.clone().sub(r.pos).dot(r.normal);
    if (Math.sign(da) === Math.sign(db) && Math.abs(db) > 2) {
      // Also accept being very close to the ring center (thin frames at low fps).
      return b.distanceTo(r.pos) < r.radius * 0.5;
    }
    const t = da / (da - db || 1e-6);
    const hit = a.clone().lerp(b, Math.min(1, Math.max(0, t)));
    return hit.distanceTo(r.pos) < r.radius * slack;
  }

  /** Returns true if the next ring was passed. */
  check(a: THREE.Vector3, b: THREE.Vector3): boolean {
    if (this.next >= this.rings.length) return false;
    if (this.crosses(this.next, a, b)) {
      this.next++;
      this.refresh();
      return true;
    }
    return false;
  }

  get done(): boolean {
    return this.rings.length > 0 && this.next >= this.rings.length;
  }

  nextPos(): THREE.Vector3 | null {
    return this.rings[this.next]?.pos ?? null;
  }
}
