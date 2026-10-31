import { FOG, FRIGHT_FLASH_TIME, HUD_BOTTOM, HUD_TOP, TILE } from '../config.ts';
import { DEATH_ANIM_LEN, DEATH_ANIM_START } from '../game/match.ts';
import { MAPS } from '../game/maps/index.ts';
import { D_POWER, Maze } from '../game/maze.ts';
import { decodeBits, type SnapGhost, type Snapshot } from '../game/snapshot.ts';
import { ghostSkin, pacSkin } from '../skins/catalog.ts';
import { buildWallLayer } from './mazeLayer.ts';
import { makeCanvas } from './pixels.ts';
import { SPRITE, ghostFrame, pacDeathFrame, pacFrame, pacTransform, type GhostLook } from './sprites.ts';

export const FONT = '"Press Start 2P", monospace';

interface MazeCache {
  key: string;
  maze: Maze;
  brokenCount: number;
  wall: HTMLCanvasElement;
  wallFlash: HTMLCanvasElement;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export interface RenderContext {
  /** Local player id (to decide fog of war / highlight). */
  myId: string;
  /** Real time in seconds (animations). */
  time: number;
  dt: number;
  paused?: boolean;
}

/**
 * Draws a Snapshot onto a canvas at native arcade resolution, scaled up by an
 * integer factor with smoothing disabled (crisp pixels).
 */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  nativeW = 28 * TILE;
  nativeH = HUD_TOP + 31 * TILE + HUD_BOTTOM;
  private scale = 2;
  private cache: MazeCache | null = null;
  private particles: Particle[] = [];
  private fog = makeCanvas(1, 1);

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Fits the canvas into a box (CSS pixels). */
  fit(boxW: number, boxH: number): void {
    const dpr = window.devicePixelRatio || 1;
    const s = Math.max(1, Math.floor(Math.min(boxW / this.nativeW, boxH / this.nativeH) * dpr));
    this.scale = s;
    this.canvas.width = this.nativeW * s;
    this.canvas.height = this.nativeH * s;
    this.canvas.style.width = `${(this.nativeW * s) / dpr}px`;
    this.canvas.style.height = `${(this.nativeH * s) / dpr}px`;
  }

  private ensureMaze(s: Snapshot): MazeCache {
    const key = `${s.level}:${s.mapIndex}`;
    if (!this.cache || this.cache.key !== key) {
      const def = MAPS[s.mapIndex]!;
      const maze = new Maze(def);
      maze.applyBroken(s.broken);
      this.cache = {
        key,
        maze,
        brokenCount: s.broken.length,
        wall: buildWallLayer(maze, def.wallColor, def.wallFill),
        wallFlash: buildWallLayer(maze, '#ffffff', def.wallFill),
      };
      this.particles = [];
      const w = maze.w * TILE;
      const h = HUD_TOP + maze.h * TILE + HUD_BOTTOM;
      if (w !== this.nativeW || h !== this.nativeH) {
        this.nativeW = w;
        this.nativeH = h;
        this.canvas.dispatchEvent(new Event('nativeresize'));
      }
    } else if (s.broken.length > this.cache.brokenCount) {
      const c = this.cache;
      for (let k = c.brokenCount; k < s.broken.length; k++) this.spawnDebris(c.maze, s.broken[k]!, c.maze.def.wallColor);
      c.maze.applyBroken(s.broken);
      c.brokenCount = s.broken.length;
      c.wall = buildWallLayer(c.maze, c.maze.def.wallColor, c.maze.def.wallFill);
      c.wallFlash = buildWallLayer(c.maze, '#ffffff', c.maze.def.wallFill);
    }
    return this.cache;
  }

