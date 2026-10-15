import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Enclosure } from './enclosure';
import { mergeChildren } from './merge';

export type FoodType = 'hay' | 'meat';

export interface FeederDef {
  name: string;
  food: FoodType;
  position: [number, number];
  capacity: number;
  cost: number;
  radius: number;
}

const FOOD_LABEL: Record<FoodType, string> = { hay: 'Hay', meat: 'Meat' };

/** A round food tub. Animals walk up to it and eat from its stock. */
export class Feeder {
  readonly name: string;
  readonly food: FoodType;
  readonly capacity: number;
  readonly cost: number;
  readonly radius: number;
  readonly root = new THREE.Group();
  stock: number;
  onEmpty: (() => void) | null = null;

  private readonly foodMesh: THREE.Group;
  private readonly labelEl: HTMLDivElement;
  private readonly barEl: HTMLElement;
  private shownPercent = -1;

  constructor(def: FeederDef) {
    this.name = def.name;
    this.food = def.food;
    this.capacity = def.capacity;
    this.cost = def.cost;
    this.radius = def.radius;
    this.stock = def.capacity;
    this.root.position.set(def.position[0], 0, def.position[1]);

    const r = def.radius;
    const wood = new THREE.MeshStandardMaterial({ color: '#7b5434', roughness: 0.9 });
    const band = new THREE.MeshStandardMaterial({ color: '#3a3836', roughness: 0.5, metalness: 0.5 });
    // Barrel-style tub: an open cylinder of staves with two metal bands.
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.6, 18, 1, true), wood);
    tub.position.y = 0.3;
    (tub.material as THREE.Material).side = THREE.DoubleSide;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.1, 18), wood);
    base.position.y = 0.05;
    const bands = [0.12, 0.5].map((y) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * (y > 0.3 ? 0.99 : 0.93), 0.035, 6, 24), band);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      return ring;
    });

    this.foodMesh = new THREE.Group();
    this.foodMesh.position.y = 0.1;
    if (def.food === 'hay') {
      const hay = new THREE.MeshStandardMaterial({ color: '#e2c25c', roughness: 1, flatShading: true });
      const pile = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.88, 2).scale(1, 0.55, 1), hay);
      pile.position.y = 0.35;
      this.foodMesh.add(pile);
      const straw = new THREE.MeshStandardMaterial({ color: '#d4ad45', roughness: 1 });
      for (let i = 0; i < 18; i++) {
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 4), straw);
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * r * 0.7;
        stick.position.set(Math.cos(a) * d, 0.6 + Math.random() * 0.15, Math.sin(a) * d);
        stick.rotation.set(Math.PI / 2 + (Math.random() - 0.5), Math.random() * Math.PI, 0);
        this.foodMesh.add(stick);
      }
    } else {
      const meat = new THREE.MeshStandardMaterial({ color: '#b2423a', roughness: 0.6 });
      const bone = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.7 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const d = i === 0 ? 0 : r * 0.45;
        const chunk = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8).scale(1.3, 0.7, 1), meat);
        chunk.position.set(Math.cos(a) * d, 0.42 + (i === 0 ? 0.15 : 0), Math.sin(a) * d);
        chunk.rotation.y = a;
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), bone);
        stick.rotation.z = Math.PI / 2;
        stick.position.copy(chunk.position).setY(chunk.position.y + 0.08);
        stick.rotation.y = a;
        this.foodMesh.add(chunk, stick);
      }
    }
    for (const m of [tub, base, ...bands]) m.castShadow = m.receiveShadow = true;
    this.foodMesh.traverse((o) => (o.castShadow = true));
    mergeChildren(this.foodMesh);
    this.root.add(tub, base, ...bands, this.foodMesh);
    mergeChildren(this.root);
    this.root.userData.pick = { kind: 'feeder', feeder: this };

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'feeder-label';
    this.labelEl.innerHTML = `
      <span class="feeder-icon">${def.food === 'meat' ? '🍖' : '🌾'}</span>
      <div class="bar"><i></i></div>
      <span class="feeder-hint">Refill $${def.cost}</span>`;
    this.barEl = this.labelEl.querySelector('i')!;
    const label = new CSS2DObject(this.labelEl);
    label.position.set(0, 2.6, 0);
    this.root.add(label);
    this.syncVisuals();
  }

  get fraction(): number {
    return this.stock / this.capacity;
  }

  get hasFood(): boolean {
    return this.stock > 0.5;
  }

  get foodLabel(): string {
    return FOOD_LABEL[this.food];
  }

  /** Takes up to `amount` food and returns how much was actually taken. */
  consume(amount: number): number {
    const taken = Math.min(amount, this.stock);
    const wasFull = this.hasFood;
    this.stock -= taken;
    if (wasFull && !this.hasFood) {
      this.stock = 0;
      this.onEmpty?.();
    }
    return taken;
  }

  refill(): void {
    this.stock = this.capacity;
    this.syncVisuals();
  }

  /** A spot next to the tub, inside the enclosure, for an animal of the given radius. */
  approachPoint(animalRadius: number, enclosure: Enclosure, out = new THREE.Vector3()): THREE.Vector3 {
    const d = this.radius + animalRadius + 0.2;
    const c = this.root.position;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      if (enclosure.containsWithMargin(x, z, animalRadius * 0.6)) return out.set(x, 0, z);
    }
    return out.set(c.x, 0, c.z);
  }

  /** Shows the refill price while the pointer is over the feeder. */
  setHover(hover: boolean): void {
    this.labelEl.classList.toggle('hover', hover);
  }

  syncVisuals(): void {
    const f = this.fraction;
    // The pile sinks into the tub as it empties.
    this.foodMesh.visible = f > 0.005;
    this.foodMesh.position.y = 0.1 - (1 - f) * 0.45;
    const pct = Math.round(f * 100);
    if (pct === this.shownPercent) return;
    this.shownPercent = pct;
    this.barEl.style.width = `${pct}%`;
    this.labelEl.classList.toggle('low', pct < 25);
    this.labelEl.classList.toggle('empty', pct === 0);
  }
}
