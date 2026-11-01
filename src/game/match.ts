import { GHOST_COUNT, HUNT, LIVES_MULTI, LIVES_SINGLE, PHASE, SCORE } from '../config.ts';
import { assignGhostSkins } from '../skins/catalog.ts';
import { Level } from './level.ts';
import { mapForLevel } from './maps/index.ts';
import { encodeBits, r2, type MatchMode, type Phase, type Snapshot } from './snapshot.ts';
import type { Dir, GameEvent, GameEventType } from './types.ts';

export interface PlayerSetup {
  id: string;
  nick: string;
  pacSkin: string;
  ghostSkin: string;
}

export interface PlayerState extends PlayerSetup {
  score: number;
  lives: number;
  connected: boolean;
}

/**
 * Developer / testing switches (main menu → DEV OPTIONS). All default to off.
 * They only bend the rules for the local test game; normal play never sets them.
 */
export interface DevOptions {
  /** Map to start on (index into MAPS); later levels continue the rotation from it. */
  mapIndex?: number;
  /** Start Paco-Monster as soon as the first round begins. */
  monsterNow?: boolean;
  /** Start every round with a power ball active. */
  powerAtStart?: boolean;
  /** Ghosts can't catch Paco. */
  invincible?: boolean;
  /** Dying never costs a life. */
  infiniteLives?: boolean;
  /** Ghosts stay in the house. */
  noGhosts?: boolean;
  /** Keep only this many dots (closest to Paco's spawn) on each level. */
  dotsLeft?: number;
  /** Replace the intro jingle freeze with the short READY! */
  skipIntro?: boolean;
}

export interface MatchOptions {
  seed?: number;
  startLevel?: number;
  highScore?: number;
  dev?: DevOptions;
}

/** Death animation timing inside the 'dying' phase (seconds from its start). */
export const DEATH_ANIM_START = 0.6;
export const DEATH_ANIM_LEN = 1.3;

/**
 * Authoritative game state: players, lives, roles, levels and phases.
 * Single player, multiplayer host and tests all drive this class; renderers only
 * ever see its Snapshot.
 */
export class Match {
  readonly mode: MatchMode;
  readonly players: PlayerState[];
  level: Level;
  levelNum: number;
  phase: Phase = 'intro';
  phaseLeft = 0;
  phaseTotal = 0;
  pacoId: string;
  /** Player id controlling each ghost slot (null = AI). */
  ghostOwners: (string | null)[] = [];
  ghostSkins: string[] = [];
  tick = 0;
  highScore: number;
  caughtBy = -1;
  /** Ghost Hunt: seconds left to catch Paco. */
  huntLeft: number = HUNT.duration;
  /** Ghost Hunt: true once Paco was caught (win). */
  huntWon = false;
  private afterReveal: 'intro' | 'ready' = 'intro';
  private readonly inputs = new Map<string, Dir | null>();
  private events: (GameEvent & { tick: number })[] = [];
  private seq = 0;
  private deathSoundPlayed = false;
  private seed: number;
  readonly dev: DevOptions;
  private readonly mapOffset: number;
  private monsterNowPending: boolean;

  constructor(mode: MatchMode, setups: PlayerSetup[], opts: MatchOptions = {}) {
    if (!setups.length) throw new Error('Match needs at least one player');
    this.mode = mode;
    this.seed = opts.seed ?? 42;
    this.highScore = opts.highScore ?? 0;
    const lives = mode === 'multi' ? LIVES_MULTI : LIVES_SINGLE;
    this.players = setups.map((s) => ({ ...s, score: 0, lives, connected: true }));
    // Ghost Hunt: Paco is an AI (no player id); the human is a ghost.
    this.pacoId = mode === 'hunt' ? '' : this.players[0]!.id;
    this.levelNum = opts.startLevel ?? 1;
    this.dev = opts.dev ?? {};
    this.mapOffset = this.dev.mapIndex !== undefined ? this.dev.mapIndex - (this.levelNum - 1) : 0;
    this.monsterNowPending = !!this.dev.monsterNow;
    this.level = this.createLevel();
    this.assignGhosts();
    this.startRound(true);
  }

