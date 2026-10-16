import * as THREE from 'three';

const MIN_DISTANCE = 14;
const MAX_DISTANCE = 190;
const MIN_PITCH = 0.25;
const MAX_PITCH = 1.45;
const WORLD_LIMIT = 150;

/**
 * RTS-style orbit camera.
 * Left-drag / WASD pans, right-drag / Q,E rotates, wheel zooms.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector3(0, 0, -10);
  private yaw = 0;
  private pitch = 0.82;
  private distance = 78;
  private readonly keys = new Set<string>();
  private drag: { button: number; x: number; y: number; moved: boolean } | null = null;
  private follow: THREE.Object3D | null = null;
  private readonly tmp = new THREE.Vector3();

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 900);

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      // Ignore click jitter so selecting an animal doesn't cancel follow mode.
      if (!this.drag.moved && Math.hypot(dx, dy) < 5) return;
      this.drag.moved = true;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.drag.button === 0) this.panBy(-dx, -dy, this.distance * 0.0016);
      else this.rotateBy(-dx * 0.005, dy * 0.004);
    });
    const endDrag = (e: PointerEvent) => {
      this.drag = null;
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    };
    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointercancel', endDrag);
    dom.addEventListener(
      'wheel',
      (e) => {
        this.distance = THREE.MathUtils.clamp(
          this.distance * Math.exp(e.deltaY * 0.0012),
          MIN_DISTANCE,
          MAX_DISTANCE,
        );
      },
      { passive: true },
    );

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setFollow(obj: THREE.Object3D | null): void {
    this.follow = obj;
    if (obj) this.distance = Math.min(this.distance, 45);
  }

  /** The point the camera orbits (rain falls around it). */
  get focus(): THREE.Vector3 {
    return this.target;
  }

  get following(): THREE.Object3D | null {
    return this.follow;
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    const k = this.keys;
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (right || fwd) this.panBy(right, -fwd, this.distance * 0.9 * dt);
    const rot = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (rot) this.rotateBy(rot * 1.6 * dt, 0);

    if (this.follow) {
      this.follow.getWorldPosition(this.tmp);
      this.target.lerp(this.tmp, 1 - Math.exp(-dt * 4));
    }

    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.lookAt(this.target);
  }

  /** Pan in screen-aligned ground directions. Any manual pan stops following. */
  private panBy(dx: number, dy: number, scale: number): void {
    this.follow = null;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // right = (cos, 0, -sin), forward (into screen) = (-sin, 0, -cos)
    this.target.x += (cos * dx + sin * dy) * scale;
    this.target.z += (-sin * dx + cos * dy) * scale;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -WORLD_LIMIT, WORLD_LIMIT);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -WORLD_LIMIT, WORLD_LIMIT);
  }

  private rotateBy(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, MIN_PITCH, MAX_PITCH);
  }
}
