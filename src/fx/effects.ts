import * as THREE from 'three';
import { G } from '../render/uniforms';

/* Wingtip contrails ------------------------------------------------- */

export class Trail {
  mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private ages: number[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  private max: number;
  private acc = 0;
  intensity = 0;

  constructor(max = 70) {
    this.max = max;
    this.pos = new Float32Array(max * 2 * 3);
    this.alpha = new Float32Array(max * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uNight: G.uNight },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vA;
        void main() { vA = aAlpha; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vA;
        void main() { gl_FragColor = vec4(vec3(1.0, 0.98, 0.95) * vA * mix(0.42, 0.3, uNight), 1.0); }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 65;
  }

  reset(): void {
    this.pts = [];
    this.ages = [];
  }

  update(dt: number, tip: THREE.Vector3, camPos: THREE.Vector3, emit: number): void {
    this.intensity += (emit - this.intensity) * Math.min(1, dt * 4);
    this.acc += dt;
    for (let i = 0; i < this.ages.length; i++) this.ages[i] += dt;
    if (this.acc > 1 / 40) {
      this.acc = 0;
      this.pts.unshift(tip.clone());
      this.ages.unshift(0);
      if (this.pts.length > this.max) {
        this.pts.pop();
        this.ages.pop();
      }
    } else if (this.pts.length) this.pts[0].copy(tip);
    const n = this.pts.length;
    const side = new THREE.Vector3();
    for (let i = 0; i < this.max; i++) {
      const p = this.pts[Math.min(i, n - 1)] ?? tip;
      const q = this.pts[Math.min(i + 1, n - 1)] ?? p;
      const dir = p.clone().sub(q);
      const toCam = camPos.clone().sub(p);
      side.crossVectors(dir, toCam).normalize();
      const w = 0.08 + i * 0.0035;
      this.pos.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w], i * 6);
      this.pos.set([p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6 + 3);
      const age = this.ages[i] ?? 9;
      const a = i < n ? Math.max(0, 1 - i / this.max) * Math.exp(-age * 0.8) * this.intensity : 0;
      this.alpha[i * 2] = a;
      this.alpha[i * 2 + 1] = a;
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* Camera-space streaks: speed lines, cloud droplets, rain ------------ */

export class Streaks {
  mesh: THREE.LineSegments;
  private pos: Float32Array;
  private col: Float32Array;
  private seeds: { x: number; y: number; z: number; s: number }[] = [];
  private n: number;

  constructor(n = 160) {
    this.n = n;
    this.pos = new Float32Array(n * 6);
    this.col = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) this.seeds.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random(), s: Math.random() });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.LineSegments(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 80;
  }

  update(dt: number, cam: THREE.Camera, vel: THREE.Vector3, speedAmt: number, cloud: number, rain: number): void {
    const camQ = cam.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQ);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camQ);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQ);
    const vdir = vel.lengthSq() > 1 ? vel.clone().normalize() : fwd.clone();
    const speed = vel.length();
    for (let i = 0; i < this.n; i++) {
      const s = this.seeds[i];
      const kind = i % 3; // 0,1 speed/droplets, 2 rain
      s.z -= dt * (kind === 2 ? 1.6 : 0.6 + speed * 0.025) * (0.6 + s.s);
      if (s.z < 0) {
        s.z += 1;
        s.x = Math.random() * 2 - 1;
        s.y = Math.random() * 2 - 1;
      }
      const depth = 2 + s.z * 30;
      const spread = 3 + depth * 0.7;
      const c = cam.position.clone().addScaledVector(fwd, depth).addScaledVector(right, s.x * spread).addScaledVector(up, s.y * spread * 0.6);
      let a: number;
      let len: number;
      let dir: THREE.Vector3;
      let color: [number, number, number];
      if (kind === 2) {
        a = rain * 0.5;
        len = 2.2;
        dir = new THREE.Vector3(0, -1, 0).addScaledVector(vdir, -Math.min(speed, 60) / 40).normalize();
        color = [0.6, 0.65, 0.8];
      } else {
        const edge = Math.min(1, Math.hypot(s.x, s.y));
        a = speedAmt * 0.35 * edge + cloud * 0.4;
        len = 0.6 + speedAmt * 5 + cloud * 0.6;
        dir = vdir.clone().negate();
        color = cloud > speedAmt ? [0.85, 0.9, 1.0] : [1, 1, 1];
      }
      a *= Math.sin(s.z * Math.PI);
      const e = c.clone().addScaledVector(dir, len);
      this.pos.set([c.x, c.y, c.z, e.x, e.y, e.z], i * 6);
      this.col.set([color[0] * a, color[1] * a, color[2] * a, 0, 0, 0], i * 6);
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = speedAmt > 0.01 || cloud > 0.01 || rain > 0.01;
  }
}

/* Particle bursts (grass, petals, sparkles) -------------------------- */

export class Particles {
  points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: THREE.Vector3[] = [];
  private life: Float32Array;
  private grav: Float32Array;
  private cursor = 0;

  constructor(n = 400) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.grav = new Float32Array(n);
    for (let i = 0; i < n; i++) this.vel.push(new THREE.Vector3());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uPixel;
        varying vec3 vC;
        varying float vA;
        void main() {
          vC = aColor;
          vA = step(0.001, aSize);
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * 300.0 * uPixel / max(-mv.z, 0.1);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.3, length(c * vec2(1.0, 1.6))) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 75;
  }

  burst(p: THREE.Vector3, count: number, color: THREE.Color, speed: number, up: number, gravity = 9, size = 0.25, life = 1.4): void {
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      this.pos.set([p.x + (Math.random() - 0.5), p.y + Math.random() * 0.3, p.z + (Math.random() - 0.5)], i * 3);
      const c = color.clone().multiplyScalar(0.8 + Math.random() * 0.4);
      this.col.set([c.r, c.g, c.b], i * 3);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed;
      this.vel[i].set(Math.cos(a) * r, up * (0.5 + Math.random()), Math.sin(a) * r);
      this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.grav[i] = gravity;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const v = this.vel[i];
      v.y -= this.grav[i] * dt;
      v.multiplyScalar(1 - dt * 1.2);
      this.pos[i * 3] += v.x * dt;
      this.pos[i * 3 + 1] += v.y * dt;
      this.pos[i * 3 + 2] += v.z * dt;
      if (this.life[i] < 0.3) this.size[i] *= 0.9;
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* Lightning bolts ------------------------------------------------------ */

export class Lightning {
  group = new THREE.Group();
  private bolts: { line: THREE.Line; life: number }[] = [];
  private mat = new THREE.LineBasicMaterial({ color: 0xeef4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  flash = 0;

  strike(from: THREE.Vector3, to: THREE.Vector3): void {
    const pts: THREE.Vector3[] = [];
    const segs = 18;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = from.clone().lerp(to, t);
      if (i > 0 && i < segs) p.add(new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 30));
      pts.push(p);
      if (i > 3 && i < segs - 2 && Math.random() < 0.25) {
        const b = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, -30 - Math.random() * 40, (Math.random() - 0.5) * 60));
        const bl = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, b]), this.mat);
        bl.frustumCulled = false;
        this.group.add(bl);
        this.bolts.push({ line: bl, life: 0.25 });
      }
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.mat);
    line.frustumCulled = false;
    this.group.add(line);
    this.bolts.push({ line, life: 0.35 });
    this.flash = 1;
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 3);
    for (const b of this.bolts) {
      b.life -= dt;
      b.line.visible = b.life > 0 && Math.random() > 0.2;
      if (b.life <= 0) {
        this.group.remove(b.line);
        b.line.geometry.dispose();
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
  }
}
