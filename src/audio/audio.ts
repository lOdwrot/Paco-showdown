import type { Snapshot } from '../game/snapshot.ts';
import type { GameEventType } from '../game/types.ts';
import type { LoopSpec } from './synth.ts';
import { GAME_OVER, INTRO, LEVEL_CLEAR, MENU_THEME, MONSTER_THEME, MusicPlayer, ROLE_STING, playSong, type Song } from './songs.ts';
import { Synth } from './synth.ts';

/** Looping background sounds, keyed by name (used by the game and the dev sound test). */
const LOOPS: Record<string, LoopSpec> = {
  monster: { wave: 'sawtooth', base: 70, depth: 20, rate: 11, vol: 0.05 },
  eyes: { wave: 'square', base: 900, depth: 350, rate: 9, lfoWave: 'sawtooth', vol: 0.04 },
  fright: { wave: 'square', base: 260, depth: 90, rate: 7, lfoWave: 'sawtooth', vol: 0.05 },
  siren: { wave: 'sine', base: 520, depth: 110, rate: 4, vol: 0.07 },
};

type SoundName = GameEventType | 'blip' | 'select' | 'monsterGulp';

/** Everything the DEV OPTIONS sound test can play. */
export const SOUND_TEST = {
  effects: [
    'dot', 'power', 'ghostEaten', 'monsterGulp', 'pacoCaught', 'death', 'wallSmash', 'monsterStart',
    'ready', 'blip', 'select',
  ] as SoundName[],
  jingles: ['intro', 'roleReveal', 'levelClear', 'gameOver'] as SoundName[],
  music: [
    ['MENU THEME', MENU_THEME],
    ['MONSTER THEME', MONSTER_THEME],
  ] as [string, Song][],
  loops: ['siren', 'fright', 'eyes', 'monster'],
};

/**
 * Turns snapshots into sound. One-shot effects come from snapshot events (each
 * `seq` is played once); looping background sounds are derived from state.
 */
export class GameAudio {
  readonly synth = new Synth();
  readonly music = new MusicPlayer(this.synth);
  private lastSeq = 0;
  private waka = false;
  /** Consecutive wall smashes (pitch climbs), reset after a short pause. */
  /** Dev sound test active: menu music must not override what the tester picked. */
  private soundTest = false;
  private smashCombo = 0;
  private lastSmashAt = 0;

  constructor() {
    this.synth.setMuted(localStorage.getItem('paco.muted') === '1');
  }

  unlock(): void {
    this.synth.unlock();
  }

  toggleMute(): boolean {
    this.synth.setMuted(!this.synth.muted);
    localStorage.setItem('paco.muted', this.synth.muted ? '1' : '0');
    return this.synth.muted;
  }

  /** Menu theme on/off (menus call this; starting a game stops it). */
  menuMusic(on: boolean): void {
    if (this.soundTest) return;
    if (on) this.music.play(MENU_THEME);
    else this.music.stop();
  }

  /** Dev sound test: plays one sound by name, a looping song, a background loop, or stops everything. */
  testPlay(kind: 'sound' | 'music' | 'loop' | 'stop', name = ''): void {
    this.unlock();
    this.soundTest = true;
    if (kind === 'sound') this.play(name as SoundName);
    else if (kind === 'music') {
      this.synth.setLoop(null);
      const song = SOUND_TEST.music.find(([n]) => n === name)?.[1];
      if (song) this.music.play(song);
    } else if (kind === 'loop') {
      this.music.stop();
      this.synth.setLoop(name, LOOPS[name]);
    } else {
      this.music.stop();
      this.synth.setLoop(null);
    }
  }

  /** Leaves the sound test (menu music takes over again on the next call). */
  endSoundTest(): void {
    if (!this.soundTest) return;
    this.soundTest = false;
    this.music.stop();
    this.synth.setLoop(null);
  }

  get muted(): boolean {
    return this.synth.muted;
  }

  /** Call when a new game starts so its events aren't confused with the last one. */
  reset(): void {
    this.lastSeq = 0;
    this.synth.setLoop(null);
    this.stopMonsterMusic();
  }

  stop(): void {
    this.synth.setLoop(null);
    this.stopMonsterMusic();
  }

  private stopMonsterMusic(): void {
    if (this.music.playing === MONSTER_THEME) this.music.stop();
  }

