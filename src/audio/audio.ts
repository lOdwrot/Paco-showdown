import type { Snapshot } from '../game/snapshot.ts';
import type { GameEventType } from '../game/types.ts';
import { GAME_OVER, INTRO, LEVEL_CLEAR, MENU_THEME, MusicPlayer, ROLE_STING, playSong } from './songs.ts';
import { Synth } from './synth.ts';

/**
 * Turns snapshots into sound. One-shot effects come from snapshot events (each
 * `seq` is played once); looping background sounds are derived from state.
 */
export class GameAudio {
  readonly synth = new Synth();
  readonly music = new MusicPlayer(this.synth);
  private lastSeq = 0;
  private waka = false;

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
    if (on) this.music.play(MENU_THEME);
    else this.music.stop();
  }

  get muted(): boolean {
    return this.synth.muted;
  }

  /** Call when a new game starts so its events aren't confused with the last one. */
  reset(): void {
    this.lastSeq = 0;
    this.synth.setLoop(null);
  }

  stop(): void {
    this.synth.setLoop(null);
  }

  update(s: Snapshot): void {
    for (const e of s.events) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      this.play(e.type);
    }
    this.updateLoop(s);
  }

  private updateLoop(s: Snapshot): void {
    const sy = this.synth;
    if (s.phase !== 'playing') return sy.setLoop(null);
    if (s.monsterLeft > 0) return sy.setLoop('monster', { wave: 'sawtooth', base: 90, depth: 30, rate: 14, vol: 0.09 });
    if (s.ghosts.some((g) => g.state === 'eyes' || g.state === 'entering'))
      return sy.setLoop('eyes', { wave: 'square', base: 900, depth: 350, rate: 9, lfoWave: 'sawtooth', vol: 0.04 });
    if (s.frightLeft > 0)
      return sy.setLoop('fright', { wave: 'square', base: 260, depth: 90, rate: 7, lfoWave: 'sawtooth', vol: 0.05 });
    const progress = 1 - s.dotsLeft / Math.max(1, s.dotsTotal);
    sy.setLoop('siren', { wave: 'sine', base: 420 + progress * 260, depth: 110, rate: 2.8 + progress * 2.5, vol: 0.07 });
  }

  play(type: GameEventType | 'blip' | 'select'): void {
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
        sy.noise(0.7, { vol: 0.35, cutoff: 1200, sweepTo: 120 });
        sy.tone(220, 0.7, { wave: 'sawtooth', vol: 0.18, slideTo: 55 });
        for (let i = 0; i < 4; i++) sy.tone(330 * 2 ** (i / 4), 0.1, { vol: 0.12, at: 0.7 + i * 0.08 });
        break;
      case 'wallSmash':
        sy.noise(0.16, { vol: 0.35, cutoff: 900, sweepTo: 150 });
        sy.tone(90, 0.12, { wave: 'square', vol: 0.12, slideTo: 50 });
        break;
      case 'bigDot':
        sy.tone(900, 0.25, { vol: 0.16, slideTo: 120 });
        for (let i = 0; i < 5; i++) sy.tone(523 * 2 ** (i / 3), 0.09, { vol: 0.12, at: 0.25 + i * 0.07 });
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
