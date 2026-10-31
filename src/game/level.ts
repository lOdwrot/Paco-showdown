import {
  COLLIDE_DIST,
  FRIGHT_FLASH_TIME,
  GHOST_COUNT,
  GHOST_RELEASE,
  GHOST_RELEASE_AFTER_EATEN,
  MODE_WAVES,
  MONSTER,
  PHASE,
  SCORE,
  frightTime,
  speeds,
} from '../config.ts';
import { Maze, D_DOT, D_POWER, type MapDef } from './maze.ts';
import { advance, scriptedMove, wrappedDist, type Chooser } from './movement.ts';
import { chaseTarget, chooseDir, scatterTarget } from './ghostAi.ts';
import {
  DV,
  OPPOSITE,
  createRng,
  type Dir,
  type GameEventType,
  type GhostState,
  type Popup,
  type Vec,
} from './types.ts';

export interface PacoActor {
  x: number;
  y: number;
  dir: Dir | null;
  next: Dir | null;
  /** Total distance moved – drives the chomp animation. */
  chomp: number;
  moving: boolean;
  scale: number;
  smashing: boolean;
}

export interface GhostActor {
  slot: number;
  x: number;
  y: number;
  dir: Dir | null;
  next: Dir | null;
  state: GhostState;
  frightened: boolean;
  release: number;
  human: boolean;
  noRespawn: boolean;
}

export interface LevelInput {
  paco: Dir | null;
  /** Per ghost slot; only used for human-controlled slots. */
  ghosts: (Dir | null)[];
}

export type LevelOutcome = { type: 'died'; caughtBySlot: number } | { type: 'cleared' } | null;

export interface LevelHooks {
  emit(type: GameEventType): void;
  score(points: number, kind: 'dot' | 'power' | 'ghost' | 'bigDot'): void;
}

export interface LevelOptions {
  seed?: number;
  humanSlots?: boolean[];
  /** Best ghost streak achieved during Paco's current life (carries across levels). */
  lifeBestStreak?: number;
  hooks?: Partial<LevelHooks>;
  /** Dev/test switches (see DevOptions in match.ts). */
  invincible?: boolean;
  noGhosts?: boolean;
}

/**
 * One maze being played: Paco, the ghosts, dots, power-ball streaks and the
 * Paco-Monster finale. Pure simulation – no DOM. Lives/levels/roles live in Match.
 */
export class Level {
  readonly maze: Maze;
  readonly levelNum: number;
  readonly paco: PacoActor;
  readonly ghosts: GhostActor[];
  readonly dotsTotal: number;
  dotsLeft: number;
  /** Scatter (false) / chase (true). */
  chase = false;
  frightLeft = 0;
  frightTotal = 0;
  /** Ghosts eaten in the current power streak. */
  streak = 0;
  lifeBestStreak: number;
  monster = false;
  monsterLeft = 0;
  bigDot: Vec | null = null;
  freeze = 0;
  popups: Popup[] = [];
  outcome: LevelOutcome = null;
  time = 0;

  /** Dev: ghosts can't hurt Paco. */
  invincible: boolean;
  /** Dev: ghosts never leave the house. */
  noGhosts: boolean;
  private modeIdx = 0;
  private modeTimer = MODE_WAVES[0]!;
  private readonly rng: () => number;
  private readonly hooks: LevelHooks;
  private eyesField: Int32Array;
  private eyesFieldVersion = -1;

  constructor(def: MapDef, levelNum: number, opts: LevelOptions = {}) {
    this.maze = new Maze(def);
    this.levelNum = levelNum;
    this.rng = createRng(opts.seed ?? 1234);
    this.hooks = { emit: () => {}, score: () => {}, ...opts.hooks };
    this.lifeBestStreak = opts.lifeBestStreak ?? 0;
    this.invincible = opts.invincible ?? false;
    this.noGhosts = opts.noGhosts ?? false;
    this.dotsTotal = this.maze.countDots();
    this.dotsLeft = this.dotsTotal;
    this.paco = { x: 0, y: 0, dir: 'left', next: null, chomp: 0, moving: false, scale: 1, smashing: false };
    this.ghosts = Array.from({ length: GHOST_COUNT }, (_, slot) => ({
      slot,
      x: 0,
      y: 0,
      dir: 'up' as Dir | null,
      next: null,
      state: 'house' as GhostState,
      frightened: false,
      release: 0,
      human: opts.humanSlots?.[slot] ?? false,
      noRespawn: false,
    }));
    this.eyesField = new Int32Array(0);
    this.resetActors();
  }

