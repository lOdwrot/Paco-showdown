# CLAUDE.md – Paco Showdown

An original multiplayer maze-chase game (Pac-Man genre) for the browser, written in TypeScript with
no game framework. You can play single player (Paco against AI ghosts) or multiplayer, where one
player is Paco and the others are ghosts, over WebRTC. The full spec is in `docs/PLAN.md` and
`docs/GAME_RULES.md`.

## Commands
| Task | Command |
|---|---|
| Dev server (http://localhost:5173) | `npm run dev` |
| Type check | `npm run typecheck` |
| Unit tests (Vitest) | `npm test` |
| Production build → `dist/` | `npm run build` |
| E2E smoke (headless Chromium, writes `screenshots/`) | `npm run build && npm run smoke` |
| Everything CI runs | `npm run check` |
| Optional WebSocket relay | `npm run relay` (port 8787) |

Run `npm run check` before every commit. After any visual or UI change, also run `npm run smoke`
and look at the PNGs in `screenshots/`.

Useful URL params: `?net=local` (multiplayer between tabs, no network), `?net=ws&relay=ws://host:8787`,
and `?level=N` (start single player at level N).

## Architecture (read before changing things)
```
src/config.ts       ALL tunables (speeds, timers, scores). Never hard-code numbers elsewhere.
src/game/           PURE simulation. No DOM, no audio, no Date/Math.random (seeded rng only).
  maze.ts           ASCII map parsing + validation + walkability + wall smashing
  maps/*.ts         one map per file; order in maps/index.ts
  movement.ts       centre-to-centre grid stepping (decisions happen exactly on tile centres)
  ghostAi.ts        targets per ghost slot + intersection choice
  level.ts          one maze in play: Paco, ghosts, dots, power streaks, Paco-Monster
  match.ts          lives, levels, phases, multiplayer roles → snapshot()
  snapshot.ts       serialisable Snapshot type (what renderer/audio/network consume)
src/session/        LocalSession (single), HostRoom (multi host, authoritative), ClientRoom (interpolating client)
src/net/            transport.ts interfaces + peer (WebRTC/PeerJS), ws (relay), local (BroadcastChannel); protocol.ts validation
src/render/         Canvas2D renderer, sprites from ASCII pixel maps, maze outline via distance transform, fog of war
src/audio/          WebAudio synth, original jingles (songs.ts), GameAudio maps snapshot → sounds
src/ui/             HTML/CSS screens + App (main loop). src/skins/catalog.ts = skin data.
server/relay.ts     Node WebSocket relay (only routes messages)
```
Data flow: `input → session.setInput → Match.step (60 Hz fixed) → Snapshot → Renderer + GameAudio`.
In multiplayer, the host runs the `Match` and broadcasts snapshots at 30 Hz. Clients only send
`{t:'input'}`.

## Invariants / conventions
- `src/game/**` must stay framework- and DOM-free so it runs in Vitest and on the host. Randomness
  must come from the seeded `createRng`.
- Every gameplay rule change needs a test in `tests/level.test.ts` or `tests/match.test.ts`.
- One-shot sounds are `GameEvent`s (`seq` is played once). Looping sounds are derived from
  snapshot state in `audio/audio.ts`. Never play sounds from the simulation.
- When you add a network message, add its type in `net/protocol.ts` **and** its validation in
  `parseClientMsg`/`parseHostMsg`. Bump `PROTOCOL_VERSION` on breaking changes.
- New transports implement `NetFactory` (`net/transport.ts`) and register in `net/index.ts`.
  Nothing else should know which transport is in use.
- Maps must pass `validateMapDef`. The test suite checks for exactly 4 power balls, no dead ends,
  full reachability, no 2×2 open areas, and the house door on top.
- Art and sound are original. Do not copy assets, maze layouts, or music from the original arcade
  games.
- Style: strict TS, ES modules with explicit `.ts` import extensions, 2-space indent, single quotes.

## Project skills (`.claude/skills/`)
- `add-map`: design, validate, and register a new maze.
- `add-skin`: add a Paco or ghost skin (catalog + pixel accessory).
- `verify-game`: full verification, including the headless smoke run and a screenshot review.
- `tune-gameplay`: change balance numbers safely.

## Docs
`docs/PLAN.md` (design and research), `docs/GAME_RULES.md`, `docs/MAP_FORMAT.md`,
`docs/NETWORKING.md`, `docs/ARCHITECTURE.md`.
