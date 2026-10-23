import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export const HALF_W = 5;
export const FRONT_Z = 5.2;
export const PLATE_Z = -4.25;
export const FLOOR_BACK_Z = -9;
export const SLAB_TOP = 0.9;
export const PUSH_MIN = -3.7;
export const PUSH_MAX = 1.5;
export const HOLE = { x0: -0.55, x1: 0.55, z0: 2.3, z1: 3.4 } as const;
export const DROP_Y = 4.5;
export const DROP_Z = -2.6;
export const KILL_Y = -3.5;
const RAIL_X = HALF_W + 0.15;
const RAIL_LEN = FRONT_Z - PLATE_Z;
const RAIL_BODY_H = 4;
/** Physical rail top sits this far below the drawn one, so coins pushed hard into a low rail can ride over it as they did before the Rapier port. */
const RAIL_SINK = 0.1;
/** Coins use friction 0.3 with the default Average combine rule, so these give pair values of about 0.18 / 0.43 / 0.1. */
const FLOOR_FRICTION = 0.05;
const SLAB_FRICTION = 0.55;
const RAIL_FRICTION = 0.1;

export type ExitKind = 'win' | 'lost' | 'jackpot';

/**
 * Where a coin has gone, judged from its centre alone. Physics events are
 * deliberately not used: a position test is stable under body pooling.
 */
export function classifyExit(p: { x: number; y: number; z: number }): ExitKind | null {
  if (p.y > -0.45) return null;
  if (p.x > HOLE.x0 && p.x < HOLE.x1 && p.z > HOLE.z0 && p.z < HOLE.z1) return 'jackpot';
  if (Math.abs(p.x) > HALF_W) return 'lost';
  if (p.z > FRONT_Z - 0.3) return 'win';
  if (p.y < -2) return 'lost';
  return null;
}

interface Burst {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  radius: number;
}

