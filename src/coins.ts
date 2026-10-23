import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { classifyExit, DROP_Y, DROP_Z, HALF_W, HOLE, KILL_Y, PLATE_Z, type ExitKind, type Machine } from './world';

export type CoinKindId = 'normal' | 'gold' | 'gem' | 'bomb' | 'big';

export const GEM_COLORS = [0xff3b5c, 0x33d17a, 0x3ea0ff, 0xffd23f, 0xb15cff] as const;
export const GEM_NAMES = ['紅寶石', '翡翠', '藍寶石', '黃玉', '紫晶'] as const;
export const MAX_BODIES = 300;
const COIN_FRICTION = 0.3;
const ANGULAR_DAMPING = 0.4;

export interface CoinRef {
  readonly kind: CoinKindId;
  readonly gemColor: number;
  /** Live position, for kinds that react at the spot where the coin exited. */
  readonly pos: { x: number; y: number; z: number };
}

/** Services a kind behaviour may call; supplied by the game so kinds stay decoupled from it. */
export interface KindCtx {
  explode(pos: { x: number; y: number; z: number }, radius: number, strength: number): void;
  collectGem(color: number): void;
}

export interface CoinKindDef {
  readonly id: CoinKindId;
  readonly label: string;
  readonly shape: 'disc' | 'sphere';
  readonly radius: number;
  readonly height: number;
  readonly mass: number;
  readonly value: number;
  readonly color: number;
  /** Relative odds among special kinds when a special spawn is rolled. */
  readonly weight: number;
  /** Seconds the coin must rest before onSettle runs. */
  readonly settleAfter?: number;
  onExit?(ctx: KindCtx, coin: CoinRef, exit: ExitKind): void;
  /** Returning 'consume' removes the coin after its effect. */
  onSettle?(ctx: KindCtx, coin: CoinRef): 'consume' | void;
}

export const COIN_KINDS: Record<CoinKindId, CoinKindDef> = {
  normal: { id: 'normal', label: '銀幣', shape: 'disc', radius: 0.5, height: 0.2, mass: 1, value: 1, color: 0xdfe3ea, weight: 0 },
  gold: { id: 'gold', label: '金幣', shape: 'disc', radius: 0.5, height: 0.2, mass: 1, value: 5, color: 0xffc83a, weight: 5 },
  big: { id: 'big', label: '大幣', shape: 'disc', radius: 0.8, height: 0.3, mass: 3, value: 5, color: 0xff9a4a, weight: 3 },
  gem: {
    id: 'gem',
    label: '寶石',
    shape: 'disc',
    radius: 0.4,
    height: 0.3,
    mass: 1,
    value: 0,
    color: 0xffffff,
    weight: 3,
    onExit(ctx, coin, exit) {
      if (exit === 'win') ctx.collectGem(coin.gemColor);
    },
  },
  bomb: {
    id: 'bomb',
    label: '炸彈',
    shape: 'sphere',
    radius: 0.4,
    height: 0.8,
    mass: 1,
    value: 0,
    color: 0x2a2a33,
    weight: 2,
    settleAfter: 3,
    onExit(ctx, coin) {
      ctx.explode(coin.pos, 3.2, 14);
    },
    onSettle(ctx, coin) {
      ctx.explode(coin.pos, 3.2, 14);
      return 'consume';
    },
  },
};

const SPECIAL_KINDS = (Object.values(COIN_KINDS) as CoinKindDef[]).filter((k) => k.weight > 0);

export function rollSpecial(rng: () => number): CoinKindId {
  const total = SPECIAL_KINDS.reduce((s, k) => s + k.weight, 0);
  let r = rng() * total;
  for (const k of SPECIAL_KINDS) {
    r -= k.weight;
    if (r <= 0) return k.id;
  }
  return 'gold';
}

interface Coin extends CoinRef {
  readonly def: CoinKindDef;
  readonly body: RAPIER.RigidBody;
  readonly slot: number;
  readonly seq: number;
  exited: ExitKind | null;
  rest: number;
  synced: boolean;
}

interface KindRuntime {
  def: CoinKindDef;
  mesh: THREE.InstancedMesh;
  freeSlots: number[];
  high: number;
  dirty: boolean;
}

export interface CoinEvents {
  exit(def: CoinKindDef, exit: ExitKind): void;
}

function capTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#9aa0ad';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(64, 64, 38, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#9aa0ad';
  g.font = 'bold 54px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('$', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CoinSystem {
  private readonly kinds = new Map<CoinKindId, KindRuntime>();
  private readonly alive: Coin[] = [];
  private seq = 0;
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly tmpC = new THREE.Color();
  rng: () => number = Math.random;
  /** Lowered by the game loop on slow devices; spawning evicts the oldest coins down to this. */
  cap = MAX_BODIES;

  constructor(
    private readonly machine: Machine,
    private readonly ctx: KindCtx,
    private readonly events: CoinEvents,
  ) {
    const cap = capTexture();
    for (const def of Object.values(COIN_KINDS)) {
      const geo =
        def.shape === 'sphere'
          ? new THREE.SphereGeometry(def.radius, 18, 12)
          : new THREE.CylinderGeometry(def.radius, def.radius, def.height, def.id === 'gem' ? 6 : 28);
      const base = { color: def.color, metalness: def.id === 'bomb' ? 0.3 : 0.75, roughness: def.id === 'bomb' ? 0.5 : 0.3 };
      const side = new THREE.MeshStandardMaterial(base);
      const material = def.shape === 'sphere' || def.id === 'gem' ? side : [side, new THREE.MeshStandardMaterial({ ...base, map: cap }), new THREE.MeshStandardMaterial({ ...base, map: cap })];
      const mesh = new THREE.InstancedMesh(geo, material, MAX_BODIES);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      if (def.id === 'gem') mesh.setColorAt(0, this.tmpC.set(0xffffff));
      machine.scene.add(mesh);
      this.kinds.set(def.id, {
        def,
        mesh,
        freeSlots: [],
        high: 0,
        dirty: false,
      });
    }
  }

  get count(): number {
    return this.alive.length;
  }

  private createBody(def: CoinKindDef, pos: { x: number; y: number; z: number }, vy: number): RAPIER.RigidBody {
    const w = this.machine.physics;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinvel(0, vy, 0)
      .setLinearDamping(0.2)
      .setAngularDamping(ANGULAR_DAMPING);
    // Flat discs only slide and stack. Free discs stood on edge and rolled into the jackpot hole, and their
    // funnelled fall made the hole too easy to hit; bombs stay free so they still roll.
    if (def.shape === 'disc') desc.lockRotations();
    const body = w.createRigidBody(desc);
    const shape = def.shape === 'sphere' ? RAPIER.ColliderDesc.ball(def.radius) : RAPIER.ColliderDesc.cylinder(def.height / 2, def.radius);
    w.createCollider(shape.setMass(def.mass).setFriction(COIN_FRICTION).setRestitution(0.05), body);
    return body;
  }

  private evictOldest(): void {
    let idx = 0;
    for (let i = 1; i < this.alive.length; i++) if (this.alive[i]!.seq < this.alive[idx]!.seq) idx = i;
    this.release(idx);
  }

  private release(index: number): void {
    const coin = this.alive[index]!;
    const rt = this.kinds.get(coin.def.id)!;
    this.machine.physics.removeRigidBody(coin.body);
    rt.mesh.setMatrixAt(coin.slot, this.hidden);
    rt.dirty = true;
    rt.freeSlots.push(coin.slot);
    const last = this.alive.pop()!;
    if (index < this.alive.length) this.alive[index] = last;
  }

  spawn(
    kind: CoinKindId,
    pos: { x: number; y: number; z: number },
    opts: { vy?: number } = {},
  ): void {
    while (this.alive.length >= this.cap) this.evictOldest();
    const rt = this.kinds.get(kind)!;
    const { def } = rt;
    const slot = rt.freeSlots.pop() ?? rt.high++;
    if (slot >= rt.mesh.count) rt.mesh.count = slot + 1;
    const body = this.createBody(def, pos, opts.vy ?? 0);
    const gemColor = kind === 'gem' ? Math.floor(this.rng() * GEM_COLORS.length) : 0;
    if (kind === 'gem') rt.mesh.setColorAt(slot, this.tmpC.set(GEM_COLORS[gemColor]!));
    if (rt.mesh.instanceColor) rt.mesh.instanceColor.needsUpdate = true;
    this.alive.push({
      kind,
      def,
      body,
      slot,
      gemColor,
      seq: this.seq++,
      exited: null,
      rest: 0,
      synced: false,
      pos: { ...pos },
    });
  }

  /** A player drop: `n` coins in a small cluster above x, each possibly special. */
  drop(x: number, n: number, specialChance: number): void {
    const cx = THREE.MathUtils.clamp(x, -HALF_W + 0.6, HALF_W - 0.6);
    for (let i = 0; i < n; i++) {
      const kind: CoinKindId = this.rng() < specialChance ? rollSpecial(this.rng) : 'normal';
      const spread = n > 1 ? (i - (n - 1) / 2) * 0.95 : 0;
      this.spawn(
        kind,
        {
          x: THREE.MathUtils.clamp(cx + spread + (this.rng() - 0.5) * 0.2, -HALF_W + 0.6, HALF_W - 0.6),
          y: DROP_Y + this.rng() * 0.3,
          z: DROP_Z + (this.rng() - 0.5) * 0.5,
        },
        { vy: -2 },
      );
    }
  }

  /** Slot rain: lands anywhere on the field, never costs credits. */
  rain(specialChance: number): void {
    const kind: CoinKindId = this.rng() < specialChance ? rollSpecial(this.rng) : 'normal';
    this.spawn(
      kind,
      { x: (this.rng() * 2 - 1) * (HALF_W - 0.7), y: 6 + this.rng() * 2, z: -2.8 + this.rng() * 6.5 },
      { vy: -3 },
    );
  }

  spawnKind(kind: CoinKindId): void {
    this.spawn(
      kind,
      { x: (this.rng() * 2 - 1) * (HALF_W - 0.9), y: 6 + this.rng() * 1.5, z: -2.6 + this.rng() * 4 },
      { vy: -3 },
    );
  }

  /** Two layers of flat coins on the shelf in front of the pusher, then settled by a caller-run warm-up. */
  prefill(): void {
    const dx = 1.02;
    for (let row = 0; row < 5; row++) {
      const z = 0.9 + row * 1.02;
      const cols = row % 2 === 0 ? 9 : 8;
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * dx + (this.rng() - 0.5) * 0.06;
        const zz = z + (this.rng() - 0.5) * 0.06;
        if (x > HOLE.x0 - 0.5 && x < HOLE.x1 + 0.5 && zz > HOLE.z0 - 0.5 && zz < HOLE.z1 + 0.5) continue;
        this.spawn('normal', { x, y: 0.11, z: zz }, {});
      }
    }
    for (let i = 0; i < 30; i++) {
      const kind: CoinKindId = i % 7 === 0 ? 'gold' : 'normal';
      const x = (this.rng() * 2 - 1) * (HALF_W - 1);
      const z = -0.2 + this.rng() * 4.6;
      if (x > HOLE.x0 - 0.8 && x < HOLE.x1 + 0.8 && z > HOLE.z0 - 0.8 && z < HOLE.z1 + 0.8) continue;
      this.spawn(kind, { x, y: 0.45 + this.rng() * 0.3, z }, {});
    }
  }

  /** Radial impulse on every coin near `pos`, falling off linearly with distance. */
  applyBlast(pos: { x: number; y: number; z: number }, radius: number, strength: number): void {
    for (const coin of this.alive) {
      if (coin.exited) continue;
      const b = coin.body;
      const t = b.translation();
      let dx = t.x - pos.x;
      let dy = t.y - pos.y;
      let dz = t.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius || d < 1e-4) continue;
      dx /= d;
      dz /= d;
      dy = Math.max(dy / d, 0) + 0.45;
      const k = strength * coin.def.mass * (1 - d / radius);
      b.applyImpulse({ x: dx * k, y: dy * k, z: dz * k }, true);
      // A locked body would still integrate an angvel we set, so only free bodies are spun.
      if (coin.def.shape === 'sphere') b.setAngvel({ x: (this.rng() - 0.5) * 8, y: (this.rng() - 0.5) * 8, z: (this.rng() - 0.5) * 8 }, true);
    }
  }

  /** Per physics step: detect exits, run settle behaviours, cull fallen bodies. */
  postStep(dt: number): void {
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const coin = this.alive[i]!;
      const b = coin.body;
      const p = b.translation();
      coin.pos.x = p.x;
      coin.pos.y = p.y;
      coin.pos.z = p.z;

      if (!coin.exited) {
        const exit = classifyExit(p);
        if (exit) {
          coin.exited = exit;
          this.events.exit(coin.def, exit);
          coin.def.onExit?.(this.ctx, coin, exit);
        } else if (coin.def.onSettle && coin.def.settleAfter !== undefined) {
          const v = b.linvel();
          coin.rest = v.x * v.x + v.y * v.y + v.z * v.z < 0.12 ? coin.rest + dt : 0;
          if (coin.rest >= coin.def.settleAfter && coin.def.onSettle(this.ctx, coin) === 'consume') {
            this.release(i);
            continue;
          }
        }
      }
      // Coins can be squeezed through the back plate by the retracting slab; they are unreachable, so recycle them.
      if (p.y < KILL_Y || p.z < PLATE_Z - 0.4) this.release(i);
    }
  }

  syncMeshes(): void {
    for (const coin of this.alive) {
      const b = coin.body;
      const sleeping = b.isSleeping();
      if (sleeping && coin.synced) continue;
      coin.synced = sleeping;
      const rt = this.kinds.get(coin.def.id)!;
      const t = b.translation();
      const q = b.rotation();
      this.tmpP.set(t.x, t.y, t.z);
      this.tmpQ.set(q.x, q.y, q.z, q.w);
      rt.mesh.setMatrixAt(coin.slot, this.tmpM.compose(this.tmpP, this.tmpQ, this.one));
      rt.dirty = true;
    }
    for (const rt of this.kinds.values()) {
      if (!rt.dirty) continue;
      rt.mesh.instanceMatrix.needsUpdate = true;
      rt.dirty = false;
    }
  }

  /** Test hook data. */
  stats(): { bodies: number; awake: number } {
    let awake = 0;
    for (const c of this.alive) if (!c.body.isSleeping()) awake++;
    return { bodies: this.alive.length, awake };
  }
}
