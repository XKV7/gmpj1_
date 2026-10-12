import { describe, expect, it } from 'vitest';
import { QUESTS, NPC_BY_ID } from '../src/game/data';
import {
  QuestProgress, acceptQuest, availableQuests, canDeliver, damageCargo, deliver, emptyProgress, gDamage, isUnlocked, landingDamage, massFactor, passRing, tickQuests,
} from '../src/game/questLogic';

describe('quest data', () => {
  it('has at least 20 quests with valid recipients and all delivery types', () => {
    expect(QUESTS.length).toBeGreaterThanOrEqual(20);
    for (const q of QUESTS) expect(NPC_BY_ID[q.recipient]).toBeDefined();
    const types = new Set(QUESTS.map((q) => q.type));
    for (const t of ['normal', 'express', 'fragile', 'heavy', 'night', 'final']) expect(types.has(t as never)).toBe(true);
    expect(QUESTS[QUESTS.length - 1].type).toBe('final');
    for (const q of QUESTS.filter((q) => q.type === 'express')) expect(q.timeLimit).toBeGreaterThan(0);
  });
});

describe('quest logic', () => {
  it('unlocks quests sequentially, limited by capacity', () => {
    const p = emptyProgress();
    expect(availableQuests(QUESTS, p, 1).map((q) => q.id)).toEqual(['q01']);
    expect(availableQuests(QUESTS, p, 2).map((q) => q.id)).toEqual(['q01', 'q02']);
    expect(acceptQuest(QUESTS, p, 'q03', 1).ok).toBe(false);
    expect(acceptQuest(QUESTS, p, 'q01', 1).ok).toBe(true);
    expect(availableQuests(QUESTS, p, 1)).toEqual([]);
    expect(acceptQuest(QUESTS, p, 'q02', 1).reason).toBe('화물 칸이 가득 찼어요');
  });

  it('delivers to the right recipient only and pays rewards', () => {
    const p = emptyProgress();
    acceptQuest(QUESTS, p, 'q01', 1);
    expect(deliver(QUESTS, p, 'q01', 'dandan', false).ok).toBe(false);
    const r = deliver(QUESTS, p, 'q01', 'bomi', false);
    expect(r.ok).toBe(true);
    expect(r.reward).toBe(20);
    expect(p.completed).toContain('q01');
    expect(p.active).toHaveLength(0);
    expect(availableQuests(QUESTS, p, 1)[0].id).toBe('q02');
  });

  it('express quests need every ring and fail on timeout', () => {
    const p = { completed: ['q01', 'q02', 'q03'], active: [] };
    expect(acceptQuest(QUESTS, p, 'q04', 1, 3).ok).toBe(true);
    expect(canDeliver(QUESTS, p, 'q04', 'bomi', false).ok).toBe(false);
    passRing(p, 'q04');
    passRing(p, 'q04');
    passRing(p, 'q04');
    expect(passRing(p, 'q04')).toBe(false);
    expect(canDeliver(QUESTS, p, 'q04', 'bomi', false).ok).toBe(true);
    const r = deliver(QUESTS, p, 'q04', 'bomi', false);
    expect(r.reward).toBeGreaterThan(35); // time bonus

    const p2 = { completed: ['q01', 'q02', 'q03'], active: [] };
    acceptQuest(QUESTS, p2, 'q04', 1, 3);
    expect(tickQuests(p2, 60)).toEqual([]);
    expect(tickQuests(p2, 61)).toEqual(['q04']);
    expect(p2.active).toHaveLength(0);
  });

  it('fragile cargo takes damage and breaks', () => {
    const p: QuestProgress = { completed: ['q01', 'q02', 'q03', 'q04'], active: [] };
    acceptQuest(QUESTS, p, 'q05', 1);
    expect(landingDamage(2)).toBe(0);
    expect(landingDamage(6)).toBeGreaterThan(20);
    expect(gDamage(1.5, 1)).toBe(0);
    expect(gDamage(4, 1)).toBeGreaterThan(20);
    expect(damageCargo(QUESTS, p, 40)).toEqual([]);
    const r = deliver(QUESTS, { ...p, active: p.active.map((a) => ({ ...a })) }, 'q05', 'noeul', false);
    expect(r.reward).toBe(Math.round(40 * (0.5 + 0.5 * 0.6)));
    expect(damageCargo(QUESTS, p, 70)).toEqual(['q05']);
    expect(p.active).toHaveLength(0);
  });

  it('heavy cargo increases mass and night letters need the night', () => {
    const p = { completed: QUESTS.slice(0, 8).map((q) => q.id), active: [] };
    acceptQuest(QUESTS, p, 'q09', 1);
    expect(canDeliver(QUESTS, p, 'q09', 'eunbit', false).ok).toBe(false);
    expect(canDeliver(QUESTS, p, 'q09', 'eunbit', true).ok).toBe(true);
    const p2 = { completed: ['q01', 'q02'], active: [] };
    acceptQuest(QUESTS, p2, 'q03', 1);
    expect(massFactor(QUESTS, p2)).toBeGreaterThan(1.3);
  });

  it('the final letter unlocks only after every other delivery', () => {
    const allButLast = QUESTS.slice(0, -1).map((q) => q.id);
    const p = { completed: allButLast.slice(0, -1), active: [{ id: allButLast[allButLast.length - 1], integrity: 100, timeLeft: 50, ringIndex: 0, ringsTotal: 3 }] };
    expect(isUnlocked(QUESTS, p, 'q23')).toBe(false);
    const p2 = { completed: allButLast, active: [] };
    expect(isUnlocked(QUESTS, p2, 'q23')).toBe(true);
    expect(availableQuests(QUESTS, p2, 1)[0].id).toBe('q23');
  });
});
