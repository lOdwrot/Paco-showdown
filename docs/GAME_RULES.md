# Game rules (implemented behaviour)

Every number below comes from `src/config.ts`. The tests in `tests/level.test.ts` and
`tests/match.test.ts` check these rules.

## Core
| Thing | Value |
|---|---|
| Dot / power ball | 10 points each |
| Ghosts in one power streak | 200, 400, 800, 1600, 3200, … (doubling, no cap) |
| Frightened time (level 1, 2, 3 …) | 6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0→1, 1, 0→1 s (arcade table, min 1 s) |
| Frightened flashing | the last 2 s |
| Speeds (level 1) | Paco 80 %, Paco frightened-phase 90 %, ghost 75 %, frightened ghost 50 %, tunnel 40 % of 9.47 tiles/s |
| Scatter/chase | 7/20/7/20/5/20/5/∞ s (paused while ghosts are frightened) |
| Ghost release after round start | slot 0: 0 s, 1: 1.5 s, 2: 4 s, 3: 7 s |
| Single-player lives | 3 |

* **Power streak**: eating a power ball frightens every ghost in the house, leaving it, or
  roaming. If you eat another power ball while the effect is still active, the timer restarts,
  **all** ghosts (including respawned ones) are frightened again, and the multiplier keeps going.
  The streak resets when the effect ends.
* A ghost that respawns after being eaten is **not** frightened until the next power ball.
* **Death**: you lose a life and every actor goes back to its spawn. Eaten dots stay eaten.
* **Level clear**: once every dot and power ball is gone, the next map loads. Maps cycle.
* **Game start**: the intro jingle plays (4.3 s) and everything stays frozen. Later rounds get a
  2 s "READY!".

## Ghost AI personalities (by slot)
0. Targets Paco's tile.
1. Targets 4 tiles ahead of Paco.
2. Uses the vector from ghost 0 through the point 2 tiles ahead of Paco, doubled.
3. Chases while more than 8 tiles away; closer than that, it retreats to its corner.

Ghosts never reverse unless the mode changes or they reach a dead end. Frightened ghosts pick
random exits. Eaten ghosts (eyes) use a BFS distance field to get home.

## Paco-Monster bonus
Eating the last dot of every level starts the bonus instead of ending the level. There are no
unlock conditions.

During the bonus, which lasts 15 s:
* Paco grows to 2× size.
* All ghosts turn blue but keep their normal speed. They flee.
* There is no bonus dot. Wall smashes shake the whole board for every player, and a separate
  Paco-Monster music loop plays.
* Paco can smash any wall except the outer border. The border is the edge cells plus any wall
  touching the void (`_`). He is about 21 % faster than a frightened Paco, and slower (70 % of that) while smashing.
* Eaten ghosts never respawn. The streak multiplier continues.
* The level is won when the time is up or as soon as every ghost has been eaten.

## Multiplayer
* Up to 5 players. The host is Paco first. Every other player controls a ghost slot, and AI fills
  the remaining slots. AI is never Paco.
* Each player has 2 lives, and only dying as Paco costs a life.
* A ghost player who catches Paco gets **+1000**. The catcher becomes the next Paco if they have
  lives left; otherwise it's the next player with lives, in join order. Players with 0 lives keep
  playing as ghosts.
* The game ends when no connected player has lives left.
* A 3 s "YOU ARE:" role screen appears before every round.
* Ghost players see only fog-of-war circles: radius 3 tiles around every ghost and 6.5 tiles
  around their own. Player-controlled ghosts show their nickname.
* Disconnects: a ghost who leaves is replaced by AI. If Paco leaves, the next player takes over
  and no life is lost.

## Lobby
Until the host presses START, every player can change their nickname, Paco skin, and ghost skin
from the lobby (client message `profile`). Everyone sees the changes live.

## Dev options (testing only)
Main menu → DEV OPTIONS. You can choose the map and level (speed), how many dots to keep, and
toggles for:
* Paco-Monster now (wall smashing)
* power ball at start
* invincible
* infinite lives
* no ghosts
* skip intro

A SOUND TEST section plays every effect, jingle, music loop and background loop.
Presets: WALL SMASH, LEVEL CLEAR, POWER BALL. Dev games never save high scores
and show a red DEV badge.
