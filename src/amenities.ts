import * as THREE from 'three';
import { GIFT_SHOP, PICNIC_TABLES, PLAYGROUND, STANDS, type Stand } from './layout';
import { mergeStatic } from './merge';
import { Rng } from './rng';
import { buildPerson } from './visitors/person';

/**
 * Visitor amenities south of the entrance boulevard: snack kiosks (and a cart
 * on the east wing), the gift shop, a playground and picnic tables. All
 * static except the swing seats, which follow the kids riding them.
 */

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.8): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness });
    mats.set(key, m);
  }
  return m;
}

function box(g: THREE.Object3D, w: number, h: number, d: number, color: string, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}

/** A painted sign board with text, facing +z. */
function sign(text: string, width: number, bg: string, fg: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(4, 4, 504, 120, 28);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = 'bold 64px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const edge = mat(bg);
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, width / 4, 0.1), [edge, edge, edge, edge, face, edge]);
  m.castShadow = true;
  return m;
}

/** Striped awning over a counter, sloping down toward the front (+z). */
function awning(g: THREE.Object3D, w: number, colors: [string, string], y: number, z: number): void {
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    const s = box(g, w / stripes, 0.06, 1.2, colors[i % 2], -w / 2 + (w / stripes) * (i + 0.5), y, z);
    s.rotation.x = 0.35;
  }
}

export class Amenities {
  readonly group = new THREE.Group();
  /** Swing seats (pivot groups at the top bar), in PLAYGROUND.swings order. */
  private readonly swings: THREE.Group[] = [];

  constructor() {
    const statics = new THREE.Group();
    for (const s of STANDS) statics.add(s.name === 'Ice cream cart' ? this.cart(s) : this.kiosk(s));
    statics.add(this.giftShop(), this.playground(), this.picnic());
    this.group.add(mergeStatic(statics));
    this.group.add(...this.swings);
    // The cart's vendor (kiosk vendors would be hidden inside the kiosks).
    const rng = new Rng('tiny-zoo:vendors');
    for (const s of STANDS.filter((x) => x.name === 'Ice cream cart')) {
      const v = buildPerson(false, false, rng);
      // Behind the counter, facing the queue (-z).
      v.root.position.set(s.x, s.name === 'Ice cream cart' ? 0 : 0.15, s.z + (s.name === 'Ice cream cart' ? 0.9 : -0.25));
      v.root.rotation.y = Math.PI;
      v.shoulders.forEach((sh) => (sh.rotation.x = -0.5));
      this.group.add(v.root);
    }
  }

  /** Swing seats follow their riders' angle (or hang still when empty). */
  update(riderAngles: (number | null)[], t: number): void {
    this.swings.forEach((seat, i) => {
      const a = riderAngles[i];
      seat.rotation.x = a ?? Math.sin(t * 0.7 + i) * 0.04;
    });
  }