function labelTexture(text: string, bg: string, fg: string, w = 512, h = 128, scale = 0.62): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `bold ${h * scale}px "PingFang HK", "Noto Sans HK", "Microsoft JhengHei", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Machine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 120);
  readonly physics = new RAPIER.World({ x: 0, y: -30, z: 0 });
  readonly pusherBody: RAPIER.RigidBody;
  readonly dropPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DROP_Y);

  private readonly slabMesh: THREE.Mesh;
  private readonly rails: { body: RAPIER.RigidBody; mesh: THREE.Mesh }[] = [];
  private readonly bursts: Burst[] = [];
  private railTop = 0;
  private readonly aim: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x120a1f);

    this.buildPhysics();
    this.pusherBody = this.buildPusherBody();
    this.slabMesh = this.buildScene();
    this.aim = this.buildAim();
    this.buildRails();
  }

  private buildPhysics(): void {
    const w = this.physics;
    w.timestep = 1 / 60;
    w.integrationParameters.numSolverIterations = 4;

    const box = (hx: number, hy: number, hz: number, x: number, y: number, z: number, friction: number) =>
      w.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(0.05),
      );
    // Floor tiles around the jackpot hole. Thickness 1 so fast coins cannot tunnel through.
    const hx = (HOLE.x1 - HOLE.x0) / 2;
    const backLen = HOLE.z0 - FLOOR_BACK_Z;
    box(HALF_W, 0.5, backLen / 2, 0, -0.5, FLOOR_BACK_Z + backLen / 2, FLOOR_FRICTION);
    const frontLen = FRONT_Z - HOLE.z1;
    box(HALF_W, 0.5, frontLen / 2, 0, -0.5, HOLE.z1 + frontLen / 2, FLOOR_FRICTION);
    const midLen = HOLE.z1 - HOLE.z0;
    const sideW = HALF_W - hx;
    box(sideW / 2, 0.5, midLen / 2, -(hx + sideW / 2), -0.5, HOLE.z0 + midLen / 2, FLOOR_FRICTION);
    box(sideW / 2, 0.5, midLen / 2, hx + sideW / 2, -0.5, HOLE.z0 + midLen / 2, FLOOR_FRICTION);
    // Back plate: lower edge sits just above the pusher top so it scrapes coins off the slab.
    box(HALF_W + 0.3, 2, 0.2, 0, SLAB_TOP + 0.1 + 2, PLATE_Z, RAIL_FRICTION);
  }

  private buildPusherBody(): RAPIER.RigidBody {
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, SLAB_TOP / 2, PUSH_MIN - 4),
    );
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF_W - 0.02, SLAB_TOP / 2, 4).setFriction(SLAB_FRICTION).setRestitution(0.03),
      body,
    );
    return body;
  }

  private buildRails(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.6, roughness: 0.35 });
    for (const side of [-1, 1]) {
      const y = -RAIL_BODY_H / 2;
      const py = y - RAIL_SINK;
      const z = PLATE_Z + RAIL_LEN / 2;
      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(side * RAIL_X, py, z),
      );
      this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(0.15, RAIL_BODY_H / 2, RAIL_LEN / 2)
          .setFriction(RAIL_FRICTION)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setRestitution(0.05),
        body,
      );
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, RAIL_BODY_H, RAIL_LEN), mat);
      mesh.position.set(side * RAIL_X, y, z);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.rails.push({ body, mesh });
    }
  }

  /** Raises both side rails so their top edge sits at `top` above the playfield. */
  setRailTop(top: number): void {
    if (Math.abs(top - this.railTop) < 1e-3) return;
    this.railTop = top;
    const y = top - RAIL_BODY_H / 2;
    for (const r of this.rails) {
      const t = r.body.translation();
      r.body.setNextKinematicTranslation({ x: t.x, y: y - RAIL_SINK, z: t.z });
      r.mesh.position.y = y;
    }
  }

  private buildScene(): THREE.Mesh {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xcfd8ff, 0x3a2050, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(-5, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -9;
    sc.right = 9;
    sc.top = 10;
    sc.bottom = -8;
    sc.near = 2;
    sc.far = 40;
    sun.shadow.bias = -0.0008;
    s.add(sun);
    const glow = new THREE.PointLight(0xff8fc0, 14, 14, 1.6);
    glow.position.set(0, 2.5, 2.1);
    s.add(glow);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2b4f9e, roughness: 0.55, metalness: 0.1 });
    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, shadow = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      m.castShadow = shadow;
      s.add(m);
      return m;
    };
    const hx = (HOLE.x1 - HOLE.x0) / 2;
    const backLen = HOLE.z0 - FLOOR_BACK_Z;
    addBox(HALF_W * 2, 1, backLen, 0, -0.5, FLOOR_BACK_Z + backLen / 2, floorMat);
    const frontLen = FRONT_Z - HOLE.z1;
    addBox(HALF_W * 2, 1, frontLen, 0, -0.5, HOLE.z1 + frontLen / 2, floorMat);
    const midLen = HOLE.z1 - HOLE.z0;
    const sideW = HALF_W - hx;
    addBox(sideW, 1, midLen, -(hx + sideW / 2), -0.5, HOLE.z0 + midLen / 2, floorMat);
    addBox(sideW, 1, midLen, hx + sideW / 2, -0.5, HOLE.z0 + midLen / 2, floorMat);

    const ring = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2 + 0.3, 0.05, midLen + 0.3),
      new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffa800, emissiveIntensity: 1.4 }),
    );
    ring.position.set(0, 0.005, (HOLE.z0 + HOLE.z1) / 2);
    s.add(ring);
    const pit = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.06, midLen), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    pit.position.set(0, 0.03, (HOLE.z0 + HOLE.z1) / 2);
    s.add(pit);
    const jp = new THREE.Mesh(
      new THREE.PlaneGeometry(hx * 2, midLen),
      new THREE.MeshBasicMaterial({ map: labelTexture('JACKPOT', '#000000', '#ffd23f', 256, 180, 0.2) }),
    );
    jp.rotation.x = -Math.PI / 2;
    jp.position.set(0, 0.07, (HOLE.z0 + HOLE.z1) / 2);
    s.add(jp);

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry((HALF_W - 0.02) * 2, SLAB_TOP, 8),
      new THREE.MeshStandardMaterial({ color: 0xb9c2d6, metalness: 0.7, roughness: 0.3 }),
    );
    slab.receiveShadow = true;
    s.add(slab);
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry((HALF_W - 0.02) * 2, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0x553d00 }),
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, SLAB_TOP / 2 + 0.005, 3.8);
    slab.add(stripe);

    const signMat = new THREE.MeshStandardMaterial({
      map: labelTexture('推銀仔機', '#7a1233', '#ffe27a'),
      emissive: 0x330a14,
      roughness: 0.5,
    });
    const plate = addBox(HALF_W * 2 + 0.6, 4, 0.4, 0, SLAB_TOP + 0.1 + 2, PLATE_Z, new THREE.MeshStandardMaterial({ color: 0x4a1030 }), true);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), signMat);
    sign.position.set(0, 0.6, 0.21);
    plate.add(sign);

    const cab = new THREE.MeshStandardMaterial({ color: 0x5b1636, roughness: 0.6 });
    addBox(0.5, 1.4, FRONT_Z - FLOOR_BACK_Z + 0.5, -(HALF_W + 0.6), -0.3, (FRONT_Z + FLOOR_BACK_Z) / 2, cab, true);
    addBox(0.5, 1.4, FRONT_Z - FLOOR_BACK_Z + 0.5, HALF_W + 0.6, -0.3, (FRONT_Z + FLOOR_BACK_Z) / 2, cab, true);
    addBox(HALF_W * 2 + 1.7, 1.2, 0.5, 0, -0.6, FRONT_Z + 0.1, cab, true);
    addBox(HALF_W * 2 + 1.7, 0.3, 3.5, 0, -2.6, FRONT_Z + 1.4, new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.6, roughness: 0.4 }));
    addBox(HALF_W * 2 + 3, 0.3, 20, 0, -3.1, -1, new THREE.MeshStandardMaterial({ color: 0x0a0612 }));
    return slab;
  }

  private buildAim(): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
    );
    m.position.set(0, DROP_Y, DROP_Z);
    m.visible = false;
    this.scene.add(m);
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, DROP_Y, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }),
    );
    beam.position.y = -DROP_Y / 2;
    m.add(beam);
    return m;
  }

  setAim(x: number, visible: boolean): void {
    this.aim.position.x = x;
    this.aim.visible = visible;
  }

  /** Short expanding flash used for bombs and big wins. */
  burst(pos: { x: number; y: number; z: number }, radius: number, color: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    mesh.position.set(pos.x, Math.max(pos.y, 0.3), pos.z);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, life: 0.45, radius });
  }

  updateFx(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.age += dt;
      const k = b.age / b.life;
      if (k >= 1) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      b.mesh.scale.setScalar(0.3 + b.radius * k);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k);
    }
  }

  syncPusherMesh(): void {
    this.slabMesh.position.set(0, SLAB_TOP / 2, this.pusherBody.translation().z);
  }

  resize(width: number, height: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Pull back until both the machine width and its depth fit; portrait phones end up further away.
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dir = new THREE.Vector3(0, 0.8, 0.6).normalize();
    const target = new THREE.Vector3(0, 0, aspect < 0.8 ? 0.9 : 0.5);
    const distV = 7.6 / t;
    const distH = 6.9 / (t * aspect);
    const dist = Math.max(distV, distH);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
