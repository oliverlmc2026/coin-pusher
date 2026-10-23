import './style.css';
import { CoinSystem, GEM_COLORS, MAX_BODIES, type CoinKindDef, type CoinKindId, type KindCtx } from './coins';
import { Input } from './input';
import { Pusher } from './pusher';
import { OUTCOMES, SlotController, type Effect } from './slot';
import { Machine, type ExitKind } from './world';

const FIXED = 1 / 60;
const MAX_SUBSTEPS = 5;
const RAIN_PER_SEC = 30;
const SPECIAL_PER_SEC = 6;
const HOLD_REPEAT = 0.2;
const WALL_TOP = 2.8;
const RAIL_BASE = 0.5;
const RAIL_SPEED = 8;
const GEM_SET_BONUS = 500;
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
const slotHost = document.createElement('div');
slotHost.className = 'slot-host';
hud.append(creditsBox, slotHost);

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
let rainLeft = 0;
let rainAcc = 0;
let specialAcc = 0;
const specialQueue: CoinKindId[] = [];
let wallLeft = 0;
let railTop = 0;
const gems: boolean[] = GEM_COLORS.map(() => false);
let stepMs = 0;
let warmingUp = true;

const kindCtx: KindCtx = {
  explode(pos, radius, strength) {
    coins.applyBlast(pos, radius, strength);
    machine.burst(pos, radius, 0xff8a1f);
  },
  collectGem(color) {
    gems[color] = true;
    if (gems.every(Boolean)) {
      gems.fill(false);
      setCredits(credits + GEM_SET_BONUS);
    }
  },
};

function onExit(def: CoinKindDef, exit: ExitKind): void {
  if (warmingUp) return;
  if (exit === 'win') {
    counters.wins++;
    counters.winCredits += def.value;
    setCredits(credits + def.value);
  } else if (exit === 'lost') counters.losts++;
  else {
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

const slot = new SlotController(slotHost, Math.random, {
  onSpinStart() {},
  onTick() {},
  onResolved: (o) => applyEffect(o.effect),
});

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
  if (rainLeft > 0) {
    rainAcc += RAIN_PER_SEC * FIXED;
    while (rainAcc >= 1 && rainLeft > 0) {
      coins.rain(0.08);
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
  const target = wallLeft > 0 ? WALL_TOP : RAIL_BASE;
  const dy = target - railTop;
  railTop += Math.sign(dy) * Math.min(Math.abs(dy), RAIL_SPEED * FIXED);
  machine.setRailTop(railTop);
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
  slot.update(dt);
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
    get slotPhase() {
      return slot.state.phase;
    },
    get stepMs() {
      return stepMs;
    },
    get counters() {
      return { ...counters };
    },
    drop: (x: number) => tryDrop(x),
    forceSlot: (id?: string) => {
      slot.forcedNext = OUTCOMES.find((o) => o.id === id) ?? null;
      slot.trigger();
    },
    spawn: (kind: CoinKindId) => coins.spawnKind(kind),
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
      readonly slotPhase: string;
      readonly stepMs: number;
      readonly counters: { wins: number; losts: number; jackpots: number; winCredits: number };
      drop(x: number): boolean;
      forceSlot(outcomeId?: string): void;
      spawn(kind: CoinKindId): void;
      advance(seconds: number): void;
      giveCredits(n: number): void;
    };
  }
}