  private spawnDebris(maze: Maze, cell: number, color: string) {
    const cx = (cell % maze.w) * TILE + 4;
    const cy = HUD_TOP + Math.floor(cell / maze.w) * TILE + 4;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 20 + Math.random() * 60;
      this.particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, color });
    }
  }

  render(s: Snapshot, rc: RenderContext): void {
    const ctx = this.ctx;
    const mc = this.ensureMaze(s);
    const maze = mc.maze;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.nativeW, this.nativeH);

    const me = s.players.find((p) => p.id === rc.myId);
    if (s.phase === 'roleReveal' && me) {
      this.drawRoleReveal(s, me.role, rc);
      return;
    }

    const phaseT = s.phaseTotal - s.phaseLeft;
    const dyingAnim = s.phase === 'dying' && phaseT >= DEATH_ANIM_START;
    const flashing = s.phase === 'levelComplete' && phaseT > 0.5 && Math.floor(phaseT * 5) % 2 === 1;

    ctx.drawImage(flashing ? mc.wallFlash : mc.wall, 0, HUD_TOP);
    this.drawDots(s, maze, rc);

    if (s.bigDot) {
      const r = 5 + Math.sin(rc.time * 10) * 1.5;
      ctx.fillStyle = Math.floor(rc.time * 8) % 2 ? '#ffd700' : '#fff3a0';
      this.pixelDisc(s.bigDot.x * TILE + 4, HUD_TOP + s.bigDot.y * TILE + 4, r);
    }

    const showGhosts = !dyingAnim && s.phase !== 'levelComplete' && s.phase !== 'gameOver';
    if (showGhosts) for (const g of s.ghosts) this.drawGhost(s, g, rc);
    this.drawPaco(s, rc, dyingAnim, phaseT);
    if (showGhosts) for (const g of s.ghosts) this.drawNick(s, g);

    this.drawParticles(rc.dt);
    this.drawPopups(s);

    if (s.mode === 'multi' && me?.role === 'ghost' && s.phase !== 'gameOver') this.drawFog(s, maze, rc.myId);

    this.drawHud(s, rc, maze);
  }

  // ---------------------------------------------------------------- pieces

  private pixelDisc(cx: number, cy: number, r: number) {
    const ctx = this.ctx;
    for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
      ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, 1);
    }
  }

  private drawDots(s: Snapshot, maze: Maze, rc: RenderContext) {
    const ctx = this.ctx;
    const bits = decodeBits(s.dots, maze.w * maze.h);
    const blinkOn = s.phase !== 'playing' || Math.floor(rc.time * 3.5) % 2 === 0;
    ctx.fillStyle = '#ffb897';
    for (let i = 0; i < bits.length; i++) {
      if (!bits[i]) continue;
      const x = (i % maze.w) * TILE;
      const y = HUD_TOP + Math.floor(i / maze.w) * TILE;
      if (maze.dots[i] === D_POWER) {
        if (blinkOn) this.pixelDisc(x + 4, y + 4, 4);
      } else ctx.fillRect(x + 3, y + 3, 2, 2);
    }
  }

  private sprite(img: HTMLCanvasElement, x: number, y: number, scale = 1, rot = 0, flip = false) {
    const ctx = this.ctx;
    const px = Math.round((x * TILE + 4) * this.scale) / this.scale;
    const py = Math.round((HUD_TOP + y * TILE + 4) * this.scale) / this.scale;
    ctx.save();
    ctx.translate(px, py);
    if (rot) ctx.rotate(rot);
    ctx.scale(flip ? -scale : scale, scale);
    ctx.drawImage(img, -SPRITE / 2, -SPRITE / 2);
    ctx.restore();
  }

  /** Draws twice when an actor straddles the tunnel edge. */
  private wrapX(x: number, maze: Maze, draw: (x: number) => void) {
    draw(x);
    if (x < 0.5) draw(x + maze.w);
    else if (x > maze.w - 1.5) draw(x - maze.w);
  }

  private ghostLook(s: Snapshot, g: SnapGhost, time: number): GhostLook {
    if (g.state === 'eyes' || g.state === 'entering') return 'eyes';
    if (!g.fright) return 'normal';
    const left = s.monsterLeft > 0 ? s.monsterLeft : s.frightLeft;
    const flash = s.monsterLeft > 0 ? 1.5 : FRIGHT_FLASH_TIME;
    if (left > 0 && left < flash && Math.floor(time * 6) % 2 === 1) return 'flash';
    return 'fright';
  }

  private drawGhost(s: Snapshot, g: SnapGhost, rc: RenderContext) {
    if (g.state === 'gone') return;
    const img = ghostFrame(g.skin, this.ghostLook(s, g, rc.time), g.dir, Math.floor(rc.time * 7) + g.slot);
    const maze = this.cache!.maze;
    this.wrapX(g.x, maze, (x) => this.sprite(img, x, g.y));
  }

  private drawNick(s: Snapshot, g: SnapGhost) {
    if (!g.playerId || g.state === 'gone' || s.mode !== 'multi') return;
    const p = s.players.find((pl) => pl.id === g.playerId);
    if (!p) return;
    this.label(p.nick, g.x * TILE + 4, HUD_TOP + g.y * TILE - 8, ghostSkin(g.skin).body);
  }

  private label(text: string, cx: number, y: number, color: string) {
    const ctx = this.ctx;
    ctx.font = `5px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#000';
    for (const [dx, dy] of [
      [-0.5, 0],
      [0.5, 0],
      [0, -0.5],
      [0, 0.5],
    ])
      ctx.fillText(text, cx + dx!, y + dy!);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, y);
  }

  private drawPaco(s: Snapshot, rc: RenderContext, dyingAnim: boolean, phaseT: number) {
    const p = s.paco;
    const maze = this.cache!.maze;
    if (s.phase === 'gameOver') return;
    if (dyingAnim) {
      const prog = (phaseT - DEATH_ANIM_START) / DEATH_ANIM_LEN;
      if (prog < 1) {
        const { rot, flip } = pacTransform('up');
        this.sprite(pacDeathFrame(p.skin, prog), p.x, p.y, 1, rot, flip);
      } else if (prog < 1.25) {
        // Final "pop" sparkle.
        const ctx = this.ctx;
        ctx.fillStyle = pacSkin(p.skin).body;
        const cx = p.x * TILE + 4;
        const cy = HUD_TOP + p.y * TILE + 4;
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          ctx.fillRect(Math.round(cx + Math.cos(a) * 5), Math.round(cy + Math.sin(a) * 5), 1, 2);
        }
      }
      return;
    }
    const intro = s.phase === 'intro' || s.phase === 'ready' || s.phase === 'roleReveal';
    const frame = intro ? 0 : p.moving ? Math.floor(p.chomp * 5) % 4 : 1;
    const monster = p.scale > 1;
    const img = pacFrame(p.skin, frame, monster, monster && Math.floor(rc.time * 8) % 2 === 0);
    const { rot, flip } = pacTransform(p.dir);
    this.wrapX(p.x, maze, (x) => this.sprite(img, x, p.y, p.scale, rot, flip));
    if (s.mode === 'multi' && p.playerId) {
      const pl = s.players.find((q) => q.id === p.playerId);
      const viewerIsGhost = s.players.find((q) => q.id === rc.myId)?.role === 'ghost';
      if (pl && !viewerIsGhost) this.label(pl.nick, p.x * TILE + 4, HUD_TOP + p.y * TILE - 4 * p.scale, '#ffe600');
    }
  }

  private drawParticles(dt: number) {
    const ctx = this.ctx;
    this.particles = this.particles.filter((q) => (q.life -= dt) > 0);
    for (const q of this.particles) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 120 * dt;
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
    }
  }

  private drawPopups(s: Snapshot) {
    const ctx = this.ctx;
    ctx.font = `6px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of s.popups) {
      ctx.fillStyle = p.color ?? '#00ffff';
      ctx.fillText(p.text, p.x * TILE + 4, HUD_TOP + p.y * TILE + 4 - (1 - p.ttl) * 4);
    }
  }

  private drawFog(s: Snapshot, maze: Maze, myId: string) {
    const W = maze.w * TILE;
    const H = maze.h * TILE;
    if (this.fog.width !== W || this.fog.height !== H) {
      this.fog.width = W;
      this.fog.height = H;
    }
    const f = this.fog.getContext('2d')!;
    f.globalCompositeOperation = 'source-over';
    f.fillStyle = '#000';
    f.fillRect(0, 0, W, H);
    f.globalCompositeOperation = 'destination-out';
    for (const g of s.ghosts) {
      if (g.state === 'gone') continue;
      const r = (g.playerId === myId ? FOG.ownRadius : FOG.otherRadius) * TILE;
      const cx = g.x * TILE + 4;
      const cy = g.y * TILE + 4;
      const grad = f.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = grad;
      f.beginPath();
      f.arc(cx, cy, r, 0, Math.PI * 2);
      f.fill();
    }
    this.ctx.drawImage(this.fog, 0, HUD_TOP);
  }

  private text(t: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', size = 8) {
    const ctx = this.ctx;
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  }

  private drawHud(s: Snapshot, rc: RenderContext, maze: Maze) {
    const W = this.nativeW;
    const me = s.players.find((p) => p.id === rc.myId) ?? s.players[0]!;
    const blink = Math.floor(rc.time * 3) % 2 === 0;
    // Top: score + high score.
    if (s.mode === 'single') {
      if (blink || s.phase !== 'playing') this.text('1UP', 24, 0, '#fff');
      this.text(String(me.score).padStart(2, '0'), 56, 9, '#fff', 'right');
    } else {
      this.text(me.nick, 4, 0, me.role === 'paco' ? '#ffe600' : ghostSkin(me.ghostSkin).body);
      this.text(String(me.score), 4, 9, '#fff');
    }
    this.text('HIGH SCORE', W / 2, 0, '#fff', 'center');
    this.text(String(s.highScore), W / 2, 9, '#fff', 'center');
    this.text(`L${s.level}`, W - 4, 0, '#fff', 'right');

    // Centre messages (below the ghost house, like the arcade).
    const h = maze.house;
    const msgY = HUD_TOP + (h.y1 + 2) * TILE + 1;
    if (s.phase === 'intro' || s.phase === 'ready') this.text('READY!', W / 2, msgY, '#ffe600', 'center');
    if (s.phase === 'intro' && s.mode === 'single') this.text('PLAYER ONE', W / 2, HUD_TOP + (h.y0 - 3) * TILE + 1, '#00ffff', 'center');
    if (s.phase === 'gameOver') this.text('GAME  OVER', W / 2, msgY, '#ff2020', 'center');
    if (rc.paused) this.text('PAUSED', W / 2, msgY, '#00ffff', 'center');
    if (s.monsterLeft > 0) {
      const col = Math.floor(rc.time * 8) % 2 ? '#ff8a00' : '#ffe600';
      this.text('PACO-MONSTER!', W / 2, 18, col, 'center', 6);
      this.text(s.monsterLeft.toFixed(1), W - 4, 9, col, 'right');
    } else if (s.phase === 'levelComplete') {
      this.text('LEVEL CLEAR!', W / 2, msgY, '#ffe600', 'center');
    }

    // Bottom: lives + map name.
    const by = HUD_TOP + maze.h * TILE + 2;
    const pacoPlayer = s.players.find((p) => p.role === 'paco');
    const lifeOwner = s.mode === 'single' ? me : pacoPlayer;
    if (lifeOwner) {
      const extra = s.mode === 'single' && s.phase !== 'intro' ? lifeOwner.lives - 1 : lifeOwner.lives;
      for (let i = 0; i < Math.max(0, extra); i++) {
        this.ctx.drawImage(pacFrame(lifeOwner.pacSkin, 2), 4 + i * 14, by - 4, SPRITE * 0.7, SPRITE * 0.7);
      }
    }
    this.text(maze.def.name.toUpperCase(), W - 4, by + 4, maze.def.wallColor, 'right', 6);
  }

  private drawRoleReveal(s: Snapshot, role: 'paco' | 'ghost', rc: RenderContext) {
    const W = this.nativeW;
    const H = this.nativeH;
    const me = s.players.find((p) => p.id === rc.myId)!;
    this.text('ROUND START', W / 2, 40, '#888', 'center', 6);
    this.text('YOU ARE:', W / 2, 70, '#fff', 'center', 10);
    const ctx = this.ctx;
    const cx = W / 2;
    const cy = H / 2;
    const bob = Math.sin(rc.time * 6) * 3;
    ctx.save();
    ctx.translate(cx, cy + bob);
    ctx.scale(4, 4);
    const img =
      role === 'paco'
        ? pacFrame(me.pacSkin, Math.floor(rc.time * 8) % 4)
        : ghostFrame(s.ghosts[me.slot]?.skin ?? me.ghostSkin, 'normal', 'down', Math.floor(rc.time * 7));
    ctx.drawImage(img, -SPRITE / 2, -SPRITE / 2);
    ctx.restore();
    const name = role === 'paco' ? pacSkin(me.pacSkin).name : `${ghostSkin(s.ghosts[me.slot]?.skin ?? me.ghostSkin).name} GHOST`;
    const color = role === 'paco' ? '#ffe600' : ghostSkin(s.ghosts[me.slot]?.skin ?? me.ghostSkin).body;
    this.text(name, W / 2, cy + 50, color, 'center', 8);
    const hint = role === 'paco' ? 'EAT ALL DOTS!' : 'CATCH PACO! +1000';
    this.text(hint, W / 2, cy + 66, '#fff', 'center', 6);
    this.text(String(Math.ceil(s.phaseLeft)), W / 2, H - 40, '#888', 'center', 10);
  }
}
