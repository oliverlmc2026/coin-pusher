export type UpgradeId = 'pusherSpeed' | 'sideWall' | 'coinsPerDrop' | 'specialChance' | 'autoDropper';

export interface UpgradeDef {
  readonly id: UpgradeId;
  readonly label: string;
  readonly desc: string;
  readonly baseCost: number;
  readonly growth: number;
  readonly maxLevel: number;
  effect(level: number): number;
  show(effect: number): string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  pusherSpeed: {
    id: 'pusherSpeed',
    label: '推板速度',
    desc: '推板來回更快，推出更多銀仔。',
    baseCost: 30,
    growth: 1.6,
    maxLevel: 8,
    effect: (l) => 1 + 0.12 * l,
    show: (e) => `x${e.toFixed(2)}`,
  },
  sideWall: {
    id: 'sideWall',
    label: '側欄高度',
    desc: '永久加高兩邊欄杆，減少銀仔跌出側邊。',
    baseCost: 40,
    growth: 1.7,
    maxLevel: 5,
    effect: (l) => 0.5 + 0.3 * l,
    show: (e) => `${e.toFixed(1)} 格`,
  },
  coinsPerDrop: {
    id: 'coinsPerDrop',
    label: '每次投幣數量',
    desc: '一個信用點可以同時投多啲銀仔。',
    baseCost: 120,
    growth: 2.2,
    maxLevel: 4,
    effect: (l) => 1 + l,
    show: (e) => `${e} 粒`,
  },
  specialChance: {
    id: 'specialChance',
    label: '特殊幣機率',
    desc: '投落去嘅銀仔變成金幣、寶石、炸彈或大幣嘅機率。',
    baseCost: 60,
    growth: 1.7,
    maxLevel: 8,
    effect: (l) => 0.08 + 0.025 * l,
    show: (e) => `${Math.round(e * 100)}%`,
  },
  autoDropper: {
    id: 'autoDropper',
    label: '自動投幣機',
    desc: '自動左右掃射投幣（照樣扣信用點）。',
    baseCost: 100,
    growth: 2,
    maxLevel: 6,
    effect: (l) => (l === 0 ? 0 : 0.4 + 0.3 * l),
    show: (e) => (e === 0 ? '未啟用' : `${e.toFixed(1)} 粒/秒`),
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export function upgradeCost(id: UpgradeId, level: number): number {
  const u = UPGRADES[id];
  return Math.round(u.baseCost * Math.pow(u.growth, level));
}