  setHooks(h: Partial<LevelHooks>): void {
    Object.assign(this.hooks, h);
  }

  setHumanSlots(human: boolean[]): void {
    this.ghosts.forEach((g, i) => (g.human = human[i] ?? false));
  }

  /** Puts Paco and the ghosts back on their spawn points. Eaten dots stay eaten. */
  resetActors(): void {
    const s = this.maze.pacoSpawn;
    Object.assign(this.paco, { x: s.x, y: s.y, dir: 'left', next: null, moving: false, scale: 1, smashing: false });
    this.ghosts.forEach((g, i) => {
      const sp = this.maze.ghostSpawns[i]!;
      Object.assign(g, {
        x: sp.x,
        y: sp.y,
        dir: i % 2 ? 'down' : 'up',
        next: null,
        state: 'house',
        frightened: false,
        release: this.noGhosts ? Infinity : (GHOST_RELEASE[i] ?? 0),
        noRespawn: false,
      });
    });
    this.frightLeft = 0;
    this.streak = 0;
    this.modeIdx = 0;
    this.modeTimer = MODE_WAVES[0]!;
    this.chase = false;
    this.freeze = 0;
    this.outcome = null;
  }

  get frightFlashing(): boolean {
    return this.frightLeft > 0 && this.frightLeft < FRIGHT_FLASH_TIME;
  }

  step(dt: number, input: LevelInput): void {
    if (this.outcome) return;
    this.popups = this.popups.filter((p) => (p.ttl -= dt) > 0);
    if (this.freeze > 0) {
      this.freeze -= dt;
      return;
    }
    this.time += dt;

    if (this.monster) {
      this.monsterLeft -= dt;
      if (this.monsterLeft <= 0) {
        this.monsterLeft = 0;
        this.outcome = { type: 'cleared' };
        return;
      }
    } else if (this.frightLeft > 0) {
      this.frightLeft -= dt;
      if (this.frightLeft <= 0) this.endFright();
    } else {
      this.modeTimer -= dt;
      if (this.modeTimer <= 0 && this.modeIdx < MODE_WAVES.length - 1) {
        this.modeIdx++;
        this.modeTimer = MODE_WAVES[this.modeIdx]!;
        this.chase = this.modeIdx % 2 === 1;
        this.reverseAiGhosts();
      }
    }

    this.stepPaco(dt, input.paco);
    this.eat();
    if (this.outcome) return;
    for (const g of this.ghosts) this.stepGhost(g, dt, input.ghosts[g.slot] ?? null);
    this.collide();
  }

  // ---------------------------------------------------------------- Paco

  private stepPaco(dt: number, want: Dir | null): void {
    const p = this.paco;
    const sp = speeds(this.levelNum);
    if (want) p.next = want;
    if (p.dir && p.next === OPPOSITE[p.dir]) p.dir = p.next;
    let speed = this.frightLeft > 0 ? sp.pacoFright : sp.paco;
    if (this.monster) speed = sp.pacoFright * (p.smashing ? MONSTER.smashSpeedFactor : 1);
    const maze = this.maze;
    const choose: Chooser = (_m, tx, ty) => {
      p.smashing = false;
      const can = (d: Dir) => {
        const nx = tx + DV[d].x;
        const ny = ty + DV[d].y;
        return maze.isOpen(nx, ny) || (this.monster && maze.isSmashable(nx, ny));
      };
      let d: Dir | null = null;
      if (p.next && can(p.next)) d = p.next;
      else if (p.dir && can(p.dir)) d = p.dir;
      if (d && this.monster) {
        const nx = tx + DV[d].x;
        const ny = ty + DV[d].y;
        if (!maze.isOpen(nx, ny)) {
          p.smashing = true;
          if (maze.smash(nx, ny)) this.hooks.emit('wallSmash');
        }
      }
      if (d === p.next) p.next = null;
      return d;
    };
    const moved = advance(p, speed * dt, maze.w, choose);
    p.chomp += moved;
    p.moving = moved > 1e-6;
  }

