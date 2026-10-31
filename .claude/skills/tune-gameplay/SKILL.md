---
name: tune-gameplay
description: Change gameplay balance (speeds, timers, scores, lives, fog radius, monster mode) safely. Use when asked to make the game easier/harder/faster or change point values.
---

# Tune gameplay

1. All numbers live in `src/config.ts`. Change them there and nowhere else.
2. Some values are coupled:
   * `PHASE.introTime` must be ≥ the intro jingle length (`audio/songs.ts` INTRO). Tested in
     `tests/audio.test.ts`.
   * `SCORE.*` values are asserted in `tests/level.test.ts` and `tests/match.test.ts`. Update the
     expectations only if the user asked for the new values.
   * `MONSTER.minStreakToUnlock` is the user-specified "4 ghosts" rule.
3. Update `docs/GAME_RULES.md` so it matches the new numbers.
4. Run `npm run check`.
