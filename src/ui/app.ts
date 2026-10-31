import { GameAudio } from '../audio/audio.ts';
import type { Snapshot } from '../game/snapshot.ts';
import type { Dir } from '../game/types.ts';
import { Input } from '../input/input.ts';
import { getNetFactory } from '../net/index.ts';
import { type LobbyPlayer, type Profile, sanitizeNick } from '../net/protocol.ts';
import { isValidRoomCode, normalizeRoomCode } from '../net/roomCode.ts';
import { Renderer } from '../render/renderer.ts';
import { SPRITE, ghostFrame, pacFrame } from '../render/sprites.ts';
import type { DevOptions } from '../game/match.ts';
import { MAPS } from '../game/maps/index.ts';
import { Carousel } from './carousel.ts';
import { ClientRoom } from '../session/clientRoom.ts';
import { HostRoom } from '../session/hostRoom.ts';
import { LocalSession } from '../session/localSession.ts';
import type { GameSession } from '../session/types.ts';
import { GHOST_SKINS, PAC_SKINS, ghostSkin } from '../skins/catalog.ts';
import { loadHighScore, loadProfile, saveHighScore, saveProfile } from './storage.ts';

type Screen = 'title' | 'setup' | 'lobby' | 'dev' | 'game' | 'over';
const MENU_SCREENS: Screen[] = ['title', 'setup', 'lobby', 'dev'];
const DEV_KEY = 'paco.dev';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/**
 * UI controller: screens, menus, lobby, and the main animation loop.
 * Game logic lives in Match; this only wires sessions, renderer, audio, input.
 */
export class App {
  readonly audio = new GameAudio();
  readonly renderer: Renderer;
  readonly input: Input;
  profile: Profile = loadProfile();
  mode: 'single' | 'multi' = 'single';
  screen: Screen = 'title';
  session: GameSession | null = null;
  private room: HostRoom | ClientRoom | null = null;
  private last = performance.now();
  private time = 0;
  private boardTimer = 0;
  private lastSnap: Snapshot | null = null;
  private pacCarousel!: Carousel;
  private ghostCarousel!: Carousel;
  /** Dev options of the running/last dev game (null = normal game). */
  private devGame: { dev: DevOptions; level: number } | null = null;

