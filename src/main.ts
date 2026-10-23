import './style.css';
import { CoinSystem, MAX_BODIES, type CoinKindDef, type KindCtx } from './coins';
import { Input } from './input';
import { Pusher } from './pusher';
import { Machine, type ExitKind } from './world';

const FIXED = 1 / 60;
const MAX_SUBSTEPS = 5;
const HOLD_REPEAT = 0.2;
const WARMUP_STEPS = 150;
const SLOW_STEP_MS = 7;
const SLOW_CAP = 180;
const START_CREDITS = 100;

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const creditsEl = document.createElement('b');
creditsEl.className = 'credits-n';
const creditsBox = document.createElement('div');
creditsBox.className = 'credits';
creditsBox.append(creditsEl);
hud.append(creditsBox);

let credits = START_CREDITS;
const setCredits = (n: number) => {
  credits = n;
  creditsEl.textContent = String(credits);
};
setCredits(credits);

const machine = new Machine(canvas);
const pusher = new Pusher(machine.pusherBody);
const counters = { wins: 0, losts: 0, jackpots: 0, winCredits: 0 };
let holdCooldown = 0;
let stepMs = 0;
let warmingUp = true;

const kindCtx: KindCtx = {
  explode(pos, radius, strength) {
    coins.applyBlast(pos, radius, strength);
    machine.burst(pos, radius, 0xff8a1f);
  },
  collectGem() {
    setCredits(credits + 3);
  },
};

function onExit(def: CoinKindDef, exit: ExitKind): void {
  if (warmingUp) return;
  if (exit === 'win') {
    counters.wins++;
    counters.winCredits += def.value;
    setCredits(credits + def.value);
  } else if (exit === 'lost') counters.losts++;
  else counters.jackpots++;
}

const coins = new CoinSystem(machine, kindCtx, { exit: onExit });

function tryDrop(x: number): boolean {
  if (credits < 1) return false;
  setCredits(credits - 1);
  coins.drop(x, 1, 0.08);
  return true;
}

const input = new Input(canvas, machine, (x) => {
  holdCooldown = HOLD_REPEAT;
  tryDrop(x);
});

function fixedStep(): void {
  pusher.step(FIXED);
  if (input.holding) {
    holdCooldown -= FIXED;
    if (holdCooldown <= 0) {
      holdCooldown = HOLD_REPEAT;
      tryDrop(input.aimX);
    }
  }
  const t0 = performance.now();
  machine.physics.step(FIXED);
  stepMs += (performance.now() - t0 - stepMs) * 0.05;
  coins.postStep(FIXED);
}

function resize(): void {
  machine.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

coins.prefill();
for (let i = 0; i < WARMUP_STEPS; i++) {
  machine.physics.step(FIXED);
  coins.postStep(FIXED);
}
warmingUp = false;

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  acc += dt;
  let steps = 0;
  while (acc >= FIXED && steps < MAX_SUBSTEPS) {
    fixedStep();
    acc -= FIXED;
    steps++;
  }
  if (steps === MAX_SUBSTEPS) acc = 0;
  coins.cap = stepMs > SLOW_STEP_MS ? SLOW_CAP : MAX_BODIES;
  machine.updateFx(dt);
  machine.syncPusherMesh();
  coins.syncMeshes();
  machine.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  window.__game = {
    get credits() {
      return credits;
    },
    get bodies() {
      return coins.count;
    },
    get awake() {
      return coins.stats().awake;
    },
    get stepMs() {
      return stepMs;
    },
    get counters() {
      return { ...counters };
    },
    drop: (x: number) => tryDrop(x),
    advance(seconds: number) {
      for (let i = 0; i < seconds / FIXED; i++) fixedStep();
    },
    giveCredits: (n: number) => setCredits(credits + n),
  };
}

declare global {
  interface Window {
    __game?: {
      readonly credits: number;
      readonly bodies: number;
      readonly awake: number;
      readonly stepMs: number;
      readonly counters: { wins: number; losts: number; jackpots: number; winCredits: number };
      drop(x: number): boolean;
      advance(seconds: number): void;
      giveCredits(n: number): void;
    };
  }
}
