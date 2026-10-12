import * as THREE from 'three';
import { makeToon } from '../render/toon';
import { FOG_PARS, G, NOISE_GLSL } from '../render/uniforms';
import { M, merge, part } from './geometry';

let charMat: THREE.MeshToonMaterial | null = null;
export function characterMaterial(): THREE.MeshToonMaterial {
  if (!charMat) charMat = makeToon({ vertexColors: true, rim: 0.3, watercolor: 0.4 });
  return charMat;
}

export type HatKind = 'none' | 'cap' | 'witch' | 'beret' | 'hood' | 'straw' | 'beanie';

export interface PersonLook {
  robe: number;
  skin?: number;
  hair?: number;
  hat?: HatKind;
  hatColor?: number;
  scarf?: number;
  scale?: number;
  backpack?: boolean;
}

export interface Person {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  pack: THREE.Mesh | null;
}

export function makePerson(look: PersonLook): Person {
  const mat = characterMaterial();
  const skin = look.skin ?? 0xf3d2b8;
  const hair = look.hair ?? 0x5b4636;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(
    merge([
      part(new THREE.CylinderGeometry(0.32, 0.55, 1.1, 8), look.robe, M.t(0, 1.05, 0)),
      part(new THREE.CylinderGeometry(0.56, 0.56, 0.12, 8), new THREE.Color(look.robe).multiplyScalar(0.8), M.t(0, 0.52, 0)),
      ...(look.scarf !== undefined ? [part(new THREE.TorusGeometry(0.3, 0.1, 5, 10), look.scarf, M.trs(0, 1.55, 0, Math.PI / 2, 0, 0))] : []),
    ]),
    mat,
  );
  torso.castShadow = true;
  body.add(torso);
  const headParts = [
    part(new THREE.SphereGeometry(0.36, 10, 8), skin, M.t(0, 0, 0)),
    part(new THREE.SphereGeometry(0.38, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, M.trs(0, 0.04, -0.03, -0.25, 0, 0)),
    part(new THREE.SphereGeometry(0.045, 5, 4), 0x2b2430, M.t(0.13, 0.03, 0.32)),
    part(new THREE.SphereGeometry(0.045, 5, 4), 0x2b2430, M.t(-0.13, 0.03, 0.32)),
    part(new THREE.SphereGeometry(0.06, 5, 4), 0xf2a3a0, M.t(0.2, -0.08, 0.28)),
    part(new THREE.SphereGeometry(0.06, 5, 4), 0xf2a3a0, M.t(-0.2, -0.08, 0.28)),
  ];
  const hc = look.hatColor ?? 0xd9776b;
  switch (look.hat ?? 'none') {
    case 'cap':
      headParts.push(part(new THREE.SphereGeometry(0.39, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), hc, M.t(0, 0.05, 0)));
      headParts.push(part(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 10, 1, false, 0, Math.PI), hc, M.trs(0, 0.1, 0.25, 0, Math.PI / 2, 0)));
      break;
    case 'witch':
      headParts.push(part(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 12), hc, M.t(0, 0.22, 0)));
      headParts.push(part(new THREE.ConeGeometry(0.33, 0.9, 10), hc, M.trs(0, 0.65, -0.05, -0.2, 0, 0)));
      break;
    case 'beret':
      headParts.push(part(new THREE.SphereGeometry(0.42, 10, 6), hc, M.trs(0.05, 0.25, 0, 0, 0, 0.2, 1, 0.35, 1)));
      break;
    case 'hood':
      headParts.push(part(new THREE.SphereGeometry(0.45, 10, 8, Math.PI * 0.15, Math.PI * 1.7), hc, M.trs(0, 0.02, -0.05, 0, Math.PI, 0)));
      break;
    case 'straw':
      headParts.push(part(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 14), 0xe8cf8a, M.t(0, 0.22, 0)));
      headParts.push(part(new THREE.CylinderGeometry(0.3, 0.38, 0.3, 12), 0xe8cf8a, M.t(0, 0.38, 0)));
      headParts.push(part(new THREE.CylinderGeometry(0.385, 0.385, 0.08, 12), hc, M.t(0, 0.28, 0)));
      break;
    case 'beanie':
      headParts.push(part(new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), hc, M.t(0, 0.08, 0)));
      headParts.push(part(new THREE.SphereGeometry(0.12, 6, 4), 0xffffff, M.t(0, 0.5, 0)));
      break;
    default:
      break;
  }
  const head = new THREE.Mesh(merge(headParts), mat);
  head.position.set(0, 1.95, 0);
  head.castShadow = true;
  body.add(head);
  const armGeo = merge([part(new THREE.CapsuleGeometry(0.1, 0.55, 3, 6), look.robe, M.t(0, -0.3, 0)), part(new THREE.SphereGeometry(0.11, 6, 4), skin, M.t(0, -0.68, 0))]);
  const armL = new THREE.Mesh(armGeo, mat);
  armL.position.set(0.42, 1.5, 0);
  const armR = new THREE.Mesh(armGeo, mat);
  armR.position.set(-0.42, 1.5, 0);
  body.add(armL, armR);
  const legGeo = merge([part(new THREE.CapsuleGeometry(0.1, 0.35, 3, 6), 0x5c5468, M.t(0, -0.25, 0)), part(new THREE.BoxGeometry(0.2, 0.12, 0.32), 0x6b4a3a, M.t(0, -0.5, 0.06))]);
  const legL = new THREE.Mesh(legGeo, mat);
  legL.position.set(0.18, 0.55, 0);
  const legR = new THREE.Mesh(legGeo, mat);
  legR.position.set(-0.18, 0.55, 0);
  body.add(legL, legR);
  let pack: THREE.Mesh | null = null;
  if (look.backpack) {
    pack = new THREE.Mesh(
      merge([
        part(new THREE.BoxGeometry(0.6, 0.75, 0.32), 0x9c6b4a, M.t(0, 0, 0)),
        part(new THREE.BoxGeometry(0.62, 0.12, 0.34), 0x7a5238, M.t(0, 0.2, 0)),
        part(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 6), 0xe8e2d4, M.trs(0, 0.42, 0, 0, 0, Math.PI / 2)),
      ]),
      mat,
    );
    pack.position.set(0, 1.25, -0.42);
    pack.castShadow = true;
    body.add(pack);
  }
  const s = look.scale ?? 1;
  root.scale.setScalar(s);
  return { root, body, head, armL, armR, legL, legR, pack };
}

