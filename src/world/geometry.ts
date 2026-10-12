import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Noise } from '../core/rng';

/** Prepare a primitive for merging: non-indexed, no uvs, solid vertex color, optional transform. */
export function part(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, tf?: THREE.Matrix4): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (tf) g.applyMatrix4(tf);
  g.deleteAttribute('uv');
  if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g === geo) g = g.clone();
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed');
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export const M = {
  t(x: number, y: number, z: number): THREE.Matrix4 {
    return new THREE.Matrix4().makeTranslation(x, y, z);
  },
  trs(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  },
};

function lumpy(geo: THREE.BufferGeometry, amt: number, seed: number, freq = 1.3): THREE.BufferGeometry {
  const nz = new Noise(seed);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  // Displace by position so shared vertices stay welded.
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + amt * nz.n3(v.x * freq, v.y * freq, v.z * freq);
    p.setXYZ(i, v.x * d, v.y * d, v.z * d);
  }
  g.computeVertexNormals();
  return g;
}

/** Shading pass: darken toward the bottom for painterly ambient occlusion. */
function aoGradient(g: THREE.BufferGeometry, minY: number, maxY: number, dark = 0.7): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const c = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - minY) / (maxY - minY)));
    const k = dark + (1 - dark) * t;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return g;
}

export function grassTuftGeo(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];
  const blades = 6;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const r = 0.12 + (b % 3) * 0.06;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const h = 0.55 + ((b * 37) % 10) / 22;
    const lean = 0.12 + (b % 2) * 0.1;
    const lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
    const w = 0.07;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const v0 = [ox - px, 0, oz - pz], v1 = [ox + px, 0, oz + pz];
    const v2 = [ox + lx * 0.4 - px * 0.6, h * 0.5, oz + lz * 0.4 - pz * 0.6];
    const v3 = [ox + lx * 0.4 + px * 0.6, h * 0.5, oz + lz * 0.4 + pz * 0.6];
    const v4 = [ox + lx, h, oz + lz];
    const tris = [v0, v1, v2, v1, v3, v2, v2, v3, v4];
    for (const v of tris) {
      pos.push(v[0], v[1], v[2]);
      const k = 0.5 + 0.6 * (v[1] / h);
      col.push(k, k, k * 0.95);
      nrm.push(0, 1, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

export function flowerGeo(): THREE.BufferGeometry {
  const stem = part(new THREE.CylinderGeometry(0.025, 0.03, 0.45, 4), 0x5f9a52, M.t(0, 0.22, 0));
  const head = part(new THREE.ConeGeometry(0.16, 0.12, 6), 0xffffff, M.trs(0, 0.47, 0, Math.PI, 0, 0));
  const center = part(new THREE.SphereGeometry(0.06, 5, 3), 0xffe48a, M.t(0, 0.5, 0));
  return merge([stem, head, center]);
}

export function treeRoundGeo(seed: number, leaf: THREE.ColorRepresentation, trunkCol: THREE.ColorRepresentation = 0x8a6448): THREE.BufferGeometry {
  const parts = [part(new THREE.CylinderGeometry(0.22, 0.38, 3.4, 6), trunkCol, M.t(0, 1.7, 0))];
  const lc = new THREE.Color(leaf);
  const blobs: [number, number, number, number][] = [[0, 4.4, 0, 1.9], [0.9, 3.8, 0.3, 1.3], [-0.8, 3.9, -0.4, 1.35], [0.2, 5.4, -0.2, 1.25]];
  blobs.forEach(([x, y, z, r], i) => {
    const g = lumpy(new THREE.IcosahedronGeometry(r, 1), 0.18, seed + i);
    parts.push(part(g, lc.clone().multiplyScalar(0.92 + i * 0.05), M.t(x, y, z)));
  });
  return aoGradient(merge(parts), 0, 6.2, 0.62);
}

export function treePineGeo(snow: boolean): THREE.BufferGeometry {
  const parts = [part(new THREE.CylinderGeometry(0.18, 0.3, 2.2, 6), 0x7a5a44, M.t(0, 1.1, 0))];
  const tiers: [number, number, number][] = [[1.9, 2.6, 2.4], [1.45, 2.2, 3.9], [1.0, 1.8, 5.2]];
  tiers.forEach(([r, h, y], i) => {
    parts.push(part(new THREE.ConeGeometry(r, h, 7), i % 2 ? 0x4f8a6a : 0x5a9673, M.t(0, y, 0)));
    if (snow) parts.push(part(new THREE.ConeGeometry(r * 0.55, h * 0.45, 7), 0xf3f6ff, M.t(0, y + h * 0.3, 0)));
  });
  return aoGradient(merge(parts), 0, 6.3, 0.6);
}

export function shrubGeo(seed: number, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  return aoGradient(merge([part(lumpy(new THREE.IcosahedronGeometry(0.9, 1), 0.25, seed), color, M.trs(0, 0.5, 0, 0, 0, 0, 1, 0.7, 1))]), 0, 1.2, 0.65);
}

export function rockGeo(seed: number): THREE.BufferGeometry {
  return aoGradient(merge([part(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.3, seed, 0.9), 0xffffff, M.trs(0, 0.3, 0, 0, 0, 0, 1, 0.75, 1))]), -0.5, 1, 0.7);
}

export function debrisGeo(seed: number): THREE.BufferGeometry {
  const top = part(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.25, seed), 0xb9a58c, M.trs(0, 0, 0, 0, 0, 0, 1, 0.45, 1));
  const root = part(lumpy(new THREE.ConeGeometry(0.85, 2.2, 7), 0.2, seed + 3), 0x7d7088, M.trs(0, -1.2, 0, Math.PI, 0, 0));
  const grass = part(new THREE.CylinderGeometry(0.95, 0.95, 0.12, 9), 0x8fc274, M.t(0, 0.42, 0));
  return merge([top, root, grass]);
}

