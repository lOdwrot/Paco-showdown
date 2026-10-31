import { describe, expect, it } from 'vitest';
import { Level } from '../src/game/level.ts';
import { MAPS } from '../src/game/maps/index.ts';
import { D_DOT, D_POWER, T_PATH, T_WALL } from '../src/game/maze.ts';
import { MONSTER, SCORE, SIM_DT, frightTime } from '../src/config.ts';
import type { GameEventType } from '../src/game/types.ts';

function setup(level = 1, lifeBestStreak = 0) {
  const events: GameEventType[] = [];
  let score = 0;
  const L = new Level(MAPS[0]!, level, {
    lifeBestStreak,
    hooks: { emit: (t) => events.push(t), score: (p) => (score += p) },
  });
  // Park Paco on a whole tile facing a wall-free direction so tests are predictable.
  L.paco.x = Math.floor(L.paco.x);
  L.paco.dir = null;
  return { L, events, score: () => score };
}

const idle = { paco: null, ghosts: [null, null, null, null] };

function run(L: Level, seconds: number, input = idle) {
  for (let t = 0; t < seconds; t += SIM_DT) L.step(SIM_DT, input);
}

/** Puts an active, frightened ghost right on top of Paco. */
function ghostOnPaco(L: Level, slot: number, frightened = true) {
  const g = L.ghosts[slot]!;
  g.state = 'active';
  g.frightened = frightened;
  g.x = L.paco.x;
  g.y = L.paco.y;
}

describe('Level scoring', () => {
  it('dots and power balls are worth 10', () => {
    const { L, score } = setup();
    const m = L.maze;
    const i = m.idx(Math.round(L.paco.x), L.paco.y);
    m.dots[i] = D_DOT;
    L.dotsLeft++;
    L.step(SIM_DT, idle);
    expect(score()).toBe(SCORE.dot);
    m.dots[m.idx(Math.round(L.paco.x), L.paco.y)] = D_POWER;
    L.dotsLeft++;
    L.step(SIM_DT, idle);
    expect(score()).toBe(SCORE.dot + SCORE.powerBall);
    expect(L.frightLeft).toBeGreaterThan(0);
  });

  it('ghost streak doubles 200, 400, 800, 1600', () => {
    const { L, score } = setup();
    L.frightLeft = 5;
    const got: number[] = [];
    for (let s = 0; s < 4; s++) {
      const before = score();
      ghostOnPaco(L, s);
      L.freeze = 0;
      L.step(SIM_DT, idle);
      got.push(score() - before);
    }
    // dots eaten along the way are 10s; subtract them
    expect(got.map((g) => g - (g % 100))).toEqual([200, 400, 800, 1600]);
    expect(L.lifeBestStreak).toBe(4);
  });

  it('streak resets when the power effect ends', () => {
    const { L } = setup();
    L.frightLeft = 0.05;
    ghostOnPaco(L, 0);
    L.step(SIM_DT, idle);
    expect(L.streak).toBe(1);
    run(L, 1);
    expect(L.streak).toBe(0);
  });

  it('second power ball extends the streak and re-frightens respawned ghosts', () => {
    const { L } = setup();
    const m = L.maze;
    const power = () => {
      m.dots[m.idx(Math.round(L.paco.x), Math.round(L.paco.y))] = D_POWER;
      L.dotsLeft++;
      L.step(SIM_DT, idle);
    };
    power();
    expect(L.frightLeft).toBeCloseTo(frightTime(1) - 0, 0);
    ghostOnPaco(L, 0);
    L.step(SIM_DT, idle);
    expect(L.streak).toBe(1);
    // Ghost 0 respawns: not frightened.
    const g0 = L.ghosts[0]!;
    g0.state = 'active';
    g0.frightened = false;
    g0.x = 1;
    g0.y = 1;
    L.freeze = 0;
    power();
    expect(g0.frightened).toBe(true);
    expect(L.streak).toBe(1); // continues
    ghostOnPaco(L, 1);
    L.freeze = 0;
    L.step(SIM_DT, idle);
    expect(L.streak).toBe(2);
  });

  it('touching a non-frightened ghost kills Paco', () => {
    const { L } = setup();
    ghostOnPaco(L, 2, false);
    L.step(SIM_DT, idle);
    expect(L.outcome).toEqual({ type: 'died', caughtBySlot: 2 });
  });

  it('eaten ghosts go home as eyes, then leave again unfrightened', () => {
    const { L } = setup();
    L.frightLeft = 3;
    ghostOnPaco(L, 0);
    L.step(SIM_DT, idle);
    const g = L.ghosts[0]!;
    expect(g.state).toBe('eyes');
    L.paco.y = -100; // park Paco out of the way (no collisions)
    L.paco.dir = null;
    let seen = new Set<string>();
    for (let t = 0; t < 20 && g.state !== 'active'; t += SIM_DT) {
      L.step(SIM_DT, idle);
      seen.add(g.state);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['eyes', 'entering', 'house', 'leaving', 'active']));
    expect(g.frightened).toBe(false);
  });
});

