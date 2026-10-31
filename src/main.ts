import './ui/styles.css';
import { App } from './ui/app.ts';

async function boot() {
  // Make sure the pixel font is ready before the first canvas text is drawn.
  try {
    await document.fonts.load('8px "Press Start 2P"');
  } catch {
    /* fall back to monospace */
  }
  const app = new App();
  (window as unknown as { __paco: App }).__paco = app;
}

void boot();
