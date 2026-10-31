import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/game/maps/index.ts';
import { Maze, validateMapDef, T_DOOR } from '../src/game/maze.ts';

describe('maps', () => {
  it('has at least 3 maps with unique ids', () => {
    expect(MAPS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(MAPS.length);
  });

  for (const def of MAPS) {
    describe(def.id, () => {
      it('passes validation', () => {
        expect(validateMapDef(def)).toEqual([]);
      });
      it('parses with house, door, spawns and 4 power balls', () => {
        const m = new Maze(def);
        expect(m.ghostSpawns).toHaveLength(4);
        expect(m.tiles[m.idx(Math.floor(m.house.doorX), m.house.doorY)]).toBe(T_DOOR);
        expect(m.isOpen(m.house.exitTileX, m.house.exitY)).toBe(true);
        expect([...m.dots].filter((d) => d === 2)).toHaveLength(4);
        expect(m.countDots()).toBeGreaterThan(150);
      });
      it('has no 2x2 open areas (classic corridor look)', () => {
        const open = (x: number, y: number) => '. otP'.includes(def.rows[y]?.[x] ?? '#');
        for (let y = 0; y < def.rows.length - 1; y++)
          for (let x = 0; x < def.rows[0]!.length - 1; x++)
            expect(open(x, y) && open(x + 1, y) && open(x, y + 1) && open(x + 1, y + 1), `2x2 at ${x},${y}`).toBe(false);
      });
    });
  }

  it('reports useful errors for broken maps', () => {
    const errs = validateMapDef({ id: 'x', name: 'x', wallColor: '#fff', rows: ['####', '#..#', '####'] });
    expect(errs.length).toBeGreaterThan(0);
  });
});
