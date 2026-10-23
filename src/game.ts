import { dateLabel, upsertEntry, writeSave, type SaveData } from './save';
import { UPGRADES, upgradeCost, type UpgradeId } from './shop';

export type GemResult = { kind: 'new' } | { kind: 'duplicate'; credits: number } | { kind: 'set'; credits: number };

const SET_BONUS = 500;
const DUPLICATE_BONUS = 3;
const BAILOUT = 10;

/** Live game economy over the persisted model. Mutations notify listeners and schedule an autosave. */
export class Game {
  private readonly listeners = new Set<() => void>();
  private saveTimer: number | undefined;
  private readonly runId = Date.now();
  private runPeak: number;

  constructor(readonly save: SaveData) {
    this.runPeak = save.credits;
  }

  get credits(): number {
    return this.save.credits;
  }

  level(id: UpgradeId): number {
    return this.save.upgrades[id];
  }

  effect(id: UpgradeId): number {
    return UPGRADES[id].effect(this.level(id));
  }

  cost(id: UpgradeId): number | null {
    const l = this.level(id);
    return l >= UPGRADES[id].maxLevel ? null : upgradeCost(id, l);
  }

  subscribe(fn: () => void): void {
    this.listeners.add(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
    if (this.saveTimer === undefined) this.saveTimer = window.setTimeout(() => this.flush(), 1500);
  }

  flush(): void {
    if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    writeSave(this.save);
  }

  addCredits(n: number): void {
    if (n === 0) return;
    this.save.credits += n;
    if (this.save.credits > this.runPeak) {
      this.runPeak = this.save.credits;
      const lb = this.save.leaderboard;
      lb.peak = upsertEntry(lb.peak, { id: this.runId, value: this.runPeak, label: dateLabel() });
    }
    this.changed();
  }

  trySpend(n: number): boolean {
    if (this.save.credits < n) return false;
    this.save.credits -= n;
    this.changed();
    return true;
  }

  buy(id: UpgradeId): boolean {
    const cost = this.cost(id);
    if (cost === null || !this.trySpend(cost)) return false;
    this.save.upgrades[id]++;
    this.changed();
    return true;
  }

  collectGem(color: number): GemResult {
    const gems = this.save.gems;
    if (gems[color]) {
      this.addCredits(DUPLICATE_BONUS);
      return { kind: 'duplicate', credits: DUPLICATE_BONUS };
    }
    gems[color] = true;
    if (gems.every(Boolean)) {
      gems.fill(false);
      this.save.gemSets++;
      this.addCredits(SET_BONUS);
      return { kind: 'set', credits: SET_BONUS };
    }
    this.changed();
    return { kind: 'new' };
  }

  recordJackpot(value: number): void {
    const lb = this.save.leaderboard;
    lb.jackpot = upsertEntry(lb.jackpot, { id: Date.now() + Math.floor(Math.random() * 1000), value, label: dateLabel() });
    this.changed();
  }

  /** Free credits when the player is broke, so the game never dead-ends. */
  bailout(): boolean {
    if (this.save.credits > 0) return false;
    this.save.credits = BAILOUT;
    this.changed();
    return true;
  }

  setMuted(m: boolean): void {
    this.save.muted = m;
    this.changed();
  }
}
