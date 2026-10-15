/**
 * Grid A* with line-of-sight smoothing, for walking around ponds, rocks and
 * trees inside an enclosure.
 */

export interface Grid {
  minX: number;
  minZ: number;
  cell: number;
  cols: number;
  rows: number;
  /** 1 = walkable. */
  free: Uint8Array;
}

export function buildGrid(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  cell: number,
  isFree: (x: number, z: number) => boolean,
): Grid {
  const cols = Math.ceil((maxX - minX) / cell) + 1;
  const rows = Math.ceil((maxZ - minZ) / cell) + 1;
  const free = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      free[r * cols + c] = isFree(minX + c * cell, minZ + r * cell) ? 1 : 0;
    }
  }
  return { minX, minZ, cell, cols, rows, free };
}

/** Nearest walkable cell to (x, z), searching outward a few rings. */
function nearestFree(g: Grid, x: number, z: number): number {
  const c0 = Math.round((x - g.minX) / g.cell);
  const r0 = Math.round((z - g.minZ) / g.cell);
  for (let ring = 0; ring < 6; ring++) {
    let best = -1;
    let bestD = Infinity;
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || !g.free[r * g.cols + c]) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) {
          bestD = d;
          best = r * g.cols + c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Is the straight segment between two points walkable (sampled every half cell)? */
export function lineOfSight(g: Grid, ax: number, az: number, bx: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const c = Math.round((ax + (bx - ax) * t - g.minX) / g.cell);
    const r = Math.round((az + (bz - az) * t - g.minZ) / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || !g.free[r * g.cols + c]) return false;
  }
  return true;
}

/**
 * Waypoints from `from` to `to` (excluding the start, ending at `to`), or null
 * if `to` can't be reached.
 */
export function findPath(g: Grid, fx: number, fz: number, tx: number, tz: number): [number, number][] | null {
  if (lineOfSight(g, fx, fz, tx, tz)) return [[tx, tz]];
  const start = nearestFree(g, fx, fz);
  const goal = nearestFree(g, tx, tz);
  if (start < 0 || goal < 0) return null;

  const n = g.cols * g.rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gc = goal % g.cols;
  const gr = Math.floor(goal / g.cols);
  const h = (i: number) => {
    const dc = Math.abs((i % g.cols) - gc);
    const dr = Math.abs(Math.floor(i / g.cols) - gr);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
  };
  // Small binary heap of [f, index].
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0][1];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };

  gScore[start] = 0;
  push(h(start), start);
  while (heap.length) {
    const cur = pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const c = cur % g.cols;
    const r = Math.floor(cur / g.cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
        const ni = nr * g.cols + nc;
        if (!g.free[ni] || closed[ni]) continue;
        // No cutting corners past blocked cells.
        if (dr && dc && (!g.free[r * g.cols + nc] || !g.free[nr * g.cols + c])) continue;
        const cost = gScore[cur] + (dr && dc ? Math.SQRT2 : 1);
        if (cost < gScore[ni]) {
          gScore[ni] = cost;
          came[ni] = cur;
          push(cost + h(ni), ni);
        }
      }
    }
  }
  if (gScore[goal] === Infinity) return null;

  // Cells from goal back to start, as world points.
  const cells: [number, number][] = [];
  for (let i = goal; i !== -1 && i !== start; i = came[i]) {
    cells.push([g.minX + (i % g.cols) * g.cell, g.minZ + Math.floor(i / g.cols) * g.cell]);
  }
  cells.reverse();
  cells.push([tx, tz]);

  // String-pulling: from each point, jump to the farthest one still in sight.
  const out: [number, number][] = [];
  let ax = fx;
  let az = fz;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineOfSight(g, ax, az, cells[j][0], cells[j][1])) j--;
    out.push(cells[j]);
    [ax, az] = cells[j];
    i = j + 1;
  }
  return out;
}
