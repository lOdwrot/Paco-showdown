---
name: add-skin
description: Add a new selectable Paco or ghost skin (name, colour and pixel-art accessory). Use when asked for new characters, costumes or looks.
---

# Add a skin

1. Add an entry to `PAC_SKINS` or `GHOST_SKINS` in `src/skins/catalog.ts`, with a unique `id`,
   an uppercase `name` (≤ 14 chars), a `body` colour, and a short `blurb`.
2. Draw the accessory in `src/render/sprites.ts`:
   * Paco: add to `PAC_ACCESSORIES[id]`. Use `{ eye: boolean, overlays: Overlay[] }`, drawn in
     the **facing-right** frame on a 20×20 grid with the body centred at (10,10), radius 6.6.
     Keep accessories out of the mouth wedge (right side, ±0.85 rad).
   * Ghost: add to `GHOST_ACCESSORIES[id]`. `top` overlays (hats, stems) appear in normal and
     frightened looks. `face` overlays appear only in the normal look. The body occupies
     x 3..16, y 3..16.
   * An `Overlay` is `{x, y, rows: string[], pal: {char: '#rrggbb'}}`, where `.` means
     transparent.
3. `sanitizeProfile` accepts the new id automatically, because it reads the catalog.
4. Verify with `npm run build && npm run smoke`, then look at `screenshots/02-setup.png`. The
   setup screen shows every skin animated.
