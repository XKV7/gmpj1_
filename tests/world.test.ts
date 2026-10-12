import { describe, expect, it } from 'vitest';
import { generateWorld, seedFromString } from '../src/world/worldgen';

describe('world generation', () => {
  for (const seedText of ['바람', '42', 'windcourier']) {
    it(`builds a complete sky for seed "${seedText}"`, () => {
      const w = generateWorld(seedFromString(seedText));
      expect(w.islands.length).toBeGreaterThanOrEqual(25);
      const biomes = new Set(w.islands.map((i) => i.spec.biome));
      for (const b of ['meadow', 'cherry', 'canyon', 'alpine', 'ruins']) expect(biomes.has(b as never)).toBe(true);
      expect(w.villages.filter(Boolean).length).toBeGreaterThanOrEqual(6);
      expect(w.moon).toBeDefined();
      expect(w.sky).toBeDefined();
      expect(w.shards).toHaveLength(30);
      expect(w.races).toHaveLength(3);
      expect(w.rivers.length).toBeGreaterThanOrEqual(4);
      expect(w.storms.some((s) => s.kind === 'eye')).toBe(true);
      expect(w.bridges.length).toBeGreaterThan(0);
      expect(w.lighthouses.length).toBeGreaterThan(0);
      // World spans ~4-6 km.
      const xs = w.islands.map((i) => i.spec.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3000);
      // Unique names, no island overlaps.
      expect(new Set(w.islands.map((i) => i.spec.name)).size).toBe(w.islands.length);
      for (let a = 0; a < w.islands.length; a++) {
        for (let b = a + 1; b < w.islands.length; b++) {
          const A = w.islands[a].spec, B = w.islands[b].spec;
          expect(Math.hypot(A.x - B.x, A.z - B.z)).toBeGreaterThan((A.radius + B.radius) * 0.9);
        }
      }
      // Islands float well above the cloud sea and have hanging rock roots.
      for (const I of w.islands) {
        expect(I.spec.y + I.minBottom).toBeGreaterThan(0);
        expect(I.minBottom).toBeLessThan(-I.spec.radius * 0.3);
      }
      // Race rings are never buried in rock.
      for (const r of w.races) {
        for (const p of r.rings) {
          for (const I of w.islands) {
            const top = I.surfaceY(p.x, p.z);
            const bot = I.bottomY(p.x, p.z);
            if (top !== null && bot !== null) expect(p.y > top || p.y < bot).toBe(true);
          }
        }
      }
    });
  }

  it('is deterministic for the same seed', () => {
    const a = generateWorld(1234);
    const b = generateWorld(1234);
    expect(a.islands.map((i) => [i.spec.x, i.spec.z, i.spec.name])).toEqual(b.islands.map((i) => [i.spec.x, i.spec.z, i.spec.name]));
  });
});