export const ROOF_COLORS = [0xd9776b, 0x6f8fc9, 0x83b06f, 0xd2a05a, 0xa880c8];

export function houseGeo(roof: THREE.ColorRepresentation, big = false): THREE.BufferGeometry {
  const w = big ? 12 : 6, d = big ? 10 : 5.5, h = big ? 6.5 : 4;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(new THREE.BoxGeometry(w + 0.4, 0.6, d + 0.4), 0xb8a894, M.t(0, 0.3, 0)));
  parts.push(part(new THREE.BoxGeometry(w, h, d), 0xf6eedf, M.t(0, 0.6 + h / 2, 0)));
  // Timber frame accents
  parts.push(part(new THREE.BoxGeometry(w + 0.1, 0.3, d + 0.1), 0x9c7458, M.t(0, 0.6 + h, 0)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(new THREE.BoxGeometry(0.35, h, 0.35), 0x9c7458, M.t((sx * w) / 2, 0.6 + h / 2, (sz * d) / 2)));
  // Roof prism
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-w / 2 - 0.7, 0);
  roofShape.lineTo(w / 2 + 0.7, 0);
  roofShape.lineTo(0, h * 0.75 + 0.6);
  roofShape.lineTo(-w / 2 - 0.7, 0);
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: d + 1.2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(d + 1.2) / 2);
  parts.push(part(roofGeo, roof, M.t(0, 0.6 + h + 0.15, 0)));
  parts.push(part(new THREE.BoxGeometry(0.8, 2.2, 0.8), 0xc4a48c, M.t(w * 0.25, 0.6 + h + h * 0.5, d * 0.15)));
  // Door (front = +z)
  parts.push(part(new THREE.BoxGeometry(big ? 2 : 1.2, big ? 3 : 2.1, 0.2), 0x8b5d43, M.t(0, 0.6 + (big ? 1.5 : 1.05), d / 2 + 0.05)));
  return aoGradient(merge(parts), 0, 0.6 + h + h * 0.75, 0.78);
}

/** Window quads matching houseGeo; rendered with a glow material that lights up at night. */
export function houseWindowsGeo(big = false): THREE.BufferGeometry {
  const w = big ? 12 : 6, d = big ? 10 : 5.5, h = big ? 6.5 : 4;
  const parts: THREE.BufferGeometry[] = [];
  const win = (x: number, y: number, z: number, ry: number): void => {
    const g = new THREE.PlaneGeometry(big ? 1.5 : 1.0, big ? 1.5 : 1.0);
    parts.push(part(g, 0xffffff, M.trs(x, y, z, 0, ry, 0)));
  };
  const y = 0.6 + h * 0.55;
  const xs = big ? [-3.8, 3.8] : [-1.8, 1.8];
  for (const x of xs) win(x, y, d / 2 + 0.03, 0);
  for (const x of xs) win(x, y, -d / 2 - 0.03, Math.PI);
  win(w / 2 + 0.03, y, 0, Math.PI / 2);
  win(-w / 2 - 0.03, y, 0, -Math.PI / 2);
  if (big) {
    for (const x of [-3.8, 0, 3.8]) win(x, y + 2.2, d / 2 + 0.03, 0);
  }
  return merge(parts);
}

