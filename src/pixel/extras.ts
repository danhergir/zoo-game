import type { FoodType } from '../feeder';
import type { Item } from '../visitors/Visitor';
import { canvas, shade, type Sprite } from './sprite';

const OUTLINE = '#2a2018';

/**
 * A person sprite with what they're holding: an item in the hand (ice cream, hot dog, plush)
 * or a balloon on a string, and an umbrella overhead in the rain. Returns the new sprite and how
 * many pixels were added on top (so the caller can keep the feet where they were).
 */
export function withProps(
  base: Sprite,
  item: Item | null,
  umbrella: boolean,
  color: string,
  side: boolean,
  flip: boolean,
): { sprite: Sprite; top: number } {
  const top = item === 'balloon' ? 9 : umbrella ? 5 : 0;
  const pad = umbrella ? 3 : 0;
  const s = canvas(base.width + pad * 2, base.height + top);
  const ctx = s.getContext('2d')!;
  ctx.drawImage(base, pad, top);
  // The hand: in front of the body when seen from the side, at the right side otherwise.
  const handX = pad + (side ? (flip ? 2 : base.width - 3) : base.width - 2);
  const handY = top + 9;
  const px = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  };
  if (item === 'icecream') {
    px(handX, handY - 2, '#f4b8c8');
    px(handX, handY - 1, '#d9a35a');
    px(handX, handY, '#b07a3a');
  } else if (item === 'hotdog') {
    px(handX, handY - 1, '#c8452e');
    px(handX, handY, '#e8b860');
  } else if (item === 'plush') {
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(handX - 1, handY - 2, 3, 3);
    px(handX, handY - 1, '#c89a6a');
  } else if (item === 'balloon') {
    // Balloon above the head on a string down to the hand.
    const bx = handX - 1;
    for (let y = 5; y < handY; y++) px(handX, y, '#e8e4dc');
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(bx - 1, 0, 5, 6);
    ctx.fillStyle = color;
    ctx.fillRect(bx, 1, 3, 4);
    px(bx, 1, shade(color, 1.4));
  }
  if (umbrella) {
    // A dome canopy over the head in the person's own colour, with scalloped edge and a shaft.
    const w = s.width;
    const mid = Math.floor(w / 2);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(mid - 3, 0, 7, 1);
    ctx.fillRect(1, 1, w - 2, 1);
    ctx.fillRect(0, 2, w, 3);
    ctx.fillStyle = color;
    ctx.fillRect(mid - 2, 1, 5, 1);
    ctx.fillRect(1, 2, w - 2, 2);
    ctx.fillStyle = shade(color, 1.25);
    ctx.fillRect(mid - 2, 1, 2, 1);
    ctx.fillStyle = shade(color, 0.72);
    for (let x = 1; x < w - 1; x += 3) ctx.fillRect(x, 4, 2, 1);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(mid, 5, 1, 2);
  }
  return { sprite: s, top };
}

export type Bubble = 'sleep' | 'unhappy' | FoodType;

const FOOD_COLORS: Record<FoodType, string> = { hay: '#e2c25a', fruit: '#e0603a', fish: '#8aa4b4', meat: '#b0453a' };

/** A little speech bubble with an icon: asleep (Z), hungry (its food) or unhappy (a frown). */
export function bubble(kind: Bubble): Sprite {
  const s = canvas(9, 10);
  const ctx = s.getContext('2d')!;
  const fill = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  fill(1, 0, 7, 1, OUTLINE);
  fill(0, 1, 9, 6, OUTLINE);
  fill(1, 7, 7, 1, OUTLINE);
  fill(3, 8, 2, 1, OUTLINE);
  fill(3, 9, 1, 1, OUTLINE);
  fill(1, 1, 7, 6, '#fbf8f0');
  fill(3, 7, 1, 1, '#fbf8f0');
  if (kind === 'sleep') {
    const z = '#4a6ab8';
    fill(2, 2, 5, 1, z);
    fill(5, 3, 1, 1, z);
    fill(4, 4, 1, 1, z);
    fill(2, 5, 5, 1, z);
  } else if (kind === 'unhappy') {
    fill(3, 2, 1, 1, OUTLINE);
    fill(5, 2, 1, 1, OUTLINE);
    fill(3, 5, 3, 1, OUTLINE);
    fill(2, 6, 1, 1, OUTLINE);
    fill(6, 6, 1, 1, OUTLINE);
  } else {
    const c = FOOD_COLORS[kind];
    fill(3, 2, 3, 4, shade(c, 0.6));
    fill(2, 3, 5, 2, shade(c, 0.6));
    fill(3, 3, 3, 2, c);
    fill(3, 3, 1, 1, shade(c, 1.3));
  }
  return s;
}

/* ---------- Sky and effects ---------- */

