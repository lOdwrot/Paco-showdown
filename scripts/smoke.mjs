/**
 * End-to-end smoke test in headless Chromium (Playwright).
 *  1. Single player: title → setup → play a few seconds → screenshots.
 *  2. Multiplayer over BroadcastChannel (?net=local): host + client tabs,
 *     lobby, start, role reveal, gameplay with fog → screenshots.
 * Usage: npm run build && npm run smoke   (screenshots in ./screenshots)
 * Exit code != 0 on failure.
 */
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const server = await preview({ preview: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('preview server did not start');
}

const errors = [];
function watch(page, name) {
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] console: ${m.text()}`));
}
const snap = (page) => page.evaluate(() => window.__paco?.snapshot ?? null);
function assert(c, msg) {
  if (!c) throw new Error(`ASSERT: ${msg}`);
}

let browser;
try {
  await waitServer();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 820 } });

  // ---------------- single player
  const p = await ctx.newPage();
  watch(p, 'single');
    await p.goto(BASE);
  await sleep(800);
  await p.screenshot({ path: `${OUT}/01-title.png` });
  await p.click('[data-action=single]');
  await p.fill('#nick', 'TESTER');
  await p.click('.skin[data-id=president]');
  await p.screenshot({ path: `${OUT}/02-setup.png` });
  await p.click('[data-action=start-single]');
  await sleep(1500);
  await p.screenshot({ path: `${OUT}/03-intro.png` });
  let s = await snap(p);
  assert(s && s.phase === 'intro', `expected intro, got ${s?.phase}`);
  await sleep(3500);
  for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
    await p.keyboard.press(k);
    await sleep(700);
  }
  s = await snap(p);
  assert(s.phase === 'playing' || s.phase === 'dying', `expected playing, got ${s.phase}`);
  assert(s.players[0].score > 0, 'score should increase after moving');
  await p.screenshot({ path: `${OUT}/04-playing.png` });
  // Force a power ball + monster mode via the live match for a visual check.
  await p.evaluate(() => {
    const m = window.__paco.session.match;
    m.level.lifeBestStreak = 4;
    m.level.startMonster();
  });
  await sleep(1200);
  await p.screenshot({ path: `${OUT}/05-monster.png` });
  s = await snap(p);
  assert(s.monsterLeft > 0 || s.phase === 'levelComplete', 'monster mode should run');
  await p.close();

  // ---------------- phone layout (portrait + landscape): the maze must fill the screen
  for (const [name, vp] of [['portrait', { width: 390, height: 664 }], ['landscape', { width: 750, height: 342 }]]) {
    const mctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const m = await mctx.newPage();
    watch(m, `mobile-${name}`);
    await m.goto(BASE);
    await m.tap('[data-action=single]');
    await m.tap('[data-action=start-single]');
    await sleep(800);
    await m.screenshot({ path: `${OUT}/11-mobile-${name}.png` });
    const r = await m.evaluate(() => {
      const b = document.querySelector('#game').getBoundingClientRect();
      const d = document.querySelector('#dpad').getBoundingClientRect();
      return { w: b.width, h: b.height, top: b.top, bottom: b.bottom, dpadTop: d.top, dpadLeft: d.left, right: b.right };
    });
    if (name === 'portrait') {
      assert(r.w >= vp.width * 0.85, `portrait maze too small: ${r.w}px of ${vp.width}`);
      assert(r.bottom <= r.dpadTop, 'portrait D-pad overlaps the maze');
    } else {
      assert(r.h >= vp.height * 0.95, `landscape maze too small: ${r.h}px of ${vp.height}`);
      assert(r.right <= r.dpadLeft, 'landscape D-pad overlaps the maze');
    }
    assert(r.top >= 0 && r.bottom <= vp.height + 1, `${name} maze clipped`);
    await mctx.close();
  }

  // ---------------- multiplayer (BroadcastChannel transport)
  const host = await ctx.newPage();
  const guest = await ctx.newPage();
  watch(host, 'host');
  watch(guest, 'guest');
    await host.goto(`${BASE}?net=local`);
  await guest.goto(`${BASE}?net=local`);
  await host.click('[data-action=multi]');
  await host.fill('#nick', 'HOSTY');
  await host.click('[data-action=host]');
  await host.waitForSelector('#screen-lobby:not(.hidden)');
  const code = (await host.textContent('#room-code')).trim();
  assert(/^[A-Z0-9]{5}$/.test(code), `bad room code ${code}`);
  await guest.click('[data-action=multi]');
  await guest.fill('#nick', 'GUESTY');
  await guest.click('.skin[data-id=count]');
  await guest.fill('#join-code', code);
  await guest.click('[data-action=join]');
  await guest.waitForSelector('#screen-lobby:not(.hidden)');
  await host.waitForFunction(() => document.querySelectorAll('#lobby-players li').length === 2);
  await host.screenshot({ path: `${OUT}/06-lobby.png` });
  await host.click('[data-action=start-multi]');
  await guest.waitForSelector('#screen-game:not(.hidden)');
  await sleep(1200);
  await host.screenshot({ path: `${OUT}/07-host-reveal.png` });
  await guest.screenshot({ path: `${OUT}/08-guest-reveal.png` });
  await sleep(7000);
  await guest.keyboard.press('ArrowLeft');
  await host.keyboard.press('ArrowRight');
  await sleep(1500);
  await host.screenshot({ path: `${OUT}/09-host-play.png` });
  await guest.screenshot({ path: `${OUT}/10-guest-fog.png` });
  const hs = await snap(host);
  const gs = await snap(guest);
  assert(hs.mode === 'multi' && gs.mode === 'multi', 'both in multi');
  assert(gs.players.length === 2, 'guest sees 2 players');
  assert(Math.abs(hs.tick - gs.tick) < 30, `guest lagging: ${hs.tick} vs ${gs.tick}`);
  assert(gs.ghosts.some((g) => g.playerId && g.skin === 'count'), 'guest ghost uses chosen skin');

  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('SMOKE OK – screenshots in', OUT);
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  // browser.close() can hang in some sandboxes; never let cleanup block the exit.
  await Promise.race([browser?.close().catch(() => {}), sleep(3000)]);
  await Promise.race([server.close(), sleep(2000)]);
  process.exit(process.exitCode ?? 0);
}