  update(s: Snapshot): void {
    for (const e of s.events) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      // Eating a ghost as Paco-Monster gets its own, heavier sound.
      this.play(e.type === 'ghostEaten' && s.monsterLeft > 0 ? 'monsterGulp' : e.type);
    }
    this.updateLoop(s);
  }

  private updateLoop(s: Snapshot): void {
    const sy = this.synth;
    const monster = s.phase === 'playing' && s.monsterLeft > 0;
    if (monster) this.music.play(MONSTER_THEME);
    else this.stopMonsterMusic();
    if (s.phase !== 'playing') return sy.setLoop(null);
    if (monster) return sy.setLoop('monster', LOOPS.monster);
    if (s.ghosts.some((g) => g.state === 'eyes' || g.state === 'entering'))
      return sy.setLoop('eyes', LOOPS.eyes);
    if (s.frightLeft > 0)
      return sy.setLoop('fright', LOOPS.fright);
    const progress = 1 - s.dotsLeft / Math.max(1, s.dotsTotal);
    sy.setLoop('siren', { ...LOOPS.siren!, base: 420 + progress * 260, rate: 2.8 + progress * 2.5 });
  }

  play(type: SoundName): void {
    const sy = this.synth;
    switch (type) {
      case 'intro':
        playSong(sy, INTRO);
        break;
      case 'ready':
        sy.tone(660, 0.08, { vol: 0.12 });
        sy.tone(990, 0.12, { vol: 0.12, at: 0.1 });
        break;
      case 'dot':
        this.waka = !this.waka;
        sy.tone(this.waka ? 220 : 480, 0.09, { wave: 'triangle', vol: 0.35, slideTo: this.waka ? 480 : 220 });
        break;
      case 'power':
        sy.tone(300, 0.15, { vol: 0.15, slideTo: 900 });
        break;
      case 'ghostEaten':
        sy.tone(180, 0.32, { vol: 0.18, slideTo: 1800 });
        break;
      case 'pacoCaught':
        sy.tone(140, 0.25, { wave: 'sawtooth', vol: 0.12, slideTo: 90 });
        break;
      case 'death':
        for (let i = 0; i < 9; i++) sy.tone(820 - i * 70, 0.11, { vol: 0.14, at: i * 0.11, slideTo: 420 - i * 35 });
        sy.tone(160, 0.06, { vol: 0.2, at: 1.08 });
        sy.tone(160, 0.06, { vol: 0.2, at: 1.2 });
        break;
      case 'levelClear':
        playSong(sy, LEVEL_CLEAR);
        break;
      case 'monsterStart':
        // Transformation: rising growl, a thunderous boom, then a brassy power chord.
        sy.noise(0.9, { vol: 0.4, cutoff: 1400, sweepTo: 90 });
        sy.tone(70, 0.8, { wave: 'sawtooth', vol: 0.2, slideTo: 280 });
        sy.tone(35, 0.9, { wave: 'square', vol: 0.2, at: 0.8, slideTo: 28 });
        sy.noise(0.5, { vol: 0.45, cutoff: 500, sweepTo: 60, at: 0.8 });
        for (const f of [147, 220, 294]) sy.tone(f, 0.5, { wave: 'sawtooth', vol: 0.1, at: 0.85 });
        break;
      case 'wallSmash': {
        // Crunch + stone rumble; successive smashes climb in pitch like a combo.
        const now = performance.now();
        this.smashCombo = now - this.lastSmashAt < 700 ? Math.min(this.smashCombo + 1, 8) : 0;
        this.lastSmashAt = now;
        const up = 2 ** (this.smashCombo / 12);
        sy.noise(0.2, { vol: 0.4, cutoff: 1100, sweepTo: 120 });
        sy.noise(0.07, { vol: 0.25, cutoff: 5000, sweepTo: 800 });
        sy.tone(110 * up, 0.16, { wave: 'square', vol: 0.14, slideTo: 40 });
        sy.tone(660 * up, 0.05, { wave: 'triangle', vol: 0.1, at: 0.02, slideTo: 220 });
        break;
      }
      case 'monsterGulp':
        // Big chomp: low "nom", a bite crunch and a rising victory tail.
        sy.tone(160, 0.18, { wave: 'sawtooth', vol: 0.2, slideTo: 50 });
        sy.noise(0.12, { vol: 0.3, cutoff: 2500, sweepTo: 200 });
        for (let i = 0; i < 3; i++) sy.tone(294 * 2 ** (i / 3), 0.07, { wave: 'square', vol: 0.12, at: 0.15 + i * 0.06 });
        break;
      case 'roleReveal':
        playSong(sy, ROLE_STING);
        break;
      case 'gameOver':
        playSong(sy, GAME_OVER);
        break;
      case 'blip':
        sy.tone(880, 0.05, { vol: 0.1 });
        break;
      case 'select':
        sy.tone(660, 0.06, { vol: 0.12 });
        sy.tone(1320, 0.08, { vol: 0.12, at: 0.06 });
        break;
    }
  }
}
