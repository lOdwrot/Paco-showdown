import { SIM_DT } from '../config.ts';
import { Match, type DevOptions } from '../game/match.ts';
import type { Snapshot } from '../game/snapshot.ts';
import type { Dir } from '../game/types.ts';
import type { Profile } from '../net/protocol.ts';
import type { GameSession } from './types.ts';

/** Single player: runs the Match locally with a fixed timestep. */
export class LocalSession implements GameSession {
  readonly mode = 'single' as const;
  readonly myId = 'me';
  paused = false;
  readonly match: Match;
  private acc = 0;
  private snap: Snapshot;

  constructor(profile: Profile, opts: { highScore?: number; startLevel?: number; seed?: number; dev?: DevOptions } = {}) {
    this.match = new Match('single', [{ id: this.myId, ...profile }], {
      highScore: opts.highScore,
      startLevel: opts.startLevel,
      seed: opts.seed ?? Math.floor(Math.random() * 1e9),
      dev: opts.dev,
    });
    this.snap = this.match.snapshot();
  }

  get over(): boolean {
    return this.match.finished;
  }

  update(dt: number): void {
    if (this.paused) return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= SIM_DT) {
      this.match.step(SIM_DT);
      this.acc -= SIM_DT;
    }
    this.snap = this.match.snapshot();
  }

  view(): Snapshot {
    return this.snap;
  }

  setInput(dir: Dir | null): void {
    this.match.setInput(this.myId, dir);
  }

  dispose(): void {}
}
