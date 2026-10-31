import { ghostSkin, pacSkin } from '../skins/catalog.ts';
import type { Dir } from '../game/types.ts';
import { PixelGrid, type Overlay } from './pixels.ts';

/**
 * All character sprites, generated at runtime from code.
 * Sprite canvases are SPRITE×SPRITE native pixels, centred on the actor.
 * Paco is drawn facing right and rotated/mirrored at draw time (like the arcade).
 */
export const SPRITE = 20;
const C = SPRITE / 2;
const K = '#000000';
const W = '#ffffff';

// ------------------------------------------------------------------ Paco

/** Mouth half-angles for the 4-frame chomp cycle. */
const MOUTH = [0.12, 0.45, 0.85, 0.45];

interface PacAccessory {
  eye: boolean;
  overlays: Overlay[];
}

/** Accessories for each Paco skin, in the facing-right frame of reference. */
const PAC_ACCESSORIES: Record<string, PacAccessory> = {
  classic: { eye: false, overlays: [] },
  girl: {
    eye: true,
    overlays: [
      {
        x: 3,
        y: 1,
        rows: ['RR...RR', 'RRR.RRR', 'RRRKRRR', 'RRR.RRR', 'RR...RR'],
        pal: { R: '#ff2050', K: '#ffd0e0' },
      },
      { x: 9, y: 4, rows: ['k.k.k', '.....'], pal: { k: K } }, // lashes
      { x: 11, y: 14, rows: ['k'], pal: { k: '#a03000' } }, // beauty mark
    ],
  },
  president: {
    eye: true,
    overlays: [
      {
        x: 5,
        y: 0,
        rows: ['..KKKKKK..', '..KKKKKK..', '..KKKKKK..', '..RRRRRR..', 'KKKKKKKKKK'],
        pal: { K: '#111111', R: '#c01020' },
      },
      { x: 9, y: 5, rows: ['YYYY', 'Y..Y', 'Y..Y', 'YYYY', '.Y..', 'Y...', 'Y...'], pal: { Y: '#f0c020' } },
    ],
  },
  punk: {
    eye: true,
    overlays: [
      { x: 5, y: 0, rows: ['.G..G..G', '.GG.GG.G', 'GGGGGGGG', '.MMMMMM.'], pal: { G: '#20e040', M: '#ff30c0' } },
      { x: 9, y: 4, rows: ['kk.', '..k'], pal: { k: K } },
    ],
  },
  ninja: {
    eye: false,
    overlays: [
      { x: 4, y: 5, rows: ['RRRRRRRRRRR', 'RRRRRRWWkRR', 'RRRRRRRRRRR'], pal: { R: '#d01818', W: W, k: K } },
      { x: 0, y: 5, rows: ['.RRR', 'RR..', 'R...', '.R..'], pal: { R: '#d01818' } },
    ],
  },
  cool: {
    eye: false,
    overlays: [{ x: 7, y: 5, rows: ['KKKKKKK', '.KKWKKK', '..KKKK.'], pal: { K: '#101010', W: '#80c0ff' } }],
  },
};

function pacGrid(body: string, mouth: number, acc: PacAccessory | null, monster = false): PixelGrid {
  const g = new PixelGrid(SPRITE, SPRITE);
  for (let y = 0; y < SPRITE; y++)
    for (let x = 0; x < SPRITE; x++) {
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      if (dx * dx + dy * dy > 6.6 * 6.6) continue;
      if (Math.abs(Math.atan2(dy, dx)) < mouth) continue;
      g.set(x, y, body);
    }
  if (acc) {
    if (acc.eye) g.overlay({ x: 10, y: 6, rows: ['kk', 'kk'], pal: { k: K } });
    for (const o of acc.overlays) g.overlay(o);
  }
  if (monster) {
    g.overlay({ x: 9, y: 4, rows: ['kk...', '.kkk.', '..RR.', '..RR.'], pal: { k: K, R: '#ff0000' } });
    // Teeth along the mouth edges.
    const t = Math.tan(mouth);
    for (let dx = 2; dx <= 5; dx += 2) {
      const dy = Math.round(dx * t);
      g.set(C + dx, C - dy, W);
      g.set(C + dx, C + dy - 1, W);
    }
  }
  return g;
}

const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, make: () => PixelGrid): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) {
    c = make().toCanvas();
    cache.set(key, c);
  }
  return c;
}

/** Facing-right Paco frame. frame = 0..3 (chomp cycle). */
export function pacFrame(skinId: string, frame: number, monster = false, monsterHot = false): HTMLCanvasElement {
  const skin = pacSkin(skinId);
  const body = monster && monsterHot ? '#ff8a00' : skin.body;
  return cached(`pac:${skin.id}:${frame}:${monster}:${monsterHot}`, () =>
    pacGrid(body, MOUTH[frame % 4]!, PAC_ACCESSORIES[skin.id] ?? null, monster),
  );
}

/** Death animation frame, progress 0..1 (mouth opens until Paco vanishes). */
export function pacDeathFrame(skinId: string, progress: number): HTMLCanvasElement {
  const step = Math.min(15, Math.floor(progress * 16));
  const skin = pacSkin(skinId);
  return cached(`pacdeath:${skin.id}:${step}`, () => pacGrid(skin.body, 0.2 + (step / 15) * (Math.PI - 0.15), null));
}