  // ---------------------------------------------------------------- public API

  setInput(playerId: string, dir: Dir | null): void {
    this.inputs.set(playerId, dir);
  }

  get finished(): boolean {
    return this.phase === 'gameOver' && this.phaseLeft <= 0;
  }

  player(id: string): PlayerState | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** Multiplayer: a player left. Their ghost becomes AI; if they were Paco the round restarts. */
  disconnect(id: string): void {
    const p = this.player(id);
    if (!p || !p.connected) return;
    p.connected = false;
    if (this.phase === 'gameOver') return;
    if (id === this.pacoId) {
      const next = this.pickNextPaco(-1, false);
      if (!next) return this.toGameOver();
      this.pacoId = next;
      this.assignGhosts();
      this.level.resetActors();
      this.startRound(false);
    } else {
      this.assignGhosts();
    }
  }

  step(dt: number): void {
    this.tick++;
    this.phaseLeft = Math.max(0, this.phaseLeft - dt);
    switch (this.phase) {
      case 'roleReveal':
        if (this.phaseLeft <= 0) this.setPhase(this.afterReveal);
        break;
      case 'intro':
      case 'ready':
        if (this.phaseLeft <= 0) this.beginPlay();
        break;
      case 'playing': {
        this.phaseLeft = 0;
        this.level.step(dt, this.levelInput());
        if (this.mode === 'hunt' && !this.level.outcome && this.level.freeze <= 0) {
          this.huntLeft = Math.max(0, this.huntLeft - dt);
          if (this.huntLeft <= 0) return this.toGameOver();
        }
        const out = this.level.outcome;
        if (out && this.mode === 'hunt') {
          // Caught Paco: win. Paco cleared the board: lose.
          if (out.type === 'died') this.huntWin(out.caughtBySlot);
          else this.toGameOver();
        } else if (out?.type === 'died') {
          this.caughtBy = out.caughtBySlot;
          this.emit('pacoCaught');
          const catcher = this.ghostOwners[out.caughtBySlot];
          if (this.mode === 'multi' && catcher) {
            const c = this.player(catcher);
            if (c) c.score += SCORE.catchPaco;
            this.level.popups.push({
              x: this.level.paco.x,
              y: this.level.paco.y - 1,
              text: String(SCORE.catchPaco),
              ttl: 2,
              color: '#ff5050',
            });
          }
          this.deathSoundPlayed = false;
          this.setPhase('dying');
        } else if (out?.type === 'cleared') {
          this.emit('levelClear');
          this.setPhase('levelComplete');
        }
        break;
      }
      case 'dying': {
        const t = this.phaseTotal - this.phaseLeft;
        if (!this.deathSoundPlayed && t >= DEATH_ANIM_START) {
          this.deathSoundPlayed = true;
          this.emit('death');
        }
        this.level.popups = this.level.popups.filter((p) => (p.ttl -= dt) > 0);
        if (this.phaseLeft <= 0) this.afterDeath();
        break;
      }
      case 'levelComplete':
        if (this.phaseLeft <= 0) this.nextLevel();
        break;
      case 'gameOver':
        break;
    }
    const cutoff = this.tick - 90;
    if (this.events.length && this.events[0]!.tick < cutoff) this.events = this.events.filter((e) => e.tick >= cutoff);
  }

