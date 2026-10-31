---
name: add-map
description: Design, validate and register a new maze for Paco Showdown. Use when asked to add, change or fix a map/level layout.
---

# Add a map

1. Read `docs/MAP_FORMAT.md` for the legend and rules.
2. Design the **left 14 columns** of a 28×31 maze, then mirror them. Use this helper (put it in
   /tmp, not in the repo):
   ```python
   left = [ "##############", ... 31 rows of 14 chars ... ]
   rows = [r + r[::-1] for r in left]
   print(",\n".join('    "%s"' % r for r in rows))
   ```
   Rules of thumb: corridors are 1 tile wide; the centre columns 13 and 14 are open only on
   horizontal corridors; the ghost house is `####--####` over `#GGGGGGGG#` rows, with a ring
   corridor of spaces around it; Paco's `PP` is a few rows below the house; there are exactly 4
   `o`; a tunnel row starts and ends with `t`.
3. Create `src/game/maps/<id>.ts`. Copy the shape of `plaza.ts` and pick an original name,
   `wallColor`, and `wallFill`.
4. Register it in `src/game/maps/index.ts`. Array order is play order.
5. Run `npx vitest run tests/maps.test.ts`. Error messages name exact cells (dead ends,
   unreachable cells, 2×2 areas). Fix them and run again.
6. Run `npm run check`. Then check it visually: `npm run build && npm run smoke`, or open
   `npm run dev` with `?level=<index+1>` and read the screenshot.
