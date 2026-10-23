import './style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sfx } from './audio';
import { CoinSystem, MAX_BODIES, type CoinKindDef, type CoinKindId, type KindCtx } from './coins';
import { Game } from './game';
import { Input } from './input';
import { Pusher } from './pusher';
import { loadSave, type SaveData } from './save';
import { OUTCOMES, SlotController, type Effect, type Outcome } from './slot';
import { GEM_NAMES } from './coins';
import { Ui } from './ui';
import { Machine, type ExitKind } from './world';

await RAPIER.init();

const FIXED = 1 / 60;
const MAX_SUBSTEPS = 5;
const RAIN_PER_SEC = 30;
const SPECIAL_PER_SEC = 6;
const WALL_TOP = 2.8;
const RAIL_SPEED = 8;
const WARMUP_STEPS = 150;
const SLOW_STEP_MS = 7;
const SLOW_CAP = 180;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

const game = new Game(loadSave());
const sfx = new Sfx(game.save.muted);
const machine = new Machine(canvas);
const pusher = new Pusher(machine.pusherBody);

const counters = { wins: 0, losts: 0, jackpots: 0, winCredits: 0 };
let rainLeft = 0;
let rainAcc = 0;
let specialAcc = 0;
const specialQueue: CoinKindId[] = [];
let wallLeft = 0;
let railTop = 0;
let autoAcc = 0;
let autoT = 0;
let stepMs = 0;
const frameStats = { frames: 0, capped: 0, ms: 0, physMs: 0, renderMs: 0 };
let warmingUp = true;
let paused = false;

const ui = new Ui(hud, game, {
  onMuteToggle() {
    sfx.muted = !sfx.muted;
    game.setMuted(sfx.muted);
    ui.renderMute();
    sfx.resume();
  },
  onPauseToggle() {
    paused = !paused;
    ui.setPaused(paused);
  },
  onBailout() {
    if (game.bailout()) ui.toast('派咗 10 點救濟金，繼續加油！', 'good');
  },
  onBuy(_id, ok) {
    if (ok) sfx.buy();
    else sfx.deny();
  },
  onClick: () => sfx.click(),
});

const kindCtx: KindCtx = {
  explode(pos, radius, strength) {
    coins.applyBlast(pos, radius, strength);
    machine.burst(pos, radius, 0xff8a1f);
    sfx.bomb();
  },
  collectGem(color) {
    const r = game.collectGem(color);
    sfx.gem();
    if (r.kind === 'set') {
      ui.toast(`集齊五色寶石！+${r.credits}`, 'great');
      sfx.jackpot();
    } else if (r.kind === 'duplicate') ui.toast(`${GEM_NAMES[color]}（重複） +${r.credits}`, 'good');
    else ui.toast(`獲得 ${GEM_NAMES[color]}`, 'good');
  },
};

function onExit(def: CoinKindDef, exit: ExitKind): void {
  if (warmingUp) return;
  if (exit === 'win') {
    counters.wins++;
    counters.winCredits += def.value;
    if (def.value > 0) {
      game.addCredits(def.value);
      ui.noteWin(def.value);
      sfx.win(def.value);
    }
  } else if (exit === 'lost') {
    counters.losts++;
    sfx.lost();
  } else {
    counters.jackpots++;
    slot.trigger();
  }
}

const coins = new CoinSystem(machine, kindCtx, { exit: onExit });

function applyEffect(e: Effect): void {
  switch (e.kind) {
    case 'rain':
      rainLeft += e.n;
      break;
    case 'spawnSpecial':
      for (let i = 0; i < e.count; i++) specialQueue.push(e.coin);
      break;
    case 'wall':
      wallLeft = Math.max(wallLeft, e.seconds);
      break;
  }
}

const slot = new SlotController(ui.slotHost, Math.random, {
  onSpinStart: () => sfx.spinStart(),
  onTick: () => sfx.spinTick(),
  onResolved(o: Outcome) {
    if (o.effect.kind === 'none') {
      ui.toast(o.label, 'bad');
      return;
    }
    applyEffect(o.effect);
    game.recordJackpot(o.prize);
    ui.toast(o.label, 'great');
    sfx.jackpot();
  },
});

function tryDrop(x: number): boolean {
  const n = Math.min(game.effect('coinsPerDrop'), game.credits);
  if (n < 1 || !game.trySpend(n)) {
    sfx.deny();
    ui.toast('信用點不足', 'bad');
    return false;
  }
  coins.drop(x, n, game.effect('specialChance'));
  sfx.drop();
  return true;
}

new Input(canvas, machine, (x) => tryDrop(x));

function fixedStep(): void {
  pusher.speed = game.effect('pusherSpeed');
  pusher.step(FIXED);

  if (rainLeft > 0) {
    rainAcc += RAIN_PER_SEC * FIXED;
    while (rainAcc >= 1 && rainLeft > 0) {
      coins.rain(game.effect('specialChance'));
      rainAcc--;
      rainLeft--;
    }
  } else rainAcc = 0;
  if (specialQueue.length > 0) {
    specialAcc += SPECIAL_PER_SEC * FIXED;
    while (specialAcc >= 1 && specialQueue.length > 0) {
      coins.spawnKind(specialQueue.shift()!);
      specialAcc--;
    }
  } else specialAcc = 0;

  wallLeft = Math.max(0, wallLeft - FIXED);
  const perm = game.effect('sideWall');
  const target = wallLeft > 0 ? Math.max(perm, WALL_TOP) : perm;
  const dy = target - railTop;
  railTop += Math.sign(dy) * Math.min(Math.abs(dy), RAIL_SPEED * FIXED);
  machine.setRailTop(railTop);

  const rate = game.effect('autoDropper');
  if (rate > 0) {
    autoT += FIXED;
    autoAcc += rate * FIXED;
    if (autoAcc >= 1) {
      autoAcc -= 1;
      tryDrop(Math.sin(autoT * 1.1) * 4.2);
    }
  }

  const t0 = performance.now();
  machine.physics.step();
  stepMs += (performance.now() - t0 - stepMs) * 0.05;
  coins.postStep(FIXED);
}

