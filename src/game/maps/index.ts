import type { MapDef } from '../maze.ts';
import { plaza } from './plaza.ts';
import { labyrinth } from './labyrinth.ts';
import { pumpkin } from './pumpkin.ts';

/** Play order. Level N uses MAPS[(N - 1) % MAPS.length]. Add new maps here. */
export const MAPS: readonly MapDef[] = [plaza, labyrinth, pumpkin];

/** `offset` shifts the rotation (dev options: start on any map). */
export function mapForLevel(level: number, offset = 0): { def: MapDef; index: number } {
  const n = MAPS.length;
  const index = (((level - 1 + offset) % n) + n) % n;
  return { def: MAPS[index]!, index };
}