/** Rotation (radians) and mirror to apply to a facing-right sprite. */
export function pacTransform(dir: Dir): { rot: number; flip: boolean } {
  switch (dir) {
    case 'left':
      return { rot: 0, flip: true };
    case 'up':
      return { rot: -Math.PI / 2, flip: false };
    case 'down':
      return { rot: Math.PI / 2, flip: false };
    default:
      return { rot: 0, flip: false };
  }
}

// ------------------------------------------------------------------ Ghosts

const GHOST_BODY = [
  '.....####.....',
  '...########...',
  '..##########..',
  '.############.',
  '.############.',
  '##############',
  '##############',
  '##############',
  '##############',
  '##############',
  '##############',
  '##############',
];
const GHOST_SKIRT = [
  ['##.###..###.##', '#...##..##...#'],
  ['####.####.####', '.##...##...##.'],
];
const BX = 3; // body offset inside the sprite
const BY = 3;

const EYE_WHITE = ['.##.', '####', '####', '####', '.##.'];
const PUPIL: Record<Dir, [number, number]> = { right: [2, 2], left: [0, 2], up: [1, 0], down: [1, 3] };
const EYE_SHIFT: Record<Dir, [number, number]> = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };

interface GhostAccessory {
  /** Drawn in every visible state except eyes-only (hats, stems…). */
  top?: Overlay[];
  /** Drawn only in the normal (not frightened) state. */
  face?: Overlay[];
}

const GHOST_ACCESSORIES: Record<string, GhostAccessory> = {
  pumpkin: { top: [{ x: 9, y: 0, rows: ['..GG', '.GG.', '.G..'], pal: { G: '#20a020' } }] },
  count: {
    top: [
      { x: 8, y: 3, rows: ['KKKK'], pal: { K: '#3a1060' } },
      { x: 6, y: 4, rows: ['KKKKKKKK', '..KKKK..', '...KK...'], pal: { K: '#3a1060' } },
      { x: 2, y: 9, rows: ['R..............R', 'R..............R', 'RR............RR'], pal: { R: '#d01020' } },
    ],
    face: [{ x: 8, y: 13, rows: ['W..W', 'W..W'], pal: { W } }],
  },
  sirspook: {
    top: [{ x: 5, y: 0, rows: ['..KKKKKK..', '..RRRRRR..', 'KKKKKKKKKK'], pal: { K: '#111111', R: '#c01020' } }],
    face: [
      {
        x: 10,
        y: 5,
        rows: ['.YYYY.', 'Y....Y', 'Y....Y', 'Y....Y', 'Y....Y', '.YYYY.', '.Y....', 'Y.....'],
        pal: { Y: '#f0c020' },
      },
    ],
  },
  pirate: {
    top: [
      { x: 6, y: 3, rows: ['..RRRR..', 'RRRRRRRR'], pal: { R: '#e02020' } },
      { x: 16, y: 4, rows: ['RR.', '.RR', 'R..'], pal: { R: '#e02020' } },
    ],
    face: [
      { x: 4, y: 6, rows: ['KKKKK', 'KKKKK', 'KKKKK', 'KKKKK', '.KKK.'], pal: { K: '#101010' } },
      { x: 9, y: 6, rows: ['KKKKKK'], pal: { K: '#101010' } },
    ],
  },
  wisp: { top: [{ x: 12, y: 1, rows: ['P...P', 'PP.PP', 'PPKPP', 'PP.PP'], pal: { P: '#ff60b0', K: '#ffd0e8' } }] },
};

export type GhostLook = 'normal' | 'fright' | 'flash' | 'eyes';

/** Ghost sprite for a skin/look/direction/skirt frame (0|1). */
export function ghostFrame(skinId: string, look: GhostLook, dir: Dir, frame: number): HTMLCanvasElement {
  const skin = ghostSkin(skinId);
  const f = frame & 1;
  return cached(`ghost:${skin.id}:${look}:${dir}:${f}`, () => {
    const g = new PixelGrid(SPRITE, SPRITE);
    const acc = GHOST_ACCESSORIES[skin.id] ?? {};
    if (look !== 'eyes') {
      const body = look === 'normal' ? skin.body : look === 'fright' ? '#2121ff' : W;
      g.stamp(GHOST_BODY, BX, BY, body);
      g.stamp(GHOST_SKIRT[f]!, BX, BY + GHOST_BODY.length, body);
    }
    if (look === 'fright' || look === 'flash') {
      const face = look === 'fright' ? '#ffb8ae' : '#ff0000';
      g.stamp(['##', '##'], BX + 4, BY + 5, face);
      g.stamp(['##', '##'], BX + 8, BY + 5, face);
      g.stamp(['.##..##..##.', '#..##..##..#'], BX + 1, BY + 9, face);
    } else {
      const [sx, sy] = EYE_SHIFT[dir];
      const [px, py] = PUPIL[dir];
      for (const ex of [BX + 2, BX + 8]) {
        g.stamp(EYE_WHITE, ex + sx, BY + 3 + sy, W);
        g.stamp(['##', '##'], ex + sx + px, BY + 3 + sy + py, '#2121ff');
      }
    }
    if (look !== 'eyes') for (const o of acc.top ?? []) g.overlay(o);
    if (look === 'normal') for (const o of acc.face ?? []) g.overlay(o);
    return g;
  });
}

/** Thumbnail helpers for the character-select screen. */
export function pacPreview(skinId: string, frame: number): HTMLCanvasElement {
  return pacFrame(skinId, frame);
}