  private kiosk(s: Stand): THREE.Group {
    const g = new THREE.Group();
    const iceCream = s.sells.includes('balloon');
    const body = iceCream ? '#f7c5d9' : '#ffd88a';
    box(g, 2.8, 2.2, 2.2, body, 0, 1.1, 0);
    box(g, 2.0, 0.9, 0.12, '#3a2a22', 0, 1.45, 1.06); // dark serving window
    box(g, 2.6, 0.12, 0.5, '#ffffff', 0, 0.98, 1.25); // counter
    awning(g, 3.0, iceCream ? ['#ff7aa8', '#ffffff'] : ['#e8443a', '#ffffff'], 2.35, 1.35);
    box(g, 3.0, 0.2, 2.4, '#ffffff', 0, 2.3, 0);
    const board = sign(iceCream ? 'ICE CREAM' : 'SNACKS', 2.6, iceCream ? '#ff7aa8' : '#e8443a', '#ffffff');
    board.position.set(0, 2.85, 0.9);
    g.add(board);
    if (iceCream) {
      // A giant cone on the roof.
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 10).rotateX(Math.PI), mat('#d9a05b'));
      cone.position.set(0, 3.25, -0.4);
      const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), mat('#ffb3cf'));
      scoop.position.set(0, 3.95, -0.4);
      g.add(cone, scoop);
    } else {
      // A giant hot dog.
      const bun = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.2, 4, 10).rotateZ(Math.PI / 2), mat('#e3b170'));
      bun.position.set(0, 3.15, -0.4);
      const sausage = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.5, 4, 10).rotateZ(Math.PI / 2), mat('#b8452f'));
      sausage.position.set(0, 3.35, -0.4);
      g.add(bun, sausage);
    }
    // A second sign on the back, for people coming from the other side.
    const back = board.clone();
    back.position.z = -1.2;
    back.rotation.y = Math.PI;
    g.add(back);
    g.traverse((o) => (o.castShadow = true));
    // Built facing +z; the counter faces the boulevard (-z).
    g.position.set(s.x, 0, s.z);
    g.rotation.y = Math.PI;
    return g;
  }

  /** A little push cart with a striped umbrella. */
  private cart(s: Stand): THREE.Group {
    const g = new THREE.Group();
    box(g, 1.8, 0.9, 1.0, '#9fd3ef', 0, 0.75, 0);
    box(g, 1.9, 0.08, 1.1, '#ffffff', 0, 1.24, 0);
    for (const x of [-0.7, 0.7]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 14).rotateZ(Math.PI / 2), mat('#3a3f45'));
      wheel.position.set(x, 0.28, 0.55);
      g.add(wheel);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), mat('#dddddd'));
    pole.position.set(0, 2.0, -0.2);
    const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.5, 8), mat('#ff7aa8'));
    umbrella.position.set(0, 2.9, -0.2);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.28, 8), mat('#ffffff'));
    tip.position.set(0, 3.1, -0.2);
    g.add(pole, umbrella, tip);
    g.traverse((o) => (o.castShadow = true));
    g.position.set(s.x, 0, s.z);
    g.rotation.y = Math.PI;
    return g;
  }

  private giftShop(): THREE.Group {
    const g = new THREE.Group();
    const { w, d } = GIFT_SHOP;
    box(g, w, 3.0, d, '#f4e3c3', 0, 1.5, 0);
    box(g, 1.3, 2.1, 0.12, '#5a3a1e', 0, 1.05, d / 2 + 0.01); // door
    for (const x of [-2.2, 2.2]) box(g, 1.8, 1.2, 0.1, '#9fd3ef', x, 1.6, d / 2 + 0.02); // display windows
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.5, 1.8, 4), mat('#d95f43'));
    roof.position.y = 3.9;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, d / w);
    g.add(roof);
    const board = sign('GIFT SHOP', 3.4, '#2f6f8f', '#ffffff');
    board.position.set(0, 2.55, d / 2 + 0.08);
    g.add(board);
    const back = board.clone();
    back.position.z = -d / 2 - 0.08;
    back.rotation.y = Math.PI;
    g.add(back);
    g.traverse((o) => (o.castShadow = true));
    // Built facing +z; the door faces the boulevard (-z).
    g.position.set(GIFT_SHOP.x, 0, GIFT_SHOP.z);
    g.rotation.y = Math.PI;
    return g;
  }

  private playground(): THREE.Group {
    const g = new THREE.Group();
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(14, 11).rotateX(-Math.PI / 2), mat('#e8d6a6', 1));
    sand.position.set(44, 0.02, 47);
    sand.receiveShadow = true;
    g.add(sand);

    // Swing frame: A-frame legs at both ends, top bar along x.
    const [s0, s1] = PLAYGROUND.swings;
    const barY = 2.3;
    const steel = '#4f8fdc';
    for (const x of [s0.x - 1, s1.x + 1]) {
      for (const dz of [-0.6, 0.6]) {
        const leg = box(g, 0.1, 2.5, 0.1, steel, x, barY / 2, s0.z + dz / 2);
        leg.rotation.x = dz > 0 ? -0.25 : 0.25;
      }
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, s1.x - s0.x + 2.2, 8).rotateZ(Math.PI / 2), mat(steel));
    bar.position.set((s0.x + s1.x) / 2, barY, s0.z);
    g.add(bar);
    // Swing seats hang from pivots on the bar (animated).
    for (const s of PLAYGROUND.swings) {
      const pivot = new THREE.Group();
      pivot.position.set(s.x, barY, s.z);
      const ropeGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.65, 4).translate(0, -0.825, 0);
      for (const dx of [-0.25, 0.25]) {
        const rope = new THREE.Mesh(ropeGeo, mat('#c9b48a'));
        rope.position.x = dx;
        pivot.add(rope);
      }
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.3), mat('#e8443a'));
      seat.position.y = -1.67;
      pivot.add(seat);
      pivot.traverse((o) => (o.castShadow = true));
      this.swings.push(pivot);
    }

    // Slide: ladder up to a platform, chute down toward +z.
    const { ladder, top, bottom } = PLAYGROUND.slide;
    for (const dx of [-0.35, 0.35]) box(g, 0.08, top + 0.9, 0.08, '#ffd23f', ladder.x + dx, (top + 0.9) / 2, ladder.z);
    for (let y = 0.3; y < top; y += 0.35) box(g, 0.7, 0.05, 0.05, '#ffd23f', ladder.x, y, ladder.z);
    box(g, 0.9, 0.1, 0.8, '#ffd23f', ladder.x, top, ladder.z + 0.5);
    const len = Math.hypot(bottom.z - (ladder.z + 0.9), top - 0.25);
    const chute = box(g, 0.7, 0.06, len, '#e8443a', ladder.x, (top + 0.25) / 2, (ladder.z + 0.9 + bottom.z) / 2);
    chute.rotation.x = Math.atan2(top - 0.25, bottom.z - (ladder.z + 0.9));

    // Sandbox.
    box(g, 3.2, 0.25, 0.15, '#8a5f3a', 44.4, 0.12, 49.7);
    box(g, 3.2, 0.25, 0.15, '#8a5f3a', 44.4, 0.12, 52.1);
    box(g, 0.15, 0.25, 2.4, '#8a5f3a', 42.8, 0.12, 50.9);
    box(g, 0.15, 0.25, 2.4, '#8a5f3a', 46.0, 0.12, 50.9);
    box(g, 3.0, 0.1, 2.3, '#f0dfa9', 44.4, 0.06, 50.9);
    return g;
  }

  private picnic(): THREE.Group {
    const g = new THREE.Group();
    const wood = '#9a6a42';
    for (const t of PICNIC_TABLES) {
      box(g, 1.8, 0.08, 0.8, wood, t.x, 0.75, t.z);
      for (const dx of [-0.75, 0.75]) box(g, 0.08, 0.72, 0.6, wood, t.x + dx, 0.37, t.z);
      for (const dz of [-0.8, 0.8]) box(g, 1.8, 0.06, 0.3, wood, t.x, 0.45, t.z + dz);
      // Parasol.
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), mat('#eeeeee'));
      pole.position.set(t.x, 1.2, t.z);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.5, 10), mat(t.z > 48 ? '#4f8fdc' : '#6cc28a'));
      shade.position.set(t.x, 2.4, t.z);
      pole.castShadow = shade.castShadow = true;
      g.add(pole, shade);
    }
    return g;
  }
}
