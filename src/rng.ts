/**
 * Seeded randomness. Every browser that uses the same seeds draws the same
 * numbers in the same order, which is what keeps everyone's zoo identical.
 */

/** cyrb128: hashes a string into four 32-bit seeds. */
function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32 generator. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string) {
    [this.a, this.b, this.c, this.d] = hash128(seed);
    for (let i = 0; i < 12; i++) this.next(); // warm up
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)];
  }

  /** An independent stream derived from this one, e.g. one per spawned visitor. */
  fork(label: string): Rng {
    return new Rng(`${label}:${this.next()}`);
  }
}

/**
 * Runs `fn` with Math.random temporarily replaced by a seeded generator, so
 * one-off procedural content (scenery, textures) comes out the same everywhere.
 * Only for synchronous build code; the simulation uses explicit Rng streams.
 */
export function withSeededRandom<T>(seed: string, fn: () => T): T {
  const original = Math.random;
  const rng = new Rng(seed);
  Math.random = () => rng.next();
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}
