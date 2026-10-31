import { SPRITE, ghostFrame, pacFrame } from '../render/sprites.ts';
import type { Dir } from '../game/types.ts';

export interface CarouselItem {
  id: string;
  name: string;
  blurb: string;
}

/**
 * One-at-a-time character picker: ◀ [animated sprite + name] ▶.
 * Also supports swiping on the sprite and arrow keys while focused.
 */
export class Carousel {
  readonly canvas: HTMLCanvasElement;
  private index = 0;
  private nameEl: HTMLElement;
  private blurbEl: HTMLElement;
  private countEl: HTMLElement;
  onChange: (id: string) => void = () => {};

  constructor(
    readonly el: HTMLElement,
    readonly kind: 'pac' | 'ghost',
    readonly items: readonly CarouselItem[],
    label: string,
  ) {
    el.innerHTML = `
      <span class="car-label">${label}</span>
      <div class="car-row">
        <button class="arrow" data-step="-1" aria-label="Previous ${label}">◀</button>
        <div class="car-stage" tabindex="0"><canvas width="${SPRITE}" height="${SPRITE}"></canvas></div>
        <button class="arrow" data-step="1" aria-label="Next ${label}">▶</button>
      </div>
      <span class="name"></span>
      <span class="blurb"></span>
      <span class="count"></span>`;
    this.canvas = el.querySelector('canvas')!;
    this.nameEl = el.querySelector('.name')!;
    this.blurbEl = el.querySelector('.blurb')!;
    this.countEl = el.querySelector('.count')!;
    el.querySelectorAll<HTMLButtonElement>('.arrow').forEach((b) =>
      b.addEventListener('click', () => this.step(Number(b.dataset.step))),
    );
    const stage = el.querySelector<HTMLElement>('.car-stage')!;
    stage.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    let x0: number | null = null;
    stage.addEventListener('touchstart', (e) => (x0 = e.touches[0]!.clientX), { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0]!.clientX - x0;
      if (Math.abs(dx) > 30) this.step(dx < 0 ? 1 : -1);
      x0 = null;
    });
    this.render();
  }

  get value(): string {
    return this.items[this.index]!.id;
  }

  set(id: string): void {
    const i = this.items.findIndex((it) => it.id === id);
    this.index = i >= 0 ? i : 0;
    this.render();
  }

  step(d: number): void {
    const n = this.items.length;
    this.index = (this.index + d + n) % n;
    this.render();
    this.onChange(this.value);
  }

  private render(): void {
    const it = this.items[this.index]!;
    this.el.dataset.value = it.id;
    this.nameEl.textContent = it.name;
    this.blurbEl.textContent = it.blurb;
    this.countEl.textContent = `${this.index + 1}/${this.items.length}`;
  }

  /** Called every frame while visible. */
  draw(time: number): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, SPRITE, SPRITE);
    const dirs: Dir[] = ['right', 'down', 'left', 'up'];
    const img =
      this.kind === 'pac'
        ? pacFrame(this.value, Math.floor(time * 8) % 4)
        : ghostFrame(this.value, 'normal', dirs[Math.floor(time / 1.2) % 4]!, Math.floor(time * 6));
    ctx.drawImage(img, 0, 0);
  }
}
