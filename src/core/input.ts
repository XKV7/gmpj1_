/** Unified keyboard / mouse / gamepad input. */

export interface PadState {
  connected: boolean;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
  buttons: boolean[];
  pressed: boolean[];
}

const DEAD = 0.15;
const dz = (v: number): number => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class Input {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseDown = false;
  mouseClicked = false;
  pointerLocked = false;
  lastActivity = performance.now();
  pad: PadState = { connected: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: [], pressed: [] };
  private prevPadButtons: boolean[] = [];
  private canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.lastActivity = performance.now();
      if (['Space', 'Tab', 'F3', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked || this.mouseDown) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) this.lastActivity = performance.now();
      }
    });
    canvas.addEventListener('mousedown', () => {
      this.mouseDown = true;
      this.mouseClicked = true;
      this.lastActivity = performance.now();
    });
    window.addEventListener('mouseup', () => {
      this.mouseDown = false;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestLock(): void {
    if (this.pointerLocked) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      /* pointer lock not available (e.g. headless); mouse-drag fallback is used */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedKeys.has(code);
  }

  padDown(i: number): boolean {
    return !!this.pad.buttons[i];
  }

  padPressed(i: number): boolean {
    return !!this.pad.pressed[i];
  }

  pollGamepad(): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    const st = this.pad;
    if (!gp) {
      st.connected = false;
      st.lx = st.ly = st.rx = st.ry = st.lt = st.rt = 0;
      st.buttons = [];
      st.pressed = [];
      this.prevPadButtons = [];
      return;
    }
    st.connected = true;
    st.lx = dz(gp.axes[0] ?? 0);
    st.ly = dz(gp.axes[1] ?? 0);
    st.rx = dz(gp.axes[2] ?? 0);
    st.ry = dz(gp.axes[3] ?? 0);
    st.lt = gp.buttons[6]?.value ?? 0;
    st.rt = gp.buttons[7]?.value ?? 0;
    const btn = gp.buttons.map((b) => b.pressed);
    st.pressed = btn.map((b, i) => b && !this.prevPadButtons[i]);
    st.buttons = btn;
    this.prevPadButtons = btn;
    if (Math.abs(st.lx) + Math.abs(st.ly) + Math.abs(st.rx) + Math.abs(st.ry) + st.lt + st.rt > 0.05 || btn.some((b) => b)) {
      this.lastActivity = performance.now();
    }
  }

  endFrame(): void {
    this.pressedKeys.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.mouseClicked = false;
  }
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

/** Standard gamepad button indices. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
