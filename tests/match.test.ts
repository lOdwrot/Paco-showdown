import { describe, expect, it } from 'vitest';
import { Match, type PlayerSetup } from '../src/game/match.ts';
import { PHASE, SCORE, SIM_DT, LIVES_SINGLE, LIVES_MULTI } from '../src/config.ts';
import { decodeBits } from '../src/game/snapshot.ts';

const P = (id: string, ghostSkin = 'blaze'): PlayerSetup => ({ id, nick: id.toUpperCase(), pacSkin: 'classic', ghostSkin });

function runUntil(m: Match, pred: () => boolean, max = 60) {
  for (let t = 0; t < max && !pred(); t += SIM_DT) m.step(SIM_DT);
}

function catchPacoBy(m: Match, slot: number) {
  const L = m.level;
  const g = L.ghosts[slot]!;
  g.state = 'active';
  g.frightened = false;
  g.x = L.paco.x;
  g.y = L.paco.y;
  m.step(SIM_DT);
}

describe('Match – single player', () => {
  it('starts with the intro freeze, then plays', () => {
    const m = new Match('single', [P('me')]);
    expect(m.phase).toBe('intro');
    expect(m.snapshot().events.map((e) => e.type)).toContain('intro');
    const x0 = m.level.paco.x;
    m.step(1);
    expect(m.level.paco.x).toBe(x0); // frozen
    runUntil(m, () => m.phase === 'playing');
    expect(m.phase).toBe('playing');
  });

  it('has 3 lives; game over after the last one; dots stay eaten', () => {
    const m = new Match('single', [P('me')]);
    expect(m.players[0]!.lives).toBe(LIVES_SINGLE);
    runUntil(m, () => m.phase === 'playing');
    m.level.maze.dots[5] = 0;
    for (let life = LIVES_SINGLE; life > 0; life--) {
      runUntil(m, () => m.phase === 'playing');
      catchPacoBy(m, 0);
      expect(m.phase).toBe('dying');
      runUntil(m, () => m.phase !== 'dying');
      expect(m.players[0]!.lives).toBe(life - 1);
    }
    expect(m.phase).toBe('gameOver');
    expect(m.level.maze.dots[5]).toBe(0);
  });

  it('advances to the next map when cleared and wraps around', () => {
    const m = new Match('single', [P('me')], { startLevel: 3 });
    runUntil(m, () => m.phase === 'playing');
    m.level.outcome = { type: 'cleared' };
    m.level.step = () => {}; // keep outcome
    m.step(SIM_DT);
    expect(m.phase).toBe('levelComplete');
    runUntil(m, () => m.phase !== 'levelComplete');
    expect(m.levelNum).toBe(4);
    expect(m.snapshot().mapIndex).toBe(0);
  });
});

describe('Match – multiplayer', () => {
  it('shows the role reveal for 3s before each round, humans fill ghost slots', () => {
    const m = new Match('multi', [P('a'), P('b', 'count'), P('c', 'count')]);
    expect(m.phase).toBe('roleReveal');
    expect(m.phaseLeft).toBeCloseTo(PHASE.roleRevealTime);
    expect(m.pacoId).toBe('a');
    expect(m.ghostOwners).toEqual(['b', 'c', null, null]);
    expect(m.players.every((p) => p.lives === LIVES_MULTI)).toBe(true);
    const s = m.snapshot();
    expect(s.players.find((p) => p.id === 'b')!.slot).toBe(0);
    expect(s.ghosts[0]!.skin).toBe('count');
    expect(s.ghosts[1]!.skin).toBe('count');
    expect(new Set(s.ghosts.slice(2).map((g) => g.skin)).has('count')).toBe(false);
    runUntil(m, () => m.phase !== 'roleReveal');
    expect(m.phase).toBe('intro');
  });

  it('ghost player who catches Paco gets 1000 and becomes Paco', () => {
    const m = new Match('multi', [P('a'), P('b'), P('c')]);
    runUntil(m, () => m.phase === 'playing');
    catchPacoBy(m, 1); // slot 1 = player c
    expect(m.player('c')!.score).toBe(SCORE.catchPaco);
    runUntil(m, () => m.phase !== 'dying');
    expect(m.player('a')!.lives).toBe(LIVES_MULTI - 1);
    expect(m.pacoId).toBe('c');
    expect(m.phase).toBe('roleReveal');
    expect(m.ghostOwners).toEqual(['a', 'b', null, null]);
  });

  it('AI catch rotates Paco to the next player; game ends when everyone is out of lives', () => {
    const m = new Match('multi', [P('a'), P('b')]);
    const order: string[] = [];
    for (let i = 0; i < 10 && m.phase !== 'gameOver'; i++) {
      runUntil(m, () => m.phase === 'playing');
      order.push(m.pacoId);
      catchPacoBy(m, 3); // AI slot
      runUntil(m, () => m.phase !== 'dying');
    }
    expect(order).toEqual(['a', 'b', 'a', 'b']);
    expect(m.phase).toBe('gameOver');
  });

  it('a disconnected ghost becomes AI; a disconnected Paco hands over without losing lives', () => {
    const m = new Match('multi', [P('a'), P('b'), P('c')]);
    m.disconnect('b');
    expect(m.ghostOwners).toEqual(['c', null, null, null]);
    m.disconnect('a');
    expect(m.pacoId).toBe('c');
    expect(m.player('a')!.lives).toBe(LIVES_MULTI);
  });
});

describe('Snapshot', () => {
  it('round-trips through JSON and encodes dots', () => {
    const m = new Match('single', [P('me')]);
    const s = JSON.parse(JSON.stringify(m.snapshot()));
    const bits = decodeBits(s.dots, m.level.maze.w * m.level.maze.h);
    expect(bits.reduce((a: number, b: number) => a + b, 0)).toBe(m.level.dotsTotal);
    expect(s.ghosts).toHaveLength(4);
  });
});
