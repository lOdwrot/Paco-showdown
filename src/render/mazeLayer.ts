import { TILE } from '../config.ts';
import { T_DOOR, T_WALL, type Maze } from '../game/maze.ts';
import { makeCanvas } from './pixels.ts';

/**
 * Builds the wall layer at native resolution. A chamfer distance transform over
 * wall pixels gives every wall pixel its distance to the nearest walkable pixel;
 * the outline is drawn where that distance crosses a threshold, which produces
 * rounded, arcade-style neon outlines for any layout (and after wall smashing).
 * Unbreakable border walls get a second, inner line (double border).
 */
export function buildWallLayer(maze: Maze, color: string, fill?: string): HTMLCanvasElement {
  const W = maze.w * TILE;
  const H = maze.h * TILE;
  const INF = 1 << 20;
  const dist = new Int32Array(W * H);
  const solid = (px: number, py: number) => maze.tiles[((py / TILE) | 0) * maze.w + ((px / TILE) | 0)] === T_WALL;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dist[y * W + x] = solid(x, y) ? INF : 0;
  // Chamfer 3-4 two-pass transform. Out-of-bounds neighbours are ignored (treated as wall).
  const relax = (i: number, x: number, y: number, dx: number, dy: number, w: number) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
    const v = dist[ny * W + nx]! + w;
    if (v < dist[i]!) dist[i] = v;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!dist[i]) continue;
      relax(i, x, y, -1, 0, 3);
      relax(i, x, y, 0, -1, 3);
      relax(i, x, y, -1, -1, 4);
      relax(i, x, y, 1, -1, 4);
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!dist[i]) continue;
      relax(i, x, y, 1, 0, 3);
      relax(i, x, y, 0, 1, 3);
      relax(i, x, y, 1, 1, 4);
      relax(i, x, y, -1, 1, 4);
    }

  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const put = (i: number, css: string) => {
    const [r, g, b] = hex(css);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  };
  const R1 = 9; // ~3 px inset
  const R2 = 18; // ~6 px inset (border double line)
  const isEdge = (x: number, y: number, R: number) => {
    const d = dist[y * W + x]!;
    if (d < R) return false;
    return (
      (x > 0 && dist[y * W + x - 1]! < R) ||
      (x < W - 1 && dist[y * W + x + 1]! < R) ||
      (y > 0 && dist[(y - 1) * W + x]! < R) ||
      (y < H - 1 && dist[(y + 1) * W + x]! < R)
    );
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!dist[i]) continue;
      const unbreakable = maze.unbreakable[((y / TILE) | 0) * maze.w + ((x / TILE) | 0)];
      if (isEdge(x, y, R1) || (unbreakable && isEdge(x, y, R2))) put(i, color);
      else if (fill && dist[i]! > R1) put(i, fill);
    }
  ctx.putImageData(img, 0, 0);
  // Ghost door.
  ctx.fillStyle = '#ffb8ff';
  for (let y = 0; y < maze.h; y++)
    for (let x = 0; x < maze.w; x++)
      if (maze.tiles[y * maze.w + x] === T_DOOR) ctx.fillRect(x * TILE, y * TILE + 3, TILE, 2);
  return canvas;
}

function hex(css: string): [number, number, number] {
  const h = css.replace('#', '');
  const v = h.length === 3 ? h.replace(/./g, '$&$&') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
