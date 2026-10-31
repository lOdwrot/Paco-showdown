import { DIRS, DV, OPPOSITE, type Dir, type Vec } from './types.ts';
import type { Maze } from './maze.ts';

/** Scatter corners per ghost slot (outside the maze, like the original). */
export function scatterTarget(slot: number, maze: Maze): Vec {
  switch (slot) {
    case 0:
      return { x: maze.w - 3, y: -3 };
    case 1:
      return { x: 2, y: -3 };
    case 2:
      return { x: maze.w - 1, y: maze.h };
    default:
      return { x: 0, y: maze.h };
  }
}

/**
 * Classic personalities by slot:
 * 0 chases Paco's tile, 1 ambushes 4 tiles ahead, 2 flanks using ghost 0,
 * 3 chases when far (> 8 tiles) and retreats to its corner when close.
 */
export function chaseTarget(
  slot: number,
  ghost: Vec,
  paco: { x: number; y: number; dir: Dir | null },
  leader: Vec,
  maze: Maze,
): Vec {
  const px = Math.round(paco.x);
  const py = Math.round(paco.y);
  const dv = paco.dir ? DV[paco.dir] : { x: 0, y: 0 };
  switch (slot) {
    case 0:
      return { x: px, y: py };
    case 1:
      return { x: px + dv.x * 4, y: py + dv.y * 4 };
    case 2: {
      const ax = px + dv.x * 2;
      const ay = py + dv.y * 2;
      return { x: ax + (ax - leader.x), y: ay + (ay - leader.y) };
    }
    default: {
      const d = Math.hypot(ghost.x - px, ghost.y - py);
      return d > 8 ? { x: px, y: py } : scatterTarget(3, maze);
    }
  }
}

export type ChoiceMode = 'toward' | 'away' | 'random';

/**
 * Picks the exit at an intersection. Ghosts may not reverse unless it's the only way.
 * Ties are broken by DIRS order (up, left, down, right).
 */
export function chooseDir(
  x: number,
  y: number,
  dir: Dir | null,
  canGo: (d: Dir) => boolean,
  target: Vec,
  mode: ChoiceMode,
  rng: () => number,
): Dir | null {
  let options = DIRS.filter((d) => (dir ? d !== OPPOSITE[dir] : true) && canGo(d));
  if (!options.length) options = DIRS.filter(canGo);
  if (!options.length) return null;
  if (mode === 'random') return options[Math.floor(rng() * options.length)]!;
  let best = options[0]!;
  let bestScore = mode === 'toward' ? Infinity : -Infinity;
  for (const d of options) {
    const nx = x + DV[d].x;
    const ny = y + DV[d].y;
    const s = (nx - target.x) ** 2 + (ny - target.y) ** 2;
    if (mode === 'toward' ? s < bestScore : s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}