const draw = (s: Sprite, rows: string[], palette: Record<string, string>) => {
  const ctx = s.getContext('2d')!;
  rows.forEach((row, y) =>
    row.split('').forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = palette[ch];
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return s;
};

/** A bird seen from below: wings up or down. Gulls are white with dark tips. */
export function flyer(up: boolean, gull: boolean): Sprite {
  const rows = up ? ['t...t', '.b.b.', '..b..'] : ['.....', 'tb.bt', '..b..'];
  return draw(canvas(5, 3), rows, gull ? { b: '#f4f4f2', t: '#4a4a4e' } : { b: '#2b2d33', t: '#2b2d33' });
}

/** A butterfly: wings open or closed, in its own colour around a dark body. */
export function butterfly(open: boolean, color: string): Sprite {
  const rows = open ? ['cbc', 'c.c'] : ['.c.', '.b.'];
  return draw(canvas(3, 2), rows, { c: color, b: '#2a2018' });
}

/** A cloud's shadow on the ground: a few overlapping ovals (drawn faint). */
export function cloudShadow(seed: number, px: number): Sprite {
  const parts = [
    { x: 0, z: 0, rx: 9, rz: 4.5 },
    { x: -7 + (seed % 3), z: 1.5, rx: 6, rz: 3.5 },
    { x: 7 - (seed % 2) * 2, z: -1, rx: 6.5, rz: 3.8 },
    { x: 2, z: -2.5 - (seed % 2), rx: 5, rz: 3 },
  ];
  const w = 34 * px;
  const h = 16 * px;
  const s = canvas(w, h);
  const ctx = s.getContext('2d')!;
  ctx.fillStyle = '#16240e';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const wx = (x - w / 2) / px;
      const wz = (y - h / 2) / px;
      if (parts.some((p) => ((wx - p.x) / p.rx) ** 2 + ((wz - p.z) / p.rz) ** 2 <= 1)) ctx.fillRect(x, y, 1, 1);
    }
  }
  return s;
}

/** A round puff of smoke, lighter on top. */
export function puff(r: number): Sprite {
  const s = canvas(r * 2 + 1, r * 2 + 1);
  const ctx = s.getContext('2d')!;
  for (let y = 0; y <= r * 2; y++) {
    for (let x = 0; x <= r * 2; x++) {
      const dx = x - r;
      const dy = y - r;
      if (dx * dx + dy * dy > r * r - 0.3) continue;
      ctx.fillStyle = dy < -r * 0.3 ? '#ffffff' : dy > r * 0.4 ? '#c8ccd0' : '#eceef0';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return s;
}

/** What a keeper carries to a feeding: a hay bale, a fish bucket, a meat tray, a fruit basket. */
export function feedLoad(food: FoodType): Sprite {
  const rows: Record<FoodType, string[]> = {
    hay: ['oooo', 'oyyo', 'oYYo', 'oooo'],
    fish: ['o..o', 'osso', 'oggo', 'oooo'],
    meat: ['.oo.', 'orro', 'oRRo', 'oooo'],
    fruit: ['.oo.', 'oafo', 'obbo', 'oooo'],
  };
  return draw(canvas(4, 4), rows[food], {
    o: '#2a2018',
    y: '#f0d06a',
    Y: '#c8a040',
    s: '#a9bcc8',
    g: '#6f8796',
    r: '#d0584a',
    R: '#9a3a30',
    a: '#e8453a',
    f: '#f0c03a',
    b: '#e07a2a',
  });
}

/**
 * A gesture drawn onto a person sprite: a phone held up for a photo (with a flash), an arm
 * pointing ahead, or a hand waving overhead. `frame` alternates the wave.
 */
export function withGesture(base: Sprite, gesture: 'photo' | 'point' | 'wave', flashing: boolean, side: boolean, flip: boolean, frame: number): Sprite {
  const top = gesture === 'wave' || flashing ? 3 : 0;
  const pad = 3;
  const s = canvas(base.width + pad * 2, base.height + top);
  const ctx = s.getContext('2d')!;
  ctx.drawImage(base, pad, top);
  const dir = side && flip ? -1 : 1;
  // The body's outer edge at shoulder height (the sprite has empty columns beside the body).
  const front = pad + bodyEdge(base, 8, dir);
  const px = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  };
  if (gesture === 'photo') {
    // Phone in front of the face.
    px(front, top + 4, OUTLINE);
    px(front, top + 5, OUTLINE);
    px(front - dir, top + 5, '#6a7a8a');
    if (flashing) {
      const fx = front + dir;
      px(fx, top + 3, '#ffffff');
      px(fx, top + 1, '#fff6c8');
      px(fx, top + 5, '#fff6c8');
      px(fx - 1, top + 3, '#fff6c8');
      px(fx + 1, top + 3, '#fff6c8');
    }
  } else if (gesture === 'point') {
    // Arm straight out at shoulder height.
    px(front, top + 8, '#2a2018');
    px(front + dir, top + 8, '#2a2018');
    px(front + dir * 2, top + 8, '#e3b48e');
  } else {
    // Arm raised beside the head, hand swaying side to side.
    const ax = front + dir;
    for (let y = top + 2; y <= top + 8; y++) px(ax, y, OUTLINE);
    const hx = ax + (frame ? dir : 0);
    px(hx, top, '#e3b48e');
    px(hx, top + 1, '#e3b48e');
  }
  return s;
}

/** Column of the outermost opaque pixel in a row: the rightmost if dir > 0, else the leftmost. */
export function bodyEdge(sprite: Sprite, row: number, dir: number): number {
  const data = sprite.getContext('2d')!.getImageData(0, Math.min(row, sprite.height - 1), sprite.width, 1).data;
  const cols = Array.from({ length: sprite.width }, (_, x) => x).filter((x) => data[x * 4 + 3] > 0);
  if (!cols.length) return dir > 0 ? sprite.width - 1 : 0;
  return dir > 0 ? cols[cols.length - 1] : cols[0];
}
