/** Pure quest state machine (no rendering / DOM). */

export type QuestType = 'normal' | 'express' | 'fragile' | 'heavy' | 'night' | 'final';

export interface QuestDef {
  id: string;
  title: string;
  type: QuestType;
  recipient: string;
  cargo: string;
  reward: number;
  timeLimit?: number;
  briefing: string;
  thanks: string;
}

export interface ActiveQuest {
  id: string;
  integrity: number; // fragile: 0..100
  timeLeft: number | null; // express
  ringIndex: number;
  ringsTotal: number;
}

export interface QuestProgress {
  completed: string[];
  active: ActiveQuest[];
}

export const TYPE_LABEL: Record<QuestType, string> = {
  normal: '일반 편지',
  express: '급송',
  fragile: '깨지기 쉬움',
  heavy: '무거운 화물',
  night: '야간 배달',
  final: '마지막 편지',
};

export function emptyProgress(): QuestProgress {
  return { completed: [], active: [] };
}

export function isUnlocked(defs: QuestDef[], p: QuestProgress, id: string, capacity = 1): boolean {
  const def = defs.find((d) => d.id === id);
  if (!def) return false;
  if (def.type === 'final') return defs.every((d) => d.type === 'final' || p.completed.includes(d.id));
  const pending = defs.filter((d) => !p.completed.includes(d.id));
  const idx = pending.findIndex((d) => d.id === id);
  return idx >= 0 && idx < Math.max(1, capacity);
}

/** Quests that can be taken right now: the first `capacity` unfinished quests in order (sequential unlock). */
export function availableQuests(defs: QuestDef[], p: QuestProgress, capacity: number): QuestDef[] {
  const free = capacity - p.active.length;
  if (free <= 0) return [];
  return defs
    .filter((d) => !p.completed.includes(d.id))
    .slice(0, Math.max(1, capacity))
    .filter((d) => !p.active.some((a) => a.id === d.id) && isUnlocked(defs, p, d.id, capacity))
    .slice(0, free);
}

export interface AcceptResult {
  ok: boolean;
  reason?: string;
}

export function acceptQuest(defs: QuestDef[], p: QuestProgress, id: string, capacity: number, ringsTotal = 0): AcceptResult {
  const def = defs.find((d) => d.id === id);
  if (!def) return { ok: false, reason: '알 수 없는 의뢰' };
  if (p.completed.includes(id)) return { ok: false, reason: '이미 완료한 의뢰' };
  if (p.active.some((a) => a.id === id)) return { ok: false, reason: '이미 받은 의뢰' };
  if (p.active.length >= capacity) return { ok: false, reason: '화물 칸이 가득 찼어요' };
  if (!availableQuests(defs, p, capacity).some((d) => d.id === id)) return { ok: false, reason: '아직 받을 수 없는 의뢰' };
  if (def.type === 'heavy' && p.active.some((a) => defs.find((d) => d.id === a.id)?.type === 'heavy')) {
    return { ok: false, reason: '무거운 화물은 한 번에 하나만' };
  }
  p.active.push({
    id,
    integrity: 100,
    timeLeft: def.type === 'express' ? def.timeLimit ?? 120 : null,
    ringIndex: 0,
    ringsTotal: def.type === 'express' ? ringsTotal : 0,
  });
  return { ok: true };
}

export function findActive(p: QuestProgress, id: string): ActiveQuest | undefined {
  return p.active.find((a) => a.id === id);
}

/** Advances timers. Returns ids of quests that just failed. */
export function tickQuests(p: QuestProgress, dt: number): string[] {
  const failed: string[] = [];
  for (const a of p.active) {
    if (a.timeLeft !== null) {
      a.timeLeft -= dt;
      if (a.timeLeft <= 0) failed.push(a.id);
    }
  }
  for (const id of failed) failQuest(p, id);
  return failed;
}

/** Fragile cargo damage. Returns true if the cargo broke (quest failed). */
export function damageCargo(defs: QuestDef[], p: QuestProgress, amount: number): string[] {
  const broke: string[] = [];
  for (const a of p.active) {
    const d = defs.find((x) => x.id === a.id);
    if (!d || d.type !== 'fragile') continue;
    a.integrity = Math.max(0, a.integrity - amount);
    if (a.integrity <= 0) broke.push(a.id);
  }
  for (const id of broke) failQuest(p, id);
  return broke;
}

/** Fragile damage from a landing impact speed (m/s, vertical) */
export function landingDamage(vSink: number): number {
  return Math.max(0, vSink - 2.5) * 9;
}

/** Fragile damage from sustained g-load. */
export function gDamage(g: number, dt: number): number {
  return Math.max(0, g - 2.3) * 22 * dt;
}

export function passRing(p: QuestProgress, id: string): boolean {
  const a = findActive(p, id);
  if (!a || a.ringIndex >= a.ringsTotal) return false;
  a.ringIndex++;
  return true;
}

export interface DeliverCheck {
  ok: boolean;
  reason?: string;
}

export function canDeliver(defs: QuestDef[], p: QuestProgress, id: string, npcId: string, isNight: boolean): DeliverCheck {
  const def = defs.find((d) => d.id === id);
  const a = findActive(p, id);
  if (!def || !a) return { ok: false, reason: '받은 의뢰가 아니에요' };
  if (def.recipient !== npcId) return { ok: false, reason: '받는 사람이 달라요' };
  if (def.type === 'night' && !isNight) return { ok: false, reason: '밤에만 받을 수 있는 편지예요' };
  if (def.type === 'express' && a.ringIndex < a.ringsTotal) return { ok: false, reason: '아직 지나지 않은 링이 있어요' };
  return { ok: true };
}

export function deliver(defs: QuestDef[], p: QuestProgress, id: string, npcId: string, isNight: boolean): { ok: boolean; reward: number; reason?: string } {
  const c = canDeliver(defs, p, id, npcId, isNight);
  if (!c.ok) return { ok: false, reward: 0, reason: c.reason };
  const def = defs.find((d) => d.id === id) as QuestDef;
  const a = findActive(p, id) as ActiveQuest;
  let reward = def.reward;
  if (def.type === 'fragile') reward = Math.round(reward * (0.5 + 0.5 * (a.integrity / 100)));
  if (def.type === 'express' && a.timeLeft !== null && def.timeLimit) reward += Math.round((a.timeLeft / def.timeLimit) * def.reward * 0.5);
  p.active = p.active.filter((x) => x.id !== id);
  p.completed.push(id);
  return { ok: true, reward };
}

export function failQuest(p: QuestProgress, id: string): void {
  p.active = p.active.filter((a) => a.id !== id);
}

export function massFactor(defs: QuestDef[], p: QuestProgress): number {
  let m = 1;
  for (const a of p.active) if (defs.find((d) => d.id === a.id)?.type === 'heavy') m += 0.45;
  return m;
}
