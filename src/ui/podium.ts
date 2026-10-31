import type { SnapPlayer } from '../game/snapshot.ts';
import { SPRITE, ghostFrame, pacFrame } from '../render/sprites.ts';

const W = 320;
const H = 190;
const GROW_TIME = 3.2; // seconds for the bars to reach their final height
const BASE_Y = H - 26; // y of the bar bottoms
const MAX_BAR = 100;

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/**
 * End-of-match bar chart for multiplayer: bars grow while the score counts up, each
 * topped by the player's Paco and ghost. Winners jump happily, the rest are sad.
 * Pure canvas drawing, driven by App.tick() while the 'over' screen is visible.
 */
export class Podium {
  private ctx: CanvasRenderingContext2D;
  private players: SnapPlayer[] = [];
  private maxScore = 1;
  private t = 0;
  private myId = '';

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
  }

  /** Winners = everybody sharing the top score (needs > 0 points). */
  isWinner(p: SnapPlayer): boolean {
    return this.maxScore > 0 && p.score === this.maxScore;
  }

  start(players: SnapPlayer[], myId: string): void {
    this.players = [...players].sort((a, b) => b.score - a.score);
    this.maxScore = Math.max(0, ...players.map((p) => p.score));
    this.myId = myId;
    this.t = 0;
  }

  draw(dt: number): void {
    this.t += dt;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    const n = this.players.length;
    if (!n) return;
    const grow = easeOut(this.t / GROW_TIME);
    const done = this.t >= GROW_TIME;
    const slot = W / n;
    const barW = Math.min(46, slot - 10);
    const scale = this.maxScore > 0 ? MAX_BAR / this.maxScore : 0;

    // floor line
    ctx.fillStyle = '#2a3cff';
    ctx.fillRect(8, BASE_Y, W - 16, 2);

    this.players.forEach((p, i) => {
      const cx = slot * i + slot / 2;
      const x = Math.round(cx - barW / 2);
      const h = Math.max(2, Math.round(p.score * scale * grow));
      const top = BASE_Y - h;
      const winner = done && this.isWinner(p);
      const sad = done && !this.isWinner(p);
      const shown = Math.round(p.score * grow);

      // bar
      ctx.fillStyle = winner ? '#ffd23f' : sad ? '#3a4090' : '#2a3cff';
      ctx.fillRect(x, top, barW, h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, top, 3, h);

      // characters (Paco on the left, ghost on the right)
      const phase = i * 0.9;
      const pacX = cx - SPRITE / 2 - 1;
      const ghostX = cx + SPRITE / 2 + 1 - SPRITE + SPRITE / 2;
      this.character(pacFrame(p.pacSkin, Math.floor(this.t * 8) % 4), pacX - 4, top, phase, winner, sad);
      this.character(ghostFrame(p.ghostSkin, 'normal', 'right', Math.floor(this.t * 6)), ghostX - 2, top, phase + 1.6, winner, sad);

      // crown + labels
      ctx.textAlign = 'center';
      ctx.font = '7px "Press Start 2P", monospace';
      if (winner) {
        ctx.fillStyle = '#ffd23f';
        const bob = Math.sin(this.t * 5) * 1.5;
        ctx.fillText('WINNER', cx, top - SPRITE - 14 + bob);
      }
      ctx.fillStyle = '#fff';
      ctx.fillText(String(shown), cx, BASE_Y + 12);
      ctx.fillStyle = p.id === this.myId ? '#ffd23f' : '#00ffff';
      ctx.fillText(p.nick.slice(0, 8), cx, BASE_Y + 22);
    });
  }

  /** One sprite standing on a bar: runs while growing, jumps if happy, droops if sad. */
  private character(img: HTMLCanvasElement, x: number, barTop: number, phase: number, happy: boolean, sad: boolean): void {
    const ctx = this.ctx;
    let y = barTop - SPRITE + 2;
    let sy = 1;
    if (happy) {
      y -= Math.abs(Math.sin(this.t * 6 + phase)) * 16;
    } else if (sad) {
      y += 1 + Math.sin(this.t * 1.5 + phase) * 0.6;
      sy = 0.88;
    } else {
      y -= Math.abs(Math.sin(this.t * 14 + phase)) * 2;
    }
    ctx.save();
    if (sad) ctx.filter = 'grayscale(0.75) brightness(0.8)';
    ctx.translate(Math.round(x), Math.round(y + SPRITE * (1 - sy)));
    ctx.scale(1, sy);
    ctx.drawImage(img, 0, 0);
    ctx.restore();

    if (sad) {
      // falling tears from both "eyes"
      for (let k = 0; k < 2; k++) {
        const f = (this.t * 0.9 + phase * 0.3 + k * 0.5) % 1;
        ctx.fillStyle = `rgba(110,190,255,${1 - f})`;
        ctx.fillRect(Math.round(x + 6 + k * 7), Math.round(y + 9 + f * 10), 1, 2);
      }
    } else if (happy) {
      // sparkles
      for (let k = 0; k < 2; k++) {
        const f = (this.t * 2 + phase + k * 0.5) % 1;
        ctx.fillStyle = `rgba(255,240,120,${1 - f})`;
        const ox = k ? 19 : -2;
        ctx.fillRect(Math.round(x + ox), Math.round(y + 2 - f * 6), 2, 2);
      }
    }
  }
}
