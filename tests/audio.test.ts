import { describe, expect, it } from 'vitest';
import { INTRO, songLength } from '../src/audio/songs.ts';
import { midi } from '../src/audio/synth.ts';
import { PHASE } from '../src/config.ts';

describe('audio data', () => {
  it('intro jingle fits inside the intro freeze', () => {
    expect(songLength(INTRO)).toBeLessThanOrEqual(PHASE.introTime);
    expect(songLength(INTRO)).toBeGreaterThan(PHASE.introTime - 0.6);
  });
  it('parses note names', () => {
    expect(midi('A4')).toBe(69);
    expect(midi('C#5')).toBe(73);
    expect(midi('Bb3')).toBe(58);
  });
});
