import type { Vec } from './types.ts';

/**
 * Map format (see docs/MAP_FORMAT.md):
 *   #  wall            .  dot             o  power ball
 *   (space) empty path t  tunnel path (ghosts slow down)
 *   P  Paco spawn (1 or 2 adjacent cells; spawn = their centre)
 *   -  ghost-house door (top edge of the house)
 *   G  ghost-house interior (rectangle)
 *   _  void (outside the maze; not walkable, not drawn)
 * A row whose first and last cells are walkable wraps around (tunnel).
 */
export interface MapDef {
  id: string;
  name: string;
  /** Wall outline colour (CSS). */
  wallColor: string;
  /** Optional wall fill colour (CSS). */
  wallFill?: string;
  rows: string[];
}

export const T_PATH = 0;
export const T_WALL = 1;
export const T_VOID = 2;
export const T_DOOR = 3;
export const T_HOUSE = 4;
export const T_TUNNEL = 5;

export const D_NONE = 0;
export const D_DOT = 1;
export const D_POWER = 2;

export interface HouseInfo {
  /** Interior rectangle (inclusive tile coords). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Door centre x (may be .5) and door row. */
  doorX: number;
  doorY: number;
  /** Row just above the door – where ghosts start roaming. */
  exitY: number;
  /** Integer tile ghosts (eyes) aim for before entering. */
  exitTileX: number;
  centerX: number;
  centerY: number;
}

export class Maze {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly dots: Uint8Array;
  readonly unbreakable: Uint8Array;
  readonly pacoSpawn: Vec;
  readonly house: HouseInfo;
  readonly ghostSpawns: Vec[];
  readonly def: MapDef;
  /** Cell indices smashed during Paco-Monster (in order). */
  readonly broken: number[] = [];
  /** Bumped every time the wall layout changes. */
  version = 0;

  constructor(def: MapDef) {
    const errs = validateMapDef(def);
    if (errs.length) throw new Error(`Invalid map "${def.id}": ${errs.join('; ')}`);
    this.def = def;
    const rows = def.rows;
    this.h = rows.length;
    this.w = rows[0]!.length;
    this.tiles = new Uint8Array(this.w * this.h);
    this.dots = new Uint8Array(this.w * this.h);
    this.unbreakable = new Uint8Array(this.w * this.h);
    const pac: Vec[] = [];
    const house: Vec[] = [];
    const door: Vec[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = rows[y]![x]!;
        const i = y * this.w + x;
        let t = T_PATH;
        if (c === '#') t = T_WALL;
        else if (c === '_') t = T_VOID;
        else if (c === '-') {
          t = T_DOOR;
          door.push({ x, y });
        } else if (c === 'G') {
          t = T_HOUSE;
          house.push({ x, y });
        } else if (c === 't') t = T_TUNNEL;
        else if (c === '.') this.dots[i] = D_DOT;
        else if (c === 'o') this.dots[i] = D_POWER;
        else if (c === 'P') pac.push({ x, y });
        this.tiles[i] = t;
      }
    }
    // Walls on the edge or touching the void are the "outer border": unbreakable.
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.tiles[i] !== T_WALL) continue;
        if (x === 0 || y === 0 || x === this.w - 1 || y === this.h - 1) {
          this.unbreakable[i] = 1;
          continue;
        }
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (this.tiles[(y + dy) * this.w + x + dx] === T_VOID) this.unbreakable[i] = 1;
      }
    }
    this.pacoSpawn = {
      x: pac.reduce((s, p) => s + p.x, 0) / pac.length,
      y: pac[0]!.y,
    };
    const x0 = Math.min(...house.map((p) => p.x));
    const x1 = Math.max(...house.map((p) => p.x));
    const y0 = Math.min(...house.map((p) => p.y));
    const y1 = Math.max(...house.map((p) => p.y));
    const doorX = door.reduce((s, p) => s + p.x, 0) / door.length;
    const doorY = door[0]!.y;
    this.house = {
      x0,
      y0,
      x1,
      y1,
      doorX,
      doorY,
      exitY: doorY - 1,
      exitTileX: Math.floor(doorX),
      centerX: (x0 + x1) / 2,
      centerY: (y0 + y1) / 2,
    };
    // Four spawn points in a row across the house interior (slot order = left to right).
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const step = Math.min(2, (x1 - x0) / 3);
    this.ghostSpawns = [0, 1, 2, 3].map((k) => ({ x: cx + (k - 1.5) * step, y: cy }));
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  /** Tile type with horizontal wrap; rows outside the map are void. */
  tileAt(x: number, y: number): number {
    if (y < 0 || y >= this.h) return T_VOID;
    const wx = ((x % this.w) + this.w) % this.w;
    return this.tiles[y * this.w + wx]!;
  }

  /** Walkable for normal grid movement (Paco, roaming ghosts). */
  isOpen(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return t === T_PATH || t === T_TUNNEL;
  }

  isTunnel(x: number, y: number): boolean {
    return this.tileAt(x, y) === T_TUNNEL;
  }

  /** Can Paco-Monster smash this tile (or walk on it)? */
  isSmashable(x: number, y: number): boolean {
    if (y < 0 || y >= this.h || x < 0 || x >= this.w) return false;
    const i = this.idx(x, y);
    const t = this.tiles[i]!;
    if (t === T_WALL) return !this.unbreakable[i];
    return t === T_DOOR || t === T_HOUSE;
  }

  /** Turns a wall/door/house tile into path. Returns true if a wall was smashed. */
  smash(x: number, y: number): boolean {
    const i = this.idx(x, y);
    const t = this.tiles[i]!;
    if (t === T_PATH || t === T_TUNNEL) return false;
    this.tiles[i] = T_PATH;
    this.broken.push(i);
    this.version++;
    return t === T_WALL || t === T_DOOR;
  }

  /** Re-applies a list of smashed cells (used by network clients). */
  applyBroken(list: readonly number[]): void {
    if (list.length === this.broken.length) return;
    for (let k = this.broken.length; k < list.length; k++) {
      const i = list[k]!;
      this.tiles[i] = T_PATH;
      this.broken.push(i);
    }
    this.version++;
  }

  countDots(): number {
    let n = 0;
    for (const d of this.dots) if (d) n++;
    return n;
  }

  /** BFS distance field (in tiles) from a target over open tiles, wrapping. */
  distanceField(tx: number, ty: number): Int32Array {
    const dist = new Int32Array(this.w * this.h).fill(-1);
    const q: number[] = [this.idx(tx, ty)];
    dist[q[0]!] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h]!;
      const x = i % this.w;
      const y = (i / this.w) | 0;
      const nb: [number, number][] = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx0, ny] of nb) {
        if (ny < 0 || ny >= this.h) continue;
        const nx = (nx0 + this.w) % this.w;
        const j = this.idx(nx, ny);
        if (dist[j] !== -1 || !this.isOpen(nx, ny)) continue;
        dist[j] = dist[i]! + 1;
        q.push(j);
      }
    }
    return dist;
  }
}

