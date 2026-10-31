import type { Dir, GameEvent, GhostState, Popup } from './types.ts';

export type MatchMode = 'single' | 'multi';

export type Phase = 'roleReveal' | 'intro' | 'ready' | 'playing' | 'dying' | 'levelComplete' | 'gameOver';

export interface SnapPaco {
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  chomp: number;
  scale: number;
  skin: string;
  playerId: string | null;
}

export interface SnapGhost {
  slot: number;
  x: number;
  y: number;
  dir: Dir;
  state: GhostState;
  fright: boolean;
  skin: string;
  playerId: string | null;
}

export interface SnapPlayer {
  id: string;
  nick: string;
  score: number;
  lives: number;
  role: 'paco' | 'ghost';
  /** Ghost slot when role === 'ghost', else -1. */
  slot: number;
  pacSkin: string;
  ghostSkin: string;
  connected: boolean;
}

/**
 * Everything the renderer / audio need for one frame. Serialisable (JSON) – this
 * is exactly what the host sends to clients.
 */
export interface Snapshot {
  tick: number;
  mode: MatchMode;
  phase: Phase;
  phaseLeft: number;
  phaseTotal: number;
  level: number;
  mapIndex: number;
  /** Base64 bitset: 1 = dot/power ball still present at that cell. */
  dots: string;
  /** Cells smashed by Paco-Monster, in order. */
  broken: number[];
  dotsLeft: number;
  dotsTotal: number;
  paco: SnapPaco;
  ghosts: SnapGhost[];
  frightLeft: number;
  frightTotal: number;
  monsterLeft: number;
  players: SnapPlayer[];
  popups: Popup[];
  events: GameEvent[];
  highScore: number;
  /** Ghost slot that caught Paco in the current 'dying' phase (-1 otherwise). */
  caughtBy: number;
}

export function encodeBits(bits: ArrayLike<number>): string {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3]! |= 1 << (i & 7);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeBits(b64: string, length: number): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}

export const r2 = (v: number): number => Math.round(v * 100) / 100;
