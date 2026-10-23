import * as THREE from 'three';
import { HALF_W, type Machine } from './world';

/** Mouse and touch through one pointer path. Reports the drop x under the pointer. */
export class Input {
  aimX = 0;
  holding = false;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly machine: Machine,
    private readonly onPress: (x: number) => void,
  ) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button > 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.track(e);
      this.holding = true;
      this.machine.setAim(this.aimX, true);
      this.onPress(this.aimX);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!e.isPrimary) return;
      this.track(e);
      this.machine.setAim(this.aimX, true);
    });
    const release = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      this.holding = false;
      if (e.pointerType !== 'mouse') this.machine.setAim(this.aimX, false);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.holding) this.machine.setAim(this.aimX, false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private track(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.machine.camera);
    const p = this.ray.ray.intersectPlane(this.machine.dropPlane, this.hit);
    if (p) this.aimX = THREE.MathUtils.clamp(p.x, -HALF_W + 0.6, HALF_W - 0.6);
  }
}
