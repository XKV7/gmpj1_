import './style.css';
import { Game } from './game/game';

function fail(msg: string): void {
  const el = document.getElementById('ui');
  if (el) {
    el.innerHTML = `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f3ead9;color:#3d3548;font:16px sans-serif;text-align:center;padding:24px;pointer-events:auto">
      <div><h2>바람이 멈췄어요</h2><p>${msg}</p><p style="opacity:.7">WebGL2를 지원하는 최신 브라우저에서 다시 시도해 주세요.</p></div></div>`;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const probe = document.createElement('canvas').getContext('webgl2');
if (!probe) {
  fail('이 브라우저에서는 WebGL2를 사용할 수 없어요.');
} else {
  try {
    const game = new Game(canvas, ui);
    (window as unknown as { __game: Game }).__game = game;
    game.init().catch((e: unknown) => {
      console.error(e);
      fail('세계를 만드는 중 문제가 생겼어요.');
    });
  } catch (e) {
    console.error(e);
    fail('게임을 시작하지 못했어요.');
  }
}
