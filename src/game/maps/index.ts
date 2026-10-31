import type { MapDef } from '../maze.ts';
import { plaza } from './plaza.ts';
import { labyrinth } from './labyrinth.ts';
import { pumpkin } from './pumpkin.ts';

/** Play order. Level N uses MAPS[(N - 1) % MAPS.length]. Add new maps here. */
export const MAPS: readonly MapDef[] = [plaza, labyrinth, pumpkin];

export function mapForLevel(level: number): { def: MapDef; index: number } {
  const index = (level - 1) % MAPS.length;
  return { def: MAPS[index]!, index };
}
