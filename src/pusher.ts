import type RAPIER from '@dimforge/rapier3d-compat';
import { PUSH_MAX, PUSH_MIN } from './world';

const CENTER = (PUSH_MAX + PUSH_MIN) / 2;
const AMPLITUDE = (PUSH_MAX - PUSH_MIN) / 2;
const BASE_PERIOD = 12;
const SLAB_HALF_DEPTH = 4;

/** Drives the kinematic slab along z; its front face oscillates between PUSH_MIN and PUSH_MAX. */
export class Pusher {
  private phase = -Math.PI / 2;
  speed = 1;

  constructor(private readonly body: RAPIER.RigidBody) {}

  /** Queues the slab's position for the next physics step; Rapier derives the contact velocity from the move. */
  step(dt: number): void {
    this.phase += ((Math.PI * 2) / BASE_PERIOD) * this.speed * dt;
    const frontNext = CENTER + AMPLITUDE * Math.sin(this.phase);
    this.body.setNextKinematicTranslation({ x: 0, y: this.body.translation().y, z: frontNext - SLAB_HALF_DEPTH });
  }
}
