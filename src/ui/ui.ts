import type { Settings, Quality } from '../core/settings';
import { formatTime } from '../core/math';
import { COLORS, PATTERNS, UPGRADES, SaveData, UpgradeKey, cargoCapacity, patternUnlocked, upgradeCost } from '../game/progress';
import { QUESTS, NPC_BY_ID } from '../game/data';
import { QuestDef, TYPE_LABEL, availableQuests } from '../game/questLogic';

export interface UIHost {
  newGame(): void;
  continueGame(): void;
  applySettings(s: Settings, reloadWorld: boolean): void;
  getSettings(): Settings;
  getSave(): SaveData;
  acceptQuest(id: string): void;
  buyUpgrade(k: UpgradeKey): void;
  buyColor(i: number): void;
  buyPattern(i: number): void;
  rest(target: 'night' | 'morning'): void;
  resume(): void;
  quitToTitle(): void;
  openMap(): void;
  openQuestLog(): void;
  enterPhoto(): void;
  exitPhoto(): void;
  setPhotoTime(t: number): void;
  takeScreenshot(): void;
  continueAfterEnding(): void;
  drawMap(canvas: HTMLCanvasElement): void;
  questTarget(def: QuestDef): string;
  click(): void;
}

export interface HudData {
  flying: boolean;
  altitude: number;
  vspeed: number;
  speed: number;
  stallSpeed: number;
  maxSpeed: number;
  stall: number;
  windDir: number; // radians relative to heading
  windSpeed: number;
  heading: number; // radians, 0 = north (-Z)
  markers: { bearing: number; label: string; ring?: boolean }[];
  timer: number | null;
  questLine: string;
  feathers: number;
  shards: number;
  cargo: { name: string; integrity: number | null; type: string }[];
  prompt: string | null;
  faded: boolean;
  hint: string;
  reticle: { x: number; y: number } | null;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export class UI {
  root: HTMLElement;
  private host: UIHost;
  private els: Record<string, HTMLElement> = {};
  private openPanelName: string | null = null;
  private poTab = 'quests';
  private dialogHandlers: (() => void)[] = [];
  private lastHud = '';
  private lastCargo = '';
  private lastMarkers = '';
  debugOn = false;

  constructor(root: HTMLElement, host: UIHost) {
    this.root = root;
    this.host = host;
    root.innerHTML = `
      <div id="loading"><div class="logo">바람의 배달부</div><div class="bar"><i></i></div><div class="tip">하늘을 그리는 중…</div></div>
      <div id="title" class="hidden">
        <h1>바람의 배달부</h1>
        <div class="sub">WINDCOURIER</div>
        <div class="menu">
          <button class="primary" data-act="new">새로 시작</button>
          <button data-act="continue">이어하기</button>
          <button data-act="settings">설정</button>
          <button data-act="controls">조작법</button>
        </div>
        <div class="foot">바람을 읽고, 편지를 전하세요. · 클릭하면 소리가 켜집니다</div>
      </div>
      <div id="hud" class="hidden">
        <div id="hint" class="hud-glass"></div>
        <div id="compass" class="hud-glass"><div class="strip"></div><div class="center"></div></div>
        <div id="questline" class="hud-glass hidden"></div>
        <div id="timer" class="hud-glass hidden"></div>
        <div id="status"><div class="pill hud-glass" id="feathers"></div><div class="pill hud-glass" id="shards"></div></div>
        <div id="gauges" class="hud-glass">
          <svg id="speedo" viewBox="0 0 150 110"></svg>
          <div id="altimeter"><div class="tape"></div><div class="read"></div><div class="vs"></div></div>
          <div id="wind"><svg viewBox="0 0 74 74" width="74" height="74"></svg><div class="lab"></div></div>
        </div>
        <div id="cargo" class="hud-glass hidden"></div>
        <div id="stallwarn" class="hidden">실속!</div>
        <div id="prompt" class="hud-glass hidden"></div>
        <div id="toasts"></div>
      </div>
      <div id="reticle" class="hidden"></div>
      <div id="dialog" class="hidden"><div class="who"></div><div class="txt"></div><div class="opts"></div></div>
      <div id="stun" class="hidden">어질어질… 잠시 쉬어 갈게요</div>
      <div id="panel-wrap" class="panel-wrap hidden"><div class="panel interactive" id="panel"></div></div>
      <div id="photo-bar" class="hud-glass hidden">
        <span>사진 모드 · WASD 이동 · 마우스 시점 · Q/E 상하 · Shift 빠르게</span>
        <label>시간 <input type="range" id="photo-time" min="0" max="1" step="0.001"></label>
        <button class="small primary" data-act="shot">사진 저장</button>
        <button class="small" data-act="photo-exit">나가기 (P)</button>
      </div>
      <div id="ending">
        <h1>하늘이 열렸어요</h1>
        <p>하늘등대에 다시 불이 켜지고, 폭풍은 바람의 길로 흩어졌습니다.<br/>섬과 섬 사이에는 이제 언제나 순한 바람이 붑니다.</p>
        <div class="stats"></div>
        <p class="muted">바람의 배달부 · 만든 이: 바람과 코드 · 모든 소리와 그림은 절차적으로 생성되었습니다</p>
        <button class="primary" data-act="after-ending">계속 날기</button>
      </div>
      <div id="debug" class="hidden"></div>
    `;
    for (const id of ['loading', 'title', 'hud', 'compass', 'questline', 'timer', 'feathers', 'shards', 'speedo', 'altimeter', 'wind', 'cargo', 'stallwarn', 'reticle', 'prompt', 'toasts', 'dialog', 'stun', 'panel-wrap', 'panel', 'photo-bar', 'ending', 'debug', 'hint']) {
      this.els[id] = root.querySelector(`#${id}`) as HTMLElement;
    }
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => this.onInput(e));
    root.addEventListener('change', (e) => this.onInput(e));
    this.buildCompass();
  }

