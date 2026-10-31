# Map format

Maps are ASCII grids in `src/game/maps/<id>.ts`. They are registered (in play order) in
`src/game/maps/index.ts`. The classic size is 28×31, but any rectangular size works, because the
renderer adapts.

| Char | Meaning |
|---|---|
| `#` | wall (outlined by the renderer) |
| `.` | path with a dot |
| `o` | path with a power ball. **Exactly 4 per map.** |
| ` ` (space) | empty path |
| `t` | tunnel path: empty, ghosts move slower |
| `P` | Paco spawn, 1 cell or 2 horizontally adjacent cells (spawn is their centre) |
| `G` | ghost-house interior, a filled rectangle at least 4 wide |
| `-` | ghost-house door. It must sit on the row directly above `G`, within its width, with open path above it |
| `_` | void (outside the maze, not drawn) |

* **Tunnels**: if a row's first and last cells are both walkable, actors wrap from one to the
  other.
* The house's sides and bottom must be `#`. Its top must be `#` or `-`.
* Validation (`validateMapDef`, run by `tests/maps.test.ts`) also requires that every walkable
  cell can be reached from `P`, that there are no dead ends, and that the top and bottom rows
  are wall or void. The test suite also rejects 2×2 open areas so the corridors keep the classic
  look.
* The walls on the edge or touching `_` count as the outer border, which Paco-Monster can't
  smash.
* Metadata: `wallColor` sets the outline colour. `wallFill` is an optional dark fill inside walls.

Tip: design the left 14 columns and mirror them. Symmetric mazes play best. The centre columns
13 and 14 should be open only on horizontal corridors, or you get 2-wide vertical paths. See
`.claude/skills/add-map/SKILL.md` for the mirror helper script.
