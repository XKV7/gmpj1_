import { loadJSON, saveJSON } from './save';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  mouseSensitivity: number; // 0.2 .. 3
  invertY: boolean;
  masterVolume: number; // 0..1
  musicVolume: number;
  sfxVolume: number;
  seed: string;
  controlMode: 'easy' | 'classic';
}

const KEY = 'windcourier.settings.v1';

export const defaultSettings = (): Settings => ({
  quality: 'medium',
  mouseSensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  seed: '바람',
  controlMode: 'easy',
});

export function loadSettings(): Settings {
  const s = loadJSON<Partial<Settings>>(KEY);
  return { ...defaultSettings(), ...(s ?? {}) };
}

export function storeSettings(s: Settings): void {
  saveJSON(KEY, s);
}

export interface QualityProfile {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  radialSamples: number;
  grassDensity: number;
  propDistance: number;
  cloudPuffs: number;
  cloudLayers: number;
  lodDistance: number;
}

export function qualityProfile(q: Quality): QualityProfile {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  switch (q) {
    case 'low':
      return { pixelRatio: Math.min(dpr, 0.85), shadows: false, shadowMapSize: 512, bloom: false, radialSamples: 0, grassDensity: 0.35, propDistance: 420, cloudPuffs: 0.45, cloudLayers: 2, lodDistance: 600 };
    case 'high':
      return { pixelRatio: Math.min(dpr, 1.5), shadows: true, shadowMapSize: 2048, bloom: true, radialSamples: 8, grassDensity: 1, propDistance: 950, cloudPuffs: 1, cloudLayers: 3, lodDistance: 1300 };
    default:
      return { pixelRatio: Math.min(dpr, 1), shadows: true, shadowMapSize: 1024, bloom: true, radialSamples: 5, grassDensity: 0.65, propDistance: 650, cloudPuffs: 0.75, cloudLayers: 3, lodDistance: 900 };
  }
}
