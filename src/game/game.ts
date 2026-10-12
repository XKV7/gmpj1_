import * as THREE from 'three';
import { Input, PAD } from '../core/input';
import { Settings, loadSettings, qualityProfile, storeSettings, QualityProfile } from '../core/settings';
import { clamp, damp, lerp, smoothstep, TAU } from '../core/math';
import { RNG } from '../core/rng';
import { PostPipeline } from '../render/post';
import { makeSky } from '../render/sky';
import { CloudPuffs, CloudSea } from '../render/clouds';
import { Environment } from '../render/environment';
import { G } from '../render/uniforms';
import { generateWorld, seedFromString, WorldData, HARD_LIMIT_R } from '../world/worldgen';
import { Island } from '../world/island';
import { WorldDecor, IslandDecor } from '../world/decor';
import { Bridges } from '../world/bridges';
import { WindSystem, makeWindSample, makeRiverStreaks, makeThermalVisuals, WindSample } from '../world/wind';
import { Person, animatePerson, makePerson } from '../world/characters';
import { PALETTES } from '../world/biomes';
import { Player, WorldQuery, Ground, Contact, PlayerEvent } from '../flight/player';
import { CameraRig } from '../flight/camera';
import { FlightInput, GliderParams, stallSpeedFor, maxLevelSpeedHint } from '../flight/physics';
import { RingSet } from './rings';
import { Collectibles, Birds, NpcGliders } from './life';
import { Trail, Streaks, Particles, Lightning } from '../fx/effects';
import { AudioEngine } from '../audio/audio';
import { UI, UIHost, HudData } from '../ui/ui';
import { drawMap } from '../ui/map';
import { NPCS, NPC_BY_ID, QUESTS, NpcDef, Home } from './data';
import {
  QuestDef, acceptQuest, availableQuests, canDeliver, damageCargo, deliver, findActive, gDamage, landingDamage, massFactor, passRing, tickQuests, failQuest,
} from './questLogic';
import {
  SaveData, buyColor, buyPattern, buyUpgrade, cargoCapacity, clearSave, hasSave, loadSave, newSave, writeSave, COLORS, UpgradeKey, UPGRADES,
} from './progress';

type GameState = 'loading' | 'title' | 'play' | 'paused' | 'photo' | 'ending';

