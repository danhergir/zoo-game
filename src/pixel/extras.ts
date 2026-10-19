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
