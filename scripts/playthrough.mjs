// Headless end-to-end check: completes every quest through the real game logic
// (accepting at the post office, flying express rings, night deliveries) and reaches the ending.
// Usage: node scripts/playthrough.mjs [url] [outDir]
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
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };

await page.goto(url);
await page.waitForSelector('#title:not(.hidden)', { timeout: 240000 });
await page.click('[data-act=new]');
await page.waitForTimeout(1200);

await page.evaluate(() => window.__game.ui.closeDialog());

const ids = await page.evaluate(() => {
  const g = window.__game;
  // Quest ids are visible through the post office list; read them from the save helpers.
  return g.villagers.map((v) => v.def.id);
});
console.log('villagers', ids.join(','));

let done = 0;
for (let k = 0; k < 30; k++) {
  const step = await page.evaluate(() => {
    const g = window.__game;
    g.ui.closeDialog();
    g.ui.closePanel();
    g.state = 'play';
    // Find the next available quest by looking at the post office list.
    g.ui.openPostOffice('quests');
    const btn = document.querySelector('[data-quest]');
    if (!btn) { g.ui.closePanel(); return { none: true, completed: g.save.quests.completed.length }; }
    const id = btn.getAttribute('data-quest');
    btn.click();
    g.ui.closeDialog();
    const active = g.save.quests.active.find((a) => a.id === id);
    if (!active) return { error: 'not accepted ' + id };
    // Express: fly through every ring.
    let rings = 0;
    if (g.rings.rings.length && g.expressQuest === id) {
      while (!g.rings.done && g.rings.rings.length) {
        const r = g.rings.rings[g.rings.next];
        const start = r.pos.clone().addScaledVector(r.normal, -8);
        const vel = r.normal.clone().multiplyScalar(26);
        g.player.startFlying(start, vel);
        g.debugAdvance(0.6);
        rings++;
        if (rings > 40) break;
      }
    }
    return { id, rings, type: g.save.quests.active.find((a) => a.id === id) ? 'active' : 'gone' };
  });
  if (step.none) { console.log('no more quests; completed', step.completed); break; }
  if (step.error) { console.log('ERR', step.error); break; }
  const deliver = await page.evaluate((id) => {
    const g = window.__game;
    const def = g.villagers.length && g.save.quests.active.find((a) => a.id === id);
    if (!def) return { error: 'quest vanished ' + id };
    // Find recipient via the quest definitions referenced by the HUD helper.
    const targets = g.questTargets().filter((t) => !t.ring);
    const recipient = g.villagers.find((v) => targets.some((t) => t.pos === v.pos));
    if (!recipient) return { error: 'no recipient for ' + id };
    if (recipient.def.nightOnly || id === 'q09' || id === 'q15' || id === 'q19') g.env.timeOfDay = 0.95;
    else g.env.timeOfDay = 0.45;
    g.env.update(0, recipient.pos);
    const p = recipient.pos.clone();
    p.x += 1.5;
    p.y = (recipient.island.surfaceY(p.x, p.z) ?? p.y);
    g.player.placeOnGround(p, 0);
    g.debugAdvance(0.3);
    g.interact();
    const txt = document.querySelector('#dialog .txt')?.textContent ?? '';
    const completed = g.save.quests.completed.includes(id);
    if (id !== 'q23') g.ui.dialogConfirm();
    return { id, completed, who: recipient.def.name, txt: txt.slice(0, 40), feathers: g.save.feathers, night: g.env.isNight() };
  }, step.id);
  console.log(JSON.stringify(step), JSON.stringify(deliver));
  if (deliver.error || !deliver.completed) break;
  done++;
  if (step.id === 'q04') await shot('p01-express-done');
  if (step.id === 'q09') await shot('p02-moonflower-night');
  if (step.id === 'q23') {
    await shot('p03-final-delivery');
    await page.evaluate(() => window.__game.ui.dialogConfirm());
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.__game.debugAdvance(4));
      if (i === 3) await page.waitForTimeout(3500);
      await shot(`p04-ending-${i}`);
    }
    const shown = await page.evaluate(() => window.__game.ui.endingShown && window.__game.state);
    console.log('ending shown/state:', shown);
    await page.click('[data-act=after-ending]');
    await page.waitForTimeout(500);
    console.log('after ending state:', await page.evaluate(() => window.__game.state + ' storm=' + window.__game.stormFactor));
    break;
  }
}
console.log('delivered', done, 'errors', errors.length);
for (const e of errors.slice(0, 10)) console.log(e.slice(0, 500));
await browser.close();
