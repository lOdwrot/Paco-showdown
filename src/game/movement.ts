import { DV, type Dir } from './types.ts';

/** Anything that moves on the grid. Positions are in tiles; integer = tile centre. */
export interface Mover {
  x: number;
  y: number;
  dir: Dir | null;
}

const EPS = 1e-6;

export function isCentered(v: number): boolean {
  return Math.abs(v - Math.round(v)) < EPS;
}

/**
 * Called when the mover sits exactly on a tile centre (tx, ty are integer, tx wrapped
 * into [0, width)). Return the direction to continue in, or null to stop on this centre.
 */
export type Chooser = (m: Mover, tx: number, ty: number) => Dir | null;

/**
 * Moves `m` up to `dist` tiles, stepping centre-to-centre so that decisions happen
 * exactly on tile centres even with large steps. Handles horizontal wrap (tunnels).
 * Returns the distance actually travelled.
 */
export function advance(m: Mover, dist: number, width: number, choose: Chooser): number {
  let remaining = dist;
  let moved = 0;
  for (let guard = 0; remaining > EPS && guard < 64; guard++) {
    if (isCentered(m.x) && isCentered(m.y)) {
      m.x = Math.round(m.x);
      m.y = Math.round(m.y);
      const d = choose(m, m.x, m.y);
      if (d === null) break;
      m.dir = d;
    }
    if (!m.dir) break;
    const dv = DV[m.dir];
    const horizontal = dv.x !== 0;
    const p = horizontal ? m.x : m.y;
    const s = horizontal ? dv.x : dv.y;
    const target = s > 0 ? Math.floor(p + EPS) + 1 : Math.ceil(p - EPS) - 1;
    const gap = Math.abs(target - p);
    const step = Math.min(gap, remaining);
    const np = step === gap ? target : p + s * step;
    if (horizontal) m.x = np;
    else m.y = np;
    remaining -= step;
    moved += step;
    // Wrap through tunnels.
    if (m.x < -0.5) m.x += width;
    else if (m.x >= width - 0.5) m.x -= width;
  }
  return moved;
}

/** Shortest horizontal-wrapped distance between two points (in tiles). */
export function wrappedDist(ax: number, ay: number, bx: number, by: number, width: number): number {
  let dx = Math.abs(ax - bx);
  if (dx > width / 2) dx = width - dx;
  return Math.hypot(dx, ay - by);
}

/** Moves a point toward (tx, ty), x first then y. Returns true when it arrives. */
export function scriptedMove(m: Mover, tx: number, ty: number, dist: number): boolean {
  let rem = dist;
  if (Math.abs(m.x - tx) > EPS) {
    const d = Math.min(Math.abs(tx - m.x), rem);
    m.dir = tx > m.x ? 'right' : 'left';
    m.x += Math.sign(tx - m.x) * d;
    rem -= d;
    if (Math.abs(m.x - tx) < EPS) m.x = tx;
  }
  if (rem > EPS && Math.abs(m.y - ty) > EPS) {
    const d = Math.min(Math.abs(ty - m.y), rem);
    m.dir = ty > m.y ? 'down' : 'up';
    m.y += Math.sign(ty - m.y) * d;
    if (Math.abs(m.y - ty) < EPS) m.y = ty;
  }
  return Math.abs(m.x - tx) < EPS && Math.abs(m.y - ty) < EPS;
}