  /* -------------------------------- screens ------------------------------- */

  setLoading(p: number, text?: string): void {
    const bar = this.els.loading.querySelector('.bar > i') as HTMLElement;
    bar.style.width = `${Math.round(p * 100)}%`;
    if (text) (this.els.loading.querySelector('.tip') as HTMLElement).textContent = text;
  }

  hideLoading(): void {
    this.els.loading.style.opacity = '0';
    setTimeout(() => this.els.loading.classList.add('hidden'), 800);
  }

  showTitle(hasSave: boolean): void {
    this.els.title.classList.remove('hidden');
    (this.els.title.querySelector('[data-act=continue]') as HTMLButtonElement).disabled = !hasSave;
    this.showHud(false);
  }

  hideTitle(): void {
    this.els.title.classList.add('hidden');
  }

  get titleVisible(): boolean {
    return !this.els.title.classList.contains('hidden');
  }

  showHud(on: boolean): void {
    this.els.hud.classList.toggle('hidden', !on);
    if (!on) this.els.reticle.classList.add('hidden');
  }

  showStun(on: boolean): void {
    this.els.stun.classList.toggle('hidden', !on);
  }

  showPhotoBar(on: boolean, time = 0): void {
    this.els['photo-bar'].classList.toggle('hidden', !on);
    (this.root.querySelector('#photo-time') as HTMLInputElement).value = String(time);
  }

  showEnding(on: boolean, stats?: { deliveries: number; feathers: number; shards: number; playTime: number }): void {
    const e = this.els.ending;
    if (on && stats) {
      (e.querySelector('.stats') as HTMLElement).innerHTML = `<span>📮 배달 ${stats.deliveries}회</span><span>🪶 깃털 ${stats.feathers}</span><span>✦ 바람 조각 ${stats.shards}/30</span><span>⏱ ${Math.floor(stats.playTime / 60)}분</span>`;
    }
    e.classList.toggle('show', on);
    e.style.pointerEvents = on ? 'auto' : 'none';
  }

  get endingShown(): boolean {
    return this.els.ending.classList.contains('show');
  }

  toggleDebug(): void {
    this.debugOn = !this.debugOn;
    this.els.debug.classList.toggle('hidden', !this.debugOn);
  }

  setDebug(text: string): void {
    if (this.debugOn) this.els.debug.textContent = text;
  }

  /* -------------------------------- toasts / dialog ------------------------------- */

