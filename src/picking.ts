import * as THREE from 'three';
import type { Animal } from './animals/Animal';
import type { Feeder } from './feeder';

export type Pick = { kind: 'animal'; animal: Animal } | { kind: 'feeder'; feeder: Feeder };

/** Click (not drag) selection and hover cursor, via raycasting. */
export class Picker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private down: { x: number; y: number } | null = null;
  private hovered: Pick | null = null;

  constructor(
    private readonly dom: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly targets: () => THREE.Object3D[],
    private readonly onPick: (pick: Pick | null) => void,
    private readonly onHover: (pick: Pick | null) => void = () => {},
  ) {
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.down = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.down) return;
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      this.down = null;
      if (moved < 5) this.onPick(this.pickAt(e.clientX, e.clientY));
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      const pick = this.pickAt(e.clientX, e.clientY);
      dom.style.cursor = pick ? 'pointer' : '';
      if (targetOf(pick) !== targetOf(this.hovered)) {
        this.hovered = pick;
        this.onHover(pick);
      }
    });
  }

  private pickAt(clientX: number, clientY: number): Pick | null {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.targets(), true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o.userData.pick) return o.userData.pick as Pick;
        o = o.parent;
      }
    }
    return null;
  }
}

function targetOf(pick: Pick | null): unknown {
  if (!pick) return null;
  return pick.kind === 'animal' ? pick.animal : pick.feeder;
}
