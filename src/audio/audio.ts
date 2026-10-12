/** Fully procedural WebAudio: wind, warnings, sfx, ambience and generative pentatonic music. */

export interface AudioFrame {
  airspeed: number;
  aoa: number;
  stall: number;
  flying: boolean;
  night: number; // 0..1
  nearLand: number; // 0..1
  storm: number; // 0..1
  inCloud: number;
  river: number;
  roll: number;
  paused: boolean;
}

const PENTA_MAJOR = [0, 2, 4, 7, 9];
const PENTA_MINOR = [0, 3, 5, 7, 10];

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private delay!: DelayNode;
  private noiseBuf!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windPan!: StereoPannerNode;
  private hissGain!: GainNode;
  private hissFilter!: BiquadFilterNode;
  private stormGain!: GainNode;
  private cricketGain!: GainNode;
  private stallTimer = 0;
  private birdTimer = 2;
  private nextNoteTime = 0;
  private step = 0;
  private chordIdx = 0;
  private padVoices: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private lastFrame: AudioFrame | null = null;
  volumes = { master: 0.8, music: 0.6, sfx: 0.8 };

  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 6000;
    this.musicBus.connect(this.musicFilter).connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);

    // Reverb from a generated impulse.
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb).connect(this.musicBus);
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2200;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(this.reverbSend);
    dlp.connect(this.musicBus);

    // Noise buffer.
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < nd.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + 0.03 * w;
      nd[i] = w * 0.6 + b0 * 3;
    }
    this.noiseBuf = nb;

    // Wind layers.
    const wind = this.noiseSource();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windPan = ctx.createStereoPanner();
    wind.connect(this.windFilter).connect(this.windGain).connect(this.windPan).connect(this.sfxBus);
    wind.start();
    const hiss = this.noiseSource();
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'highpass';
    this.hissFilter.frequency.value = 3000;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(this.hissFilter).connect(this.hissGain).connect(this.sfxBus);
    hiss.start();
    const storm = this.noiseSource();
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 400;
    this.stormGain = ctx.createGain();
    this.stormGain.gain.value = 0;
    storm.connect(sf).connect(this.stormGain).connect(this.ambBus);
    storm.start();

    // Crickets: AM-modulated high tone.
    const cr = ctx.createOscillator();
    cr.frequency.value = 4300;
    const crAm = ctx.createGain();
    crAm.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 28;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(crAm.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.9;
    const lfo2g = ctx.createGain();
    lfo2g.gain.value = 0.5;
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    lfo2.connect(lfo2g).connect(this.cricketGain.gain);
    cr.connect(crAm).connect(this.cricketGain).connect(this.ambBus);
    cr.start();
    lfo.start();
    lfo2.start();
    this.nextNoteTime = ctx.currentTime + 0.5;
    this.applyVolumes();
  }

  private noiseSource(): AudioBufferSourceNode {
    const ctx = this.ctx as AudioContext;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.volumes.sfx * 0.8, t, 0.05);
  }

  update(dt: number, f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.lastFrame = f;
    const t = ctx.currentTime;
    const sp = f.flying ? f.airspeed : 0;
    const k = Math.min(1, sp / 70);
    const pausedMul = f.paused ? 0.2 : 1;
    this.windGain.gain.setTargetAtTime((0.04 + k * k * 0.5 + f.inCloud * 0.08 + f.river * 0.12) * pausedMul * (f.flying ? 1 : 0.35), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + k * 2200 + Math.abs(f.aoa) * 1500, t, 0.1);
    this.windFilter.Q.value = 0.7 + f.stall * 2;
    this.windPan.pan.setTargetAtTime(Math.max(-0.6, Math.min(0.6, f.roll * 0.4)), t, 0.2);
    this.hissGain.gain.setTargetAtTime(Math.max(0, k - 0.45) * 0.25 * pausedMul, t, 0.15);
    this.stormGain.gain.setTargetAtTime(f.storm * 0.35 * pausedMul, t, 0.4);
    const cricket = f.night * f.nearLand * 0.035 * pausedMul;
    this.cricketGain.gain.setTargetAtTime(cricket, t, 0.5);
    this.musicFilter.frequency.setTargetAtTime(f.storm > 0.3 ? 900 : f.inCloud > 0.3 ? 1800 : 6000, t, 0.5);

    // Stall warning beeps.
    if (f.flying && f.stall > 0.35 && !f.paused) {
      this.stallTimer -= dt;
      if (this.stallTimer <= 0) {
        this.beep(f.stall > 0.75 ? 990 : 760, 0.09, 0.08);
        this.stallTimer = f.stall > 0.75 ? 0.18 : 0.32;
      }
    } else this.stallTimer = 0;

    // Day birds near land.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.5 + Math.random() * 4;
      if ((1 - f.night) * f.nearLand > 0.3 && !f.paused) this.chirp();
    }

    this.scheduleMusic(f);
  }

  private env(g: GainNode, t0: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  beep(freq: number, dur: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private chirp(): void {
    const ctx = this.ctx as AudioContext;
    const t0 = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 2000;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.ambBus);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.06);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + 0.04);
      o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.08);
      const g = ctx.createGain();
      this.env(g, t, 0.01, 0.025, 0.08);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  private noiseBurst(t: number, dur: number, filterType: BiquadFilterType, f0: number, f1: number, vol: number, dest?: AudioNode): void {
    const ctx = this.ctx as AudioContext;
    const s = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest ?? this.sfxBus);
    s.start(t);
    s.stop(t + dur + 0.1);
  }

  whoosh(): void {
    if (!this.ctx) return;
    this.noiseBurst(this.ctx.currentTime, 0.9, 'bandpass', 350, 3200, 0.5);
  }

  landing(soft: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(soft ? 110 : 80, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain();
    this.env(g, t, 0.01, soft ? 0.15 : 0.35, 0.3);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.4);
    this.noiseBurst(t, 0.35, 'lowpass', 1800, 300, soft ? 0.12 : 0.3);
  }

  crash(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.landing(false);
    this.noiseBurst(ctx.currentTime, 0.8, 'lowpass', 900, 100, 0.5);
    this.beep(220, 0.4, 0.05);
  }

  private bell(freq: number, t: number, vol: number, dur = 1.6, dest?: AudioNode): void {
    const ctx = this.ctx as AudioContext;
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    g.connect(dest ?? this.sfxBus);
    g.connect(this.reverbSend);
    for (const [mul, amp] of [[1, 1], [2.01, 0.35], [3.98, 0.12]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mul;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  jingle(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [72, 76, 79, 84, 88].forEach((m, i) => this.bell(mtof(m), t + i * 0.11, 0.12, 1.8));
    this.bell(mtof(91), t + 0.62, 0.08, 2.4);
  }

  feather(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.bell(mtof(96), t, 0.06, 0.6);
    this.bell(mtof(100), t + 0.07, 0.05, 0.8);
  }

  shard(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [79, 83, 86, 91, 95, 98].forEach((m, i) => this.bell(mtof(m), t + i * 0.06, 0.07, 1.2));
  }

  ring(n: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const scale = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93];
    this.bell(mtof(scale[n % scale.length]), ctx.currentTime, 0.1, 1.0);
  }

  click(): void {
    this.beep(1400, 0.03, 0.03);
  }

  fail(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [67, 63, 60].forEach((m, i) => this.bell(mtof(m), t + i * 0.18, 0.08, 1.0));
  }

  thunder(distance: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const delay = Math.min(4, distance / 340);
    const vol = Math.max(0.08, 0.6 - distance / 2500);
    const t = ctx.currentTime + delay;
    this.noiseBurst(t, 3.5, 'lowpass', 600, 60, vol, this.ambBus);
    this.noiseBurst(t + 0.05, 0.4, 'lowpass', 2500, 300, vol * 0.6, this.ambBus);
  }

  /* ------------------------- generative music ------------------------- */

  private scheduleMusic(f: AudioFrame): void {
    const ctx = this.ctx as AudioContext;
    const night = f.night;
    const bpm = 76 - night * 16;
    const eighth = 60 / bpm / 2;
    while (this.nextNoteTime < ctx.currentTime + 0.25) {
      const t = this.nextNoteTime;
      const minor = night > 0.5;
      const scale = minor ? PENTA_MINOR : PENTA_MAJOR;
      const root = minor ? 57 : 60; // A minor / C major
      if (this.step % 32 === 0) {
        const prog = minor ? [0, 3, 2, 4] : [0, 4, 2, 3];
        const deg = prog[this.chordIdx % prog.length];
        this.chordIdx++;
        this.playPad(t, root, scale, deg, night);
      }
      // Arpeggio: sparse, gentle.
      const density = 0.45 - night * 0.15 + (f.flying ? 0.1 : 0);
      if (this.step % 2 === 0 || Math.random() < 0.2) {
        if (Math.random() < density) {
          const deg = Math.floor(Math.random() * 7);
          const oct = Math.random() < 0.3 ? 24 : 12;
          const m = root + oct + scale[deg % 5] + (deg >= 5 ? 12 : 0);
          this.pluck(mtof(m), t, 0.05 + Math.random() * 0.03, night);
        }
      }
      // Soft low bass on bar starts.
      if (this.step % 16 === 0) this.pluck(mtof(root - 12 + scale[(this.chordIdx * 2) % 5]), t, 0.06, 1);
      this.step++;
      this.nextNoteTime += eighth;
    }
  }

  private pluck(freq: number, t: number, vol: number, softness: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    o.type = softness > 0.5 ? 'sine' : 'triangle';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3500 - softness * 1800, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.8);
    const g = ctx.createGain();
    this.env(g, t, 0.008, vol, 1.1);
    o.connect(f).connect(g);
    g.connect(this.musicBus);
    g.connect(this.delay);
    g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + 1.3);
  }

  private playPad(t: number, root: number, scale: number[], deg: number, night: number): void {
    const ctx = this.ctx as AudioContext;
    // Release previous voices.
    for (const v of this.padVoices) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0.0001, t, 1.2);
      for (const o of v.osc) o.stop(t + 6);
    }
    this.padVoices = [];
    const notes = [0, 2, 4].map((i) => {
      const idx = deg + i * 1;
      return root - 12 + scale[idx % 5] + Math.floor(idx / 5) * 12;
    });
    notes.push(notes[0] + 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setTargetAtTime(0.05, t, 1.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700 + (1 - night) * 600;
    f.Q.value = 0.5;
    f.connect(g);
    g.connect(this.musicBus);
    g.connect(this.reverbSend);
    const oscs: OscillatorNode[] = [];
    for (const m of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.18;
        o.connect(og).connect(f);
        o.start(t);
        oscs.push(o);
      }
    }
    this.padVoices.push({ osc: oscs, gain: g });
  }

  get frame(): AudioFrame | null {
    return this.lastFrame;
  }
}