  toast(text: string, kind: '' | 'gold' | 'bad' | 'blue' = '', ms = 3200): void {
    const t = document.createElement('div');
    t.className = `toast hud-glass ${kind}`;
    t.textContent = text;
    this.els.toasts.appendChild(t);
    while (this.els.toasts.children.length > 4) this.els.toasts.firstElementChild?.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 700);
    }, ms);
  }

  get dialogOpen(): boolean {
    return !this.els.dialog.classList.contains('hidden');
  }

  dialog(name: string, title: string, text: string, options: { label: string; primary?: boolean; cb: () => void }[]): void {
    const d = this.els.dialog;
    (d.querySelector('.who') as HTMLElement).innerHTML = `${esc(name)}<small>${esc(title)}</small>`;
    (d.querySelector('.txt') as HTMLElement).textContent = text;
    const opts = d.querySelector('.opts') as HTMLElement;
    this.dialogHandlers = options.map((o) => o.cb);
    opts.innerHTML = options.map((o, i) => `<button class="${o.primary ? 'primary' : ''}" data-dlg="${i}">${esc(o.label)}</button>`).join('');
    d.classList.remove('hidden');
  }

  closeDialog(): void {
    this.els.dialog.classList.add('hidden');
    this.dialogHandlers = [];
  }

  /** Activate the first dialog option (keyboard E / Enter). */
  dialogConfirm(): void {
    const cb = this.dialogHandlers[0];
    if (cb) cb();
  }

  /* -------------------------------- panels ------------------------------- */

  get panelOpen(): string | null {
    return this.openPanelName;
  }

  closePanel(): void {
    this.openPanelName = null;
    this.els['panel-wrap'].classList.add('hidden');
    this.els['panel-wrap'].id = 'panel-wrap';
  }

  private showPanel(name: string, html: string, wide = false): void {
    this.openPanelName = name;
    const wrap = this.els['panel-wrap'];
    wrap.classList.remove('hidden');
    wrap.id = wide ? 'map-wrap' : 'panel-wrap';
    this.els.panel.innerHTML = `<button class="close small" data-act="close">닫기 ✕</button>${html}`;
  }

  refreshPanel(): void {
    switch (this.openPanelName) {
      case 'post': this.openPostOffice(this.poTab); break;
      case 'quests': this.openQuestLog(); break;
      case 'settings': this.openSettings(); break;
      default: break;
    }
  }

  openSettings(): void {
    const s = this.host.getSettings();
    const opt = (v: Quality, l: string): string => `<option value="${v}" ${s.quality === v ? 'selected' : ''}>${l}</option>`;
    this.showPanel('settings', `
      <h2>설정</h2>
      <div class="row"><label>그래픽 품질</label><select data-set="quality">${opt('low', '낮음')}${opt('medium', '중간')}${opt('high', '높음')}</select></div>
      <div class="row"><label>마우스 감도</label><input type="range" min="0.2" max="3" step="0.05" value="${s.mouseSensitivity}" data-set="mouseSensitivity"></div>
      <div class="row"><label>비행 조작<br><span class="muted">쉬운 조작: 마우스 커서가 있는 쪽으로 날아감 · 고급 조작: 기체를 직접 조종</span></label><select data-set="controlMode"><option value="easy" ${s.controlMode !== 'classic' ? 'selected' : ''}>쉬운 조작</option><option value="classic" ${s.controlMode === 'classic' ? 'selected' : ''}>고급 조작</option></select></div>
      <div class="row"><label>Y축 반전</label><input type="checkbox" ${s.invertY ? 'checked' : ''} data-set="invertY"></div>
      <div class="row"><label>전체 볼륨</label><input type="range" min="0" max="1" step="0.01" value="${s.masterVolume}" data-set="masterVolume"></div>
      <div class="row"><label>음악</label><input type="range" min="0" max="1" step="0.01" value="${s.musicVolume}" data-set="musicVolume"></div>
      <div class="row"><label>효과음</label><input type="range" min="0" max="1" step="0.01" value="${s.sfxVolume}" data-set="sfxVolume"></div>
      <div class="row"><label>세계 시드<br><span class="muted">바꾸면 새로운 하늘이 생성됩니다 (진행도는 유지)</span></label><input type="text" value="${esc(s.seed)}" id="seed-input" maxlength="24"><button class="small" data-act="apply-seed">적용</button></div>
      <p class="muted">그래픽 품질 중 풀 밀도와 구름 양은 다음 로딩부터 적용됩니다.</p>`);
  }

  openControls(): void {
    this.showPanel('controls', `
      <h2>조작법</h2>
      <h3>비행 · 쉬운 조작 (기본)</h3>
      <p class="muted" style="margin:0 0 8px">마우스 커서를 가고 싶은 곳에 두면 글라이더가 그쪽으로 날아가요. 커서를 위에 두면 올라가고, 아래에 두면 내려가고, 옆에 두면 그쪽으로 돌아요. 화면 가운데쯤이면 천천히 활공합니다.</p>
      <div class="keys">
        <span><b>마우스 커서</b></span><span>가는 방향 (위 = 상승, 아래 = 하강, 좌우 = 선회)</span>
        <span><b>W</b><b>S</b> / <b>↑</b><b>↓</b></span><span>위로 / 아래로 (키를 누르는 동안 커서 대신 사용)</span>
        <span><b>A</b><b>D</b> / <b>←</b><b>→</b></span><span>왼쪽 / 오른쪽으로 돌기</span>
        <span><b>Shift</b></span><span>날개 접기 — 급강하로 속도 얻기</span>
        <span><b>Space</b></span><span>날개 활짝 — 감속, 착륙 준비</span>
        <span><b>V</b></span><span>1인칭 / 3인칭 전환</span>
        <span><b>R</b></span><span>레이스 포기</span>
      </div>
      <h3>비행 · 고급 조작 (설정에서 선택)</h3>
      <div class="keys">
        <span><b>마우스</b> / <b>W</b><b>S</b></span><span>피치 (W 기수 내리기 / S 올리기)</span>
        <span><b>마우스</b> / <b>A</b><b>D</b></span><span>롤 (기울이면 선회)</span>
        <span><b>Q</b> <b>E</b></span><span>요 (좌우로 기수 돌리기)</span>
      </div>
      <h3>지상</h3>
      <div class="keys">
        <span><b>WASD</b></span><span>걷기 (Shift 달리기)</span>
        <span><b>Space</b></span><span>점프</span>
        <span><b>F</b></span><span>이륙 — 절벽에서 뛰어내려도 글라이더가 펼쳐집니다</span>
        <span><b>E</b></span><span>대화 / 배달 / 우체국 이용</span>
      </div>
      <h3>기타</h3>
      <div class="keys">
        <span><b>M</b></span><span>지도</span>
        <span><b>J</b> / <b>Tab</b></span><span>퀘스트 로그 · 기록</span>
        <span><b>P</b></span><span>사진 모드</span>
        <span><b>Esc</b></span><span>일시정지</span>
        <span><b>F3</b></span><span>디버그 정보</span>
        <span><b>게임패드</b></span><span>왼스틱 피치/롤 · LB/RB 요 · RT 급강하 · LT 감속 · A 점프/이륙 · X 상호작용 · Y 시점 · Back 지도 · Start 일시정지</span>
      </div>
      <h3>비행 요령</h3>
      <p class="muted">글라이더는 엔진이 없어요. 고도를 내주고 속도를 얻고, 속도를 들여 고도를 얻습니다. 떠오르는 꽃잎과 아지랑이가 보이는 곳은 상승기류 — 천천히 원을 그리며 오르세요. 반짝이는 바람 줄기는 바람 강, 들어가면 빠르게 실려 갑니다. 섬 위에서 Space로 천천히 다가가면 부드럽게 착지합니다.</p>`);
  }

  openPause(): void {
    this.showPanel('pause', `
      <h2>잠시 쉬어요</h2>
      <div style="display:flex;flex-direction:column;gap:10px;max-width:280px">
        <button class="primary" data-act="resume">계속하기</button>
        <button data-act="questlog">퀘스트 로그</button>
        <button data-act="map">지도</button>
        <button data-act="settings">설정</button>
        <button data-act="controls">조작법</button>
        <button data-act="photo">사진 모드</button>
        <button data-act="quit">타이틀로 (자동 저장)</button>
      </div>`);
  }

  openQuestLog(): void {
    const s = this.host.getSave();
    const active = s.quests.active.map((a) => {
      const d = QUESTS.find((q) => q.id === a.id) as QuestDef;
      const npc = NPC_BY_ID[d.recipient];
      const extra = d.type === 'fragile' ? ` · 상태 ${Math.round(a.integrity)}%` : d.type === 'express' && a.timeLeft !== null ? ` · 남은 시간 ${formatTime(a.timeLeft)} · 링 ${a.ringIndex}/${a.ringsTotal}` : '';
      return `<div class="card"><div><span class="chip ${d.type}">${TYPE_LABEL[d.type]}</span></div><div class="t">${esc(d.title)}</div><div class="d">${esc(npc.name)}에게 · ${esc(this.host.questTarget(d))}${extra}</div></div>`;
    }).join('');
    const done = s.quests.completed.length;
    const total = QUESTS.length;
    const records = ['초원 일주', '협곡 질주', '구름 미로'].map((n, i) => `<div class="row"><label>링 레이스 · ${n}</label><span>${s.raceBest[i] !== null ? formatTime(s.raceBest[i] as number) : '—'}</span></div>`).join('');
    this.showPanel('quests', `
      <h2>퀘스트 로그</h2>
      <h3>진행 중 (${s.quests.active.length}/${cargoCapacity(s)})</h3>
      ${active ? `<div class="cards">${active}</div>` : '<p class="muted">받은 의뢰가 없어요. 바람마루 우체국 게시판에서 의뢰를 받아 보세요.</p>'}
      <h3>완료 ${done}/${total}</h3>
      <div class="cards">${QUESTS.filter((q) => s.quests.completed.includes(q.id)).map((q) => `<div class="card"><div class="t">✓ ${esc(q.title)}</div><div class="d">${esc(NPC_BY_ID[q.recipient].name)} · 깃털 ${q.reward}</div></div>`).join('') || '<p class="muted">아직 없어요.</p>'}</div>
      <h3>기록</h3>
      ${records}
      <div class="row"><label>최고 고도</label><span>${Math.round(s.maxAltitude)} m</span></div>
      <div class="row"><label>최고 속도</label><span>${Math.round(s.maxSpeed * 3.6)} km/h</span></div>
      <div class="row"><label>바람 조각</label><span>${s.shards.length} / 30</span></div>`);
  }

  openPostOffice(tab = 'quests'): void {
    this.poTab = tab;
    const s = this.host.getSave();
    const cap = cargoCapacity(s);
    const tabs = [['quests', '의뢰'], ['upgrades', '업그레이드'], ['custom', '꾸미기'], ['rest', '휴식']]
      .map(([k, l]) => `<button class="small ${k === tab ? 'on' : ''}" data-po="${k}">${l}</button>`).join('');
    let body = '';
    if (tab === 'quests') {
      const avail = availableQuests(QUESTS, s.quests, cap);
      const cards = avail.map((q) => {
        const npc = NPC_BY_ID[q.recipient];
        return `<div class="card"><div><span class="chip ${q.type}">${TYPE_LABEL[q.type]}</span>${q.timeLimit ? `<span class="chip">⏱ ${formatTime(q.timeLimit)}</span>` : ''}</div>
          <div class="t">${esc(q.title)}</div><div class="d">${esc(q.briefing)}</div>
          <div class="muted">받는 이: ${esc(npc.name)} (${esc(this.host.questTarget(q))}) · 🪶 ${q.reward}</div>
          <button class="small primary" data-quest="${q.id}">받기</button></div>`;
      }).join('');
      const remaining = QUESTS.length - s.quests.completed.length - s.quests.active.length;
      body = `<p class="muted">화물 칸 ${s.quests.active.length}/${cap} · 남은 의뢰 ${remaining}개</p>
        ${cards ? `<div class="cards">${cards}</div>` : `<p>${s.quests.active.length >= cap ? '화물 칸이 가득 찼어요. 먼저 배달을 마치거나 화물 칸을 늘려 보세요.' : s.quests.completed.length >= QUESTS.length ? '모든 편지를 전했어요. 고마워요, 배달부!' : '지금은 새 의뢰가 없어요.'}</p>`}`;
    } else if (tab === 'upgrades') {
      body = `<div class="cards">${UPGRADES.map((u) => {
        const lvl = s.upgrades[u.key];
        const cost = upgradeCost(s, u.key);
        return `<div class="card"><div class="t">${u.name}</div><div class="d">${u.desc}</div>
          <div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
          <button class="small ${cost !== null && s.feathers >= cost ? 'primary' : ''}" data-up="${u.key}" ${cost === null || s.feathers < cost ? 'disabled' : ''}>${cost === null ? '최대' : `🪶 ${cost}`}</button></div>`;
      }).join('')}</div>`;
    } else if (tab === 'custom') {
      body = `<h3>날개 색</h3><div class="swatches">${COLORS.map((c, i) => {
        const own = s.ownedColors.includes(i);
        return `<div class="swatch ${s.color === i ? 'sel' : ''} interactive" data-color="${i}"><div class="c" style="background:linear-gradient(135deg,#${c.primary.toString(16).padStart(6, '0')} 60%,#${c.secondary.toString(16).padStart(6, '0')} 60%)"></div>${esc(c.name)}<span class="muted">${own ? '보유' : `🪶 ${c.cost}`}</span></div>`;
      }).join('')}</div>
      <h3>날개 무늬</h3><div class="swatches">${PATTERNS.map((p, i) => {
        const own = s.ownedPatterns.includes(i);
        const unlocked = patternUnlocked(s, i);
        return `<div class="swatch ${s.pattern === i ? 'sel' : ''} ${unlocked ? '' : 'lock'} interactive" data-pattern="${i}"><div class="c" style="background:${patternPreview(i)}"></div>${esc(p.name)}<span class="muted">${!unlocked ? `✦ ${p.shards}개 필요` : own ? '보유' : p.cost ? `🪶 ${p.cost}` : '무료'}</span></div>`;
      }).join('')}</div>`;
    } else {
      body = `<p>우체국 벤치에서 잠시 쉬어 갈 수 있어요.</p>
        <div style="display:flex;gap:10px"><button class="primary" data-act="rest-night">밤까지 쉬기 🌙</button><button data-act="rest-morning">아침까지 쉬기 ☀️</button></div>
        <p class="muted">야간 배달은 밤에만 받는 사람이 기다리고 있어요.</p>`;
    }
    this.showPanel('post', `<h2>바람마루 우체국 <span class="muted">🪶 ${s.feathers}</span></h2><div class="tabs">${tabs}</div>${body}`);
  }

  openMap(): void {
    this.showPanel('map', `<h2>지도</h2><canvas class="map" id="map-canvas" width="1100" height="1000"></canvas><p class="muted">● 발견한 섬 · ○ 미발견 · 하늘색 선: 바람 강 · 보라: 폭풍 · ★ 퀘스트 목적지 · ◎ 레이스 출발점</p>`, true);
    const c = this.root.querySelector('#map-canvas') as HTMLCanvasElement;
    this.host.drawMap(c);
  }

  redrawMap(): void {
    const c = this.root.querySelector('#map-canvas') as HTMLCanvasElement | null;
    if (c && this.openPanelName === 'map') this.host.drawMap(c);
  }

  /* -------------------------------- HUD ------------------------------- */

  private buildCompass(): void {
    const strip = this.els.compass.querySelector('.strip') as HTMLElement;
    const labels: Record<number, string> = { 0: '북', 45: '북동', 90: '동', 135: '남동', 180: '남', 225: '남서', 270: '서', 315: '북서' };
    let html = '';
    for (let rep = -1; rep <= 1; rep++) {
      for (let d = 0; d < 360; d += 15) {
        const x = (d + rep * 360) * 3;
        html += `<div class="tick" style="left:${x}px;height:${d % 45 === 0 ? 10 : 6}px"></div>`;
        if (labels[d]) html += `<div class="lbl" style="left:${x}px">${labels[d]}</div>`;
      }
    }
    strip.innerHTML = html;
  }

  updateHud(h: HudData): void {
    this.els.hud.classList.toggle('faded', h.faded);
    const strip = this.els.compass.querySelector('.strip') as HTMLElement;
    const hdeg = ((h.heading * 180) / Math.PI + 360) % 360;
    strip.style.transform = `translateX(${-hdeg * 3}px)`;
    // Markers.
    const comp = this.els.compass;
    const w = comp.clientWidth;
    const mk = h.markers.map((m) => `${m.label}${m.ring ? 1 : 0}`).join('|');
    if (mk !== this.lastMarkers) {
      this.lastMarkers = mk;
      comp.querySelectorAll('.marker').forEach((m) => m.remove());
      for (const m of h.markers) {
        const el = document.createElement('div');
        el.className = `marker ${m.ring ? 'ring' : ''}`;
        el.textContent = m.ring ? '◆' : '★';
        el.title = m.label;
        comp.appendChild(el);
      }
    }
    const els = comp.querySelectorAll<HTMLElement>('.marker');
    h.markers.forEach((m, idx) => {
      const el = els[idx];
      if (!el) return;
      let rel = (m.bearing - h.heading) * (180 / Math.PI);
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      const x = Math.max(8, Math.min(w - 8, w / 2 + rel * 3));
      el.style.left = `${x}px`;
      el.style.opacity = Math.abs(rel) > 85 ? '0.45' : '1';
    });
    const ql = this.els.questline;
    ql.classList.toggle('hidden', !h.questLine);
    ql.textContent = h.questLine;
    const tm = this.els.timer;
    tm.classList.toggle('hidden', h.timer === null);
    if (h.timer !== null) {
      tm.textContent = formatTime(Math.abs(h.timer));
      tm.classList.toggle('warn', h.timer > 0 && h.timer < 20);
    }
    this.els.feathers.textContent = `🪶 ${h.feathers}`;
    this.els.shards.textContent = `✦ ${h.shards}/30`;
    this.els.hint.textContent = h.hint;
    this.els.hint.classList.toggle('hidden', !h.hint);

    // Gauges.
    const key = `${Math.round(h.speed)}|${Math.round(h.altitude)}|${h.stallSpeed.toFixed(0)}|${Math.round(h.windDir * 20)}|${Math.round(h.windSpeed)}|${h.flying}|${Math.round(h.vspeed * 2)}`;
    if (key !== this.lastHud) {
      this.lastHud = key;
      this.drawSpeedo(h);
      this.drawAlt(h);
      this.drawWind(h);
    }
    this.els.stallwarn.classList.toggle('hidden', !(h.flying && h.stall > 0.4));
    const rt = this.els.reticle;
    rt.classList.toggle('hidden', !h.reticle);
    if (h.reticle) rt.style.transform = `translate(${h.reticle.x}px, ${h.reticle.y}px) translate(-50%, -50%)`;
    const pr = this.els.prompt;
    pr.classList.toggle('hidden', !h.prompt);
    if (h.prompt) pr.innerHTML = h.prompt;
    const cg = this.els.cargo;
    cg.classList.toggle('hidden', h.cargo.length === 0);
    const cargoHtml = h.cargo.map((c) => `<div class="item"><span>📦 ${esc(c.name)}</span>${c.integrity !== null ? `<div class="hp"><i style="width:${c.integrity}%;background:${c.integrity < 35 ? '#d9665c' : c.integrity < 70 ? '#e8b64a' : '#6fbf8a'}"></i></div>` : `<span class="chip ${c.type}">${esc(TYPE_LABEL[c.type as keyof typeof TYPE_LABEL] ?? '')}</span>`}</div>`).join('');
    if (cargoHtml !== this.lastCargo) {
      this.lastCargo = cargoHtml;
      cg.innerHTML = cargoHtml;
    }
  }

  private drawSpeedo(h: HudData): void {
    const svg = this.els.speedo;
    const cx = 75, cy = 80, r = 58;
    const a0 = Math.PI * 0.85, a1 = Math.PI * 2.15;
    const ang = (v: number): number => a0 + (a1 - a0) * Math.min(1, Math.max(0, v / h.maxSpeed));
    const arc = (v0: number, v1: number, color: string, width: number): string => {
      const s = ang(v0), e = ang(v1);
      const large = e - s > Math.PI ? 1 : 0;
      return `<path d="M ${cx + Math.cos(s) * r} ${cy + Math.sin(s) * r} A ${r} ${r} 0 ${large} 1 ${cx + Math.cos(e) * r} ${cy + Math.sin(e) * r}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round"/>`;
    };
    const na = ang(h.speed);
    const kmh = Math.round(h.speed * 3.6);
    svg.innerHTML = `${arc(0, h.maxSpeed, 'rgba(61,53,72,.15)', 8)}${arc(0, h.stallSpeed, 'rgba(217,102,92,.75)', 8)}${arc(h.stallSpeed, Math.min(h.speed, h.maxSpeed), '#4f8fc9', 8)}
      <line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(na) * (r - 12)}" y2="${cy + Math.sin(na) * (r - 12)}" stroke="#3d3548" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="5" fill="#3d3548"/>
      <text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="22" font-weight="800" fill="#3d3548">${kmh}</text>
      <text x="${cx}" y="${cy + 38}" text-anchor="middle" font-size="9" fill="#6d6378">km/h ${h.flying ? '' : '· 지상'}</text>`;
  }

  private drawAlt(h: HudData): void {
    const tape = this.els.altimeter.querySelector('.tape') as HTMLElement;
    const step = 20;
    const base = Math.floor(h.altitude / step) * step;
    let html = '';
    for (let k = -4; k <= 4; k++) {
      const v = base + k * step;
      const y = 75 - (v - h.altitude) * 1.9 - 7;
      html += `<div class="ln" style="top:${y}px">${v}</div>`;
    }
    tape.innerHTML = html;
    (this.els.altimeter.querySelector('.read') as HTMLElement).textContent = `${Math.round(h.altitude)}m`;
    const vs = this.els.altimeter.querySelector('.vs') as HTMLElement;
    vs.textContent = `${h.vspeed >= 0 ? '▲' : '▼'} ${Math.abs(h.vspeed).toFixed(1)}`;
    vs.style.color = h.vspeed >= 0 ? '#3f8f5f' : '#b5453c';
  }

  private drawWind(h: HudData): void {
    const svg = this.els.wind.querySelector('svg') as SVGElement;
    const a = h.windDir;
    const len = Math.min(26, 8 + h.windSpeed * 1.2);
    const x = 37 + Math.sin(a) * len, y = 37 - Math.cos(a) * len;
    const x0 = 37 - Math.sin(a) * len * 0.6, y0 = 37 + Math.cos(a) * len * 0.6;
    svg.innerHTML = `<circle cx="37" cy="37" r="30" fill="rgba(255,255,255,.4)" stroke="rgba(61,53,72,.2)"/>
      <polygon points="37,9 34,15 40,15" fill="#3d3548"/>
      <line x1="${x0}" y1="${y0}" x2="${x}" y2="${y}" stroke="#4f8fc9" stroke-width="4" stroke-linecap="round"/>
      <circle cx="${x}" cy="${y}" r="4" fill="#4f8fc9"/>`;
    (this.els.wind.querySelector('.lab') as HTMLElement).textContent = `바람 ${h.windSpeed.toFixed(0)} m/s`;
  }

  /* -------------------------------- events ------------------------------- */

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act],[data-po],[data-quest],[data-up],[data-color],[data-pattern],[data-dlg]') as HTMLElement | null;
    if (!t) return;
    const h = this.host;
    h.click();
    const d = t.dataset;
    if (d.dlg !== undefined) {
      const cb = this.dialogHandlers[Number(d.dlg)];
      if (cb) cb();
      return;
    }
    if (d.po) return this.openPostOffice(d.po);
    if (d.quest) { h.acceptQuest(d.quest); return; }
    if (d.up) { h.buyUpgrade(d.up as UpgradeKey); this.openPostOffice('upgrades'); return; }
    if (d.color !== undefined) { h.buyColor(Number(d.color)); this.openPostOffice('custom'); return; }
    if (d.pattern !== undefined) { h.buyPattern(Number(d.pattern)); this.openPostOffice('custom'); return; }
    switch (d.act) {
      case 'new': h.newGame(); break;
      case 'continue': h.continueGame(); break;
      case 'settings': this.openSettings(); break;
      case 'controls': this.openControls(); break;
      case 'close': this.closePanel(); if (!this.titleVisible) h.resume(); break;
      case 'resume': this.closePanel(); h.resume(); break;
      case 'questlog': this.openQuestLog(); break;
      case 'map': h.openMap(); break;
      case 'photo': this.closePanel(); h.enterPhoto(); break;
      case 'quit': this.closePanel(); h.quitToTitle(); break;
      case 'rest-night': h.rest('night'); break;
      case 'rest-morning': h.rest('morning'); break;
      case 'shot': h.takeScreenshot(); break;
      case 'photo-exit': h.exitPhoto(); break;
      case 'after-ending': h.continueAfterEnding(); break;
      case 'apply-seed': {
        const s = { ...h.getSettings() };
        s.seed = (this.root.querySelector('#seed-input') as HTMLInputElement).value.trim() || '바람';
        h.applySettings(s, true);
        break;
      }
      default: break;
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.id === 'photo-time') {
      this.host.setPhotoTime(Number(t.value));
      return;
    }
    const key = t.dataset.set as keyof Settings | undefined;
    if (!key) return;
    const s = { ...this.host.getSettings() } as Record<string, unknown>;
    if (t.type === 'checkbox') s[key] = t.checked;
    else if (t.type === 'range') s[key] = Number(t.value);
    else s[key] = t.value;
    this.host.applySettings(s as unknown as Settings, false);
  }
}

function patternPreview(i: number): string {
  const a = '#f4f1ea', b = '#d9665c';
  switch (i) {
    case 1: return `repeating-linear-gradient(0deg,${a} 0 8px,${b} 8px 16px)`;
    case 2: return `repeating-linear-gradient(45deg,${a} 0 7px,${b} 7px 14px)`;
    case 3: return `radial-gradient(${b} 25%, transparent 27%) 0 0/12px 12px, ${a}`;
    case 4: return `linear-gradient(90deg,${b},${a},${b})`;
    case 5: return `repeating-linear-gradient(70deg,${a} 0 6px,${b} 6px 8px)`;
    case 6: return `radial-gradient(#fff 15%, transparent 17%) 0 0/10px 13px, #3d4a7a`;
    case 7: return `conic-gradient(${a} 25%,${b} 0 50%,${a} 0 75%,${b} 0) 0 0/16px 16px`;
    case 8: return `repeating-radial-gradient(circle at 50% 120%,${a} 0 6px,${b} 6px 12px)`;
    case 9: return 'conic-gradient(#9fe8ff,#c8b4f0,#ffc4dc,#fff1a0,#a8e6d4,#9fe8ff)';
    default: return a;
  }
}
