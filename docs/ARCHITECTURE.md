# Architecture

See the tree and data flow in `CLAUDE.md`. Key design decisions:

1. **Pure, seeded simulation** (`src/game`). This makes rules unit-testable and lets the
   multiplayer host (or a future server) run the exact same code.
2. **Snapshot as the only interface** between the simulation and presentation. Single player,
   the host, and clients all share one rendering and audio path.
3. **Centre-to-centre movement** (`movement.ts`). Steps never skip a tile centre, so turning and
   ghost decisions are frame-rate independent and tunnels wrap cleanly.
4. **Everything is generated from code**: ASCII pixel-art sprites (`render/sprites.ts`),
   distance-transform wall outlines (`render/mazeLayer.ts`), and a WebAudio synth with note-string
   songs (`audio/songs.ts`). This avoids binary assets and licensing issues, and an AI can edit
   any of it as text.
5. **Phases** (`Match.phase`): `roleReveal → intro|ready → playing → dying|levelComplete → … → gameOver`.
   Timers are in `config.PHASE`.

## Ghost state machine
`house` (bobbing, release timer) → `leaving` (scripted walk to the door, then up) → `active`
(grid AI) → eaten → `eyes` (BFS home) → `entering` (scripted down into the house) → `house`. During
Paco-Monster an eaten ghost goes to `gone` instead.

## Rendering
* Native resolution is 224×288 (8 px tiles + HUD), scaled by an integer factor with smoothing off.
* Paco sprites face right and are rotated or mirrored at draw time. Ghost eyes are drawn per
  direction.
* Fog of war: an offscreen black layer with `destination-out` radial holes around the ghosts.