export function columnGeo(broken: boolean): THREE.BufferGeometry {
  const h = broken ? 2.2 + Math.random() * 1.5 : 5.5;
  const parts = [
    part(new THREE.BoxGeometry(1.5, 0.5, 1.5), 0xd8d0bf, M.t(0, 0.25, 0)),
    part(new THREE.CylinderGeometry(0.5, 0.55, h, 10), 0xe6dece, M.t(0, 0.5 + h / 2, 0)),
  ];
  if (!broken) parts.push(part(new THREE.BoxGeometry(1.4, 0.45, 1.4), 0xd8d0bf, M.t(0, 0.5 + h + 0.22, 0)));
  else parts.push(part(new THREE.CylinderGeometry(0.35, 0.5, 0.5, 7), 0xcfc4b0, M.trs(0, 0.5 + h + 0.15, 0, 0.3, 0, 0.2)));
  return aoGradient(merge(parts), 0, h + 1, 0.7);
}

export function archGeo(): THREE.BufferGeometry {
  const parts = [
    part(new THREE.BoxGeometry(1.4, 6, 1.4), 0xe2dac9, M.t(-2.6, 3, 0)),
    part(new THREE.BoxGeometry(1.4, 6, 1.4), 0xe2dac9, M.t(2.6, 3, 0)),
    part(new THREE.BoxGeometry(7, 1.2, 1.6), 0xd6cdb9, M.t(0, 6.6, 0)),
    part(new THREE.BoxGeometry(2.0, 0.6, 1.8), 0xbcd1a0, M.t(1.5, 7.4, 0)),
  ];
  return aoGradient(merge(parts), 0, 7.5, 0.7);
}

export function mailboxGeo(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6), 0x8a6448, M.t(0, 0.6, 0)),
    part(new THREE.BoxGeometry(0.8, 0.55, 0.5), 0xe0574f, M.t(0, 1.4, 0)),
    part(new THREE.CylinderGeometry(0.25, 0.25, 0.8, 8, 1, false, 0, Math.PI), 0xe0574f, M.trs(0, 1.67, 0, 0, 0, Math.PI / 2)),
    part(new THREE.BoxGeometry(0.05, 0.3, 0.2), 0xffd35a, M.t(0.42, 1.65, 0)),
  ]);
}

export function lampPostGeo(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.08, 0.12, 3.2, 6), 0x5c5468, M.t(0, 1.6, 0)),
    part(new THREE.BoxGeometry(0.5, 0.08, 0.5), 0x5c5468, M.t(0, 3.25, 0)),
    part(new THREE.ConeGeometry(0.42, 0.35, 4), 0x5c5468, M.trs(0, 3.85, 0, 0, Math.PI / 4, 0)),
  ]);
}

export function lampGlowGeo(): THREE.BufferGeometry {
  return merge([part(new THREE.BoxGeometry(0.34, 0.45, 0.34), 0xffffff, M.t(0, 3.5, 0))]);
}

export function flagPoleGeo(): THREE.BufferGeometry {
  return merge([part(new THREE.CylinderGeometry(0.05, 0.07, 4, 5), 0xe8e2d4, M.t(0, 2, 0)), part(new THREE.SphereGeometry(0.1, 5, 4), 0xffd35a, M.t(0, 4.05, 0))]);
}

export function flagClothGeo(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1.6, 1.0, 8, 2);
  g.translate(0.8, 0, 0);
  const p = part(g, 0xffffff);
  return merge([p]);
}

export function crystalGeo(): THREE.BufferGeometry {
  return merge([
    part(new THREE.OctahedronGeometry(0.6, 0), 0xffffff, M.trs(0, 1.1, 0, 0, 0, 0, 0.6, 1.8, 0.6)),
    part(new THREE.OctahedronGeometry(0.4, 0), 0xffffff, M.trs(0.5, 0.6, 0.2, 0, 0, 0.5, 0.5, 1.4, 0.5)),
    part(new THREE.OctahedronGeometry(0.35, 0), 0xffffff, M.trs(-0.4, 0.5, -0.3, 0.3, 0, -0.4, 0.5, 1.2, 0.5)),
  ]);
}

export function moonflowerGeo(): THREE.BufferGeometry {
  const parts = [part(new THREE.CylinderGeometry(0.03, 0.04, 0.7, 4), 0x6f9aa8, M.t(0, 0.35, 0))];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(part(new THREE.SphereGeometry(0.18, 5, 3), 0xe8f1ff, M.trs(Math.cos(a) * 0.2, 0.72, Math.sin(a) * 0.2, 0, -a, 0.9, 1.6, 0.35, 0.8)));
  }
  parts.push(part(new THREE.SphereGeometry(0.1, 5, 4), 0xfff6c0, M.t(0, 0.74, 0)));
  return merge(parts);
}