/** Procedural idle / walk animation. */
export function animatePerson(p: Person, t: number, walk: number, phase = 0, wave = 0): void {
  const sw = Math.sin(t * 9 + phase) * walk;
  p.legL.rotation.x = sw * 0.7;
  p.legR.rotation.x = -sw * 0.7;
  p.armL.rotation.x = -sw * 0.6;
  p.armR.rotation.x = sw * 0.6;
  const breathe = Math.sin(t * 2 + phase) * 0.02;
  p.body.position.y = Math.abs(Math.sin(t * 9 + phase)) * 0.08 * walk + breathe;
  p.head.rotation.y = Math.sin(t * 0.5 + phase) * 0.35 * (1 - walk);
  p.head.rotation.z = Math.sin(t * 0.8 + phase * 2) * 0.05;
  p.armR.rotation.z = -0.1 - wave * (1.9 + Math.sin(t * 10) * 0.3);
  p.armL.rotation.z = 0.1;
}

/* ------------------------------------------------------------------ */
/* Glider                                                              */
/* ------------------------------------------------------------------ */

export const WING_PATTERNS = ['단색', '줄무늬', '쉐브론', '물방울', '노을빛', '깃털', '별자리', '체크', '물결', '바람 날개'] as const;

export interface GliderLook {
  primary: number;
  secondary: number;
  pattern: number;
}

export interface GliderModel {
  root: THREE.Group;
  wing: THREE.Mesh;
  wingMat: THREE.ShaderMaterial;
  rider: Person;
  tipL: THREE.Object3D;
  tipR: THREE.Object3D;
  setLook(l: GliderLook): void;
  setFold(fold: number, spread: number): void;
}

