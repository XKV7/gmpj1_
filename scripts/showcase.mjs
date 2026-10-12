// Captures scenic viewpoints (wind river, thermal, storm wall, inside a cloud, sunset over the sea).
// Usage: node scripts/showcase.mjs [url] [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'screenshots';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };

await page.goto(url);
await page.waitForSelector('#title:not(.hidden)', { timeout: 240000 });
await page.click('[data-act=new]');
await page.waitForTimeout(1000);
await page.evaluate(() => window.__game.ui.closeDialog());

const views = [
  ['s01-river', 0.4, `const r = g.wind.rivers[0]; const i = 60; return [r.samples[i].clone().addScaledVector(r.tangents[i], -10), r.tangents[i].clone().multiplyScalar(30)];`],
  ['s02-thermal', 0.45, `const t = g.wind.thermals[2]; return [new V(t.x + t.radius * 2.5, t.baseY + 60, t.z + t.radius * 2.5), new V(-1, 0.1, -1).normalize().multiplyScalar(22)];`],
  ['s03-storm', 0.42, `const e = g.world.eye; const d = new V(-e.x, 0, -e.z).normalize(); return [e.clone().addScaledVector(d, 800).setY(620), d.clone().negate().multiplyScalar(26)];`],
  ['s04-sunset-sea', 0.74, `const h = g.world.hub; return [new V(h.spec.x + 300, h.spec.y + 160, h.spec.z + 300), new V(-1, -0.15, -0.2).normalize().multiplyScalar(30)];`],
  ['s05-low-sea', 0.34, `const h = g.world.hub; return [new V(h.spec.x - 600, 70, h.spec.z), new V(1, 0, 0.3).normalize().multiplyScalar(32)];`],
  ['s06-cloud', 0.5, `const p = g.puffs.specs.find((s) => s.dark < 0.5 && s.y > 150); return [new V(p.x, p.y, p.z + 4), new V(0, 0, -25)];`],
  ['s07-village', 0.6, `const v = g.world.villages[2]; return [new V(v.spec.x + v.spec.radius * 1.6, v.spec.y + 60, v.spec.z), new V(-1, -0.25, 0).normalize().multiplyScalar(24)];`],
  ['s08-alpine', 0.3, `const v = g.world.villages[6]; return [new V(v.spec.x + v.spec.radius * 1.8, v.spec.y + 40, v.spec.z + 40), new V(-1, 0, -0.2).normalize().multiplyScalar(24)];`],
];
for (const [name, tod, code] of views) {
  await page.evaluate(({ tod, code }) => {
    const g = window.__game;
    const V = g.player.position.constructor;
    const [pos, vel] = new Function('g', 'V', code)(g, V);
    g.env.timeOfDay = tod;
    g.player.startFlying(pos, vel);
    g.rig.reset();
    g.debugAdvance(1.2);
  }, { tod, code });
  await shot(name);
}
console.log('errors', errors.length);
for (const e of errors.slice(0, 10)) console.log(e.slice(0, 500));
await browser.close();
