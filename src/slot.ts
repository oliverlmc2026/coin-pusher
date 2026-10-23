import type { CoinKindId } from './coins';

export type Effect =
  | { kind: 'rain'; n: number }
  | { kind: 'spawnSpecial'; coin: CoinKindId; count: number }
  | { kind: 'wall'; seconds: number };

export interface Outcome {
  readonly id: string;
  readonly weight: number;
  readonly label: string;
  readonly symbol: string;
  /** Nominal credit worth, used for the jackpot leaderboard. */
  readonly prize: number;
  readonly effect: Effect;
}

export const OUTCOMES: readonly Outcome[] = [
  { id: 'rain10', weight: 30, label: '銀幣雨 x10', symbol: '🍒', prize: 10, effect: { kind: 'rain', n: 10 } },
  { id: 'rain30', weight: 17, label: '銀幣雨 x30', symbol: '🔔', prize: 30, effect: { kind: 'rain', n: 30 } },
  { id: 'rain100', weight: 4, label: '超級銀幣雨 x100', symbol: '7️⃣', prize: 100, effect: { kind: 'rain', n: 100 } },
  { id: 'gold', weight: 14, label: '金幣 x5', symbol: '⭐', prize: 50, effect: { kind: 'spawnSpecial', coin: 'gold', count: 5 } },
  { id: 'gem', weight: 10, label: '寶石 x3', symbol: '💎', prize: 30, effect: { kind: 'spawnSpecial', coin: 'gem', count: 3 } },
  { id: 'big', weight: 9, label: '大幣 x3', symbol: '🪙', prize: 15, effect: { kind: 'spawnSpecial', coin: 'big', count: 3 } },
  { id: 'bomb', weight: 6, label: '炸彈 x3', symbol: '💣', prize: 5, effect: { kind: 'spawnSpecial', coin: 'bomb', count: 3 } },
  { id: 'wall', weight: 12, label: '護欄 10 秒', symbol: '🧱', prize: 20, effect: { kind: 'wall', seconds: 10 } },
];

export const SYMBOLS = [...new Set(OUTCOMES.map((o) => o.symbol))];
export const REEL_STOP_AT = [1.0, 1.6, 2.2] as const;
const RESULT_SHOWN = 2.4;
const MAX_QUEUE = 12;
/** While spins are queued, the reels run faster so the backlog clears. */
const CATCH_UP = 2.2;

export type SlotState =
  | { phase: 'idle' }
  | { phase: 'spinning'; elapsed: number; outcome: Outcome }
  | { phase: 'result'; outcome: Outcome; shown: number };

export function pickOutcome(rng: () => number): Outcome {
  const total = OUTCOMES.reduce((s, o) => s + o.weight, 0);
  let r = rng() * total;
  for (const o of OUTCOMES) {
    r -= o.weight;
    if (r <= 0) return o;
  }
  return OUTCOMES[0]!;
}

export function startSpin(rng: () => number): SlotState {
  return { phase: 'spinning', elapsed: 0, outcome: pickOutcome(rng) };
}

/** Pure reducer. `resolved` is set exactly once, on the frame the last reel stops. */
export function advanceSlot(s: SlotState, dt: number): { state: SlotState; resolved: Outcome | null } {
  switch (s.phase) {
    case 'idle':
      return { state: s, resolved: null };
    case 'spinning': {
      const elapsed = s.elapsed + dt;
      if (elapsed >= REEL_STOP_AT[2]) return { state: { phase: 'result', outcome: s.outcome, shown: 0 }, resolved: s.outcome };
      return { state: { ...s, elapsed }, resolved: null };
    }
    case 'result': {
      const shown = s.shown + dt;
      return { state: shown >= RESULT_SHOWN ? { phase: 'idle' } : { ...s, shown }, resolved: null };
    }
  }
}

/** Queues jackpot spins and renders the reels. */
export class SlotController {
  state: SlotState = { phase: 'idle' };
  pending = 0;
  /** Test seam: the next spin lands on this outcome instead of a weighted draw. */
  forcedNext: Outcome | null = null;
  private readonly root: HTMLElement;
  private readonly reels: HTMLElement[];
  private readonly caption: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly rng: () => number,
    private readonly hooks: { onSpinStart(): void; onTick(): void; onResolved(o: Outcome): void },
  ) {
    this.root = document.createElement('div');
    this.root.className = 'slot';
    this.root.hidden = true;
    this.root.innerHTML = '<div class="slot-title">JACKPOT</div><div class="slot-reels"><span></span><span></span><span></span></div><div class="slot-caption"></div>';
    this.reels = [...this.root.querySelectorAll<HTMLElement>('.slot-reels span')];
    this.caption = this.root.querySelector<HTMLElement>('.slot-caption')!;
    parent.appendChild(this.root);
  }

  trigger(): void {
    this.pending = Math.min(this.pending + 1, MAX_QUEUE);
  }

  update(dt: number): void {
    if (this.state.phase === 'idle' && this.pending > 0) {
      this.pending--;
      this.state = this.forcedNext ? { phase: 'spinning', elapsed: 0, outcome: this.forcedNext } : startSpin(this.rng);
      this.forcedNext = null;
      this.hooks.onSpinStart();
    }
    const { state, resolved } = advanceSlot(this.state, this.pending > 0 ? dt * CATCH_UP : dt);
    this.state = state;
    if (resolved) this.hooks.onResolved(resolved);
    this.render();
  }

  private lastTick = -1;

  private render(): void {
    const s = this.state;
    this.root.hidden = s.phase === 'idle';
    if (s.phase === 'idle') {
      this.lastTick = -1;
      return;
    }
    if (s.phase === 'spinning') {
      this.caption.textContent = this.pending > 0 ? `排隊中 x${this.pending}` : '轉動中…';
      const frame = Math.floor(s.elapsed * 14);
      this.reels.forEach((el, i) => {
        const stopped = s.elapsed >= REEL_STOP_AT[i]!;
        el.textContent = stopped ? s.outcome.symbol : SYMBOLS[(frame + i * 3) % SYMBOLS.length]!;
        el.classList.toggle('stopped', stopped);
      });
      if (frame !== this.lastTick) {
        this.lastTick = frame;
        this.hooks.onTick();
      }
    } else {
      this.reels.forEach((el) => {
        el.textContent = s.outcome.symbol;
        el.classList.add('stopped');
      });
      this.caption.textContent = s.outcome.label;
    }
  }
}
