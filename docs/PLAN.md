# Paco Showdown – Design & Implementation Plan

Paco Showdown is an original maze-chase game in the Pac-Man genre, played in the browser. It adds
online multiplayer (one player is Paco and the other players are ghosts), selectable characters,
and a "Paco-Monster" bonus finale. The mazes, sprites, and sounds are original. The game uses the
pixel-art arcade look of the genre and copies none of the original's assets or maze layouts.

---

## 1. Research summary & technology choices

| Concern | Options considered | Choice | Why |
|---|---|---|---|
| Language/build | TS + Vite, TS + webpack, Parcel | **TypeScript + Vite** | Fast dev server, zero-config TS, static output works on GitHub Pages |
| Rendering | Phaser 4, PixiJS 8, Kaplay, plain Canvas 2D | **Plain Canvas 2D** | The game is a 224×248 px pixel grid. Phaser and Pixi add a large API and scene graph that we don't need. Plain canvas with nearest-neighbour scaling gives crisp pixels, no dependencies, and code that is easy for a person or an AI to read. All sprites are ASCII pixel maps or procedural pixel functions in TS, so they can be edited as text. |
| Audio | Howler + sample files, Tone.js, raw WebAudio | **Raw WebAudio synth** | Chiptune sounds are generated from code with square, triangle, and noise voices. There are no binary assets and no licensing problems, and any sound can be tweaked as data. |
| Font | bitmap font in code, Google font | **Press Start 2P** (OFL, bundled via `@fontsource/press-start-2p`) | Classic arcade look. It is bundled into the build, so there is no CDN call at runtime. |
| P2P networking | PeerJS, simple-peer, Trystero, metered realtime | **PeerJS (WebRTC DataChannels)** | Mature and maintained. It ships a free public signaling broker (and a self-hostable `peerjs-server`). Room codes map directly to peer IDs. simple-peer needs custom signaling, and Trystero depends on third-party relays (nostr/torrent). |
| Server fallback | — | **WebSocket relay** (`server/relay.ts`, `ws`) | Behind the same `Transport` interface, so switching from WebRTC to WebSockets is a one-line factory change (`?net=ws`). |
| Local dev transport | — | **BroadcastChannel** | Lets you test multiplayer across browser tabs with no network. Playwright uses it. |
| Tests | Jest, Vitest | **Vitest** + Playwright smoke script | Vitest reuses the Vite config. Chromium and Playwright are preinstalled. |

### Original Pac-Man reference numbers (from "The Pac-Man Dossier")
* Max speed ≈ 75.76 px/s = **9.47 tiles/s**. Level 1: Pac 80 %, ghost 75 %, frightened ghost 50 %,
  Pac frightened 90 %, ghost in tunnel 40 %.
* Frightened time by level (s): `6,5,4,3,2,5,2,2,1,5,2,1,1,3,1,1,0,1,0…`. Level 1 flashes 5 times.
  **We clamp the minimum to 1 s** so the power-ball and monster-bonus mechanics stay meaningful.
* Scatter/chase waves: S7 C20 S7 C20 S5 C20 S5 C∞.
* Ghost targeting: ghost 0 chases Pac's tile, ghost 1 targets 4 tiles ahead of Pac, ghost 2 uses
  the vector from ghost 0 through the point 2 tiles ahead of Pac (doubled), and ghost 3 chases
  when more than 8 tiles away and otherwise scatters. At each intersection a ghost picks the exit
  closest (Euclidean) to its target. Ghosts can't reverse except on a mode switch. Frightened
  ghosts pick random exits.

## 2. Game rules (spec)

Every number lives in `src/config.ts`.

* **Movement**: 4 directions on a tile grid. Inputs are buffered: the desired direction is applied at
  the next tile centre where it is open. Paco can reverse at any time. Tunnels wrap left↔right.
* **Dots** give 10 points. **Power balls** (exactly 4 per map) also give 10 points.
* **Power ball**: all ghosts that are *out of the house and alive* become frightened. Frightened
  ghosts are dark blue, slow (50 %), and edible, and they flash white near the end. Ghosts give
  200, 400, 800, 1600, … (doubling without a cap) within one *power streak*. Eating another power
  ball before the effect expires restarts the timer, re-frightens **all** ghosts including
  respawned ones, and keeps the multiplier going. A respawned ghost is **not** frightened until the
  next power ball. The streak (and multiplier) resets when the effect ends.
* **Ghost house**: a rectangle of `G` tiles with a door `-` on its top edge. All ghosts start inside
  and leave through the top at staggered times. An eaten ghost turns into eyes, goes back to the
  house, revives, and leaves again.
* **Death**: Paco loses a life. Dots that were eaten stay eaten. Paco and the ghosts reset to their
  spawn points. Paco has 3 lives in single player.
* **Level end**: when every dot and power ball is eaten, the game moves to the next map, cycling
  through the map list.
* **Game start**: the intro jingle plays and the game stays frozen ("READY!") until it ends.
* **Paco-Monster bonus**: every time Paco eats the last dot, it triggers the bonus instead of
  ending the level right away. No unlock needed. During the
  bonus:
  * Paco grows to 2× size.
  * Every ghost turns blue and edible but keeps normal speed.
  * Paco can smash any wall except the outer border, moving about 21 % faster than a frightened Paco, and at 70 % of that while smashing. The
    ghost door and house walls can be smashed too.
  * Eaten ghosts do not respawn. The multiplier continues from the current streak.
  * The level is won when the time runs out or all ghosts are eaten.

### Multiplayer
* The main menu offers single player or multiplayer. Next comes the character screen: nickname,
  Paco skin (Classic, Paco-Girl, Paco-President, …) and ghost skin.