function wingGeometry(): THREE.BufferGeometry {
  const NS = 20, NV = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    for (let i = 0; i <= NS; i++) {
      const s = (i / NS) * 2 - 1;
      const as = Math.abs(s);
      const zle = -1.7 + as * 2.9;
      const zte = 1.0 + as * 0.35 - Math.cos(as * Math.PI * 0.5) * 0.15;
      const z = zle + (zte - zle) * v;
      const y = as * 0.38 + Math.sin(Math.PI * v) * 0.14 * (1 - as * 0.6);
      pos.push(s * 4.8, y, z);
      uv.push(s * 0.5 + 0.5, v);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NS; i++) {
      const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeWingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uPrimary: { value: new THREE.Color(0xf4f1ea) },
      uSecondary: { value: new THREE.Color(0xd9665c) },
      uPattern: { value: 0 },
      uTime: G.uTime,
      uSunDir: G.uSunDir,
      uSunColor: G.uSunColor,
      uAmbient: G.uAmbient,
      uFogColor: G.uFogColor,
      uFogSunColor: G.uFogSunColor,
      uFogLowColor: G.uFogLowColor,
      uFogDensity: G.uFogDensity,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPrimary;
      uniform vec3 uSecondary;
      uniform int uPattern;
      uniform float uTime;
      uniform vec3 uSunColor;
      uniform vec3 uAmbient;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      ${FOG_PARS}
      ${NOISE_GLSL}
      float pattern(vec2 uv) {
        float s = abs(uv.x - 0.5) * 2.0;
        if (uPattern == 1) return step(0.5, fract(uv.y * 4.0));
        if (uPattern == 2) return step(0.5, fract((uv.y + s * 0.8) * 3.0));
        if (uPattern == 3) { vec2 g = fract(vec2(uv.x * 12.0, uv.y * 4.0)) - 0.5; return step(length(g), 0.28); }
        if (uPattern == 4) return smoothstep(0.2, 0.95, s);
        if (uPattern == 5) { float f = fract(s * 7.0 + uv.y * 0.6); return step(0.62, f) * step(0.3, uv.y); }
        if (uPattern == 6) { vec2 c = floor(vec2(uv.x * 26.0, uv.y * 8.0)); float h = hash12(c); vec2 f = fract(vec2(uv.x * 26.0, uv.y * 8.0)) - 0.5; return step(0.8, h) * step(length(f), 0.18); }
        if (uPattern == 7) { vec2 c = floor(vec2(uv.x * 10.0, uv.y * 4.0)); return mod(c.x + c.y, 2.0); }
        if (uPattern == 8) return step(0.5, fract(uv.y * 3.0 + sin(uv.x * 18.0) * 0.12));
        if (uPattern == 9) return 0.5 + 0.5 * sin(s * 6.0 - uTime * 2.0 + uv.y * 3.0);
        return 0.0;
      }
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float p = pattern(vUv);
        vec3 base = mix(uPrimary, uSecondary, p);
        if (uPattern == 9) {
          vec3 iri = 0.6 + 0.4 * cos(6.283 * (vec3(0.0, 0.33, 0.67) + vUv.x * 0.8 + vUv.y * 0.4 + uTime * 0.1));
          base = mix(uPrimary, iri, 0.65);
        }
        float ndl = dot(n, uSunDir);
        float band = ndl > 0.4 ? 1.0 : ndl > 0.0 ? 0.78 : 0.58;
        // Translucent fabric: light passing through from behind.
        float trans = max(-ndl, 0.0) * 0.35;
        vec3 col = base * (uAmbient * 0.75 + uSunColor * (band * 0.75 + trans));
        // Stitch lines along the span.
        float stitch = smoothstep(0.015, 0.0, abs(fract(vUv.x * 6.0) - 0.5) - 0.48);
        col *= 1.0 - stitch * 0.15;
        float edge = smoothstep(0.03, 0.0, min(vUv.y, 1.0 - vUv.y));
        col = mix(col, col * 0.55, edge * 0.6);
        if (uPattern == 9) col += vec3(0.25, 0.35, 0.45) * (0.5 + 0.5 * sin(uTime * 3.0 + vUv.x * 20.0)) * 0.3;
        gl_FragColor = vec4(applyFog(col, vW), 1.0);
      }`,
  });
}

export function makeGlider(look: GliderLook, riderLook: PersonLook): GliderModel {
  const root = new THREE.Group();
  const wingMat = makeWingMaterial();
  const wingPivot = new THREE.Group();
  root.add(wingPivot);
  const wing = new THREE.Mesh(wingGeometry(), wingMat);
  wing.castShadow = true;
  wingPivot.add(wing);
  wingPivot.position.y = 1.2;
  const mat = characterMaterial();
  const frame = new THREE.Mesh(
    merge([
      part(new THREE.CylinderGeometry(0.05, 0.05, 3.0, 5), 0x5c5468, M.trs(0, 1.25, -0.2, Math.PI / 2, 0, 0)),
      part(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 4), 0x5c5468, M.trs(0.45, 0.6, -0.1, 0, 0, 0.35)),
      part(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 4), 0x5c5468, M.trs(-0.45, 0.6, -0.1, 0, 0, -0.35)),
      part(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 4), 0x5c5468, M.trs(0, -0.05, -0.1, 0, 0, Math.PI / 2)),
      part(new THREE.BoxGeometry(0.22, 0.22, 0.5), 0xd9665c, M.t(0, 1.1, 1.3)),
    ]),
    mat,
  );
  frame.castShadow = true;
  root.add(frame);
  const rider = makePerson({ ...riderLook, backpack: true });
  // Prone pose: head forward (-Z), face down.
  rider.root.rotation.set(Math.PI / 2 - 0.15, 0, Math.PI);
  rider.root.position.set(0, 0.35, 1.6);
  rider.root.scale.setScalar(0.85);
  rider.armL.rotation.x = -2.3;
  rider.armR.rotation.x = -2.3;
  root.add(rider.root);
  const tipL = new THREE.Object3D();
  tipL.position.set(-4.8, 1.2 + 0.38, 1.32);
  const tipR = new THREE.Object3D();
  tipR.position.set(4.8, 1.2 + 0.38, 1.32);
  wingPivot.add(tipL, tipR);
  tipL.position.y -= 1.2;
  tipR.position.y -= 1.2;
  const model: GliderModel = {
    root,
    wing,
    wingMat,
    rider,
    tipL,
    tipR,
    setLook(l: GliderLook) {
      (wingMat.uniforms.uPrimary.value as THREE.Color).setHex(l.primary);
      (wingMat.uniforms.uSecondary.value as THREE.Color).setHex(l.secondary);
      wingMat.uniforms.uPattern.value = l.pattern;
    },
    setFold(fold: number, spread: number) {
      wingPivot.scale.set(1 - fold * 0.42 + spread * 0.08, 1 + spread * 0.25, 1 + fold * 0.18);
      wingPivot.rotation.x = -fold * 0.12 + spread * 0.08;
      wingPivot.position.z = fold * 0.4;
    },
  };
  model.setLook(look);
  return model;
}