  private eat(): void {
    const p = this.paco;
    const m = this.maze;
    const tx = ((Math.round(p.x) % m.w) + m.w) % m.w;
    const ty = Math.round(p.y);
    if (ty >= 0 && ty < m.h) {
      const i = m.idx(tx, ty);
      const d = m.dots[i];
      if (d) {
        m.dots[i] = 0;
        this.dotsLeft--;
        if (d === D_DOT) {
          this.hooks.score(SCORE.dot, 'dot');
          this.hooks.emit('dot');
        } else if (d === D_POWER) {
          this.hooks.score(SCORE.powerBall, 'power');
          this.hooks.emit('power');
          this.startFright();
        }
        if (this.dotsLeft <= 0) {
          if (this.lifeBestStreak >= MONSTER.minStreakToUnlock) this.startMonster();
          else this.outcome = { type: 'cleared' };
        }
      }
    }
    if (this.bigDot && wrappedDist(p.x, p.y, this.bigDot.x, this.bigDot.y, m.w) < 1.2) {
      this.hooks.score(SCORE.bigDot, 'bigDot');
      this.hooks.emit('bigDot');
      this.popups.push({ x: this.bigDot.x, y: this.bigDot.y, text: String(SCORE.bigDot), ttl: 1.5, color: '#ffd700' });
      this.bigDot = null;
    }
  }

  /** Starts (or extends) the power-ball effect as if a power ball was eaten. */
  triggerPower(): void {
    this.startFright();
  }

  /** Dev: removes all but the `keep` dots/power balls closest to Paco's spawn. */
  trimDots(keep: number): void {
    const m = this.maze;
    const s = m.pacoSpawn;
    const cells: number[] = [];
    m.dots.forEach((d, i) => d && cells.push(i));
    const dist = (i: number) => Math.abs((i % m.w) - s.x) + Math.abs(Math.floor(i / m.w) - s.y);
    cells.sort((a, b) => dist(a) - dist(b));
    for (const i of cells.slice(Math.max(0, keep))) m.dots[i] = 0;
    this.dotsLeft = Math.min(cells.length, Math.max(0, keep));
  }

  private startFright(): void {
    if (this.monster) return;
    this.frightTotal = frightTime(this.levelNum);
    this.frightLeft = this.frightTotal;
    // Streak continues if a previous power ball is still active (streak not reset).
    for (const g of this.ghosts) {
      if (g.state === 'house' || g.state === 'leaving' || g.state === 'active') g.frightened = true;
    }
    this.reverseAiGhosts();
  }

  private endFright(): void {
    this.frightLeft = 0;
    this.streak = 0;
    for (const g of this.ghosts) g.frightened = false;
  }

  startMonster(): void {
    this.monster = true;
    this.monsterLeft = MONSTER.duration;
    this.frightLeft = 0;
    this.paco.scale = MONSTER.scale;
    this.bigDot = { x: this.maze.house.centerX, y: this.maze.house.centerY };
    for (const g of this.ghosts) {
      if (g.state === 'eyes' || g.state === 'entering') g.noRespawn = true;
      else if (g.state !== 'gone') {
        g.frightened = true;
        if (g.state === 'house') g.release = 0;
      }
    }
    this.hooks.emit('monsterStart');
  }

  // ---------------------------------------------------------------- Ghosts

  private reverseAiGhosts(): void {
    for (const g of this.ghosts) if (!g.human && g.state === 'active' && g.dir) g.dir = OPPOSITE[g.dir];
  }

  private ghostSpeed(g: GhostActor): number {
    const sp = speeds(this.levelNum);
    if (g.state === 'eyes') return sp.eyes;
    const scared = g.frightened && !this.monster;
    if (g.human) return scared ? sp.ghostFright : sp.humanGhost;
    if (this.maze.isTunnel(Math.round(g.x), Math.round(g.y))) return sp.ghostTunnel;
    return scared ? sp.ghostFright : sp.ghost;
  }

