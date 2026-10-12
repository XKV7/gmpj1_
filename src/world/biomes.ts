import * as THREE from 'three';

export type Biome = 'meadow' | 'cherry' | 'canyon' | 'alpine' | 'ruins' | 'moonflower' | 'sky';

export interface Palette {
  grassA: THREE.Color;
  grassB: THREE.Color;
  dirt: THREE.Color;
  cliff: THREE.Color;
  rockTop: THREE.Color;
  rockBottom: THREE.Color;
  band: THREE.Color;
  bladeTint: THREE.Color;
  flowers: THREE.Color[];
  rock: THREE.Color;
  thermal: THREE.Color;
}

const c = (h: number): THREE.Color => new THREE.Color(h);

export const PALETTES: Record<Biome, Palette> = {
  meadow: {
    grassA: c(0x9fd27a), grassB: c(0x78b862), dirt: c(0xc7a774), cliff: c(0xb48c66), rockTop: c(0x9b8a8f), rockBottom: c(0x5f5876),
    band: c(0xc29a73), bladeTint: c(0xa4d77c), flowers: [c(0xffffff), c(0xffe27a), c(0xff9fb5), c(0xb8a6ff)], rock: c(0xb3abaa), thermal: c(0xfff3c4),
  },
  cherry: {
    grassA: c(0xb7de8f), grassB: c(0x95ca7f), dirt: c(0xd2a98a), cliff: c(0xc59a82), rockTop: c(0xa08c98), rockBottom: c(0x66587a),
    band: c(0xd7aa96), bladeTint: c(0xb5e08e), flowers: [c(0xffc4dc), c(0xffe0ec), c(0xffffff)], rock: c(0xc0b1b6), thermal: c(0xffc1da),
  },
  canyon: {
    grassA: c(0xd8c27e), grassB: c(0xc4a868), dirt: c(0xe2ad78), cliff: c(0xd07e58), rockTop: c(0xb46a57), rockBottom: c(0x6c4558),
    band: c(0xe9b98a), bladeTint: c(0xd2c47c), flowers: [c(0xffb36b), c(0xfff0a8)], rock: c(0xd0896a), thermal: c(0xffd6a6),
  },
  alpine: {
    grassA: c(0x92c294), grassB: c(0x76a888), dirt: c(0xa79b8f), cliff: c(0x9a9aae), rockTop: c(0x8d91a8), rockBottom: c(0x535877),
    band: c(0xb4b6c8), bladeTint: c(0x98c69a), flowers: [c(0xffffff), c(0xa9c8ff)], rock: c(0xa8adbf), thermal: c(0xe6f2ff),
  },
  ruins: {
    grassA: c(0xb0cc8b), grassB: c(0x8fb57a), dirt: c(0xcfc2a5), cliff: c(0xbfb19a), rockTop: c(0xa59d9a), rockBottom: c(0x635e78),
    band: c(0xd6ccb4), bladeTint: c(0xa9cb85), flowers: [c(0xfff4b0), c(0xe7c6ff)], rock: c(0xd3cbb8), thermal: c(0xf7f0d0),
  },
  moonflower: {
    grassA: c(0x86b3b9), grassB: c(0x6f98a8), dirt: c(0x9fa0b8), cliff: c(0x8b88a8), rockTop: c(0x7c7c9e), rockBottom: c(0x46496e),
    band: c(0xa6a3c4), bladeTint: c(0x8cc0c4), flowers: [c(0xcfe6ff), c(0xe9d8ff)], rock: c(0x9a9cc0), thermal: c(0xd8e8ff),
  },
  sky: {
    grassA: c(0xa8cf91), grassB: c(0x8dbd86), dirt: c(0xd9d0bf), cliff: c(0xcfc6b6), rockTop: c(0xaaa2a8), rockBottom: c(0x5d5a7a),
    band: c(0xe4dccb), bladeTint: c(0xb0d695), flowers: [c(0xffffff), c(0xfff1a0)], rock: c(0xddd5c5), thermal: c(0xfff8dc),
  },
};

export const BIOME_LABEL: Record<Biome, string> = {
  meadow: '초원',
  cherry: '벚꽃 숲',
  canyon: '바위 협곡',
  alpine: '눈 덮인 고산',
  ruins: '폐허 유적',
  moonflower: '달꽃 들판',
  sky: '하늘등대',
};