export function questBoardGeo(): THREE.BufferGeometry {
  return aoGradient(merge([
    part(new THREE.BoxGeometry(0.2, 2.6, 0.2), 0x8a6448, M.t(-1.2, 1.3, 0)),
    part(new THREE.BoxGeometry(0.2, 2.6, 0.2), 0x8a6448, M.t(1.2, 1.3, 0)),
    part(new THREE.BoxGeometry(2.8, 1.6, 0.15), 0xb08a64, M.t(0, 1.9, 0)),
    part(new THREE.BoxGeometry(0.6, 0.7, 0.05), 0xfff4dc, M.trs(-0.7, 2.0, 0.1, 0, 0, 0.08)),
    part(new THREE.BoxGeometry(0.6, 0.8, 0.05), 0xffe8e0, M.trs(0.1, 1.9, 0.1, 0, 0, -0.05)),
    part(new THREE.BoxGeometry(0.5, 0.6, 0.05), 0xe8f2ff, M.trs(0.8, 2.05, 0.1, 0, 0, 0.1)),
    part(new THREE.ConeGeometry(1.9, 0.6, 4), 0xd9776b, M.trs(0, 2.95, 0, 0, Math.PI / 4, 0, 1, 1, 0.35)),
  ]), 0, 3.2, 0.75);
}

export function windmillTowerGeo(): THREE.BufferGeometry {
  return aoGradient(merge([
    part(new THREE.CylinderGeometry(1.6, 2.6, 9, 8), 0xf1e6d2, M.t(0, 4.5, 0)),
    part(new THREE.ConeGeometry(2.3, 2.6, 8), 0xc9665c, M.t(0, 10.3, 0)),
    part(new THREE.BoxGeometry(1.2, 2, 0.3), 0x8b5d43, M.t(0, 1, 2.25)),
    part(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 6), 0x8a6448, M.trs(0, 8.2, 1.6, Math.PI / 2, 0, 0)),
  ]), 0, 11, 0.75);
}

export function windmillBladesGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [part(new THREE.SphereGeometry(0.45, 6, 4), 0x8a6448)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    parts.push(part(new THREE.BoxGeometry(0.25, 6.5, 0.12), 0x8a6448, M.trs(Math.sin(a) * 3.2, Math.cos(a) * 3.2, 0, 0, 0, -a)));
    parts.push(part(new THREE.BoxGeometry(1.4, 5.2, 0.06), 0xfaf3e6, M.trs(Math.sin(a) * 3.6 + Math.cos(a) * 0.75, Math.cos(a) * 3.6 - Math.sin(a) * 0.75, 0.05, 0, 0, -a)));
  }
  return merge(parts);
}

export function lighthouseGeo(scale = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const H = 14;
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const r0 = 2.2 - (i / seg) * 0.8, r1 = 2.2 - ((i + 1) / seg) * 0.8;
    parts.push(part(new THREE.CylinderGeometry(r1, r0, H / seg, 12), i % 2 ? 0xd9665c : 0xfaf5ea, M.t(0, (i + 0.5) * (H / seg), 0)));
  }
  parts.push(part(new THREE.CylinderGeometry(2.0, 2.0, 0.4, 12), 0x5c5468, M.t(0, H + 0.2, 0)));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(part(new THREE.BoxGeometry(0.12, 2.2, 0.12), 0x5c5468, M.t(Math.cos(a) * 1.3, H + 1.5, Math.sin(a) * 1.3)));
  }
  parts.push(part(new THREE.ConeGeometry(1.8, 1.6, 12), 0x5c5468, M.t(0, H + 3.4, 0)));
  parts.push(part(new THREE.BoxGeometry(1.2, 2, 0.3), 0x8b5d43, M.t(0, 1, 2.1)));
  const g = aoGradient(merge(parts), 0, H + 4, 0.75);
  g.scale(scale, scale, scale);
  return g;
}

export function lighthouseLampGeo(scale = 1): THREE.BufferGeometry {
  const g = merge([part(new THREE.CylinderGeometry(1.0, 1.0, 1.8, 10), 0xffffff, M.t(0, 14 + 1.5, 0))]);
  g.scale(scale, scale, scale);
  return g;
}

export function plankGeo(): THREE.BufferGeometry {
  return merge([part(new THREE.BoxGeometry(0.7, 0.18, 2.6), 0xa27a58)]);
}