* **Host** creates a room and gets a 5-character code. **Join** connects with that code. The host
  sees the lobby and presses START, which starts the game for everyone. A room holds up to 5
  players (1 Paco + 4 ghosts). Ghost slots not taken by players are filled by AI. AI is never Paco.
* Each player has **2 lives**. A life is lost only when you die as Paco. Players with 0 lives keep
  playing as ghosts. The game is over when every player has 0 lives.
* A ghost player who catches Paco gets **+1000**. Then the roles change: the catching player
  becomes Paco (if they have lives left); otherwise the next player with lives, in join order.
  Paco can never be AI.
* Ghost players see only a small field-of-view circle around every ghost and a bigger one around
  their own ghost. Everything else is dark. Human-controlled ghosts show their nickname. Paco sees
  the whole maze.
* Before every round each player sees "YOU ARE:" with their sprite (Paco or ghost colour) for
  3 seconds.
* The right-hand panel lists players, roles, lives, and scores.

## 3. Architecture

```
src/
  config.ts            all tunables (speeds, timers, scores, sizes)
  game/                PURE simulation – no DOM, no audio, deterministic given inputs
    types.ts           Dir, Vec, GhostState, events …
    maze.ts            map parsing, validation, walkability, wall breaking
    maps/              one file per map (ASCII), index.ts = ordered list
    movement.ts        grid movement (centre-to-centre stepping, wrap, buffered turns)
    ghostAi.ts         targeting & choice at intersections
    level.ts           Level: one map's round state (Paco, ghosts, dots, power, monster)
    match.ts           Match: players, lives, levels, phases, roles; produces Snapshots
    snapshot.ts        serialisable view of the Match (+ dot bitset codec)
  net/
    transport.ts       HostTransport / ClientTransport / TransportFactory interfaces
    peerTransport.ts   WebRTC via PeerJS
    wsTransport.ts     WebSocket relay client (pairs with server/relay.ts)
    localTransport.ts  BroadcastChannel (tabs) + in-memory (tests)
    protocol.ts        message types + runtime validation
    roomCode.ts
  session/
    localSession.ts    single player: Match + local input
    hostRoom.ts        lobby + runs Match, applies remote inputs, broadcasts snapshots
    clientRoom.ts      sends inputs, receives & interpolates snapshots
  render/              Canvas 2D: maze (cached outline), sprites, fog, HUD text, popups
  audio/               WebAudio synth, song/sfx definitions, loop manager (derived from snapshot)
  input/               keyboard + touch swipe
  skins/               Paco & ghost skin definitions (pixel accessories)
  ui/                  HTML/CSS menus: title, character select, lobby, scoreboard, game over
server/relay.ts        optional WebSocket relay (Node, `ws`)
```

**Key principle**: `Match` is the single source of truth and outputs a `Snapshot`. The renderer and
audio only read `Snapshot`s. Single player, the multiplayer host, and multiplayer clients therefore
all render through the same code path. Clients just get their snapshots over the network.

* Fixed timestep: 60 Hz sim. The host broadcasts snapshots at 30 Hz, and clients interpolate.
* Sound events carry increasing sequence numbers. Snapshots include the events from the last
  second, and clients play each `seq` only once. This tolerates dropped or merged snapshots.
* Looping sounds (siren, frightened, eyes) are *derived from state*, not from events.
* Map format: ASCII grid, see `docs/MAP_FORMAT.md`. A validator (run in unit tests) checks that
  the map is rectangular, has exactly one Paco spawn and 4 power balls, has a correct ghost house
  with the door on top, has no dead ends, and has every dot reachable.

## 4. Visuals & audio

* Native resolution is 8 px tiles (28×31 maze), scaled by an integer factor with smoothing off.
* Maze walls are drawn as rounded neon outlines computed from a pixel-level erosion of the wall
  mask, and they are recomputed when Paco smashes a wall. Each map has its own wall colour.
* Animations: Paco chomp (4 frames), rotation per direction, death animation (mouth opens fully
  and then sparks), ghost skirt (2 frames), eyes that look in the movement direction, frightened
  flash, eyes-only return, score pop-ups, level-complete maze flash, pulsing power balls, monster
  pulse, wall-smash debris, title screen chase.
* Sounds (synthesised): intro jingle, waka chomp, siren (pitch rises as dots run out), frightened
  loop, eat-ghost, eyes retreat loop, death, level clear, monster roar, wall crunch, big-dot gulp,
  role-reveal sting, game over, and menu blips.

## 5. Implementation order

1. Scaffold (Vite, TS strict, Vitest, lint via `tsc`), CLAUDE.md, docs, skills.
2. `config.ts`, `maze.ts` + map validator + 3 maps + tests.
3. Movement + ghost AI + `Level` rules + tests (scoring, streaks, monster).
4. `Match` (phases, lives, roles) + snapshot codec + tests.
5. Renderer, sprites, skins, fog of war.
6. Audio synth.
7. UI flow (menus, character select, lobby, HUD).
8. Transports + protocol + sessions + in-memory multiplayer test.
9. WebSocket relay server.
10. Playwright smoke (single player, and a 2-tab multiplayer over BroadcastChannel) with screenshots.
11. CI workflow + GitHub Pages deploy workflow.

## 6. Risks / decisions to revisit
* **NAT traversal**: PeerJS uses public STUN only. Strict NATs need TURN, which can be configured
  in `src/net/peerTransport.ts`, or use the WS relay instead.
* **The public PeerJS broker is best-effort.** For production, self-host `peerjs-server` or use the
  WS relay.
* **Monster bonus big dot**: the 2000 value is our choice; the original spec gave no value.
* **"Walls except …"**: the original spec didn't say which walls are unbreakable. We chose the
  outer border.
