import type { WorldData } from '../world/worldgen';
import { EDGE_STORM_R } from '../world/worldgen';
import type { River } from '../world/wind';

export interface MapState {
  world: WorldData;
  rivers: River[];
  discovered: Set<number>;
  player: { x: number; z: number; heading: number };
  targets: { x: number; z: number; label: string }[];
  rings: { x: number; z: number }[];
  stormCleared: boolean;
}

const BIOME_COLOR: Record<string, string> = {
  meadow: '#9fd27a', cherry: '#ffc4dc', canyon: '#e2a274', alpine: '#e8eef8', ruins: '#d6ccb4', moonflower: '#a9c0e8', sky: '#ffe9a8',
};

export function drawMap(c: HTMLCanvasElement, s: MapState): void {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const W = c.width, H = c.height;
  const R = 2850;
  const scale = Math.min(W, H) / (R * 2) * 0.98;
  const cx = W / 2, cy = H / 2;
  const X = (x: number): number => cx + x * scale;
  const Y = (z: number): number => cy + z * scale;
  // Paper background with cloud-sea texture.
  const g = ctx.createRadialGradient(cx, cy, 50, cx, cy, Math.max(W, H) * 0.7);
  g.addColorStop(0, '#f6f3ec');
  g.addColorStop(1, '#dfe6ef');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 160; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const d = ((i * 97) % 100) / 100 * R;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(X(Math.cos(a) * d), Y(Math.sin(a) * d), 40 + (i % 7) * 8, 16 + (i % 5) * 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Edge storm.
  ctx.strokeStyle = s.stormCleared ? 'rgba(160,150,200,.25)' : 'rgba(110,90,150,.5)';
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, EDGE_STORM_R * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Storm zones.
  for (const st of s.world.storms) {
    if (s.stormCleared) continue;
    const grad = ctx.createRadialGradient(X(st.x), Y(st.z), st.inner * scale, X(st.x), Y(st.z), st.outer * scale);
    grad.addColorStop(0, 'rgba(110,90,150,0)');
    grad.addColorStop(0.3, 'rgba(110,90,150,.45)');
    grad.addColorStop(1, 'rgba(110,90,150,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(X(st.x), Y(st.z), st.outer * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a5a8a';
    ctx.font = '600 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(st.kind === 'eye' ? '폭풍의 눈' : '폭풍 지대', X(st.x), Y(st.z) + st.outer * scale + 16);
  }
  // Wind rivers.
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(79,143,201,.55)';
  for (const r of s.rivers) {
    ctx.beginPath();
    r.samples.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.z)) : ctx.moveTo(X(p.x), Y(p.z))));
    ctx.stroke();
    const p = r.samples[Math.floor(r.samples.length * 0.5)];
    const t = r.tangents[Math.floor(r.samples.length * 0.5)];
    ctx.fillStyle = 'rgba(79,143,201,.8)';
    ctx.beginPath();
    const a = Math.atan2(t.z, t.x);
    ctx.moveTo(X(p.x) + Math.cos(a) * 10, Y(p.z) + Math.sin(a) * 10);
    ctx.lineTo(X(p.x) + Math.cos(a + 2.5) * 8, Y(p.z) + Math.sin(a + 2.5) * 8);
    ctx.lineTo(X(p.x) + Math.cos(a - 2.5) * 8, Y(p.z) + Math.sin(a - 2.5) * 8);
    ctx.fill();
  }
  // Bridges.
  ctx.strokeStyle = '#8a6448';
  ctx.lineWidth = 2;
  for (const b of s.world.bridges) {
    if (!s.discovered.has(b.a) && !s.discovered.has(b.b)) continue;
    ctx.beginPath();
    ctx.moveTo(X(b.p0.x), Y(b.p0.z));
    ctx.lineTo(X(b.p1.x), Y(b.p1.z));
    ctx.stroke();
  }
  // Islands.
  for (const I of s.world.islands) {
    const sp = I.spec;
    const known = s.discovered.has(sp.id);
    ctx.beginPath();
    for (let k = 0; k <= 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const r = I.boundary(a);
      const x = X(sp.x + Math.cos(a) * r), y = Y(sp.z + Math.sin(a) * r);
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    if (known) {
      ctx.fillStyle = BIOME_COLOR[sp.biome];
      ctx.fill();
      ctx.strokeStyle = 'rgba(61,53,72,.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(61,53,72,.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (known && (sp.role !== 'satellite' || sp.radius > 45)) {
      ctx.fillStyle = '#3d3548';
      ctx.font = `${sp.role === 'hub' || sp.role === 'village' ? '700 22px' : '500 17px'} sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(sp.name, X(sp.x), Y(sp.z) - I.spec.radius * scale - 6);
      if (sp.role === 'hub') ctx.fillText('📮', X(sp.x), Y(sp.z) + 6);
    } else if (!known) {
      ctx.fillStyle = 'rgba(61,53,72,.4)';
      ctx.font = '600 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('?', X(sp.x), Y(sp.z) + 5);
    }
  }
  // Race starts.
  ctx.lineWidth = 2;
  s.world.races.forEach((r) => {
    const p = r.rings[0];
    ctx.strokeStyle = '#3f8f5f';
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.z), 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.z), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#3f8f5f';
    ctx.fill();
    ctx.font = '600 15px sans-serif';
    ctx.fillText(r.name, X(p.x), Y(p.z) + 30);
  });
  // Active rings.
  ctx.fillStyle = '#e8b64a';
  for (const r of s.rings) {
    ctx.beginPath();
    ctx.arc(X(r.x), Y(r.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Targets.
  for (const t of s.targets) {
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d9665c';
    ctx.fillText('★', X(t.x), Y(t.z) + 8);
    ctx.font = '600 17px sans-serif';
    ctx.fillText(t.label, X(t.x), Y(t.z) + 24);
  }
  // Player.
  const px = X(s.player.x), py = Y(s.player.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(s.player.heading);
  ctx.fillStyle = '#4f8fc9';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(12, 13);
  ctx.lineTo(0, 6);
  ctx.lineTo(-12, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Compass rose.
  ctx.fillStyle = '#3d3548';
  ctx.font = '700 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('북', W - 40, 34);
  ctx.beginPath();
  ctx.moveTo(W - 40, 40);
  ctx.lineTo(W - 46, 56);
  ctx.lineTo(W - 34, 56);
  ctx.fill();
}