interface Villager {
  def: NpcDef;
  person: Person;
  pos: THREE.Vector3;
  island: Island;
  phase: number;
  wave: number;
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export class Game implements UIHost {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  post: PostPipeline;
  scene = new THREE.Scene();
  rig: CameraRig;
  env: Environment;
  input: Input;
  audio = new AudioEngine();
  settings: Settings;
  profile: QualityProfile;
  ui: UI;
  save: SaveData = newSave();
  state: GameState = 'loading';

  world!: WorldData;
  islandLods: THREE.LOD[] = [];
  decor!: WorldDecor;
  bridges!: Bridges;
  wind!: WindSystem;
  windSample: WindSample = makeWindSample();
  cloudSea!: CloudSea;
  puffs!: CloudPuffs;
  sky!: THREE.Mesh;
  player = new Player();
  rings = new RingSet(64);
  gates = new RingSet(8);
  collect!: Collectibles;
  birds!: Birds;
  npcs!: NpcGliders;
  trailL = new Trail();
  trailR = new Trail();
  streaks = new Streaks(150);
  particles = new Particles(500);
  lightning = new Lightning();
  villagers: Villager[] = [];
  thermalVis!: THREE.Group;

  time = 0;
  private last = performance.now();
  private stick = new THREE.Vector2();
  private inCloud = 0;
  private lastRiver = -1;
  private lightningTimer = 3;
  private saveTimer = 0;
  private expressQuest: string | null = null;
  private race: { idx: number; time: number } | null = null;
  private raceCooldown = 0;
  private interactTarget: { kind: 'npc' | 'mailbox' | 'board'; villager?: Villager; decor?: IslandDecor } | null = null;
  private hudFade = false;
  private titleAngle = 0;
  private endingT = -1;
  private stormFactor = 1;
  private shotPending = false;
  private fps = 60;
  private prevPos = new THREE.Vector3();
  private prevRiverWind = new THREE.Vector3();
  private lastUnlockRequest = 0;
  private aimVec = new THREE.Vector3(0, 0, -1);
  private discoverTimer = 0;
  private tmpV = new THREE.Vector3();
  private stunShown = false;
  private flash = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.settings = loadSettings();
    this.profile = qualityProfile(this.settings.quality);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.autoClear = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.post = new PostPipeline(this.renderer);
    this.post.setBloom(this.profile.bloom);
    this.post.setRadialSamples(this.profile.radialSamples);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.env = new Environment(this.profile.shadows, this.profile.shadowMapSize);
    this.env.addTo(this.scene);
    this.input = new Input(canvas);
    this.ui = new UI(uiRoot, this);
    this.audio.setVolumes(this.settings.masterVolume, this.settings.musicVolume, this.settings.sfxVolume);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    canvas.addEventListener('click', () => {
      this.audio.start();
      if (this.state === 'play' && !this.ui.dialogOpen && !this.ui.panelOpen && !this.easyMode) this.input.requestLock();
    });
    uiRoot.addEventListener('pointerdown', () => this.audio.start());
    // Esc while the pointer is locked only releases the lock (no keydown reaches the page),
    // so treat an unexpected unlock during play as a pause request.
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) return;
      setTimeout(() => {
        if (this.state === 'play' && !this.ui.dialogOpen && !this.ui.panelOpen && performance.now() - this.lastUnlockRequest > 400) {
          this.state = 'paused';
          this.ui.openPause();
        }
      }, 50);
    });
    window.addEventListener('keydown', () => this.audio.start(), { once: true });
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.profile.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.profile.pixelRatio);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  /* ======================================================================= */
  /* Loading                                                                  */
  /* ======================================================================= */

  async init(): Promise<void> {
    const saved = loadSave();
    if (saved) this.save = saved;
    const seed = seedFromString(this.settings.seed);
    this.ui.setLoading(0.02, '바람의 지도를 펼치는 중…');
    await nextFrame();
    this.world = generateWorld(seed);
    this.ui.setLoading(0.08, '하늘을 칠하는 중…');
    await tick();

    this.sky = makeSky();
    this.scene.add(this.sky);
    this.cloudSea = new CloudSea(this.profile.cloudLayers);
    this.scene.add(this.cloudSea.group);
    const puffSpecs = this.world.puffs.filter((p, i) => p.dark > 0.5 || (i * 0.6180339) % 1 < this.profile.cloudPuffs);
    this.puffs = new CloudPuffs(puffSpecs);
    this.scene.add(this.puffs.mesh);

    // Islands.
    this.decor = new WorldDecor(this.world, this.profile.grassDensity);
    const n = this.world.islands.length;
    for (let i = 0; i < n; i++) {
      const I = this.world.islands[i];
      const lod = new THREE.LOD();
      const hi = new THREE.Mesh(I.buildGeometry('high'), this.decor.mats.island);
      hi.castShadow = true;
      hi.receiveShadow = true;
      const lo = new THREE.Mesh(I.buildGeometry('low'), this.decor.mats.island);
      lo.castShadow = false;
      lo.receiveShadow = true;
      lod.addLevel(hi, 0);
      lod.addLevel(lo, this.profile.lodDistance + I.spec.radius);
      lod.position.set(I.spec.x, I.spec.y, I.spec.z);
      lod.autoUpdate = true;
      this.scene.add(lod);
      this.islandLods.push(lod);
      const d = this.decor.decorate(I);
      this.scene.add(d.near, d.far);
      this.ui.setLoading(0.1 + 0.65 * ((i + 1) / n), `섬을 띄우는 중… (${i + 1}/${n}) ${I.spec.name}`);
      await tick();
    }
    this.scene.add(this.decor.buildDebris());
    this.ui.setLoading(0.8, '다리를 놓는 중…');
    await tick();
    this.bridges = new Bridges(this.world.bridges, this.decor.mats.solid);
    this.scene.add(this.bridges.group);

    this.ui.setLoading(0.85, '바람을 불어넣는 중…');
    await tick();
    this.wind = new WindSystem(this.world);
    this.scene.add(makeRiverStreaks(this.wind.rivers, this.settings.quality === 'low' ? 0.5 : 1));
    this.thermalVis = makeThermalVisuals(this.wind.thermals, this.settings.quality === 'low' ? 0.5 : this.settings.quality === 'high' ? 1.2 : 0.85);
    this.scene.add(this.thermalVis);

    this.ui.setLoading(0.9, '주민들을 깨우는 중…');
    await tick();
    this.spawnVillagers();
    this.collect = new Collectibles(this.world, this.save.shards);
    this.scene.add(this.collect.group);
    this.birds = new Birds(this.world);
    this.scene.add(this.birds.mesh);
    this.npcs = new NpcGliders(this.world);
    this.scene.add(this.npcs.group);
    this.scene.add(this.player.root, this.rings.mesh, this.gates.mesh, this.trailL.mesh, this.trailR.mesh, this.streaks.mesh, this.particles.points, this.lightning.group);
    this.applyLook();

    if (this.save.ended) this.setStormCleared(true);
    this.env.timeOfDay = 0.29;
    this.placeAtHub();

    // Warm up shaders.
    this.ui.setLoading(0.96, '물감을 섞는 중…');
    await nextFrame();
    this.env.update(0, this.player.position);
    this.rig.orbit(this.world.hub.center.add(new THREE.Vector3(0, 40, 0)), 280, 90, 0);
    this.renderer.compile(this.scene, this.rig.camera);
    this.ui.setLoading(1, '준비 완료');
    await nextFrame();
    this.ui.hideLoading();
    this.state = 'title';
    this.ui.showTitle(hasSave());
    this.last = performance.now();
    requestAnimationFrame(() => this.frame());
  }

  private spawnVillagers(): void {
    const homeIsland = (h: Home): Island => {
      if (h === 'hub') return this.world.hub;
      if (h === 'moon') return this.world.moon;
      if (h === 'sky') return this.world.sky;
      return this.world.villages[Number(h.slice(1))];
    };
    for (const def of NPCS) {
      const I = homeIsland(def.home);
      if (!I) continue;
      const d = this.decor.decors.find((x) => x.island === I);
      let pos = d?.villagerSpot?.clone() ?? I.center;
      if (def.extra && d?.extraSpots.length) pos = d.extraSpots[0].clone();
      pos.y = I.surfaceY(pos.x, pos.z) ?? pos.y;
      const person = makePerson(def.look);
      person.root.position.copy(pos);
      const c = I.center;
      person.root.rotation.y = Math.atan2(c.x - pos.x, c.z - pos.z) + Math.PI;
      this.scene.add(person.root);
      this.villagers.push({ def, person, pos, island: I, phase: Math.random() * 10, wave: 0 });
    }
  }

  applyLook(): void {
    const c = COLORS[this.save.color] ?? COLORS[0];
    this.player.glider.setLook({ primary: c.primary, secondary: c.secondary, pattern: this.save.pattern });
  }

  private placeAtHub(): void {
    const hub = this.world.hub;
    const d = this.decor.decors.find((x) => x.island === hub);
    const spot = (d?.villagerSpot ?? hub.center).clone().add(new THREE.Vector3(5, 0, 7));
    spot.y = hub.surfaceY(spot.x, spot.z) ?? hub.spec.y;
    // Face away from the post office (+Z) toward the open sky; camera behind (−Z side).
    this.player.placeOnGround(spot, 0);
    this.rig.yaw = Math.PI;
    this.rig.pitch = 0.22;
    this.rig.reset();
  }

  /* ======================================================================= */
  /* UIHost                                                                   */
  /* ======================================================================= */

  newGame(): void {
    clearSave();
    this.save = newSave();
    this.collect.collected.clear();
    this.setStormCleared(false);
    this.applyLook();
    this.env.timeOfDay = 0.3;
    this.placeAtHub();
    this.startPlay();
    setTimeout(() => {
      const d = NPC_BY_ID.dodam;
      this.ui.dialog(d.name, d.title, '어서 오렴, 새 배달부야! 바람마루 우체국에 온 걸 환영한다. 게시판(또는 나)에게 다가와 E를 누르면 의뢰를 받을 수 있단다. 섬 끝에서 뛰어내리거나 F를 누르면 날아오를 수 있지.', [{ label: '알겠어요!', primary: true, cb: () => this.ui.closeDialog() }]);
    }, 600);
  }

  continueGame(): void {
    const s = loadSave();
    if (s) this.save = s;
    this.collect.collected = new Set(this.save.shards);
    this.applyLook();
    this.setStormCleared(this.save.ended);
    this.env.timeOfDay = this.save.timeOfDay;
    if (this.save.player) {
      const p = new THREE.Vector3(...this.save.player);
      const g = this.groundBelow(p.x, p.y + 2, p.z);
      if (g) this.player.placeOnGround(new THREE.Vector3(p.x, g.y, p.z));
      else this.placeAtHub();
    } else this.placeAtHub();
    this.startPlay();
    this.ui.toast('이어서 날아 볼까요?', 'blue');
  }

  private startPlay(): void {
    this.ui.hideTitle();
    this.ui.closePanel();
    this.ui.showHud(true);
    this.state = 'play';
    this.rig.reset();
    this.audio.start();
    this.expressQuest = null;
    this.rings.clear();
    this.restoreExpressRings();
    this.updateGates();
    if (!this.easyMode) this.input.requestLock();
  }

  getSettings(): Settings {
    return this.settings;
  }

  getSave(): SaveData {
    return this.save;
  }

  applySettings(s: Settings, reloadWorld: boolean): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    storeSettings(s);
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    if (qualityChanged) {
      this.profile = qualityProfile(s.quality);
      this.post.setBloom(this.profile.bloom);
      this.post.setRadialSamples(this.profile.radialSamples);
      this.env.setShadows(this.profile.shadows, this.profile.shadowMapSize);
      for (const lod of this.islandLods) {
        const lv = lod.levels[1];
        if (lv) lv.distance = this.profile.lodDistance;
      }
      this.resize();
    }
    if (reloadWorld) {
      this.save.player = null;
      writeSave(this.save);
      window.location.reload();
    }
  }

  acceptQuest(id: string): void {
    const def = QUESTS.find((q) => q.id === id);
    if (!def) return;
    if (def.type === 'express' && this.race) this.race = null;
    let ringsTotal = 0;
    let points: THREE.Vector3[] = [];
    if (def.type === 'express') {
      if (this.expressQuest) {
        this.ui.toast('급송은 한 번에 하나만 들 수 있어요', 'bad');
        return;
      }
      points = this.expressRoute(def);
      ringsTotal = points.length;
    }
    const r = acceptQuest(QUESTS, this.save.quests, id, cargoCapacity(this.save), ringsTotal);
    if (!r.ok) {
      this.ui.toast(r.reason ?? '받을 수 없어요', 'bad');
      return;
    }
    const a = findActive(this.save.quests, id);
    if (a && def.type === 'express') {
      const dist = points.reduce((acc, p, i) => acc + (i ? p.distanceTo(points[i - 1]) : 0), 0);
      a.timeLeft = Math.max(def.timeLimit ?? 120, dist / 17 + 45);
      this.expressQuest = id;
      this.rings.set(points, 0xffd35a, 10);
    }
    this.audio.feather();
    this.ui.closePanel();
    const npc = NPC_BY_ID[def.recipient];
    this.ui.dialog('도담', '바람마루 우체국장', def.briefing, [{ label: '다녀올게요!', primary: true, cb: () => { this.ui.closeDialog(); } }]);
    this.ui.toast(`의뢰 수락 · ${def.title} → ${npc.name}`, 'gold');
    this.persist();
  }

  private expressRoute(def: QuestDef): THREE.Vector3[] {
    const v = this.villagers.find((x) => x.def.id === def.recipient);
    const hub = this.world.hub;
    const start = hub.center.add(new THREE.Vector3(0, hub.maxTop + 45, 0));
    const end = v ? v.pos.clone().add(new THREE.Vector3(0, 30, 0)) : start.clone();
    const dist = start.distanceTo(end);
    const n = clamp(Math.round(dist / 140), 4, 14);
    const side = new THREE.Vector3(end.z - start.z, 0, start.x - end.x).normalize();
    const rng = new RNG(QUESTS.indexOf(def) * 977 + this.world.seed);
    const pts: THREE.Vector3[] = [];
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 0.6);
      const p = start.clone().lerp(end, t);
      p.addScaledVector(side, Math.sin(t * Math.PI * 2) * 60 + rng.range(-20, 20));
      // Gentle arc: high in the middle so it's flyable as a glide.
      p.y = lerp(start.y, end.y, t) + Math.sin(t * Math.PI) * 25 - t * 10;
      for (const I of this.world.islands) {
        const top = I.surfaceY(p.x, p.z, 25);
        const bot = I.bottomY(p.x, p.z);
        if (top !== null && p.y < top + 22 && (bot === null || p.y > bot - 30)) p.y = top + 24;
      }
      pts.push(p);
    }
    return pts;
  }

  private restoreExpressRings(): void {
    const a = this.save.quests.active.find((x) => QUESTS.find((q) => q.id === x.id)?.type === 'express');
    if (!a) return;
    const def = QUESTS.find((q) => q.id === a.id) as QuestDef;
    const pts = this.expressRoute(def);
    this.rings.set(pts, 0xffd35a, 10);
    this.rings.next = Math.min(a.ringIndex, pts.length);
    a.ringsTotal = pts.length;
    this.expressQuest = a.id;
    this.rings.refresh();
  }

  buyUpgrade(k: UpgradeKey): void {
    if (buyUpgrade(this.save, k)) {
      this.audio.jingle();
      this.ui.toast(`${UPGRADES.find((u) => u.key === k)?.name} 레벨 ${this.save.upgrades[k]}!`, 'gold');
      this.persist();
    } else this.ui.toast('깃털이 부족해요', 'bad');
  }

  buyColor(i: number): void {
    if (buyColor(this.save, i)) {
      this.applyLook();
      this.audio.feather();
      this.persist();
    } else this.ui.toast('깃털이 부족해요', 'bad');
  }

  buyPattern(i: number): void {
    if (buyPattern(this.save, i)) {
      this.applyLook();
      this.audio.feather();
      this.persist();
    } else this.ui.toast(this.save.shards.length < 30 && i === 9 ? '바람 조각 30개를 모아야 해요' : '아직 살 수 없어요', 'bad');
  }

  rest(target: 'night' | 'morning'): void {
    this.env.timeOfDay = target === 'night' ? 0.82 : 0.28;
    this.ui.closePanel();
    this.flash = 1;
    this.ui.toast(target === 'night' ? '별이 뜰 때까지 쉬었어요 🌙' : '상쾌한 아침이에요 ☀️', 'blue');
    this.state = 'play';
  }

  resume(): void {
    if (this.state === 'paused') this.state = 'play';
    this.ui.closePanel();
    if (!this.easyMode) this.input.requestLock();
  }

  quitToTitle(): void {
    this.persist();
    this.state = 'title';
    this.ui.closeDialog();
    this.ui.showTitle(true);
    this.releaseLock();
  }

  openMap(): void {
    if (this.state === 'play') this.state = 'paused';
    this.releaseLock();
    this.ui.openMap();
  }

  openQuestLog(): void {
    if (this.state === 'play') this.state = 'paused';
    this.releaseLock();
    this.ui.openQuestLog();
  }

  enterPhoto(): void {
    this.state = 'photo';
    this.ui.showHud(false);
    this.ui.closePanel();
    this.ui.showPhotoBar(true, this.env.timeOfDay);
    this.rig.enterFree();
    this.env.frozen = true;
    this.input.requestLock();
  }

  exitPhoto(): void {
    this.state = 'play';
    this.ui.showPhotoBar(false);
    this.ui.showHud(true);
    this.env.frozen = false;
    this.rig.reset();
  }

  setPhotoTime(t: number): void {
    this.env.timeOfDay = t;
  }

  takeScreenshot(): void {
    this.shotPending = true;
  }

  continueAfterEnding(): void {
    this.ui.showEnding(false);
    this.state = 'play';
    this.endingT = -1;
    this.ui.showHud(true);
    this.env.frozen = false;
    this.rig.reset();
    if (!this.easyMode) this.input.requestLock();
  }

  drawMap(c: HTMLCanvasElement): void {
    const p = this.player.position;
    const fwd = this.player.mode === 'fly' ? new THREE.Vector3(0, 0, -1).applyQuaternion(this.player.flight.quat) : new THREE.Vector3(Math.sin(this.player.facing), 0, Math.cos(this.player.facing));
    drawMap(c, {
      world: this.world,
      rivers: this.wind.rivers,
      discovered: new Set(this.save.discovered),
      player: { x: p.x, z: p.z, heading: Math.atan2(fwd.x, -fwd.z) },
      targets: this.questTargets().map((t) => ({ x: t.pos.x, z: t.pos.z, label: t.label })),
      rings: this.rings.rings.slice(this.rings.next).map((r) => ({ x: r.pos.x, z: r.pos.z })),
      stormCleared: this.save.ended,
    });
  }

  questTarget(def: QuestDef): string {
    const v = this.villagers.find((x) => x.def.id === def.recipient);
    return v ? v.island.spec.name : '';
  }

  click(): void {
    this.audio.click();
  }

  private releaseLock(): void {
    this.lastUnlockRequest = performance.now();
    this.input.releaseLock();
  }

  /* ======================================================================= */
  /* World queries                                                           */
  /* ======================================================================= */

  groundBelow(x: number, y: number, z: number): Ground | null {
    let best: Ground | null = null;
    for (const I of this.world.islands) {
      const dx = x - I.spec.x, dz = z - I.spec.z;
      const lim = I.spec.radius * 1.35;
      if (dx * dx + dz * dz > lim * lim) continue;
      const top = I.surfaceY(x, z);
      if (top === null || top > y + 0.01) continue;
      if (!best || top > best.y) best = { y: top, normal: I.surfaceNormal(x, z), island: I, bridge: false };
    }
    const b = this.bridges.heightAt(x, y, z);
    if (b !== null && b <= y + 0.6 && (!best || b > best.y)) best = { y: b, normal: new THREE.Vector3(0, 1, 0), island: null, bridge: true };
    return best;
  }

  private query: WorldQuery = {
    groundBelow: (x, y, z) => this.groundBelow(x, y, z),
    contact: (p, vel) => this.contact(p, vel),
    pushOutObstacles: (p, r) => {
      for (const o of this.decor.obstacles) {
        if (p.y < o.bottom || p.y > o.top) continue;
        const dx = p.x - o.x, dz = p.z - o.z;
        const d = Math.hypot(dx, dz);
        const m = o.r + r;
        if (d < m && d > 1e-4) {
          p.x = o.x + (dx / d) * m;
          p.z = o.z + (dz / d) * m;
        }
      }
    },
    safeSpot: (p) => this.safeSpot(p),
  };

  private contact(p: THREE.Vector3, vel: THREE.Vector3): Contact | null {
    for (const I of this.world.islands) {
      const dx = p.x - I.spec.x, dz = p.z - I.spec.z;
      const lim = I.spec.radius * 1.35;
      if (dx * dx + dz * dz > lim * lim) continue;
      if (p.y > I.spec.y + I.maxTop + 3 || p.y < I.spec.y + I.minBottom - 3) continue;
      const top = I.surfaceY(p.x, p.z);
      if (top === null) continue;
      const bot = I.bottomY(p.x, p.z);
      if (bot === null) continue;
      if (p.y < top + 0.4 && p.y > bot) {
        const push = new THREE.Vector3(dx, 0, dz).normalize();
        if (p.y > top - 4) return { kind: 'top', surfaceY: top, push: new THREE.Vector3(0, 1, 0) };
        if (p.y < bot + 6) push.set(0, -1, 0);
        return { kind: 'side', surfaceY: top, push };
      }
    }
    for (const o of this.decor.obstacles) {
      if (p.y < o.bottom || p.y > o.top + 0.5) continue;
      const dx = p.x - o.x, dz = p.z - o.z;
      if (dx * dx + dz * dz < (o.r + 0.6) ** 2) {
        // Landing on a roof counts as a bump upward.
        return { kind: 'obstacle', surfaceY: o.top, push: new THREE.Vector3(dx, 0.3, dz).normalize() };
      }
    }
    const b = this.bridges.heightAt(p.x, p.y, p.z);
    if (b !== null && p.y < b + 0.3 && vel.y <= 0) return { kind: 'top', surfaceY: b, push: new THREE.Vector3(0, 1, 0) };
    return null;
  }

  private safeSpot(p: THREE.Vector3): THREE.Vector3 {
    let best = this.world.hub;
    let bd = Infinity;
    for (const I of this.world.islands) {
      if (I.spec.role === 'sky' && !this.save.ended) continue;
      const d = Math.hypot(I.spec.x - p.x, I.spec.z - p.z);
      if (d < bd) { bd = d; best = I; }
    }
    const rng = new RNG(Math.floor(this.time * 10));
    const spot = best.randomTopPoint(rng, 0.0, 0.3, 0.3) ?? best.center.add(new THREE.Vector3(0, best.topLocal(0, 0), 0));
    return spot;
  }

  /* ======================================================================= */
  /* Main loop                                                                */
  /* ======================================================================= */

  private frame(): void {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const rawDt = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(rawDt, 0.05);
    this.fps = lerp(this.fps, 1 / Math.max(rawDt, 1e-3), 0.05);
    this.time += dt;
    G.uTime.value = this.time;
    this.input.pollGamepad();
    this.handleGlobalKeys();

    switch (this.state) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'play':
        this.updatePlay(dt);
        break;
      case 'paused':
        this.updateAmbient(0);
        break;
      case 'photo':
        this.updatePhoto(dt);
        break;
      case 'ending':
        this.updateEnding(dt);
        break;
      default:
        break;
    }
    this.render(dt);
    this.input.endFrame();
  }

  private handleGlobalKeys(): void {
    const i = this.input;
    if (i.pressed('F3')) this.ui.toggleDebug();
    if (this.state === 'play') {
      if (this.ui.dialogOpen) {
        if (i.pressed('KeyE') || i.pressed('Enter') || i.padPressed(PAD.X) || i.padPressed(PAD.A)) this.ui.dialogConfirm();
        if (i.pressed('Escape')) this.ui.closeDialog();
        return;
      }
      if (i.pressed('Escape') || i.padPressed(PAD.START)) {
        if (this.ui.panelOpen) this.ui.closePanel();
        else {
          this.state = 'paused';
          this.releaseLock();
          this.ui.openPause();
        }
        return;
      }
      if (i.pressed('KeyM') || i.padPressed(PAD.BACK)) this.openMap();
      if (i.pressed('KeyJ') || i.pressed('Tab')) this.openQuestLog();
      if (i.pressed('KeyP')) this.enterPhoto();
      if (i.pressed('KeyV') || i.padPressed(PAD.Y)) {
        this.rig.mode = this.rig.mode === 'third' ? 'first' : 'third';
        this.rig.reset();
      }
    } else if (this.state === 'paused') {
      if (i.pressed('Escape') || i.padPressed(PAD.START) || i.padPressed(PAD.B) || (this.ui.panelOpen === 'map' && i.pressed('KeyM')) || (this.ui.panelOpen === 'quests' && (i.pressed('KeyJ') || i.pressed('Tab')))) {
        this.ui.closePanel();
        this.resume();
      }
    } else if (this.state === 'photo') {
      if (i.pressed('KeyP') || i.pressed('Escape')) this.exitPhoto();
      if (i.pressed('Enter')) this.takeScreenshot();
    } else if (this.state === 'title') {
      if (i.pressed('Escape') && this.ui.panelOpen) this.ui.closePanel();
    }
  }

  private updateTitle(dt: number): void {
    this.titleAngle += dt * 0.05;
    this.env.update(dt * 0.6, this.world.hub.center);
    const c = this.world.hub.center.add(new THREE.Vector3(0, 30, 0));
    this.rig.orbit(c, 300, 85 + Math.sin(this.titleAngle * 2) * 15, this.titleAngle, new THREE.Vector3(0, 10, 0));
    this.updateAmbient(dt);
    G.uPlayerPos.value.set(0, -1e5, 0);
    this.post.params.radial = 0;
    this.post.params.whiteout = 0;
  }

  /** World animation that continues regardless of player state. */
  private updateAmbient(dt: number): void {
    const camPos = this.rig.camera.position;
    this.wind.update(this.time, this.env.sunUp);
    this.decor.update(dt, this.time, this.env.night, camPos);
    this.bridges.update(dt, this.player.mode === 'walk' && !!this.player.ground?.bridge);
    this.collect.update(this.time);
    if (dt > 0) {
      this.birds.update(dt, this.player.position);
      this.npcs.update(dt);
      this.particles.update(dt);
      this.lightning.update(dt);
    }
    for (const v of this.villagers) {
      const visible = !v.def.nightOnly || this.env.night > 0.5;
      v.person.root.visible = visible;
      v.wave = Math.max(0, v.wave - dt * 0.5);
      animatePerson(v.person, this.time, 0, v.phase, v.wave > 0 ? 1 : 0);
    }
    const tv = this.thermalVis.userData as { points: THREE.ShaderMaterial; haze: THREE.ShaderMaterial };
    tv.points.uniforms.uDay.value = this.wind.dayFactor;
    tv.points.uniforms.uPixel.value = this.renderer.getPixelRatio() * (window.innerHeight / 900);
    tv.haze.uniforms.uDay.value = this.env.sunUp;
    (this.particles.points.material as THREE.ShaderMaterial).uniforms.uPixel.value = this.renderer.getPixelRatio() * (window.innerHeight / 900);
    // Storm fades after the ending.
    G.uStorm.value = this.stormFactor;
    this.wind.stormFactor = this.stormFactor;
    // LOD / prop distance culling.
    const pd = this.profile.propDistance;
    for (const d of this.decor.decors) {
      const I = d.island;
      const dist = Math.hypot(I.spec.x - camPos.x, I.spec.y - camPos.y, I.spec.z - camPos.z) - I.spec.radius;
      d.near.visible = dist < pd * 0.55;
      d.far.visible = dist < pd * 2.2;
    }
  }

  /** Easy mode: fly straight toward the mouse cursor (or WASD/stick nudges). No auto-correction. */
  private easyFlightInput(_dt: number): FlightInput {
    const i = this.input;
    const P = this.player;
    let pitchKey = 0;
    if (i.down('KeyW') || i.down('ArrowUp')) pitchKey += 1;
    if (i.down('KeyS') || i.down('ArrowDown')) pitchKey -= 1;
    let turnKey = 0;
    if (i.down('KeyA') || i.down('ArrowLeft') || i.down('KeyQ')) turnKey -= 1;
    if (i.down('KeyD') || i.down('ArrowRight') || i.down('KeyE')) turnKey += 1;
    const p = i.pad;
    if (p.connected) {
      pitchKey -= p.ly;
      turnKey += p.lx;
      if (i.padDown(PAD.LB)) turnKey -= 1;
      if (i.padDown(PAD.RB)) turnKey += 1;
    }
    if (this.settings.invertY) pitchKey = -pitchKey;
    const cam = this.rig.camera;
    if (Math.abs(pitchKey) + Math.abs(turnKey) > 0.05) {
      // Keys/stick: aim relative to the current flight direction.
      const d = P.arcadeDir.clone();
      const yaw = -clamp(turnKey, -1, 1) * 0.7;
      d.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      const curPitch = Math.asin(clamp(d.y, -1, 1));
      const want = clamp(curPitch + clamp(pitchKey, -1, 1) * 0.6, -1.2, 1.1);
      d.applyAxisAngle(side, want - curPitch);
      this.aimVec.copy(d.normalize());
    } else if (P.airTime < 0.4) {
      this.aimVec.copy(P.arcadeDir);
    } else {
      // Mouse: cursor height relative to the point straight ahead = climb/descent angle,
      // left/right offset = turn toward that side.
      const nx = (i.mouseX / window.innerWidth) * 2 - 1;
      const ny = -(i.mouseY / window.innerHeight) * 2 + 1;
      const flat = new THREE.Vector3(P.arcadeDir.x, 0, P.arcadeDir.z);
      if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
      flat.normalize();
      cam.updateMatrixWorld();
      const ahead = P.flight.pos.clone().addScaledVector(flat, 160).project(cam);
      const inv = this.settings.invertY ? -1 : 1;
      const pitchT = clamp((ny - ahead.y) * 1.25 * inv, -1.05, 0.9);
      const yawOff = -clamp(nx - ahead.x, -1, 1) * 0.95;
      const d = flat.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOff);
      this.aimVec.set(d.x * Math.cos(pitchT), Math.sin(pitchT), d.z * Math.cos(pitchT));
    }
    // Keep the aim between straight-down-ish and a steep climb (no loops).
    const ay = clamp(this.aimVec.y, -0.92, 0.8);
    const flat = Math.hypot(this.aimVec.x, this.aimVec.z) || 1;
    const k = Math.sqrt(1 - ay * ay) / flat;
    this.aimVec.set(this.aimVec.x * k, ay, this.aimVec.z * k);
    const dive = Math.max(i.down('ShiftLeft') || i.down('ShiftRight') ? 1 : 0, p.rt);
    const brake = Math.max(i.down('Space') ? 1 : 0, p.lt);
    return { pitch: 0, roll: 0, yaw: 0, dive, brake };
  }

  private get easyMode(): boolean {
    return this.settings.controlMode !== 'classic';
  }

  /** Direction the easy-mode aim points to (world space). */
  aimDirection(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.aimVec);
  }

  private flightInput(dt: number): FlightInput {
    if (this.settings.controlMode !== 'classic') return this.easyFlightInput(dt);
    const i = this.input;
    const s = this.settings;
    const inv = s.invertY ? -1 : 1;
    // Mouse acts as a self-centering virtual stick.
    const sens = s.mouseSensitivity * 0.0045;
    this.stick.x = clamp(this.stick.x + i.mouseDX * sens, -1, 1);
    this.stick.y = clamp(this.stick.y + i.mouseDY * sens, -1, 1);
    this.stick.multiplyScalar(Math.exp(-dt * 2.2));
    let pitch = -this.stick.y * inv;
    let roll = this.stick.x;
    let yaw = 0;
    if (i.down('KeyW') || i.down('ArrowUp')) pitch -= 1 * inv;
    if (i.down('KeyS') || i.down('ArrowDown')) pitch += 1 * inv;
    if (i.down('KeyA') || i.down('ArrowLeft')) roll -= 1;
    if (i.down('KeyD') || i.down('ArrowRight')) roll += 1;
    if (i.down('KeyQ')) yaw -= 1;
    if (i.down('KeyE')) yaw += 1;
    const p = i.pad;
    if (p.connected) {
      pitch += p.ly * inv;
      roll += p.lx;
      if (i.padDown(PAD.LB)) yaw -= 1;
      if (i.padDown(PAD.RB)) yaw += 1;
      this.rig.lookYaw = lerp(this.rig.lookYaw, -p.rx * 1.6, damp(6, dt));
      this.rig.lookPitch = lerp(this.rig.lookPitch, p.ry * 0.6, damp(6, dt));
    } else {
      this.rig.lookYaw = lerp(this.rig.lookYaw, 0, damp(3, dt));
      this.rig.lookPitch = lerp(this.rig.lookPitch, 0, damp(3, dt));
    }
    const dive = Math.max(i.down('ShiftLeft') || i.down('ShiftRight') ? 1 : 0, p.rt);
    const brake = Math.max(i.down('Space') ? 1 : 0, p.lt);
    return { pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1), yaw: clamp(yaw, -1, 1), dive, brake };
  }

  private gliderParams(): GliderParams {
    return { liftLevel: this.save.upgrades.lift, speedLevel: this.save.upgrades.speed, stallLevel: this.save.upgrades.stall, massFactor: massFactor(QUESTS, this.save.quests) };
  }

  private updatePlay(dt: number): void {
    this.save.playTime += dt;
    this.env.update(dt, this.player.position);
    this.updateAmbient(dt);
    const P = this.player;
    const events: PlayerEvent[] = [];
    this.prevPos.copy(P.position);
    const uiBlock = this.ui.dialogOpen || !!this.ui.panelOpen;

    this.wind.sample(P.position, this.time, this.windSample);
    const ws = this.windSample;

    this.rig.levelFollow = this.easyMode;
    if (P.mode === 'fly') {
      // Wind rivers carry the glider: when the river airmass changes under you, your
      // ground velocity follows it (airspeed is kept), and you keep most of it on exit.
      if (!this.easyMode) {
        const dRiver = ws.riverWind.clone().sub(this.prevRiverWind);
        const entering = dRiver.dot(ws.riverWind) >= 0;
        P.flight.vel.addScaledVector(dRiver, entering ? 1 : 0.3);
      }
      this.prevRiverWind.copy(ws.riverWind);
      const inp = uiBlock ? { pitch: 0, roll: 0, yaw: 0, dive: 0, brake: 0 } : this.flightInput(dt);
      if (uiBlock) this.aimVec.copy(P.arcadeDir);
      P.updateFly(dt, inp, ws.wind, this.gliderParams(), ws.turbulence * 0.8, this.query, events, this.easyMode ? this.aimVec : null);
      // Hard world limit.
      const r = Math.hypot(P.flight.pos.x, P.flight.pos.z);
      if (r > HARD_LIMIT_R) {
        P.flight.pos.x *= HARD_LIMIT_R / r;
        P.flight.pos.z *= HARD_LIMIT_R / r;
      }
      if (P.flight.pos.y < -40 && P.mode === 'fly') {
        // Dipped into the cloud sea: carried back up by the sea breeze, no penalty.
        P.flight.vel.y = Math.max(P.flight.vel.y, 18);
        if (P.flight.pos.y < -70) {
          events.push({ type: 'crash', speed: 0 });
          P.knockOut(this.safeSpot(P.flight.pos), 2.2);
        }
      }
      // River entry whoosh.
      if (ws.riverIndex >= 0 && this.lastRiver < 0 && ws.river > 0.5) {
        this.audio.whoosh();
        this.rig.addShake(0.3);
      }
      this.lastRiver = ws.river > 0.3 ? ws.riverIndex : -1;
      // Fragile cargo vs g-load.
      const gd = gDamage(P.flight.gforce, dt) + ws.turbulence * dt * 4;
      if (gd > 0) this.applyCargoDamage(gd);
      // Rings.
      if (this.rings.rings.length && this.rings.check(this.prevPos, P.flight.pos)) this.onRingPassed();
      if (!this.race && !this.expressQuest && this.raceCooldown <= 0) {
        for (let k = 0; k < this.gates.rings.length; k++) {
          if (this.gates.crosses(k, this.prevPos, P.flight.pos, 1)) this.startRace(k);
        }
      }
    } else if (P.mode === 'walk') {
      this.prevRiverWind.set(0, 0, 0);
      const i = this.input;
      if (!uiBlock) {
        const sens = this.settings.mouseSensitivity * 0.0035;
        if (i.pointerLocked || i.mouseDown) {
          this.rig.yaw -= i.mouseDX * sens;
          this.rig.pitch = clamp(this.rig.pitch + i.mouseDY * sens * (this.settings.invertY ? -1 : 1), -0.4, 1.2);
        }
        if (i.pad.connected) {
          this.rig.yaw -= i.pad.rx * dt * 2.5;
          this.rig.pitch = clamp(this.rig.pitch + i.pad.ry * dt * 1.5, -0.4, 1.2);
        }
        this.rig.distance = clamp(this.rig.distance + i.wheel * 0.8, 3.5, 14);
      }
      let mx = 0, mz = 0;
      if (!uiBlock) {
        if (i.down('KeyW') || i.down('ArrowUp')) mz += 1;
        if (i.down('KeyS') || i.down('ArrowDown')) mz -= 1;
        if (i.down('KeyA') || i.down('ArrowLeft')) mx -= 1;
        if (i.down('KeyD') || i.down('ArrowRight')) mx += 1;
        if (i.pad.connected) { mx += i.pad.lx; mz -= i.pad.ly; }
      }
      P.updateWalk(dt, {
        moveX: mx, moveZ: mz,
        run: i.down('ShiftLeft') || i.down('ShiftRight') || i.padDown(PAD.LS),
        jump: !uiBlock && (i.pressed('Space') || i.padPressed(PAD.A)),
        takeoff: !uiBlock && (i.pressed('KeyF') || i.padPressed(PAD.RB)),
        camYaw: this.rig.yaw,
      }, this.query, events);
      if (!uiBlock && (i.pressed('KeyE') || i.padPressed(PAD.X))) this.interact();
    } else if (P.mode === 'stunned') {
      if (!this.stunShown) {
        this.ui.showStun(true);
        this.stunShown = true;
      }
      P.flight.vel.multiplyScalar(0.9);
      if (P.updateStun(dt)) {
        this.ui.showStun(false);
        this.stunShown = false;
        this.rig.reset();
        this.trailL.reset();
        this.trailR.reset();
      }
    }

    for (const e of events) this.onPlayerEvent(e);

    // Race / timers.
    this.raceCooldown -= dt;
    if (this.race) {
      this.race.time += dt;
      if (this.race.time > 300 || this.input.pressed('KeyR')) {
        this.ui.toast('레이스를 그만뒀어요', 'bad');
        this.endRace();
      }
    }
    const failed = tickQuests(this.save.quests, dt);
    for (const id of failed) this.onQuestFailed(id, '시간이 다 됐어요');

    // Pickups.
    const pk = this.collect.pickup(P.position, this.time, P.mode === 'fly' ? 6 : 3);
    for (const s of pk.shards) {
      if (!this.save.shards.includes(s)) this.save.shards.push(s);
      this.audio.shard();
      this.particles.burst(P.position, 30, new THREE.Color(0x9fe8ff), 6, 4, 2, 0.35, 1.6);
      const n = this.save.shards.length;
      this.ui.toast(`바람 조각 ${n}/30 — ${this.world.shards[s]?.hint ?? ''}`, 'blue');
      if (n === 10) this.ui.toast('별자리 날개 무늬가 해금됐어요!', 'gold', 5000);
      if (n === 30) this.ui.toast('모든 바람 조각을 모았어요! 우체국에서 「바람 날개」를 받으세요', 'gold', 7000);
      this.persist();
    }
    if (pk.feathers > 0) {
      this.save.feathers += pk.feathers * 2;
      this.audio.feather();
      this.particles.burst(P.position, 12, new THREE.Color(0xfff1c0), 4, 3, 1, 0.3, 1);
      this.ui.toast(`🪶 +${pk.feathers * 2}`, 'gold', 1500);
    }

    // Discovery + records.
    this.discoverTimer -= dt;
    if (this.discoverTimer <= 0) {
      this.discoverTimer = 0.5;
      for (const I of this.world.islands) {
        if (this.save.discovered.includes(I.spec.id)) continue;
        if (Math.hypot(I.spec.x - P.position.x, I.spec.z - P.position.z) < I.spec.radius + 260) {
          this.save.discovered.push(I.spec.id);
          if (this.save.discovered.length > 1) this.ui.toast(`새로운 섬 발견 · ${I.spec.name}`, '');
        }
      }
    }
    if (P.mode === 'fly') {
      if (P.flight.pos.y > this.save.maxAltitude + 0.5) this.save.maxAltitude = P.flight.pos.y;
      const sp = P.flight.vel.length();
      if (sp > this.save.maxSpeed) this.save.maxSpeed = sp;
    }

    // Storm lightning.
    if (ws.storm > 0.2 && this.stormFactor > 0.3) {
      this.lightningTimer -= dt * ws.storm;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 1.2 + Math.random() * 3;
        const a = Math.random() * TAU;
        const d = 40 + Math.random() * 400;
        const at = P.position.clone().add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d));
        this.lightning.strike(at.clone().add(new THREE.Vector3(0, 160, 0)), at.clone().add(new THREE.Vector3(0, -200, 0)));
        this.audio.thunder(d);
        if (d < 70 && P.mode === 'fly') {
          this.rig.addShake(1.4);
          P.flight.vel.add(new THREE.Vector3((Math.random() - 0.5) * 12, -6, (Math.random() - 0.5) * 12));
          this.applyCargoDamage(25);
          this.ui.toast('번개가 가까이 쳤어요!', 'bad', 1500);
        } else this.rig.addShake(0.2);
      }
    }

    // Cloud whiteout.
    const camIn = this.puffs.insideAmount(this.rig.camera.position, this.stormFactor);
    const lowCloud = smoothstep(15, -25, this.rig.camera.position.y);
    this.inCloud = lerp(this.inCloud, Math.max(camIn, lowCloud), damp(4, dt));

    // Autosave.
    this.saveTimer += dt;
    if (this.saveTimer > 20) {
      this.saveTimer = 0;
      this.persist();
    }

    // Interaction prompt (walk mode).
    this.findInteractTarget();

    // Camera + visuals.
    P.syncVisuals(dt);
    this.rig.update(dt, P, this.query);
    G.uPlayerPos.value.copy(P.mode === 'walk' ? P.walkPos : new THREE.Vector3(0, -1e5, 0));
    this.updateFx(dt);
    this.updateAudio(dt);
    this.updateHud();
    if (this.ui.panelOpen === 'map') this.ui.redrawMap();
  }

  private updateFx(dt: number): void {
    const P = this.player;
    const cam = this.rig.camera;
    const flying = P.mode === 'fly';
    const speed = flying ? P.flight.vel.length() : 0;
    const emit = flying ? clamp((speed - 24) / 25, 0, 1) * 0.8 + clamp((P.flight.gforce - 1.4) / 1.5, 0, 1) * 0.6 : 0;
    P.glider.root.updateMatrixWorld(true);
    const tl = P.glider.tipL.getWorldPosition(this.tmpV.clone());
    const tr = P.glider.tipR.getWorldPosition(this.tmpV.clone());
    this.trailL.update(dt, tl, cam.position, emit);
    this.trailR.update(dt, tr, cam.position, emit);
    this.trailL.mesh.visible = this.trailR.mesh.visible = flying || this.trailL.intensity > 0.01;
    const speedAmt = clamp((speed - 38) / 40, 0, 1);
    const rain = this.windSample.storm * this.stormFactor;
    this.streaks.update(dt, cam, flying ? P.flight.vel : new THREE.Vector3(), speedAmt, this.inCloud, rain);
    const pp = this.post.params;
    pp.radial = lerp(pp.radial, speedAmt * (this.rig.mode === 'first' ? 1.3 : 1), damp(3, dt));
    pp.whiteout = this.inCloud * 0.85;
    pp.whiteColor.copy(G.uFogLowColor.value).lerp(new THREE.Color(1, 1, 1), 0.5);
    pp.vignette = 0.32 + speedAmt * 0.25 + (flying ? P.flight.stall * 0.35 : 0) + (P.mode === 'stunned' ? 0.6 : 0);
    // Thermal petals around you when inside a rising column.
    if (flying && this.windSample.thermal > 0.4 && Math.random() < dt * 6) {
      const I = this.nearestIsland(P.position);
      const c = I ? PALETTES[I.spec.biome].thermal : new THREE.Color(0xfff3c4);
      this.particles.burst(P.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, -8, (Math.random() - 0.5) * 20)), 2, c, 1, 8, -2, 0.35, 2.5);
    }
  }

  private nearestIsland(p: THREE.Vector3): Island | null {
    let best: Island | null = null;
    let bd = Infinity;
    for (const I of this.world.islands) {
      const d = Math.hypot(I.spec.x - p.x, I.spec.z - p.z) - I.spec.radius;
      if (d < bd) { bd = d; best = I; }
    }
    return best;
  }

  private updateAudio(dt: number): void {
    const P = this.player;
    const I = this.nearestIsland(P.position);
    let nearLand = 0;
    if (I) {
      const dh = Math.hypot(I.spec.x - P.position.x, I.spec.z - P.position.z) - I.spec.radius;
      const dv = Math.abs(P.position.y - (I.spec.y + I.maxTop * 0.5));
      nearLand = clamp(1 - Math.max(dh, 0) / 250, 0, 1) * clamp(1 - dv / 250, 0, 1);
    }
    this.audio.update(dt, {
      airspeed: P.mode === 'fly' ? P.flight.airspeed : 0,
      aoa: P.mode === 'fly' ? P.flight.aoa : 0,
      stall: P.mode === 'fly' ? P.flight.stall : 0,
      flying: P.mode === 'fly',
      night: this.env.night,
      nearLand,
      storm: this.windSample.storm * this.stormFactor,
      inCloud: this.inCloud,
      river: this.windSample.river,
      roll: P.mode === 'fly' ? -new THREE.Vector3(1, 0, 0).applyQuaternion(P.flight.quat).y : 0,
      paused: this.state !== 'play',
    });
  }

  private updatePhoto(dt: number): void {
    const i = this.input;
    const move = new THREE.Vector3();
    if (i.down('KeyW')) move.z -= 1;
    if (i.down('KeyS')) move.z += 1;
    if (i.down('KeyA')) move.x -= 1;
    if (i.down('KeyD')) move.x += 1;
    if (i.down('KeyE')) move.y += 1;
    if (i.down('KeyQ')) move.y -= 1;
    const sens = this.settings.mouseSensitivity * 0.003;
    const look = i.pointerLocked || i.mouseDown;
    this.rig.updateFree(dt, move, look ? i.mouseDX * sens : 0, look ? i.mouseDY * sens : 0, i.down('ShiftLeft'));
    this.env.update(0, this.rig.camera.position);
    this.updateAmbient(dt);
    this.post.params.radial = 0;
    this.post.params.whiteout = 0;
    this.post.params.vignette = 0.3;
    this.updateAudio(dt);
  }

  /* ======================================================================= */
  /* Gameplay events                                                          */
  /* ======================================================================= */

  private onPlayerEvent(e: PlayerEvent): void {
    const P = this.player;
    switch (e.type) {
      case 'land': {
        const soft = e.sink < 3.5;
        this.audio.landing(soft);
        const g = P.ground ?? this.groundBelow(P.walkPos.x, P.walkPos.y + 1, P.walkPos.z);
        const col = g?.island ? PALETTES[g.island.spec.biome].bladeTint : new THREE.Color(0xa27a58);
        this.particles.burst(P.walkPos, 26, col, 5, 4, 12, 0.3, 1.0);
        this.rig.addShake(soft ? 0.1 : 0.45);
        const dmg = landingDamage(e.sink);
        if (dmg > 0) this.applyCargoDamage(dmg);
        this.ui.toast(soft ? '사뿐히 착지!' : '쿵! 착지', soft ? 'blue' : '', 1400);
        this.rig.yaw = Math.atan2(-Math.sin(P.facing), -Math.cos(P.facing));
        this.rig.pitch = 0.25;
        this.rig.reset();
        break;
      }
      case 'crash':
        this.audio.crash();
        this.rig.addShake(2);
        this.applyCargoDamage(100);
        this.trailL.reset();
        this.trailR.reset();
        if (this.race) {
          this.ui.toast('레이스 실패', 'bad');
          this.endRace();
        }
        break;
      case 'takeoff':
        if (!e.jump) {
          this.audio.whoosh();
          this.rig.reset();
          this.trailL.reset();
          this.trailR.reset();
          this.stick.set(0, 0);
          this.ui.closeDialog();
        }
        break;
      case 'bump':
        this.audio.landing(true);
        this.rig.addShake(0.4);
        this.applyCargoDamage(10);
        break;
    }
  }

  private applyCargoDamage(amount: number): void {
    const broke = damageCargo(QUESTS, this.save.quests, amount);
    for (const id of broke) this.onQuestFailed(id, '화물이 깨졌어요…');
  }

  private onQuestFailed(id: string, why: string): void {
    const def = QUESTS.find((q) => q.id === id);
    failQuest(this.save.quests, id);
    if (this.expressQuest === id) {
      this.expressQuest = null;
      this.rings.clear();
    }
    this.audio.fail();
    this.ui.toast(`${why} 「${def?.title ?? ''}」 — 우체국에서 다시 받을 수 있어요`, 'bad', 5000);
    this.persist();
  }

  private onRingPassed(): void {
    const n = this.rings.next;
    this.audio.ring(n);
    // Rings give a little gust of wind.
    const P = this.player;
    const fwd = P.flight.vel.clone().normalize();
    P.flight.vel.addScaledVector(fwd, 4).add(new THREE.Vector3(0, 2.5, 0));
    this.particles.burst(P.position, 14, new THREE.Color(0xffe27a), 6, 2, 0, 0.3, 0.8);
    if (this.expressQuest) {
      passRing(this.save.quests, this.expressQuest);
      if (this.rings.done) {
        this.ui.toast('모든 링 통과! 이제 받는 사람에게 전해 주세요', 'gold');
        this.rings.clear();
      }
    } else if (this.race) {
      if (this.rings.done) this.finishRace();
    }
  }

  private updateGates(): void {
    if (this.race || this.expressQuest) {
      this.gates.clear();
      return;
    }
    this.gates.setGates(this.world.races.map((r) => r.rings[0]), 0x7fd99a, 16);
  }

  private startRace(k: number): void {
    const course = this.world.races[k];
    this.race = { idx: k, time: 0 };
    this.rings.set(course.rings.slice(1), 0x7fd99a, 11);
    this.gates.clear();
    this.audio.jingle();
    const best = this.save.raceBest[k];
    this.ui.toast(`링 레이스 「${course.name}」 시작!${best ? ` 최고 기록 ${best.toFixed(1)}초` : ''} (R: 포기)`, 'gold');
  }

  private finishRace(): void {
    if (!this.race) return;
    const k = this.race.idx;
    const t = this.race.time;
    const best = this.save.raceBest[k];
    const record = best === null || t < best;
    if (record) this.save.raceBest[k] = t;
    const reward = record ? 30 : 10;
    this.save.feathers += reward;
    this.audio.jingle();
    this.ui.toast(`완주! ${t.toFixed(1)}초 ${record ? '· 새 기록!' : ''} 🪶 +${reward}`, 'gold', 5000);
    this.endRace();
    this.persist();
  }

  private endRace(): void {
    this.race = null;
    this.rings.clear();
    this.raceCooldown = 4;
    this.updateGates();
  }

  private findInteractTarget(): void {
    this.interactTarget = null;
    const P = this.player;
    if (P.mode !== 'walk') return;
    let best = 4.5;
    for (const v of this.villagers) {
      if (!v.person.root.visible) continue;
      const d = v.pos.distanceTo(P.walkPos);
      if (d < best) { best = d; this.interactTarget = { kind: 'npc', villager: v }; }
    }
    for (const d of this.decor.decors) {
      if (d.board) {
        const dist = d.board.distanceTo(P.walkPos);
        if (dist < best) { best = dist; this.interactTarget = { kind: 'board', decor: d }; }
      }
      if (d.mailbox) {
        const dist = d.mailbox.distanceTo(P.walkPos);
        if (dist < Math.min(best, 3)) { best = dist; this.interactTarget = { kind: 'mailbox', decor: d }; }
      }
    }
  }

  private interact(): void {
    const t = this.interactTarget;
    if (!t) return;
    if (t.kind === 'board') {
      this.ui.openPostOffice('quests');
      this.releaseLock();
      return;
    }
    if (t.kind === 'mailbox' && t.decor) {
      const I = t.decor.island;
      // Letters (normal type) can be dropped in the recipient's mailbox.
      const q = this.save.quests.active.map((a) => QUESTS.find((d) => d.id === a.id) as QuestDef).find((d) => d.type === 'normal' && this.villagers.find((v) => v.def.id === d.recipient)?.island === I);
      if (q) {
        this.completeDelivery(q, NPC_BY_ID[q.recipient]);
      } else if (I === this.world.hub) {
        this.ui.openPostOffice('quests');
        this.releaseLock();
      } else this.ui.toast('이 우편함에 넣을 편지가 없어요', '', 1800);
      return;
    }
    const v = t.villager;
    if (!v) return;
    v.wave = 1.2;
    const def = v.def;
    this.releaseLock();
    if (def.id === 'dodam') {
      this.ui.dialog(def.name, def.title, this.pickLine(def), [
        { label: '우체국 이용하기', primary: true, cb: () => { this.ui.closeDialog(); this.ui.openPostOffice('quests'); } },
        { label: '안녕히 계세요', cb: () => this.ui.closeDialog() },
      ]);
      return;
    }
    const mine = this.save.quests.active.map((a) => QUESTS.find((q) => q.id === a.id) as QuestDef).filter((q) => q.recipient === def.id);
    if (mine.length) {
      const q = mine[0];
      const check = canDeliver(QUESTS, this.save.quests, q.id, def.id, this.env.isNight());
      if (check.ok) {
        this.completeDelivery(q, def);
        return;
      }
      this.ui.dialog(def.name, def.title, `「${q.title}」… ${check.reason ?? ''}`, [{ label: '알겠어요', primary: true, cb: () => this.ui.closeDialog() }]);
      return;
    }
    this.ui.dialog(def.name, def.title, this.pickLine(def), [{ label: '또 봐요', primary: true, cb: () => this.ui.closeDialog() }]);
  }

  private pickLine(def: NpcDef): string {
    const done = this.save.quests.completed.length;
    if (def.id === 'dodam' && this.save.ended) return '하늘이 열렸구나. 이제 바람이 모두를 이어 줄 거야. 고맙다, 배달부.';
    if (def.id === 'dodam' && done >= QUESTS.length - 1 && !this.save.ended) return '모든 섬의 편지가 모였단다. 이제 하늘등대로 가는 마지막 편지만 남았어.';
    return def.lines[Math.floor(Math.random() * def.lines.length)];
  }

  private completeDelivery(q: QuestDef, npc: NpcDef): void {
    const r = deliver(QUESTS, this.save.quests, q.id, npc.id, this.env.isNight());
    if (!r.ok) {
      this.ui.toast(r.reason ?? '전할 수 없어요', 'bad');
      return;
    }
    this.save.feathers += r.reward;
    this.save.deliveries++;
    if (this.expressQuest === q.id) {
      this.expressQuest = null;
      this.rings.clear();
    }
    this.updateGates();
    this.audio.jingle();
    setTimeout(() => this.audio.feather(), 700);
    this.particles.burst(this.player.walkPos.clone().add(new THREE.Vector3(0, 1.5, 0)), 30, new THREE.Color(0xfff1c0), 4, 5, 3, 0.35, 1.6);
    this.persist();
    if (q.type === 'final') {
      this.ui.dialog(npc.name, npc.title, q.thanks, [{ label: '…!', primary: true, cb: () => { this.ui.closeDialog(); this.startEnding(); } }]);
      return;
    }
    this.ui.dialog(npc.name, npc.title, `${q.thanks}\n\n🪶 깃털 ${r.reward}개를 받았어요.`, [{ label: '천만에요!', primary: true, cb: () => this.ui.closeDialog() }]);
    const left = availableQuests(QUESTS, this.save.quests, cargoCapacity(this.save));
    if (left.length && left[0].type === 'final') this.ui.toast('마지막 편지가 우체국에서 기다리고 있어요', 'gold', 6000);
  }

  private questTargets(): { pos: THREE.Vector3; label: string; ring?: boolean }[] {
    const out: { pos: THREE.Vector3; label: string; ring?: boolean }[] = [];
    const next = this.rings.nextPos();
    if (next) out.push({ pos: next, label: '다음 링', ring: true });
    for (const a of this.save.quests.active) {
      const d = QUESTS.find((q) => q.id === a.id);
      if (!d) continue;
      const v = this.villagers.find((x) => x.def.id === d.recipient);
      if (v) out.push({ pos: v.pos, label: `${v.def.name} (${v.island.spec.name})` });
    }
    if (!this.save.quests.active.length && availableQuests(QUESTS, this.save.quests, cargoCapacity(this.save)).length) {
      const d = this.decor.decors.find((x) => x.island === this.world.hub);
      if (d?.board) out.push({ pos: d.board, label: '우체국' });
    }
    return out;
  }

  /* ======================================================================= */
  /* Ending                                                                   */
  /* ======================================================================= */

  private startEnding(): void {
    this.state = 'ending';
    this.endingT = 0;
    this.ui.showHud(false);
    this.releaseLock();
    this.save.ended = true;
    this.persist();
  }

  setStormCleared(cleared: boolean): void {
    this.stormFactor = cleared ? 0 : 1;
    if (this.decor) this.decor.skyBeamOn.value = cleared ? 1 : 0;
    G.uStorm.value = this.stormFactor;
    if (this.wind) this.wind.stormFactor = this.stormFactor;
  }

  private updateEnding(dt: number): void {
    this.endingT += dt;
    const t = this.endingT;
    const sky = this.world.sky;
    const c = sky.center.add(new THREE.Vector3(0, 40, 0));
    // Storm dissolves, sky clears toward a golden morning.
    this.stormFactor = clamp(1 - (t - 3) / 9, 0, 1);
    this.decor.skyBeamOn.value = smoothstep(1.5, 5, t);
    this.env.frozen = true;
    this.env.timeOfDay = lerp(this.env.timeOfDay, 0.31, damp(0.25, dt));
    this.env.update(dt, c);
    this.updateAmbient(dt);
    this.decor.mats.lampGlow.color.setRGB(4, 3.4, 2.2);
    const radius = lerp(60, 520, smoothstep(2, 22, t));
    const height = lerp(15, 260, smoothstep(2, 24, t));
    this.rig.orbit(c, radius, height, 0.6 + t * 0.06, new THREE.Vector3(0, 30 - smoothstep(10, 24, t) * 20, 0));
    this.player.syncVisuals(dt);
    this.post.params.radial = 0;
    this.post.params.whiteout = 0;
    this.post.params.vignette = 0.3;
    this.flash = Math.max(this.flash, t < 1.2 ? 1 - t / 1.2 : 0);
    if (t > 14 && !this.ui.endingShown) {
      this.audio.jingle();
      this.ui.showEnding(true, { deliveries: this.save.deliveries, feathers: this.save.feathers, shards: this.save.shards.length, playTime: this.save.playTime });
    }
    this.updateAudio(dt);
  }

  /* ======================================================================= */
  /* HUD                                                                      */
  /* ======================================================================= */

  private reticleScreen(flying: boolean): { x: number; y: number } | null {
    const show = flying && this.easyMode && this.rig.mode !== 'first' && !this.ui.dialogOpen && !this.ui.panelOpen;
    document.body.classList.toggle('aim-cursor', show);
    if (!show) return null;
    const i = this.input;
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE'].some((k) => i.down(k));
    if (!keys) return { x: i.mouseX, y: i.mouseY };
    const p = this.player.flight.pos.clone().addScaledVector(this.aimVec, 160).project(this.rig.camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }

  private updateHud(): void {
    const P = this.player;
    const flying = P.mode === 'fly';
    const pos = P.position;
    const vel = P.velocity;
    let heading: number;
    if (flying) {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(P.flight.quat);
      heading = Math.atan2(f.x, -f.z);
    } else {
      const f = new THREE.Vector3();
      this.rig.camera.getWorldDirection(f);
      heading = Math.atan2(f.x, -f.z);
    }
    const w = this.windSample.wind;
    const windHeading = Math.atan2(w.x, -w.z);
    const markers = this.questTargets().map((t) => ({ bearing: Math.atan2(t.pos.x - pos.x, -(t.pos.z - pos.z)), label: t.label, ring: t.ring }));
    let timer: number | null = null;
    let questLine = '';
    if (this.race) {
      timer = -this.race.time;
      questLine = `링 레이스 · ${this.world.races[this.race.idx].name} · ${this.rings.next}/${this.rings.rings.length}`;
    }
    const exp = this.expressQuest ? findActive(this.save.quests, this.expressQuest) : undefined;
    if (exp && exp.timeLeft !== null) {
      timer = exp.timeLeft;
      const d = QUESTS.find((q) => q.id === exp.id);
      questLine = `급송 · ${d?.title} · 링 ${exp.ringIndex}/${exp.ringsTotal}`;
    } else if (!this.race && this.save.quests.active.length) {
      const a = this.save.quests.active[0];
      const d = QUESTS.find((q) => q.id === a.id) as QuestDef;
      const v = this.villagers.find((x) => x.def.id === d.recipient);
      const dist = v ? Math.round(v.pos.distanceTo(pos)) : 0;
      questLine = `${d.title} → ${NPC_BY_ID[d.recipient].name} · ${v?.island.spec.name ?? ''} · ${dist}m${d.type === 'night' && !this.env.isNight() ? ' · 밤에만' : ''}`;
    }
    const inactive = performance.now() - this.input.lastActivity > 6000;
    this.hudFade = flying && inactive && timer === null && !this.ui.dialogOpen;
    let prompt: string | null = null;
    const t = this.interactTarget;
    if (t && !this.ui.dialogOpen && !this.ui.panelOpen) {
      if (t.kind === 'board') prompt = '<b>E</b>우체국 게시판';
      else if (t.kind === 'mailbox') prompt = '<b>E</b>우편함';
      else if (t.villager) {
        const has = this.save.quests.active.some((a) => QUESTS.find((q) => q.id === a.id)?.recipient === t.villager?.def.id);
        prompt = `<b>E</b>${has ? '배달하기' : '대화하기'} · ${t.villager.def.name}`;
      }
    }
    let hint = '';
    if (P.mode === 'walk' && this.save.quests.completed.length === 0 && this.save.quests.active.length === 0) hint = '우체국 게시판에서 의뢰를 받아 보세요 · F 이륙';
    else if (P.mode === 'walk' && this.save.quests.completed.length < 2) hint = 'F 이륙 · 절벽에서 뛰어내리기 · E 대화';
    else if (flying && this.save.quests.completed.length < 3) {
      hint = this.settings.controlMode === 'classic'
        ? 'W/S 기수 · A/D 기울이기 · Shift 급강하 · Space 감속 · 꽃잎 기둥 = 상승기류'
        : '마우스 커서를 가고 싶은 곳에 두세요 (위 = 상승) · Shift 급강하 · Space 감속/착륙 · 꽃잎 기둥 = 상승기류';
    }
    const h: HudData = {
      flying,
      altitude: pos.y,
      vspeed: vel.y,
      speed: flying ? P.flight.airspeed : Math.hypot(vel.x, vel.z),
      stallSpeed: stallSpeedFor(this.gliderParams(), 0),
      maxSpeed: maxLevelSpeedHint(this.gliderParams()),
      stall: flying ? P.flight.stall : 0,
      windDir: windHeading - heading,
      windSpeed: Math.hypot(w.x, w.z),
      heading,
      markers,
      timer,
      questLine,
      feathers: this.save.feathers,
      shards: this.save.shards.length,
      cargo: this.save.quests.active.map((a) => {
        const d = QUESTS.find((q) => q.id === a.id) as QuestDef;
        return { name: d.cargo, integrity: d.type === 'fragile' ? a.integrity : null, type: d.type };
      }),
      prompt,
      faded: this.hudFade,
      hint,
      reticle: this.reticleScreen(flying),
    };
    this.ui.updateHud(h);
  }

  /* ======================================================================= */
  /* Render                                                                   */
  /* ======================================================================= */

  private render(dt: number): void {
    const cam = this.rig.camera;
    this.sky.position.copy(cam.position);
    this.cloudSea.update(cam.position);
    cam.updateMatrixWorld();
    this.puffs.update(cam);
    const pp = this.post.params;
    pp.exposure = this.env.exposure * (1 + this.lightning.flash * 0.8);
    pp.saturation = this.env.saturation;
    pp.tint.copy(this.env.tint);
    this.flash = Math.max(0, this.flash - dt * 0.8);
    const stunFade = this.player.mode === 'stunned' ? clamp(1 - this.player.stunTime / 2.6, 0, 1) : 0;
    if (this.flash > 0) {
      pp.fade = this.flash;
      pp.fadeColor.setRGB(1, 0.98, 0.94);
    } else if (stunFade > 0 && this.state === 'play') {
      pp.fade = Math.sin(stunFade * Math.PI) * 0.85;
      pp.fadeColor.setRGB(0.98, 0.96, 0.93);
    } else pp.fade = 0;
    pp.bloom = 0.32 + this.env.night * 0.25;
    this.renderer.info.reset();
    this.post.render(this.scene, cam, this.time);
    if (this.shotPending) {
      this.shotPending = false;
      try {
        const url = this.canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `windcourier-${Date.now()}.png`;
        a.click();
        this.ui.toast('사진을 저장했어요 📷', 'blue');
      } catch {
        this.ui.toast('사진을 저장하지 못했어요', 'bad');
      }
    }
    if (this.ui.debugOn) {
      const p = this.player.position;
      const info = this.renderer.info;
      this.ui.setDebug(
        `FPS ${this.fps.toFixed(0)}\n드로우콜 ${info.render.calls}\n삼각형 ${info.render.triangles.toLocaleString()}\n위치 ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}\n시드 ${this.settings.seed} (${this.world.seed})\n모드 ${this.player.mode} · ${this.state}\n시각 ${(this.env.timeOfDay * 24).toFixed(1)}시\n바람 ${this.windSample.wind.toArray().map((v) => v.toFixed(1)).join(', ')}\n품질 ${this.settings.quality}`,
      );
    }
  }

  /** Test hook: run the simulation forward without rendering (used by the headless smoke test). */
  debugAdvance(seconds: number): void {
    const step = 1 / 30;
    for (let t = 0; t < seconds; t += step) {
      this.time += step;
      G.uTime.value = this.time;
      if (this.state === 'play') this.updatePlay(step);
      else if (this.state === 'ending') this.updateEnding(step);
    }
  }

  persist(): void {
    const P = this.player;
    this.save.timeOfDay = this.env.timeOfDay;
    if (P.mode === 'walk' && P.onGround) this.save.player = [P.walkPos.x, P.walkPos.y, P.walkPos.z];
    writeSave(this.save);
  }
}
