/**
 * ALL gameplay tunables live here. Numbers are based on the original arcade game
 * ("The Pac-Man Dossier") where noted. Speeds are in tiles per second.
 */

/** Arcade 100% speed: 75.75 px/s with 8px tiles. */
export const BASE_SPEED = 9.47;

export const TILE = 8; // native pixels per tile
export const HUD_TOP = 3 * TILE; // native pixels reserved above the maze
export const HUD_BOTTOM = 2 * TILE; // native pixels reserved below the maze

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const SNAPSHOT_HZ = 30;

export const SCORE = {
  dot: 10,
  powerBall: 10,
  ghostBase: 200, // 200, 400, 800, 1600, ... (doubles, uncapped)
  catchPaco: 1000, // multiplayer: ghost player catches Paco
} as const;

export const LIVES_SINGLE = 3;
export const LIVES_MULTI = 2;
export const MAX_PLAYERS = 5;
export const GHOST_COUNT = 4;

/** Frightened time by level (seconds), original table; clamped to >= FRIGHT_MIN. */
export const FRIGHT_TABLE = [6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 1, 0];
export const FRIGHT_MIN = 1;
/** Extra seconds added on top of the original arcade table. */
export const FRIGHT_BONUS = 5;
export const FRIGHT_FLASH_TIME = 2; // flash during the last N seconds
export function frightTime(level: number): number {
  const v = FRIGHT_TABLE[Math.min(level - 1, FRIGHT_TABLE.length - 1)] ?? 0;
  return Math.max(FRIGHT_MIN, v) + FRIGHT_BONUS;
}

/** Speed factors relative to BASE_SPEED by level (Dossier table: L1, L2-4, L5+). */
export function speeds(level: number) {
  const i = level <= 1 ? 0 : level <= 4 ? 1 : 2;
  const pick = (a: number, b: number, c: number) => BASE_SPEED * [a, b, c][i]!;
  return {
    paco: pick(0.8, 0.9, 1.0),
    pacoFright: pick(0.9, 0.95, 1.0),
    ghost: pick(0.75, 0.85, 0.95),
    ghostFright: pick(0.5, 0.55, 0.6),
    ghostTunnel: pick(0.4, 0.45, 0.5),
    humanGhost: pick(0.78, 0.88, 0.97), // player ghosts are slightly nimbler than AI
    eyes: BASE_SPEED * 1.6,
    house: BASE_SPEED * 0.45,
  };
}

/** Scatter/chase waves (seconds). Last chase is infinite. */
export const MODE_WAVES = [7, 20, 7, 20, 5, 20, 5, Infinity];

/** Ghost release delays (seconds after round start), by ghost slot. */
export const GHOST_RELEASE = [0, 1.5, 4, 7];
export const GHOST_RELEASE_AFTER_EATEN = 0.5;

export const PHASE = {
  introTime: 4.3, // must cover the intro jingle (see audio/songs.ts INTRO)
  readyTime: 2.0,
  roleRevealTime: 3.0,
  dyingTime: 2.2,
  levelCompleteTime: 2.4,
  ghostEatenFreeze: 0.5,
  gameOverTime: 4,
} as const;

export const MONSTER = {
  duration: 10,
  scale: 2,
  speedFactor: 1.1, // Paco-Monster is a bit faster than a frightened-speed Paco...
  smashSpeedFactor: 0.7, // ...and a bit faster while eating walls too (relative to the above)
  shakePixels: 2, // max screen-shake offset (native px) right after a wall smash
  shakeTime: 0.3, // seconds for the shake to die down
} as const;

/** Collision radius in tiles between Paco and a ghost (scaled by Paco's size). */
export const COLLIDE_DIST = 0.6;

export const FOG = {
  ownRadius: 6.5, // tiles
  otherRadius: 3, // tiles
} as const;