  snapshot(): Snapshot {
    const L = this.level;
    const m = L.maze;
    const pacoPlayer = this.player(this.pacoId) ?? (this.mode === 'hunt' ? this.players[0] : undefined);
    return {
      tick: this.tick,
      mode: this.mode,
      phase: this.phase,
      phaseLeft: r2(this.phaseLeft),
      phaseTotal: this.phaseTotal,
      level: this.levelNum,
      mapIndex: mapForLevel(this.levelNum, this.mapOffset).index,
      dots: encodeBits(m.dots),
      broken: [...m.broken],
      dotsLeft: L.dotsLeft,
      dotsTotal: L.dotsTotal,
      paco: {
        x: r2(L.paco.x),
        y: r2(L.paco.y),
        dir: L.paco.dir ?? 'left',
        moving: L.paco.moving,
        chomp: r2(L.paco.chomp),
        scale: L.paco.scale,
        skin: pacoPlayer?.pacSkin ?? 'classic',
        playerId: this.pacoId,
      },
      ghosts: L.ghosts.map((g) => ({
        slot: g.slot,
        x: r2(g.x),
        y: r2(g.y),
        dir: g.dir ?? 'up',
        state: g.state,
        fright: g.frightened || (L.monster && g.state !== 'eyes' && g.state !== 'entering'),
        skin: this.ghostSkins[g.slot] ?? 'blaze',
        playerId: this.ghostOwners[g.slot] ?? null,
      })),
      frightLeft: r2(L.frightLeft),
      frightTotal: L.frightTotal,
      monsterLeft: r2(L.monsterLeft),
      players: this.players.map((p) => {
        const slot = this.ghostOwners.indexOf(p.id);
        return {
          id: p.id,
          nick: p.nick,
          score: p.score,
          lives: p.lives,
          role: p.id === this.pacoId ? 'paco' : 'ghost',
          slot: p.id === this.pacoId ? -1 : slot,
          pacSkin: p.pacSkin,
          ghostSkin: p.ghostSkin,
          connected: p.connected,
        };
      }),
      popups: L.popups.map((p) => ({ ...p, x: r2(p.x), y: r2(p.y), ttl: r2(p.ttl) })),
      events: this.events.map(({ seq, type }) => ({ seq, type })),
      highScore: Math.max(this.highScore, ...this.players.map((p) => p.score)),
      caughtBy: this.phase === 'dying' ? this.caughtBy : -1,
      huntLeft: this.mode === 'hunt' ? r2(this.huntLeft) : -1,
    };
  }

  // ---------------------------------------------------------------- internals

  private huntWin(slot: number): void {
    this.caughtBy = slot;
    this.huntWon = true;
    this.emit('pacoCaught');
    const human = this.players[0]!;
    human.score += HUNT.catchBonus + Math.ceil(this.huntLeft) * HUNT.perSecond;
    this.level.popups.push({
      x: this.level.paco.x,
      y: this.level.paco.y - 1,
      text: String(human.score),
      ttl: 2,
      color: '#ff5050',
    });
    this.deathSoundPlayed = false;
    this.setPhase('dying');
  }

  private emit(type: GameEventType): void {
    this.events.push({ seq: ++this.seq, type, tick: this.tick });
  }

  private createLevel(): Level {
    const { def } = mapForLevel(this.levelNum, this.mapOffset);
    const level = new Level(def, this.levelNum, {
      seed: this.seed + this.levelNum * 7919,
      invincible: this.dev.invincible,
      pacoAi: this.mode === 'hunt',
      noGhosts: this.dev.noGhosts,
    });
    if (this.dev.dotsLeft !== undefined) level.trimDots(this.dev.dotsLeft);
    level.setHooks({
      emit: (t) => this.emit(t),
      score: (pts) => {
        const p = this.player(this.pacoId);
        if (p) p.score += pts;
      },
    });
    return level;
  }

  private levelInput() {
    return {
      paco: this.inputs.get(this.pacoId) ?? null,
      ghosts: this.ghostOwners.map((o) => (o ? (this.inputs.get(o) ?? null) : null)),
    };
  }

