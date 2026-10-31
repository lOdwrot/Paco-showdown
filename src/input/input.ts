import type { Dir } from '../game/types.ts';

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

/**
 * Keyboard (arrows / WASD) + touch swipe. The last pressed direction is kept
 * (arcade style: Paco keeps going and turns at the next opening).
 */
export class Input {
  dir: Dir | null = null;
  onKey: (code: string) => void = () => {};
  private touchStart: { x: number; y: number } | null = null;

  constructor(swipeTarget: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const d = KEYS[e.code];
      if (d) {
        this.dir = d;
        e.preventDefault();
      }
      this.onKey(e.code);
    });
    swipeTarget.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches[0]!;
        this.touchStart = { x: t.clientX, y: t.clientY };
      },
      { passive: true },
    );
    swipeTarget.addEventListener(
      'touchmove',
      (e) => {
        if (!this.touchStart) return;
        const t = e.touches[0]!;
        const dx = t.clientX - this.touchStart.x;
        const dy = t.clientY - this.touchStart.y;
        if (Math.hypot(dx, dy) < 18) return;
        this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        this.touchStart = { x: t.clientX, y: t.clientY };
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /** Set by on-screen D-pad buttons. */
  press(d: Dir): void {
    this.dir = d;
  }

  reset(): void {
    this.dir = null;
  }
}