  constructor() {
    const canvas = $<HTMLCanvasElement>('#game');
    this.renderer = new Renderer(canvas);
    this.input = new Input($('#canvas-box'));
    this.input.onKey = (code) => this.onKey(code);
    canvas.addEventListener('nativeresize', () => this.layout());
    window.addEventListener('resize', () => this.layout());
    // Re-fit whenever the game area changes size (rotation, address bar, side panel).
    new ResizeObserver(() => this.layout()).observe($('#canvas-box'));
    this.bindButtons();
    this.buildProfileEditor();
    this.buildDevScreen();
    this.bindAudioControls();
    if ('ontouchstart' in window || matchMedia('(pointer: coarse)').matches) {
      $('#dpad').classList.remove('hidden');
      document.body.classList.add('touch');
    }
    document.querySelectorAll<HTMLButtonElement>('#dpad button').forEach((b) =>
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.input.press(b.dataset.dir as Dir);
      }),
    );
    // Keep a hosted game ticking (slowly) even if the tab is in the background.
    setInterval(() => {
      if (document.hidden) this.tick(performance.now());
    }, 250);
    requestAnimationFrame((t) => this.frame(t));
    this.joinFromUrl();
  }

  /** Share link `?room=CODE`: joins that room right away with the saved profile. */
  private joinFromUrl(): void {
    const params = new URLSearchParams(location.search);
    const code = normalizeRoomCode(params.get('room') ?? '');
    if (!isValidRoomCode(code)) return;
    this.mode = 'multi';
    this.openSetup();
    $<HTMLInputElement>('#join-code').value = code;
    // Drop the param so a refresh / later "MENU" doesn't re-trigger it.
    const u = new URL(location.href);
    u.searchParams.delete('room');
    history.replaceState(null, '', u.toString());
    void this.join();
  }

  // ---------------------------------------------------------------- screens

  show(s: Screen): void {
    this.screen = s;
    for (const id of ['title', 'setup', 'lobby', 'dev', 'game', 'over'])
      $(`#screen-${id}`).classList.toggle('hidden', id !== s);
    document.body.classList.toggle('in-game', s === 'game');
    this.audio.menuMusic(MENU_SCREENS.includes(s));
    if (s === 'game') {
      this.layout();
      requestAnimationFrame(() => this.layout());
    }
  }

  toast(msg: string): void {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout((t as unknown as { _h: number })._h);
    (t as unknown as { _h: number })._h = window.setTimeout(() => t.classList.add('hidden'), 3500);
  }

  private layout(): void {
    const box = $('#canvas-box');
    this.renderer.fit(box.clientWidth, box.clientHeight);
  }

  private bindButtons(): void {
    document.body.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!btn) return;
      this.audio.unlock();
      this.audio.play('blip');
      void this.action(btn.dataset.action!);
    });
    $<HTMLInputElement>('#nick').addEventListener('input', (e) => {
      this.profile.nick = sanitizeNick((e.target as HTMLInputElement).value);
      this.profileChanged();
    });
    $<HTMLInputElement>('#join-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.action('join');
    });
  }

  private async action(a: string): Promise<void> {
    switch (a) {
      case 'single':
      case 'multi':
        this.mode = a;
        this.openSetup();
        break;
      case 'back':
        this.show('title');
        break;
      case 'dev':
        this.show('dev');
        break;
      case 'start-dev':
        this.startDev();
        break;
      case 'start-single':
        this.commitNick();
        this.startSingle();
        break;
      case 'host':
        this.commitNick();
        await this.host();
        break;
      case 'join':
        this.commitNick();
        await this.join();
        break;
      case 'copy':
        void navigator.clipboard?.writeText($('#room-code').textContent ?? '');
        this.toast('CODE COPIED');
        break;
      case 'copy-link': {
        const u = new URL(location.href);
        u.hash = '';
        u.searchParams.set('room', $('#room-code').textContent ?? '');
        void navigator.clipboard?.writeText(u.toString());
        this.toast('LINK COPIED');
        break;
      }
      case 'start-multi':
        if (this.room instanceof HostRoom) {
          this.room.start({ highScore: loadHighScore() });
          this.startGame(this.room);
        }
        break;
      case 'leave':
      case 'menu':
        this.quit();
        break;
      case 'again':
        if (this.devGame) this.startDev();
        else this.startSingle();
        break;
    }
  }

  private commitNick(): void {
    this.profile.nick = sanitizeNick($<HTMLInputElement>('#nick').value);
    saveProfile(this.profile);
  }

  private openSetup(): void {
    const multi = this.mode === 'multi';
    $('#setup-title').textContent = multi ? 'MULTIPLAYER' : 'CHOOSE YOUR PACO';
    $('#setup-single').classList.toggle('hidden', multi);
    $('#setup-multi').classList.toggle('hidden', !multi);
    this.mountProfileEditor('setup', multi);
    this.show('setup');
  }

  // ---------------------------------------------------------------- profile editor

  private buildProfileEditor(): void {
    this.pacCarousel = new Carousel($('.carousel[data-kind=pac]'), 'pac', PAC_SKINS, 'PACO');
    this.ghostCarousel = new Carousel($('.carousel[data-kind=ghost]'), 'ghost', GHOST_SKINS, 'GHOST');
    const changed = () => {
      this.audio.unlock();
      this.audio.play('select');
      this.profile.pacSkin = this.pacCarousel.value;
      this.profile.ghostSkin = this.ghostCarousel.value;
      this.profileChanged();
    };
    this.pacCarousel.onChange = changed;
    this.ghostCarousel.onChange = changed;
  }

  /** Moves the single nick + carousels editor into the setup or lobby screen. */
  private mountProfileEditor(where: 'setup' | 'lobby', showGhost: boolean): void {
    $(`#profile-slot-${where}`).append($('#profile-editor'));
    this.pacCarousel.set(this.profile.pacSkin);
    this.ghostCarousel.set(this.profile.ghostSkin);
    this.ghostCarousel.el.classList.toggle('hidden', !showGhost);
    $<HTMLInputElement>('#nick').value = this.profile.nick === 'PLAYER' ? '' : this.profile.nick;
  }

  /** Saves the profile and, while in a lobby, sends it to the room. */
  private profileChanged(): void {
    saveProfile(this.profile);
    if (this.screen === 'lobby' && this.room) this.room.updateProfile(this.profile);
  }

  // ---------------------------------------------------------------- dev options

  private static readonly DEV_FLAGS = [
    'monsterNow',
    'monsterUnlocked',
    'powerAtStart',
    'invincible',
    'infiniteLives',
    'noGhosts',
    'skipIntro',
  ] as const;

  private buildDevScreen(): void {
    const map = $<HTMLSelectElement>('#dev-mapIndex');
    MAPS.forEach((m, i) => map.add(new Option(m.name.toUpperCase(), String(i))));
    const lvl = $<HTMLSelectElement>('#dev-level');
    for (let i = 1; i <= 20; i++) lvl.add(new Option(String(i), String(i)));
    this.writeDevForm(this.loadDev());
    $('#screen-dev').addEventListener('change', () => this.saveDev(this.readDevForm()));
    const presets: Record<string, Partial<DevOptions>> = {
      smash: { monsterNow: true, invincible: true },
      unlock: { monsterUnlocked: true, dotsLeft: 5 },
      clear: { dotsLeft: 1 },
      power: { powerAtStart: true, infiniteLives: true },
      reset: { skipIntro: false },
    };
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        this.audio.unlock();
        this.audio.play('select');
        const cur = this.readDevForm();
        const next = {
          level: b.dataset.preset === 'reset' ? 1 : cur.level,
          dev: { mapIndex: cur.dev.mapIndex, skipIntro: true, ...presets[b.dataset.preset!] },
        };
        this.writeDevForm(next);
        this.saveDev(next);
      }),
    );
  }

  private readDevForm(): { dev: DevOptions; level: number } {
    const dev: DevOptions = { mapIndex: Number($<HTMLSelectElement>('#dev-mapIndex').value) };
    const dots = $<HTMLSelectElement>('#dev-dotsLeft').value;
    if (dots) dev.dotsLeft = Number(dots);
    for (const f of App.DEV_FLAGS) if ($<HTMLInputElement>(`#dev-${f}`).checked) dev[f] = true;
    return { dev, level: Number($<HTMLSelectElement>('#dev-level').value) || 1 };
  }

  private writeDevForm(v: { dev: DevOptions; level: number }): void {
    $<HTMLSelectElement>('#dev-mapIndex').value = String(v.dev.mapIndex ?? 0);
    $<HTMLSelectElement>('#dev-level').value = String(v.level);
    $<HTMLSelectElement>('#dev-dotsLeft').value = v.dev.dotsLeft !== undefined ? String(v.dev.dotsLeft) : '';
    for (const f of App.DEV_FLAGS) $<HTMLInputElement>(`#dev-${f}`).checked = !!v.dev[f];
  }

  private loadDev(): { dev: DevOptions; level: number } {
    try {
      const v = JSON.parse(localStorage.getItem(DEV_KEY) ?? 'null');
      if (v && typeof v === 'object' && v.dev) return v;
    } catch {
      /* ignore */
    }
    return { dev: { mapIndex: 0 }, level: 1 };
  }

  private saveDev(v: { dev: DevOptions; level: number }): void {
    localStorage.setItem(DEV_KEY, JSON.stringify(v));
  }

  private startDev(): void {
    this.devGame = this.readDevForm();
    this.saveDev(this.devGame);
    this.room = null;
    this.startGame(
      new LocalSession(this.profile, { highScore: 0, startLevel: this.devGame.level, dev: this.devGame.dev }),
    );
  }

  // ---------------------------------------------------------------- audio controls

  private syncMuteButton: () => void = () => {};

  private bindAudioControls(): void {
    const btn = $('#btn-mute');
    const sync = () => btn.classList.toggle('off', this.audio.muted);
    sync();
    this.syncMuteButton = sync;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.unlock();
      this.audio.toggleMute();
      sync();
    });
    // Browsers only allow audio after a user gesture: (re)start menu music on gestures.
    const gesture = () => {
      this.audio.unlock();
      this.audio.menuMusic(MENU_SCREENS.includes(this.screen));
    };
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
  }

  // ---------------------------------------------------------------- games

  private startSingle(): void {
    const params = new URLSearchParams(location.search);
    const startLevel = Math.max(1, Number(params.get('level') ?? 1) || 1);
    this.room = null;
    this.devGame = null;
    this.startGame(new LocalSession(this.profile, { highScore: loadHighScore(), startLevel }));
  }

  private startGame(session: GameSession): void {
    this.session = session;
    this.audio.reset();
    this.input.reset();
    $('#pause-help').classList.toggle('hidden', session.mode !== 'single');
    $('#side').classList.toggle('single', session.mode === 'single');
    this.show('game');
  }

  private async host(): Promise<void> {
    try {
      this.toast('CREATING ROOM...');
      const t = await getNetFactory().host();
      const room = new HostRoom(t, this.profile);
      this.room = room;
      room.onLobbyChange = (p) => this.renderLobby(p, room.myId);
      $('#room-code').textContent = room.code;
      $('#lobby-hint').textContent = 'SHARE THIS CODE WITH FRIENDS (MAX 5 PLAYERS)';
      $('#btn-start-multi').classList.remove('hidden');
      this.renderLobby(room.players, room.myId);
      this.mountProfileEditor('lobby', true);
      this.show('lobby');
      $('#toast').classList.add('hidden');
    } catch (e) {
      this.toast(String((e as Error).message ?? e).toUpperCase());
    }
  }

  private async join(): Promise<void> {
    const code = normalizeRoomCode($<HTMLInputElement>('#join-code').value);
    if (!isValidRoomCode(code)) return this.toast('ENTER A 5-CHARACTER ROOM CODE');
    try {
      this.toast('JOINING...');
      const t = await getNetFactory().join(code);
      const room = new ClientRoom(t, this.profile);
      this.room = room;
      room.onLobbyChange = (p) => this.renderLobby(p, room.myId);
      room.onStart = () => this.startGame(room);
      room.onClosed = (reason) => {
        if (this.room !== room) return;
        this.toast(reason.toUpperCase());
        if (this.screen !== 'over') this.quit(false);
      };
      $('#room-code').textContent = code;
      $('#lobby-hint').textContent = 'WAITING FOR HOST TO START...';
      $('#btn-start-multi').classList.add('hidden');
      this.renderLobby([], '');
      this.mountProfileEditor('lobby', true);
      this.show('lobby');
      $('#toast').classList.add('hidden');
    } catch (e) {
      this.toast(String((e as Error).message ?? e).toUpperCase());
    }
  }

  private renderLobby(players: LobbyPlayer[], myId: string): void {
    const ul = $('#lobby-players');
    ul.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      li.append(this.iconCanvas(pacFrame(p.pacSkin, 2)), this.iconCanvas(ghostFrame(p.ghostSkin, 'normal', 'right', 0)));
      li.insertAdjacentHTML(
        'beforeend',
        `<span class="grow">${p.nick}</span><span class="tag">${p.isHost ? 'HOST' : ''}${p.id === myId ? ' YOU' : ''}</span>`,
      );
      ul.append(li);
    }
  }

  private iconCanvas(img: HTMLCanvasElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = SPRITE;
    c.height = SPRITE;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c;
  }

  quit(dispose = true): void {
    this.devGame = null;
    if (dispose) {
      if (this.room) this.room.dispose();
      else this.session?.dispose();
    }
    this.room = null;
    this.session = null;
    this.audio.stop();
    this.show('title');
  }

  private gameOver(s: Snapshot): void {
    if (!this.devGame) saveHighScore(Math.max(...s.players.map((p) => (s.mode === 'single' || p.id === this.session?.myId ? p.score : 0))));
    const ol = $('#final');
    ol.innerHTML = '';
    [...s.players]
      .sort((a, b) => b.score - a.score)
      .forEach((p, i) => {
        const li = document.createElement('li');
        li.append(this.iconCanvas(pacFrame(p.pacSkin, 2)));
        li.insertAdjacentHTML('beforeend', `<span class="grow">${i + 1}. ${p.nick}</span><span>${p.score}</span>`);
        ol.append(li);
      });
    $('#btn-again').classList.toggle('hidden', s.mode !== 'single');
    $('#btn-again').textContent = this.devGame ? 'RETRY' : 'PLAY AGAIN';
    this.audio.stop();
    this.show('over');
  }

  private onKey(code: string): void {
    if (code === 'KeyM' && document.activeElement?.tagName !== 'INPUT') {
      this.audio.toggleMute();
      this.syncMuteButton();
    }
    if (this.screen !== 'game' || !this.session) return;
    if (code === 'KeyP' && this.session instanceof LocalSession) this.session.paused = !this.session.paused;
    if (code === 'Escape') this.quit();
  }

  // ---------------------------------------------------------------- loop

  private frame(t: number): void {
    this.tick(t);
    requestAnimationFrame((n) => this.frame(n));
  }

  private tick(t: number): void {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (dt <= 0) return;
    this.time += dt;
    if (this.screen === 'title') this.drawAttract();
    if (this.screen === 'setup' || this.screen === 'lobby') {
      this.pacCarousel.draw(this.time);
      this.ghostCarousel.draw(this.time);
    }
    const s = this.session;
    if (!s || this.screen !== 'game') return;
    s.setInput(this.input.dir);
    s.update(dt);
    const snap = s.view();
    if (!snap) return;
    this.lastSnap = snap;
    if (document.hidden) return;
    const paused = s instanceof LocalSession && s.paused;
    this.renderer.render(snap, { myId: s.myId, time: this.time, dt: paused ? 0 : dt, paused, dev: !!this.devGame });
    if (paused) this.audio.stop();
    else this.audio.update(snap);
    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.25;
      this.renderScoreboard(snap, s.myId);
    }
    if (s.over) this.gameOver(snap);
  }

  /** Exposed for automated tests. */
  get snapshot(): Snapshot | null {
    return this.lastSnap;
  }

  private renderScoreboard(s: Snapshot, myId: string): void {
    const ol = $('#scoreboard');
    const rows = s.players.map((p) => {
      const ghost = s.ghosts[p.slot];
      const img =
        p.role === 'paco' ? pacFrame(p.pacSkin, 2) : ghostFrame(ghost?.skin ?? p.ghostSkin, 'normal', 'right', 0);
      const color = p.role === 'paco' ? '#ffe600' : ghostSkin(ghost?.skin ?? p.ghostSkin).body;
      return { p, img, color };
    });
    const sig = JSON.stringify(rows.map((r) => [r.p.id, r.p.score, r.p.lives, r.p.role, r.p.slot, r.p.connected]));
    if (ol.dataset.sig === sig) return;
    ol.dataset.sig = sig;
    ol.innerHTML = '';
    for (const { p, img, color } of rows) {
      const li = document.createElement('li');
      li.className = `${p.role}${p.id === myId ? ' me' : ''}${p.connected ? '' : ' off'}`;
      li.append(this.iconCanvas(img));
      const lives = '♥'.repeat(Math.max(0, p.lives)) || '—';
      li.insertAdjacentHTML(
        'beforeend',
        `<span style="color:${color}">${p.nick}${p.id === myId ? ' (YOU)' : ''}</span><span><span class="score">${p.score}</span> <span class="lives">${lives}</span></span>`,
      );
      ol.append(li);
    }
  }

  private drawAttract(): void {
    const c = $<HTMLCanvasElement>('#attract');
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const T = 9;
    const t = this.time % T;
    const chase = t < T / 2;
    const y = 12;
    // Dots trail
    ctx.fillStyle = '#ffb897';
    const pacX = chase ? 240 - (t / (T / 2)) * 260 : -20 + ((t - T / 2) / (T / 2)) * 260;
    for (let x = 8; x < 224; x += 8) if ((chase && x < pacX) || (!chase && x > pacX + 6)) ctx.fillRect(x, y + 9, 2, 2);
    if (chase) {
      ctx.fillStyle = Math.floor(this.time * 4) % 2 ? '#ffb897' : '#000';
      ctx.beginPath();
      ctx.arc(10, y + 10, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const skins = ['blaze', 'bubblegum', 'frosty', 'pumpkin'];
    skins.forEach((sk, i) => {
      const gx = chase ? pacX + 26 + i * 18 : pacX + 40 + i * 18 - ((t - T / 2) / (T / 2)) * 30 * (i + 1) * 0.3;
      const look = chase ? 'normal' : Math.floor(this.time * 6) % 2 && t > T - 1.5 ? 'flash' : 'fright';
      ctx.drawImage(ghostFrame(sk, look, chase ? 'left' : 'right', Math.floor(this.time * 7)), gx, y);
    });
    const frame = Math.floor(this.time * 10) % 4;
    ctx.save();
    ctx.translate(pacX + 10, y + 10);
    if (chase) ctx.scale(-1, 1);
    ctx.drawImage(pacFrame(this.profile.pacSkin, frame), -10, -10);
    ctx.restore();
  }
}