  private assignGhosts(): void {
    if (this.mode === 'hunt') {
      this.ghostOwners = Array.from({ length: GHOST_COUNT }, (_, i) => (i === 0 ? this.players[0]!.id : null));
      this.ghostSkins = assignGhostSkins(this.ghostOwners, new Map([[this.players[0]!.id, this.players[0]!.ghostSkin]]));
      this.level.setHumanSlots(this.ghostOwners.map((o) => o !== null));
      return;
    }
    const ghostsPlayers =
      this.mode === 'multi' ? this.players.filter((p) => p.connected && p.id !== this.pacoId).map((p) => p.id) : [];
    this.ghostOwners = Array.from({ length: GHOST_COUNT }, (_, i) => ghostsPlayers[i] ?? null);
    const chosen = new Map(this.players.map((p) => [p.id, p.ghostSkin]));
    this.ghostSkins = assignGhostSkins(this.ghostOwners, chosen);
    this.level.setHumanSlots(this.ghostOwners.map((o) => o !== null));
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    const t: Record<Phase, number> = {
      roleReveal: PHASE.roleRevealTime,
      intro: PHASE.introTime,
      ready: PHASE.readyTime,
      playing: 0,
      dying: PHASE.dyingTime,
      levelComplete: PHASE.levelCompleteTime,
      gameOver: PHASE.gameOverTime,
    };
    this.phaseLeft = this.phaseTotal = t[phase];
    if (phase === 'intro') this.emit('intro');
    else if (phase === 'ready') this.emit('ready');
    else if (phase === 'roleReveal') this.emit('roleReveal');
    else if (phase === 'gameOver') this.emit('gameOver');
  }

  private startRound(first: boolean): void {
    this.caughtBy = -1;
    const intro = first && !this.dev.skipIntro;
    if (this.mode === 'multi' || this.mode === 'hunt') {
      this.afterReveal = intro ? 'intro' : 'ready';
      this.setPhase('roleReveal');
    } else {
      this.setPhase(intro ? 'intro' : 'ready');
    }
  }

  /** READY/intro is over: start playing (and apply round-start dev switches). */
  private beginPlay(): void {
    this.setPhase('playing');
    if (this.monsterNowPending) {
      this.monsterNowPending = false;
      this.level.startMonster();
    } else if (this.dev.powerAtStart) {
      this.level.triggerPower();
    }
  }

  private toGameOver(): void {
    this.setPhase('gameOver');
  }

  /**
   * Chooses the next Paco: the catcher if they still have lives, otherwise the next
   * connected player with lives (in join order, starting after the current Paco).
   */
  private pickNextPaco(caughtBySlot: number, allowCurrent: boolean): string | null {
    const alive = (id: string | null | undefined) => {
      const p = id ? this.player(id) : undefined;
      return !!p && p.connected && p.lives > 0;
    };
    const catcher = caughtBySlot >= 0 ? this.ghostOwners[caughtBySlot] : null;
    if (catcher && alive(catcher)) return catcher;
    const n = this.players.length;
    const cur = this.players.findIndex((p) => p.id === this.pacoId);
    for (let k = 1; k <= n; k++) {
      const p = this.players[(cur + k) % n]!;
      if (p.id === this.pacoId && !allowCurrent) continue;
      if (alive(p.id)) return p.id;
    }
    return null;
  }

  private afterDeath(): void {
    if (this.mode === 'hunt') return this.toGameOver();
    const paco = this.player(this.pacoId);
    if (paco && !this.dev.infiniteLives) paco.lives = Math.max(0, paco.lives - 1);
    if (this.mode === 'single') {
      if (!paco || paco.lives <= 0) return this.toGameOver();
    } else {
      const next = this.pickNextPaco(this.caughtBy, true);
      if (!next) return this.toGameOver();
      this.pacoId = next;
      this.assignGhosts();
    }
    this.level.resetActors();
    this.level.popups = [];
    this.startRound(false);
  }

  private nextLevel(): void {
    this.levelNum++;
    this.level = this.createLevel();
    this.assignGhosts();
    this.startRound(false);
  }
}
