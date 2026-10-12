import { loadJSON, removeKey, saveJSON } from '../core/save';
import { emptyProgress, QuestProgress } from './questLogic';

export type UpgradeKey = 'lift' | 'speed' | 'stall' | 'cargo';

export interface UpgradeDef {
  key: UpgradeKey;
  name: string;
  desc: string;
  max: number;
  costs: number[];
}

export const UPGRADES: UpgradeDef[] = [
  { key: 'lift', name: '양력 강화', desc: '날개 천을 팽팽하게 — 더 적게 가라앉고 상승기류에서 더 빨리 오릅니다.', max: 3, costs: [40, 90, 160] },
  { key: 'speed', name: '최대 속도', desc: '유선형 뼈대 — 급강하와 바람 강에서 더 빨라집니다.', max: 3, costs: [40, 90, 160] },
  { key: 'stall', name: '실속 저항', desc: '날개 끝 슬롯 — 느린 속도에서도 실속하지 않습니다.', max: 3, costs: [35, 80, 140] },
  { key: 'cargo', name: '화물 칸', desc: '가방 확장 — 의뢰를 동시에 더 많이 받을 수 있습니다.', max: 2, costs: [60, 140] },
];

export interface ColorOption {
  name: string;
  primary: number;
  secondary: number;
  cost: number;
}

export const COLORS: ColorOption[] = [
  { name: '구름 흰색', primary: 0xf4f1ea, secondary: 0xd9665c, cost: 0 },
  { name: '하늘 파랑', primary: 0x9cc7f0, secondary: 0xffffff, cost: 15 },
  { name: '벚꽃 분홍', primary: 0xffc4dc, secondary: 0xffffff, cost: 15 },
  { name: '들풀 초록', primary: 0xa4d77c, secondary: 0xfff1a0, cost: 15 },
  { name: '노을 주황', primary: 0xffb070, secondary: 0x7a4f8f, cost: 25 },
  { name: '라벤더', primary: 0xc8b4f0, secondary: 0xfff4f0, cost: 25 },
  { name: '우체국 빨강', primary: 0xe0574f, secondary: 0xffe27a, cost: 30 },
  { name: '밤하늘 남색', primary: 0x3d4a7a, secondary: 0xffe9a8, cost: 35 },
  { name: '레몬', primary: 0xfff1a0, secondary: 0x6f8fc9, cost: 30 },
  { name: '민트', primary: 0xa8e6d4, secondary: 0x4f6fa8, cost: 30 },
];

export interface PatternOption {
  name: string;
  cost: number;
  shards: number; // shards required
}

export const PATTERNS: PatternOption[] = [
  { name: '단색', cost: 0, shards: 0 },
  { name: '줄무늬', cost: 0, shards: 0 },
  { name: '쉐브론', cost: 20, shards: 0 },
  { name: '물방울', cost: 20, shards: 0 },
  { name: '노을빛', cost: 25, shards: 0 },
  { name: '깃털', cost: 30, shards: 0 },
  { name: '별자리', cost: 30, shards: 10 },
  { name: '체크', cost: 25, shards: 0 },
  { name: '물결', cost: 25, shards: 0 },
  { name: '바람 날개', cost: 0, shards: 30 },
];

export interface SaveData {
  version: 1;
  feathers: number;
  upgrades: Record<UpgradeKey, number>;
  ownedColors: number[];
  ownedPatterns: number[];
  color: number;
  pattern: number;
  shards: number[];
  raceBest: (number | null)[];
  maxAltitude: number;
  maxSpeed: number;
  discovered: number[];
  quests: QuestProgress;
  timeOfDay: number;
  player: [number, number, number] | null;
  ended: boolean;
  playTime: number;
  deliveries: number;
}

const KEY = 'windcourier.save.v1';

export function newSave(): SaveData {
  return {
    version: 1,
    feathers: 0,
    upgrades: { lift: 0, speed: 0, stall: 0, cargo: 0 },
    ownedColors: [0],
    ownedPatterns: [0, 1],
    color: 0,
    pattern: 1,
    shards: [],
    raceBest: [null, null, null],
    maxAltitude: 0,
    maxSpeed: 0,
    discovered: [],
    quests: emptyProgress(),
    timeOfDay: 0.3,
    player: null,
    ended: false,
    playTime: 0,
    deliveries: 0,
  };
}

export function hasSave(): boolean {
  return loadJSON<SaveData>(KEY) !== null;
}

export function loadSave(): SaveData | null {
  const d = loadJSON<Partial<SaveData>>(KEY);
  if (!d || d.version !== 1) return null;
  const base = newSave();
  return { ...base, ...d, upgrades: { ...base.upgrades, ...(d.upgrades ?? {}) }, quests: d.quests ?? base.quests } as SaveData;
}

export function writeSave(d: SaveData): boolean {
  return saveJSON(KEY, d);
}

export function clearSave(): void {
  removeKey(KEY);
}

export function cargoCapacity(d: SaveData): number {
  return 1 + d.upgrades.cargo;
}

export function upgradeCost(d: SaveData, key: UpgradeKey): number | null {
  const def = UPGRADES.find((u) => u.key === key);
  if (!def) return null;
  const lvl = d.upgrades[key];
  if (lvl >= def.max) return null;
  return def.costs[lvl];
}

export function buyUpgrade(d: SaveData, key: UpgradeKey): boolean {
  const c = upgradeCost(d, key);
  if (c === null || d.feathers < c) return false;
  d.feathers -= c;
  d.upgrades[key]++;
  return true;
}

export function patternUnlocked(d: SaveData, i: number): boolean {
  return d.shards.length >= PATTERNS[i].shards;
}

export function buyColor(d: SaveData, i: number): boolean {
  if (d.ownedColors.includes(i)) { d.color = i; return true; }
  const c = COLORS[i];
  if (!c || d.feathers < c.cost) return false;
  d.feathers -= c.cost;
  d.ownedColors.push(i);
  d.color = i;
  return true;
}

export function buyPattern(d: SaveData, i: number): boolean {
  const p = PATTERNS[i];
  if (!p || !patternUnlocked(d, i)) return false;
  if (d.ownedPatterns.includes(i)) { d.pattern = i; return true; }
  if (d.feathers < p.cost) return false;
  d.feathers -= p.cost;
  d.ownedPatterns.push(i);
  d.pattern = i;
  return true;
}
