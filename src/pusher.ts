import type * as CANNON from 'cannon-es';
import { PUSH_MAX, PUSH_MIN } from './world';

const CENTER = (PUSH_MAX + PUSH_MIN) / 2;
const AMPLITUDE = (PUSH_MAX - PUSH_MIN) / 2;
const BASE_PERIOD = 3;
const SLAB_HALF_DEPTH = 4;

/** Drives the kinematic slab along z; its front face oscillates between PUSH_MIN and PUSH_MAX. */
export class Pusher {
  private phase = -Math.PI / 2;
  speed = 1;

  constructor(private readonly body: CANNON.Body) {}

  /** Sets velocity so the body lands exactly on the target after this step, which keeps contacts correct. */
  step(dt: number): void {
    this.phase += ((Math.PI * 2) / BASE_PERIOD) * this.speed * dt;
    const frontNext = CENTER + AMPLITUDE * Math.sin(this.phase);
    this.body.velocity.z = (frontNext - SLAB_HALF_DEPTH - this.body.position.z) / dt;
  }
}