  private stepGhost(g: GhostActor, dt: number, want: Dir | null): void {
    const sp = speeds(this.levelNum);
    const h = this.maze.house;
    const spawn = this.maze.ghostSpawns[g.slot]!;
    switch (g.state) {
      case 'house': {
        g.release -= dt;
        if (g.release <= 0) {
          g.state = 'leaving';
          break;
        }
        const top = spawn.y - 0.3;
        const bottom = spawn.y + 0.3;
        if (g.dir !== 'up' && g.dir !== 'down') g.dir = 'up';
        g.y += (g.dir === 'up' ? -1 : 1) * sp.house * 0.5 * dt;
        if (g.y <= top) {
          g.y = top;
          g.dir = 'down';
        } else if (g.y >= bottom) {
          g.y = bottom;
          g.dir = 'up';
        }
        break;
      }
      case 'leaving': {
        if (scriptedMove(g, h.doorX, h.exitY, sp.house * dt)) {
          g.state = 'active';
          g.dir = this.rng() < 0.5 ? 'left' : 'right';
          if (g.human && want) g.next = want;
        }
        break;
      }
      case 'entering': {
        if (scriptedMove(g, h.doorX, spawn.y, sp.eyes * 0.6 * dt)) {
          if (g.noRespawn) {
            g.state = 'gone';
          } else {
            g.state = 'house';
            g.frightened = false;
            g.release = GHOST_RELEASE_AFTER_EATEN;
          }
        }
        break;
      }
      case 'eyes': {
        const field = this.getEyesField();
        advance(g, this.ghostSpeed(g) * dt, this.maze.w, (_m, tx, ty) => {
          if (tx === h.exitTileX && ty === h.exitY) {
            g.state = 'entering';
            return null;
          }
          let best: Dir | null = null;
          let bestD = Infinity;
          for (const d of ['up', 'left', 'down', 'right'] as Dir[]) {
            const nx = (tx + DV[d].x + this.maze.w) % this.maze.w;
            const ny = ty + DV[d].y;
            if (!this.maze.isOpen(nx, ny)) continue;
            const v = field[this.maze.idx(nx, ny)]!;
            if (v >= 0 && v < bestD) {
              bestD = v;
              best = d;
            }
          }
          return best;
        });
        break;
      }
      case 'active': {
        if (g.human) {
          if (want) g.next = want;
          if (g.dir && g.next === OPPOSITE[g.dir]) g.dir = g.next;
        }
        advance(g, this.ghostSpeed(g) * dt, this.maze.w, (_m, tx, ty) => this.ghostChoice(g, tx, ty));
        break;
      }
      case 'gone':
        break;
    }
  }

  private ghostChoice(g: GhostActor, tx: number, ty: number): Dir | null {
    const maze = this.maze;
    const canGo = (d: Dir) => maze.isOpen(tx + DV[d].x, ty + DV[d].y);
    if (g.human) {
      if (g.next && canGo(g.next)) {
        const d = g.next;
        g.next = null;
        return d;
      }
      return g.dir && canGo(g.dir) ? g.dir : null;
    }
    if (this.monster) return chooseDir(tx, ty, g.dir, canGo, this.paco, 'away', this.rng);
    if (g.frightened) return chooseDir(tx, ty, g.dir, canGo, this.paco, 'random', this.rng);
    const target = this.chase
      ? chaseTarget(g.slot, g, this.paco, this.ghosts[0]!, maze)
      : scatterTarget(g.slot, maze);
    return chooseDir(tx, ty, g.dir, canGo, target, 'toward', this.rng);
  }

  private getEyesField(): Int32Array {
    if (this.eyesFieldVersion !== this.maze.version) {
      const h = this.maze.house;
      this.eyesField = this.maze.distanceField(h.exitTileX, h.exitY);
      this.eyesFieldVersion = this.maze.version;
    }
    return this.eyesField;
  }

  // ---------------------------------------------------------------- Collisions

  private collide(): void {
    const p = this.paco;
    const reach = COLLIDE_DIST * p.scale;
    for (const g of this.ghosts) {
      const catchable = g.state === 'active' || (this.monster && (g.state === 'house' || g.state === 'leaving'));
      if (!catchable) continue;
      if (wrappedDist(p.x, p.y, g.x, g.y, this.maze.w) >= reach) continue;
      if (g.frightened || this.monster) {
        this.streak++;
        this.lifeBestStreak = Math.max(this.lifeBestStreak, this.streak);
        const pts = SCORE.ghostBase * 2 ** (this.streak - 1);
        this.hooks.score(pts, 'ghost');
        this.hooks.emit('ghostEaten');
        this.popups.push({ x: g.x, y: g.y, text: String(pts), ttl: 1, color: '#00ffff' });
        g.state = 'eyes';
        g.frightened = false;
        if (this.monster) g.noRespawn = true;
        // Snap eyes to the grid so they can path-find home.
        g.x = Math.round(g.x);
        g.y = Math.round(g.y);
        if (g.x >= this.maze.w) g.x -= this.maze.w;
        this.freeze = PHASE.ghostEatenFreeze;
      } else if (!this.invincible) {
        this.outcome = { type: 'died', caughtBySlot: g.slot };
        return;
      }
    }
  }
}
