import { describe, expect, it } from 'vitest';
import { Match, type DevOptions } from '../src/game/match.ts';
import { MAPS } from '../src/game/maps/index.ts';
import { SIM_DT, LIVES_SINGLE } from '../src/config.ts';

const me = { id: 'me', nick: 'DEV', pacSkin: 'classic', ghostSkin: 'blaze' };
const make = (dev: DevOptions, startLevel = 1) => new Match('single', [me], { dev, startLevel });
const runUntil = (m: Match, pred: () => boolean, max = 30) => {
  for (let t = 0; t < max && !pred(); t += SIM_DT) m.step(SIM_DT);
};

describe('dev options', () => {
  it('starts on any map and continues the rotation from there', () => {
    const m = make({ mapIndex: 2 });
    expect(m.snapshot().mapIndex).toBe(2);
    expect(m.level.maze.def.id).toBe(MAPS[2]!.id);
    runUntil(m, () => m.phase === 'playing');
    m.level.outcome = { type: 'cleared' };
    m.level.step = () => {};
    runUntil(m, () => m.levelNum === 2);
    expect(m.snapshot().mapIndex).toBe(0);
  });

  it('map choice is independent of the start level', () => {
    expect(make({ mapIndex: 1 }, 5).snapshot().mapIndex).toBe(1);
  });

  it('monsterNow starts Paco-Monster when play begins', () => {
    const m = make({ monsterNow: true });
    expect(m.level.monster).toBe(false);
    runUntil(m, () => m.phase === 'playing');
    m.step(SIM_DT);
    expect(m.level.monster).toBe(true);
    expect(m.snapshot().monsterLeft).toBeGreaterThan(0);
  });

  it('monsterUnlocked makes clearing the board trigger the bonus, even after a death', () => {
    const m = make({ monsterUnlocked: true, dotsLeft: 1 });
    expect(m.level.lifeBestStreak).toBe(4);
    runUntil(m, () => m.phase === 'playing');
    const g = m.level.ghosts[0]!;
    Object.assign(g, { state: 'active', frightened: false, x: m.level.paco.x, y: m.level.paco.y });
    m.step(SIM_DT);
    runUntil(m, () => m.phase === 'ready');
    expect(m.level.lifeBestStreak).toBe(4);
  });

  it('skipIntro, powerAtStart, dotsLeft', () => {
    const m = make({ skipIntro: true, powerAtStart: true, dotsLeft: 5 });
    expect(m.phase).toBe('ready');
    expect(m.level.dotsLeft).toBe(5);
    expect([...m.level.maze.dots].filter(Boolean)).toHaveLength(5);
    runUntil(m, () => m.phase === 'playing');
    expect(m.level.frightLeft).toBeGreaterThan(0);
  });

  it('invincible: ghosts pass through Paco', () => {
    const m = make({ invincible: true });
    runUntil(m, () => m.phase === 'playing');
    const g = m.level.ghosts[0]!;
    Object.assign(g, { state: 'active', frightened: false, x: m.level.paco.x, y: m.level.paco.y });
    m.step(SIM_DT);
    expect(m.phase).toBe('playing');
  });

  it('infiniteLives: dying costs nothing', () => {
    const m = make({ infiniteLives: true });
    for (let i = 0; i < 5; i++) {
      runUntil(m, () => m.phase === 'playing');
      const g = m.level.ghosts[1]!;
      Object.assign(g, { state: 'active', frightened: false, x: m.level.paco.x, y: m.level.paco.y });
      m.step(SIM_DT);
      runUntil(m, () => m.phase !== 'dying');
    }
    expect(m.players[0]!.lives).toBe(LIVES_SINGLE);
    expect(m.phase).not.toBe('gameOver');
  });

  it('noGhosts keeps every ghost in the house', () => {
    const m = make({ noGhosts: true });
    runUntil(m, () => m.phase === 'playing');
    runUntil(m, () => false, 15);
    expect(m.level.ghosts.every((g) => g.state === 'house')).toBe(true);
  });
});
