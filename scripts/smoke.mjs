// Headless smoke test: title → new game → walk → take off → fly → map → time of day.
// Collects console errors and screenshots. Software WebGL is slow, so the simulation is
// advanced with the game's debugAdvance() hook while keys are held.
// Usage: node scripts/smoke.mjs [url] [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'screenshots';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const adv = (s) => page.evaluate((x) => window.__game.debugAdvance(x), s);
const state = () => page.evaluate(() => { const g = window.__game; const p = g.player.position; return `${g.state} ${g.player.mode} pos=${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} v=${g.player.velocity.length().toFixed(1)}`; });

await page.goto(url);
await page.waitForSelector('#title:not(.hidden)', { timeout: 240000 });
await page.waitForTimeout(2000);
await shot('01-title');
await page.click('[data-act=new]');
await page.waitForTimeout(1500);
await shot('02-start');
await page.keyboard.press('KeyE');
await page.keyboard.down('KeyW'); await adv(1.5); await page.keyboard.up('KeyW');
console.log('walk', await state());
await shot('03-walk');
await page.keyboard.press('KeyF');
await adv(1.5);
console.log('takeoff', await state());
await shot('04-takeoff');
await page.keyboard.down('KeyD'); await adv(0.6); await page.keyboard.up('KeyD');
await adv(3);
console.log('fly', await state());
await shot('05-flying');
await page.keyboard.down('ShiftLeft'); await adv(2.5);
console.log('dive', await state());
await shot('06-dive');
await page.keyboard.up('ShiftLeft');
await page.keyboard.down('KeyS'); await adv(1.2); await page.keyboard.up('KeyS');
await adv(1);
console.log('pullup', await state());
await shot('07-pullup');
await page.keyboard.press('KeyV'); await adv(0.3);
await shot('08-firstperson');
await page.keyboard.press('KeyV'); await adv(0.3);
await page.keyboard.press('KeyM');
await page.waitForTimeout(800);
await shot('09-map');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
for (const [t, name] of [[0.265, '10-dawn'], [0.5, '11-noon'], [0.74, '12-sunset'], [0.93, '13-night']]) {
  await page.evaluate((tt) => { window.__game.env.timeOfDay = tt; }, t);
  await adv(0.2);
  await shot(name);
}
await page.keyboard.press('F3');
await shot('14-debug');
console.log('ERRORS:', errors.length);
for (const e of errors.slice(0, 20)) console.log(e.slice(0, 800));
await browser.close();
process.exit(errors.filter((e) => e.startsWith('[error]') || e.startsWith('[pageerror]')).length ? 1 : 0);
