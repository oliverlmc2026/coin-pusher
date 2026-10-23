import { UPGRADES, UPGRADE_IDS, type UpgradeId } from './shop';

export const SAVE_KEY = 'coin-pusher-save';
export const START_CREDITS = 100;
export const LEADERBOARD_SIZE = 10;

export interface LbEntry {
  readonly id: number;
  readonly value: number;
  readonly label: string;
}

export type GemSet = [boolean, boolean, boolean, boolean, boolean];

export interface SaveData {
  version: 1;
  credits: number;
  upgrades: Record<UpgradeId, number>;
  gems: GemSet;
  gemSets: number;
  muted: boolean;
  leaderboard: { peak: LbEntry[]; jackpot: LbEntry[] };
}

export function defaultSave(): SaveData {
  const upgrades = {} as Record<UpgradeId, number>;
  for (const id of UPGRADE_IDS) upgrades[id] = 0;
  return {
    version: 1,
    credits: START_CREDITS,
    upgrades,
    gems: [false, false, false, false, false],
    gemSets: 0,
    muted: false,
    leaderboard: { peak: [], jackpot: [] },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function int(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;
}

function parseEntries(v: unknown): LbEntry[] {
  if (!Array.isArray(v)) return [];
  const out: LbEntry[] = [];
  for (const e of v) {
    if (!isObj(e) || typeof e.label !== 'string') continue;
    const value = int(e.value, 0, 1e12, -1);
    const id = int(e.id, 0, Number.MAX_SAFE_INTEGER, -1);
    if (value < 0 || id < 0) continue;
    out.push({ id, value, label: e.label.slice(0, 40) });
  }
  return out.sort((a, b) => b.value - a.value).slice(0, LEADERBOARD_SIZE);
}

/** Validates untrusted JSON field by field; anything unusable falls back to its default. */
export function parseSave(raw: unknown): SaveData {
  const d = defaultSave();
  if (!isObj(raw) || raw.version !== 1) return d;
  const upgradesRaw = isObj(raw.upgrades) ? raw.upgrades : {};
  for (const id of UPGRADE_IDS) d.upgrades[id] = int(upgradesRaw[id], 0, UPGRADES[id].maxLevel, 0);
  if (Array.isArray(raw.gems) && raw.gems.length === 5) d.gems = raw.gems.map((g) => g === true) as GemSet;
  const lb = isObj(raw.leaderboard) ? raw.leaderboard : {};
  return {
    version: 1,
    credits: int(raw.credits, 0, 1e12, START_CREDITS),
    upgrades: d.upgrades,
    gems: d.gems,
    gemSets: int(raw.gemSets, 0, 1e9, 0),
    muted: raw.muted === true,
    leaderboard: { peak: parseEntries(lb.peak), jackpot: parseEntries(lb.jackpot) },
  };
}

export function loadSave(): SaveData {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return parseSave(text === null ? null : JSON.parse(text));
  } catch {
    return defaultSave();
  }
}

/** Set by clearSave so the pagehide flush during the reload cannot write the old progress back. */
let cleared = false;

export function writeSave(data: SaveData): void {
  if (cleared) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable or full: play on without persistence */
  }
}

export function clearSave(): void {
  cleared = true;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Inserts or updates by id, keeping the top LEADERBOARD_SIZE by value. */
export function upsertEntry(list: LbEntry[], entry: LbEntry): LbEntry[] {
  const next = list.filter((e) => e.id !== entry.id);
  next.push(entry);
  return next.sort((a, b) => b.value - a.value).slice(0, LEADERBOARD_SIZE);
}

export function dateLabel(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
