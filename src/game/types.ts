export type Dir = 'up' | 'down' | 'left' | 'right';

/** Classic tie-break priority order for ghost decisions: up, left, down, right. */
export const DIRS: readonly Dir[] = ['up', 'left', 'down', 'right'];

export const DV: Readonly<Record<Dir, { x: number; y: number }>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export interface Vec {
  x: number;
  y: number;
}

export function isDir(v: unknown): v is Dir {
  return v === 'up' || v === 'down' || v === 'left' || v === 'right';
}

/** Ghost lifecycle. See docs/GAME_RULES.md. */
export type GhostState =
  | 'house' // bobbing inside the house, waiting for release
  | 'leaving' // scripted walk to the door and out through the top
  | 'active' // roaming the maze
  | 'eyes' // eaten, eyes heading back to the house
  | 'entering' // scripted walk down into the house
  | 'gone'; // eaten during Paco-Monster: never respawns

export type GameEventType =
  | 'intro'
  | 'ready'
  | 'dot'
  | 'power'
  | 'ghostEaten'
  | 'pacoCaught'
  | 'death'
  | 'levelClear'
  | 'monsterStart'
  | 'wallSmash'
  | 'bigDot'
  | 'roleReveal'
  | 'gameOver';

export interface GameEvent {
  seq: number;
  type: GameEventType;
}

export interface Popup {
  x: number;
  y: number;
  text: string;
  ttl: number;
  color?: string;
}

/** Simple deterministic PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
