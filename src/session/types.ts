import type { MatchMode, Snapshot } from '../game/snapshot.ts';
import type { Dir } from '../game/types.ts';

/** What the game screen needs from any running game (local, host or client). */
export interface GameSession {
  readonly mode: MatchMode;
  /** Player id of the local player (valid once the game started). */
  readonly myId: string;
  /** Advance by real elapsed seconds. */
  update(dt: number): void;
  /** Latest state to render (may be interpolated). */
  view(): Snapshot | null;
  /** Local player's desired direction (persistent until changed). */
  setInput(dir: Dir | null): void;
  /** True when the match is over and the final screen may be shown. */
  readonly over: boolean;
  dispose(): void;
}
