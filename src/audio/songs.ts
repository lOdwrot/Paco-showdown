import { hz, midi, type Synth, type Wave } from './synth.ts';

/**
 * Original jingles (composed for Paco Showdown). A track is a list of
 * "NOTE:len" tokens where len is in steps; "-" is a rest. Edit freely.
 */
export interface Track {
  /** 'noise' = percussion track: any non-rest token is a hit. */
  wave: Wave | 'noise';
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

export function playSong(synth: Synth, song: Song, opts: { at?: number; bus?: 'sfx' | 'music' } = {}): void {
  const at0 = opts.at ?? 0;
  for (const t of song.tracks) {
    let pos = 0;
    for (const tok of t.notes.trim().split(/\s+/)) {
      const [n, len] = tok.split(':');
      const steps = Number(len ?? 1);
      const at = at0 + pos * song.step;
      if (n !== '-') {
        if (t.wave === 'noise') synth.noise(0.05, { vol: t.vol, at, cutoff: n === 'X' ? 1800 : 6000, bus: opts.bus });
        else synth.tone(hz(midi(n!)), steps * song.step * 0.92, { wave: t.wave, vol: t.vol, at, bus: opts.bus });
      }
      pos += steps;
    }
  }
}

/**
 * Menu theme (original): a bouncy, slightly spooky A-minor loop.
 * 4 bars × 16 steps; loops seamlessly.
 */
export const MENU_THEME: Song = {
  step: 0.12,
  tracks: [
    {
      wave: 'square',
      vol: 0.09,
      notes:
        'A4:2 C5:2 E5:2 A5:2 G5:2 E5:2 C5:2 E5:2 ' +
        'F5:2 E5:2 D5:2 C5:2 B4:2 C5:2 D5:4 ' +
        'A4:2 C5:2 E5:2 A5:2 B5:2 A5:2 G5:2 E5:2 ' +
        'F5:2 G5:2 A5:2 E5:2 G#5:4 A5:4',
    },
    {
      wave: 'triangle',
      vol: 0.22,
      notes:
        'A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 ' +
        'F2:2 F3:2 F2:2 F3:2 G2:2 G3:2 G2:2 G3:2 ' +
        'A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 ' +
        'D2:2 D3:2 F2:2 F3:2 E2:2 E3:2 E2:2 E3:2',
    },
    {
      wave: 'square',
      vol: 0.035,
      notes:
        '- E6 - C6 - E6 - A5 - E6 - C6 - E6 - A5 ' +
        '- A5 - F5 - A5 - C6 - B5 - G5 - B5 - D6 ' +
        '- E6 - C6 - E6 - A5 - E6 - C6 - E6 - A5 ' +
        '- A5 - F5 - A5 - D6 - B5 - G#5 - B5 - E6',
    },
    {
      wave: 'noise',
      vol: 0.05,
      notes: 'X:2 h:2 h:2 h:2 X:2 h:2 h:2 h:2 '.repeat(4),
    },
  ],
};

/**
 * Paco-Monster theme (original): a fast, heavy D-minor stomp. Plays on the music
 * bus for as long as the wall-eating mode lasts. 2 bars x 16 steps; loops seamlessly.
 */
export const MONSTER_THEME: Song = {
  step: 0.1,
  tracks: [
    {
      wave: 'sawtooth',
      vol: 0.07,
      notes:
        'D3:2 D3 D3 A2:2 D3:2 F3 D3 C3:2 D3:4 ' +
        'D3:2 D3 D3 A2:2 D3:2 G#3 A3 Bb3:2 A3:4 ' +
        'Bb2:2 Bb2 Bb2 F3:2 Bb2:2 D3 Bb2 A2:2 Bb2:4 ' +
        'A2:2 A2 A2 E3:2 A2:2 C#3 E3 G3:2 E3:4',
    },
    {
      wave: 'square',
      vol: 0.06,
      notes:
        'D5 F5 A5 F5 D6:2 C6 A5 F5 D5 F5 A5 C6 D6:2 - ' +
        'D5 F5 A5 F5 D6:2 E6 D6 A5 G#5 A5 C6 E6 A5:2 - ' +
        'Bb4 D5 F5 D5 Bb5:2 A5 F5 D5 Bb4 D5 F5 A5 Bb5:2 - ' +
        'A4 C#5 E5 C#5 A5:2 G5 E5 C#5 E5 G5 A5 C#6 E6:2 -',
    },
    {
      wave: 'triangle',
      vol: 0.28,
      notes:
        'D2:4 D2:2 D2:2 D2:4 F2:2 A2:2 D2:4 D2:2 D2:2 D2:4 A2:2 F2:2 ' +
        'Bb1:4 Bb1:2 Bb1:2 Bb1:4 D2:2 F2:2 A1:4 A1:2 A1:2 A1:4 C#2:2 E2:2',
    },
    {
      wave: 'noise',
      vol: 0.09,
      notes: 'X:2 h:2 h:2 h:2 X:2 h:2 X:2 h:2 '.repeat(4),
    },
  ],
};

/** Loops a song on the synth's music bus until stopped. */
export class MusicPlayer {
  private current: Song | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;

  constructor(private synth: Synth) {}

  get playing(): Song | null {
    return this.current;
  }

  play(song: Song): void {
    if (this.current === song) return;
    this.stop();
    if (!this.synth.ctx) return; // not unlocked yet; caller retries after a gesture
    this.current = song;
    this.nextAt = this.synth.now + 0.05;
    this.schedule();
  }

  private schedule(): void {
    const song = this.current;
    if (!song) return;
    const len = songLength(song);
    // Keep about one loop scheduled ahead.
    while (this.nextAt < this.synth.now + len) {
      playSong(this.synth, song, { at: Math.max(0, this.nextAt - this.synth.now), bus: 'music' });
      this.nextAt += len;
    }
    this.timer = setTimeout(() => this.schedule(), (len / 2) * 1000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.current) this.synth.cutMusic();
    this.current = null;
  }
}