/** Structural validation of a map definition. Returns human-readable errors. */
export function validateMapDef(def: MapDef): string[] {
  const errs: string[] = [];
  const rows = def.rows;
  if (rows.length < 10) errs.push('map too small');
  const w = rows[0]?.length ?? 0;
  rows.forEach((r, y) => {
    if (r.length !== w) errs.push(`row ${y} has length ${r.length}, expected ${w}`);
    for (const c of r) if (!'#. otPG-_'.includes(c)) errs.push(`row ${y}: unknown char "${c}"`);
  });
  if (errs.length) return errs;
  const at = (x: number, y: number) => rows[y]?.[x] ?? '_';
  const find = (ch: string) => {
    const out: Vec[] = [];
    rows.forEach((r, y) => [...r].forEach((c, x) => c === ch && out.push({ x, y })));
    return out;
  };
  const pac = find('P');
  if (pac.length < 1 || pac.length > 2) errs.push(`need 1-2 'P' cells, found ${pac.length}`);
  if (pac.length === 2 && (pac[0]!.y !== pac[1]!.y || pac[1]!.x - pac[0]!.x !== 1))
    errs.push("'P' cells must be horizontally adjacent");
  const power = find('o');
  if (power.length !== 4) errs.push(`need exactly 4 power balls, found ${power.length}`);
  const house = find('G');
  const door = find('-');
  if (!house.length) errs.push('no ghost house (G)');
  if (!door.length) errs.push('no ghost door (-)');
  if (house.length && door.length) {
    const x0 = Math.min(...house.map((p) => p.x));
    const x1 = Math.max(...house.map((p) => p.x));
    const y0 = Math.min(...house.map((p) => p.y));
    const y1 = Math.max(...house.map((p) => p.y));
    if (house.length !== (x1 - x0 + 1) * (y1 - y0 + 1)) errs.push('ghost house is not a filled rectangle');
    if (x1 - x0 < 3) errs.push('ghost house must be at least 4 wide');
    const dy = door[0]!.y;
    if (door.some((d) => d.y !== dy)) errs.push('door cells must be on one row');
    if (dy !== y0 - 1) errs.push('door must be directly on top of the house');
    if (door.some((d) => d.x < x0 || d.x > x1)) errs.push('door must be within the house width');
    const dxs = door.map((d) => d.x).sort((a, b) => a - b);
    if (dxs[dxs.length - 1]! - dxs[0]! !== dxs.length - 1) errs.push('door cells must be contiguous');
    for (const d of door) {
      if (!'. '.includes(at(d.x, dy - 1))) errs.push('cells above the door must be open path');
    }
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (at(x, y1 + 1) !== '#') errs.push('house bottom must be wall');
      if (x < x0 || x > x1) continue;
      if (at(x, y0 - 1) !== '#' && at(x, y0 - 1) !== '-') errs.push('house top must be wall or door');
    }
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      if (at(x0 - 1, y) !== '#' || at(x1 + 1, y) !== '#') errs.push('house sides must be wall');
    }
  }
  if (errs.length) return errs;

  // Connectivity, dead ends and tunnels.
  const open = (x: number, y: number) => {
    if (y < 0 || y >= rows.length) return false;
    const wx = ((x % w) + w) % w;
    return '. otP'.includes(at(wx, y));
  };
  for (let y = 0; y < rows.length; y++) {
    const l = open(0, y);
    const r = open(w - 1, y);
    if (l !== r) errs.push(`row ${y}: tunnel must be open on both edges`);
    if (y === 0 || y === rows.length - 1) {
      if ([...rows[y]!].some((c) => c !== '#' && c !== '_')) errs.push(`row ${y}: top/bottom rows must be wall or void`);
    }
  }
  const start = pac[0]!;
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const q: Vec[] = [start];
  while (q.length) {
    const p = q.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = (p.x + dx + w) % w;
      const ny = p.y + dy;
      const k = `${nx},${ny}`;
      if (!seen.has(k) && open(nx, ny)) {
        seen.add(k);
        q.push({ x: nx, y: ny });
      }
    }
  }
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      if ('. otP'.includes(c)) {
        if (!seen.has(`${x},${y}`)) errs.push(`cell ${x},${y} ('${c}') unreachable from spawn`);
        let n = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
          if (open(x + dx, y + dy)) n++;
        if (n < 2) errs.push(`cell ${x},${y} is a dead end`);
      }
    }),
  );
  return errs;
}
