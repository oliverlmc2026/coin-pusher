/** Synthesised blips only; no asset files. Context is created lazily on the first user gesture. */
export class Sfx {
  muted: boolean;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly lastPlayed = new Map<string, number>();

  constructor(muted: boolean) {
    this.muted = muted;
    const unlock = () => this.resume();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Rate limit per sound name so a burst of coins does not become a wall of noise. */
  private gate(name: string, minGap: number): boolean {
    if (this.muted || !this.ctx || !this.master) return false;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < minGap) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.5, slideTo?: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.6): void {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
  }

  drop(): void {
    if (this.gate('drop', 0.04)) this.tone(520, 0.08, 'triangle', 0.4, 300);
  }
  win(value: number): void {
    if (!this.gate('win', 0.05)) return;
    if (value >= 10) {
      this.tone(784, 0.1, 'square', 0.25);
      this.tone(1175, 0.18, 'square', 0.25, undefined, 0.08);
    } else {
      this.tone(1320, 0.07, 'sine', 0.35, 1760);
    }
  }
  lost(): void {
    if (this.gate('lost', 0.08)) this.tone(240, 0.22, 'sawtooth', 0.25, 90);
  }
  bomb(): void {
    if (!this.gate('bomb', 0.1)) return;
    this.noise(0.5, 0.9);
    this.tone(120, 0.4, 'sine', 0.7, 40);
  }
  spinTick(): void {
    if (this.gate('tick', 0.03)) this.tone(900, 0.03, 'square', 0.15);
  }
  spinStart(): void {
    if (this.gate('spinStart', 0.2)) this.tone(300, 0.3, 'sawtooth', 0.2, 900);
  }
  jackpot(): void {
    if (!this.gate('jackpot', 0.3)) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, 'square', 0.28, undefined, i * 0.09));
  }
  gem(): void {
    if (!this.gate('gem', 0.1)) return;
    this.tone(1568, 0.12, 'sine', 0.4);
    this.tone(2093, 0.25, 'sine', 0.35, undefined, 0.09);
  }
  buy(): void {
    if (!this.gate('buy', 0.05)) return;
    this.tone(660, 0.08, 'square', 0.25);
    this.tone(990, 0.12, 'square', 0.25, undefined, 0.07);
  }
  deny(): void {
    if (this.gate('deny', 0.15)) this.tone(160, 0.15, 'square', 0.3);
  }
  click(): void {
    if (this.gate('click', 0.03)) this.tone(700, 0.04, 'triangle', 0.3);
  }
}
