import { describe, expect, it } from 'vitest';
import { HUNT, SIM_DT } from '../src/config.ts';
import { Match } from '../src/game/match.ts';

const setup = [{ id: 'me', nick: 'ME', pacSkin: 'classic', ghostSkin: 'blaze' }];

function run(m: Match, secs: number, until?: () => boolean): void {
  for (let i = 0; i < secs / SIM_DT && !(until?.() ?? false); i++) m.step(SIM_DT);
}

describe('ghost hunt', () => {
  it('player owns ghost slot 0 and Paco is AI', () => {
    const m = new Match('hunt', setup, { seed: 5, dev: { skipIntro: true } });
    const s = m.snapshot();
    expect(s.mode).toBe('hunt');
    expect(s.ghosts[0]!.playerId).toBe('me');
    expect(s.players[0]!.role).toBe('ghost');
    expect(s.huntLeft).toBe(HUNT.duration);
  });

  it('AI Paco moves and eats dots by himself', () => {
    const m = new Match('hunt', setup, { seed: 5, dev: { skipIntro: true, noGhosts: true } });
    run(m, 10, () => m.phase === 'playing');
    const before = m.level.dotsLeft;
    run(m, 10);
    expect(m.level.dotsLeft).toBeLessThan(before);
  });

  it('timer runs out -> game over with no points', () => {
    const m = new Match('hunt', setup, { seed: 5, dev: { skipIntro: true, noGhosts: true, invincible: true } });
    run(m, 200, () => m.phase === 'gameOver');
    expect(m.phase).toBe('gameOver');
    expect(m.players[0]!.score).toBe(0);
  });

  it('catching Paco scores 500 + 100 per remaining second', () => {
    const m = new Match('hunt', setup, { seed: 5, dev: { skipIntro: true, noGhosts: true } });
    run(m, 10, () => m.phase === 'playing');
    m.huntLeft = 42.3;
    const g = m.level.ghosts[0]!;
    g.state = 'active';
    g.x = m.level.paco.x;
    g.y = m.level.paco.y;
    m.step(SIM_DT);
    expect(m.phase).toBe('dying');
    expect(m.players[0]!.score).toBe(HUNT.catchBonus + 43 * HUNT.perSecond);
    run(m, 10, () => m.phase === 'gameOver');
    expect(m.phase).toBe('gameOver');
  });
});
