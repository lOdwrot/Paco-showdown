/** Pixel-art helpers: sprites are built from ASCII maps + palettes. */

export interface Overlay {
  x: number;
  y: number;
  rows: string[];
  /** char -> CSS colour. '.' and ' ' are transparent. */
  pal: Record<string, string>;
}

export class PixelGrid {
  readonly data: (string | null)[];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: string | null): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
  }
  get(x: number, y: number): string | null {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.data[y * this.w + x]! : null;
  }
  overlay(o: Overlay, dx = 0, dy = 0): void {
    o.rows.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        const c = o.pal[ch];
        if (c) this.set(o.x + i + dx, o.y + j + dy, c);
      }),
    );
  }
  /** Draws an ASCII map; `color` used for every non-transparent char. */
  stamp(rows: readonly string[], ox: number, oy: number, color: string): void {
    rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && ch !== ' ' && this.set(ox + i, oy + j, color)));
  }
  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext('2d')!;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const col = this.data[y * this.w + x];
        if (col) {
          ctx.fillStyle = col;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    return c;
  }
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
