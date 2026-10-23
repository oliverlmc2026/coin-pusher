import { GEM_COLORS, GEM_NAMES } from './coins';
import type { Game } from './game';
import { clearSave } from './save';
import { UPGRADES, UPGRADE_IDS, type UpgradeId } from './shop';

type Tone = 'info' | 'good' | 'great' | 'bad';

export interface UiHooks {
  onMuteToggle(): void;
  onBailout(): void;
  onBuy(id: UpgradeId, ok: boolean): void;
  onClick(): void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export class Ui {
  readonly slotHost = h('div', 'slot-host');
  private readonly credits = h('b', 'credits-n', '0');
  private readonly gain = h('span', 'gain');
  private readonly gems = h('div', 'gems');
  private readonly muteBtn = h('button', 'btn', '');
  private readonly wall = h('div', 'wall');
  private readonly bail = h('button', 'bail', '領取救濟金 +10');
  private readonly toasts = h('div', 'toasts');
  private readonly sheet = h('div', 'sheet');
  private sheetKind: 'shop' | 'lb' | null = null;
  private gainSum = 0;
  private gainTimer: number | undefined;

  constructor(
    root: HTMLElement,
    private readonly game: Game,
    private readonly hooks: UiHooks,
  ) {
    const top = h('div', 'hud-top');
    const cr = h('div', 'credits');
    cr.append(h('small', undefined, '信用點'), this.credits, this.gain);
    const btns = h('div', 'btns');
    const shop = h('button', 'btn', '商店');
    const lb = h('button', 'btn', '排行榜');
    shop.onclick = () => this.togglePanel('shop');
    lb.onclick = () => this.togglePanel('lb');
    this.muteBtn.onclick = () => hooks.onMuteToggle();
    this.bail.onclick = () => hooks.onBailout();
    btns.append(shop, lb, this.muteBtn);
    top.append(cr, this.gems, btns);
    this.wall.hidden = true;
    this.bail.hidden = true;
    this.sheet.hidden = true;
    const hint = h('div', 'hint', '點擊或按住機器上方任何位置投幣（每次 1 信用點）');
    root.append(top, this.wall, this.slotHost, this.toasts, this.bail, hint, this.sheet);
    game.subscribe(() => this.render());
    this.render();
    this.renderMute();
  }

  private render(): void {
    this.credits.textContent = fmt(this.game.credits);
    this.bail.hidden = this.game.credits > 0;
    this.gems.replaceChildren();
    this.game.save.gems.forEach((have, i) => {
      const d = h('i', have ? 'gem on' : 'gem');
      d.style.setProperty('--c', '#' + GEM_COLORS[i]!.toString(16).padStart(6, '0'));
      d.title = GEM_NAMES[i]!;
      this.gems.append(d);
    });
    if (this.game.save.gemSets > 0) this.gems.append(h('span', 'sets', `x${this.game.save.gemSets}`));
    if (this.sheetKind) this.renderSheet();
  }

  renderMute(): void {
    this.muteBtn.textContent = this.game.save.muted ? '靜音' : '音效';
    this.muteBtn.classList.toggle('off', this.game.save.muted);
  }

  /** Aggregates wins over a short window so a stream of coins shows one running total. */
  noteWin(n: number): void {
    if (n <= 0) return;
    this.gainSum += n;
    this.gain.textContent = `+${fmt(this.gainSum)}`;
    this.gain.classList.remove('pop');
    void this.gain.offsetWidth;
    this.gain.classList.add('pop');
    window.clearTimeout(this.gainTimer);
    this.gainTimer = window.setTimeout(() => {
      this.gainSum = 0;
      this.gain.textContent = '';
    }, 1200);
  }

  toast(text: string, tone: Tone = 'info'): void {
    const t = h('div', `toast ${tone}`, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    window.setTimeout(() => t.remove(), 2600);
  }

  setWall(seconds: number): void {
    this.wall.hidden = seconds <= 0;
    if (seconds > 0) this.wall.textContent = `護欄生效中 ${Math.ceil(seconds)} 秒`;
  }

  private togglePanel(kind: 'shop' | 'lb'): void {
    this.hooks.onClick();
    if (this.sheetKind === kind) return this.closePanel();
    this.sheetKind = kind;
    this.sheet.hidden = false;
    this.renderSheet();
  }

  private closePanel(): void {
    this.sheetKind = null;
    this.sheet.hidden = true;
  }

  private renderSheet(): void {
    const head = h('div', 'sheet-head');
    head.append(h('h2', undefined, this.sheetKind === 'shop' ? '升級商店' : '本機排行榜'));
    const close = h('button', 'btn', '關閉');
    close.onclick = () => {
      this.hooks.onClick();
      this.closePanel();
    };
    head.append(close);
    const body = h('div', 'sheet-body');
    if (this.sheetKind === 'shop') this.fillShop(body);
    else this.fillLeaderboard(body);
    this.sheet.replaceChildren(head, body);
  }

  private fillShop(body: HTMLElement): void {
    for (const id of UPGRADE_IDS) {
      const u = UPGRADES[id];
      const level = this.game.level(id);
      const cost = this.game.cost(id);
      const row = h('div', 'row');
      const info = h('div', 'info');
      info.append(h('b', undefined, `${u.label}  Lv ${level}/${u.maxLevel}`), h('span', undefined, u.desc));
      const now = u.show(u.effect(level));
      info.append(h('em', undefined, cost === null ? `現時：${now}（已滿級）` : `${now}  →  ${u.show(u.effect(level + 1))}`));
      const btn = h('button', 'buy', cost === null ? '滿級' : `${fmt(cost)} 點`);
      btn.disabled = cost === null || this.game.credits < cost;
      btn.onclick = () => this.hooks.onBuy(id, this.game.buy(id));
      row.append(info, btn);
      body.append(row);
    }
  }

  private fillLeaderboard(body: HTMLElement): void {
    const lb = this.game.save.leaderboard;
    const block = (title: string, entries: typeof lb.peak) => {
      const sec = h('section', 'lb');
      sec.append(h('h3', undefined, title));
      if (entries.length === 0) sec.append(h('p', 'empty', '暫時未有紀錄'));
      const ol = h('ol');
      for (const e of entries) {
        const li = h('li');
        li.append(h('span', 'v', fmt(e.value)), h('span', 'd', e.label));
        ol.append(li);
      }
      sec.append(ol);
      return sec;
    };
    body.append(block('信用點最高峰', lb.peak), block('最大 Jackpot 獎勵', lb.jackpot));
    const reset = h('button', 'btn danger', '重置存檔');
    reset.onclick = () => {
      if (window.confirm('確定要清除所有進度同排行榜？')) {
        clearSave();
        window.location.reload();
      }
    };
    body.append(reset);
  }
}
