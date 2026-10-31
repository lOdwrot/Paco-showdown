---
name: verify-game
description: Full verification of Paco Showdown – typecheck, unit tests, build, headless browser smoke test with screenshot review. Use before committing or when asked to check the game works.
---

# Verify the game

1. `npm run check` runs typecheck, Vitest, and the production build. It must pass.
2. `npm run smoke` runs headless Chromium through Playwright. It exits 0 on success and writes
   `screenshots/*.png`:
   * `01-title`, `02-setup`, `03-intro` (READY!), `04-playing`, `05-monster` (forced Paco-Monster)
   * `06-lobby`, `07/08-*-reveal` (YOU ARE: screens), `09-host-play`, `10-guest-fog` (fog of
     war for the ghost player)
   Multiplayer uses `?net=local` (BroadcastChannel), so no network is needed.
3. **Look at the screenshots** with the Read tool. Check that walls are outlined, dots and sprites
   are visible, the HUD text is readable, the scoreboard is populated, and there are no blank
   canvases.
4. If a smoke run is aborted, an old preview server may still hold port 4179. Kill it by PID (run
   `ps -eo pid,args | grep "[v]ite preview"`). Don't use `pkill -f`, because that also kills your
   own shell.
5. If you changed a rule, make sure a unit test covers it (see `tests/level.test.ts` and
   `tests/match.test.ts`).
