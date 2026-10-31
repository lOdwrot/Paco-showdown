import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match.ts';
import { MAPS } from '../src/game/maps/index.ts';
import { SIM_DT } from '../src/config.ts';
import { DIRS } from '../src/game/types.ts';
import { createRng } from '../src/game/types.ts';

describe('soak: long random games on every map', () => {
  for (let mi = 0; mi < MAPS.length; mi++) {
    it(`map ${MAPS[mi]!.id} – 90s of play keeps actors on valid tiles`, () => {
      const m = new Match('multi', [
        { id: 'a', nick: 'A', pacSkin: 'classic', ghostSkin: 'blaze' },
        { id: 'b', nick: 'B', pacSkin: 'girl', ghostSkin: 'wisp' },
      ], { startLevel: mi + 1, seed: 7 + mi });
      const rng = createRng(99 + mi);
      for (let t = 0; t < 90 && m.phase !== 'gameOver'; t += SIM_DT) {
        if (rng() < 0.03) m.setInput('a', DIRS[Math.floor(rng() * 4)]!);
        if (rng() < 0.03) m.setInput('b', DIRS[Math.floor(rng() * 4)]!);
        m.step(SIM_DT);
        const L = m.level;
        if (m.phase !== 'playing') continue;
        const open = (x: number, y: number) => L.maze.isOpen(Math.round(x), Math.round(y));
        expect(open(L.paco.x, L.paco.y) || L.monster).toBe(true);
        for (const g of L.ghosts) if (g.state === 'active' || g.state === 'eyes') expect(open(g.x, g.y)).toBe(true);
      }
      const s = m.snapshot();
      expect(s.players.some((p) => p.score > 0)).toBe(true);
    });
  }
});
