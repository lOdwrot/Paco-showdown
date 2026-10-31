import { hz, midi, type Synth, type Wave } from './synth.ts';

/**
 * Original jingles (composed for Paco Showdown). A track is a list of
 * "NOTE:len" tokens where len is in steps; "-" is a rest. Edit freely.
 */
export interface Track {
  wave: Wave;
  vol: number;
  notes: string;
}

export interface Song {
  step: number; // seconds per step
  tracks: Track[];
}

/** Intro jingle – the game is frozen while it plays (keep in sync with PHASE.introTime). */
export const INTRO: Song = {
  step: 0.13,
  tracks: [
    {
      wave: 'square',
      vol: 0.16,
      notes:
        'C5 E5 G5 E5 C6 G5 E5 G5 F5 A5 C6 A5 F5 A5 C6 F6 ' +
        'E5 G5 C6 G5 D5 G5 B5 D6 C6:2 E6:2 C6:4',
    },
    {
      wave: 'triangle',
      vol: 0.3,
      notes: 'C3:2 G3:2 C3:2 G3:2 F2:2 C3:2 F2:2 C3:2 C3:2 G3:2 G2:2 B2:2 C3:8',
    },
  ],
};

export const LEVEL_CLEAR: Song = {
  step: 0.09,
  tracks: [
    { wave: 'square', vol: 0.15, notes: 'C5 E5 G5 C6 E5 G5 C6 E6 G5 C6 E6 G6:6' },
    { wave: 'triangle', vol: 0.25, notes: 'C3:4 E3:4 G3:4 C4:6' },
  ],
};

export const GAME_OVER: Song = {
  step: 0.16,
  tracks: [
    { wave: 'square', vol: 0.15, notes: 'G4 - F#4 - F4 - E4:2 Eb4:2 D4:6' },
    { wave: 'triangle', vol: 0.28, notes: 'G2:4 F2:4 E2:4 D2:6' },
  ],
};

export const ROLE_STING: Song = {
  step: 0.08,
  tracks: [{ wave: 'square', vol: 0.14, notes: 'G4 C5 E5 G5:3' }],
};

export function songLength(song: Song): number {
  let max = 0;
  for (const t of song.tracks) {
    let steps = 0;
    for (const tok of t.notes.trim().split(/\s+/)) steps += Number(tok.split(':')[1] ?? 1);
    max = Math.max(max, steps);
  }
  return max * song.step;
}

export function playSong(synth: Synth, song: Song): void {
  for (const t of song.tracks) {
    let pos = 0;
    for (const tok of t.notes.trim().split(/\s+/)) {
      const [n, len] = tok.split(':');
      const steps = Number(len ?? 1);
      if (n !== '-') synth.tone(hz(midi(n!)), steps * song.step * 0.92, { wave: t.wave, vol: t.vol, at: pos * song.step });
      pos += steps;
    }
  }
}
