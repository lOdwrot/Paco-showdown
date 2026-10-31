import { describe, expect, it } from 'vitest';
import { advance, scriptedMove, wrappedDist, type Mover } from '../src/game/movement.ts';
import type { Dir } from '../src/game/types.ts';

describe('advance', () => {
  it('moves centre to centre and asks the chooser on every centre', () => {
    const m: Mover = { x: 0, y: 0, dir: 'right' };
    const seen: number[] = [];
    advance(m, 3.5, 100, (_m, tx) => {
      seen.push(tx);
      return 'right';
    });
    expect(m.x).toBeCloseTo(3.5);
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('stops on a centre when the chooser returns null', () => {
    const m: Mover = { x: 0, y: 0, dir: 'right' };
    const moved = advance(m, 5, 100, (_m, tx) => (tx < 2 ? 'right' : null));
    expect(m.x).toBe(2);
    expect(moved).toBeCloseTo(2);
  });

  it('turns exactly on a centre', () => {
    const m: Mover = { x: 0.5, y: 0, dir: 'right' };
    advance(m, 1, 100, (_m, tx): Dir => (tx === 1 ? 'down' : 'right'));
    expect(m.x).toBe(1);
    expect(m.y).toBeCloseTo(0.5);
  });

  it('wraps through tunnels', () => {
    const m: Mover = { x: 0, y: 5, dir: 'left' };
    advance(m, 1.25, 28, () => 'left');
    expect(m.x).toBeCloseTo(26.75);
  });

  it('starts from half-tile spawn positions', () => {
    const m: Mover = { x: 13.5, y: 22, dir: 'left' };
    advance(m, 0.75, 28, () => 'left');
    expect(m.x).toBeCloseTo(12.75);
  });
});

describe('helpers', () => {
  it('wrappedDist takes the short way around', () => {
    expect(wrappedDist(0, 0, 27, 0, 28)).toBeCloseTo(1);
  });
  it('scriptedMove goes x first then y', () => {
    const m: Mover = { x: 0, y: 0, dir: null };
    expect(scriptedMove(m, 2, 2, 3)).toBe(false);
    expect(m).toMatchObject({ x: 2, y: 1 });
    expect(scriptedMove(m, 2, 2, 3)).toBe(true);
  });
});