describe('Level progression', () => {
  it('clears when the last dot is eaten', () => {
    const { L } = setup();
    L.maze.dots.fill(0);
    const i = L.maze.idx(Math.round(L.paco.x), L.paco.y);
    L.maze.dots[i] = D_DOT;
    L.dotsLeft = 1;
    L.step(SIM_DT, idle);
    expect(L.outcome).toEqual({ type: 'cleared' });
    expect(L.monster).toBe(false);
  });

  it('triggers Paco-Monster when a 4-ghost streak happened this life', () => {
    const { L, events, score } = setup(1, 4);
    L.maze.dots.fill(0);
    L.maze.dots[L.maze.idx(Math.round(L.paco.x), L.paco.y)] = D_DOT;
    L.dotsLeft = 1;
    L.step(SIM_DT, idle);
    expect(L.outcome).toBeNull();
    expect(L.monster).toBe(true);
    expect(L.paco.scale).toBe(MONSTER.scale);
    expect(events).toContain('monsterStart');
    expect(L.ghosts.every((g) => g.frightened)).toBe(true);
    // Eating a ghost in monster mode: no respawn.
    ghostOnPaco(L, 3, false);
    L.ghosts[3]!.frightened = true;
    const before = score();
    L.step(SIM_DT, idle);
    expect(score() - before).toBeGreaterThanOrEqual(200);
    expect(L.ghosts[3]!.noRespawn).toBe(true);
    run(L, MONSTER.duration + 1);
    expect(L.outcome).toEqual({ type: 'cleared' });
  });

  it('Paco-Monster ends as soon as all ghosts are eaten', () => {
    const { L } = setup(1, 4);
    L.startMonster();
    for (let i = 0; i < 3; i++) L.ghosts[i]!.state = 'gone';
    L.step(SIM_DT, idle);
    expect(L.outcome).toBeNull();
    ghostOnPaco(L, 3, false);
    L.step(SIM_DT, idle);
    expect(L.outcome).toEqual({ type: 'cleared' });
    expect(L.monsterLeft).toBe(0);
  });

  it('Paco-Monster smashes inner walls (slower) but not the border', () => {
    const { L, events } = setup(1, 4);
    L.startMonster();
    const m = L.maze;
    // Find a breakable wall directly above an open tile.
    let found: { x: number; y: number } | null = null;
    for (let y = 2; y < m.h - 2 && !found; y++)
      for (let x = 1; x < m.w - 1; x++)
        if (m.isOpen(x, y) && m.tiles[m.idx(x, y - 1)] === T_WALL && !m.unbreakable[m.idx(x, y - 1)]) {
          found = { x, y };
          break;
        }
    expect(found).not.toBeNull();
    L.paco.x = found!.x;
    L.paco.y = found!.y;
    L.paco.dir = 'up';
    for (const g of L.ghosts) g.state = 'gone';
    L.step(SIM_DT, { ...idle, paco: 'up' });
    expect(m.tiles[m.idx(found!.x, found!.y - 1)]).toBe(T_PATH);
    expect(L.paco.smashing).toBe(true);
    expect(events).toContain('wallSmash');
    // Border is never smashable.
    expect(m.isSmashable(0, 5)).toBe(false);
    expect(m.isSmashable(5, 0)).toBe(false);
  });

  it('ghosts leave the house over time and roam', () => {
    const { L } = setup();
    L.paco.y = -100;
    L.paco.dir = null;
    run(L, 12);
    expect(L.ghosts.filter((g) => g.state === 'active').length).toBe(4);
    for (const g of L.ghosts) expect(L.maze.isOpen(Math.round(g.x), Math.round(g.y))).toBe(true);
  });

  it('Paco follows buffered input and never enters walls', () => {
    const { L } = setup();
    for (const g of L.ghosts) g.release = 999;
    const dirs = ['up', 'left', 'down', 'right'] as const;
    for (let k = 0; k < 600; k++) {
      L.step(SIM_DT, { ...idle, paco: dirs[Math.floor(k / 37) % 4]! });
      expect(L.maze.isOpen(Math.round(L.paco.x), Math.round(L.paco.y))).toBe(true);
    }
    expect(L.dotsLeft).toBeLessThan(L.dotsTotal);
  });
});