function resize(): void {
  machine.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.flush();
});
window.addEventListener('pagehide', () => game.flush());
resize();

coins.prefill();
for (let i = 0; i < WARMUP_STEPS; i++) {
  machine.physics.step();
  coins.postStep(FIXED);
}
warmingUp = false;

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  // A zero dt freezes physics, the slot, effects and the auto-dropper while rendering continues.
  const dt = paused ? 0 : Math.min((now - last) / 1000, 0.1);
  last = now;
  acc += dt;
  let steps = 0;
  const p0 = performance.now();
  while (acc >= FIXED && steps < MAX_SUBSTEPS) {
    fixedStep();
    acc -= FIXED;
    steps++;
  }
  if (steps === MAX_SUBSTEPS) {
    acc = 0;
    frameStats.capped++;
  }
  frameStats.frames++;
  frameStats.ms += (dt * 1000 - frameStats.ms) * 0.1;
  frameStats.physMs += (performance.now() - p0 - frameStats.physMs) * 0.1;
  coins.cap = stepMs > SLOW_STEP_MS ? SLOW_CAP : MAX_BODIES;
  slot.update(dt);
  ui.setWall(wallLeft);
  machine.updateFx(dt);
  machine.syncPusherMesh();
  coins.syncMeshes();
  const r0 = performance.now();
  machine.render();
  frameStats.renderMs += (performance.now() - r0 - frameStats.renderMs) * 0.1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV && new URLSearchParams(location.search).has('debug')) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:6px;bottom:40px;z-index:99;margin:0;padding:6px 8px;font:11px/1.4 monospace;color:#0f0;background:rgba(0,0,0,.75);border-radius:6px;pointer-events:none';
  document.body.appendChild(box);
  const ptr = { down: 0, up: 0, cancel: 0 };
  canvas.addEventListener('pointerdown', () => ptr.down++);
  canvas.addEventListener('pointerup', () => ptr.up++);
  canvas.addEventListener('pointercancel', () => ptr.cancel++);
  let seen = { frames: 0, capped: 0 };
  let tick = 0;
  setInterval(() => {
    const f = frameStats.frames - seen.frames;
    const capPct = f ? Math.round((100 * (frameStats.capped - seen.capped)) / f) : 0;
    seen = { frames: frameStats.frames, capped: frameStats.capped };
    if (++tick % 4 === 0) {
      const stats = {
        frameMs: +frameStats.ms.toFixed(1),
        physPerFrameMs: +frameStats.physMs.toFixed(1),
        stepMs: +stepMs.toFixed(1),
        renderCpuMs: +frameStats.renderMs.toFixed(1),
        cappedPct: capPct,
        coins: coins.count,
        dpr: window.devicePixelRatio,
        canvas: `${canvas.width}x${canvas.height}`,
        ptr,
        awake: coins.stats().awake,
        ua: navigator.userAgent,
      };
      fetch('/__perf', { method: 'POST', body: JSON.stringify(stats), keepalive: true }).catch(() => {});
    }
    box.textContent =
      `frame ${frameStats.ms.toFixed(1)} ms (${Math.round(1000 / Math.max(frameStats.ms, 1))} fps)\n` +
      `physics ${frameStats.physMs.toFixed(1)} ms/frame, ${stepMs.toFixed(1)} ms/step\n` +
      `render cpu ${frameStats.renderMs.toFixed(1)} ms\n` +
      `slowed frames ${capPct}%\n` +
      `coins ${coins.count} / cap ${coins.cap}\n` +
      `pointer down ${ptr.down} up ${ptr.up} cancel ${ptr.cancel}`;
  }, 500);
}

if (import.meta.env.DEV) {
  window.__game = {
    get credits() {
      return game.credits;
    },
    get bodies() {
      return coins.count;
    },
    get awake() {
      return coins.stats().awake;
    },
    get save() {
      return game.save;
    },
    spawn: (kind: CoinKindId) => coins.spawnKind(kind),
    collectGem: (color: number) => kindCtx.collectGem(color),
    get stepMs() {
      return stepMs;
    },
    get slotPhase() {
      return slot.state.phase;
    },
    get counters() {
      return { ...counters };
    },
    drop: (x: number) => tryDrop(x),
    forceSlot: (id?: string) => {
      slot.forcedNext = OUTCOMES.find((o) => o.id === id) ?? null;
      slot.trigger();
    },
    advance(seconds: number) {
      for (let i = 0; i < seconds / FIXED; i++) {
        fixedStep();
        slot.update(FIXED);
      }
    },
    giveCredits: (n: number) => game.addCredits(n),
  };
}

declare global {
  interface Window {
    __game?: {
      readonly credits: number;
      readonly bodies: number;
      readonly awake: number;
      readonly slotPhase: string;
      readonly stepMs: number;
      readonly save: SaveData;
      spawn(kind: CoinKindId): void;
      collectGem(color: number): void;
      readonly counters: { wins: number; losts: number; jackpots: number; winCredits: number };
      drop(x: number): boolean;
      forceSlot(outcomeId?: string): void;
      advance(seconds: number): void;
      giveCredits(n: number): void;
    };
  }
}
