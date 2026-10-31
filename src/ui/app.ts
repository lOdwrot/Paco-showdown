import { GameAudio } from '../audio/audio.ts';
import type { Snapshot } from '../game/snapshot.ts';
import type { Dir } from '../game/types.ts';
import { Input } from '../input/input.ts';
import { getNetFactory } from '../net/index.ts';
import { type LobbyPlayer, type Profile, sanitizeNick } from '../net/protocol.ts';
import { isValidRoomCode, normalizeRoomCode } from '../net/roomCode.ts';
import { Renderer } from '../render/renderer.ts';
import { SPRITE, ghostFrame, pacFrame } from '../render/sprites.ts';
import { ClientRoom } from '../session/clientRoom.ts';
import { HostRoom } from '../session/hostRoom.ts';
import { LocalSession } from '../session/localSession.ts';
import type { GameSession } from '../session/types.ts';
import { GHOST_SKINS, PAC_SKINS, ghostSkin } from '../skins/catalog.ts';
import { loadHighScore, loadProfile, saveHighScore, saveProfile } from './storage.ts';

type Screen = 'title' | 'setup' | 'lobby' | 'game' | 'over';

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

  constructor() {
    const canvas = $<HTMLCanvasElement>('#game');
    this.renderer = new Renderer(canvas);
    this.input = new Input($('#canvas-box'));
    this.input.onKey = (code) => this.onKey(code);
    canvas.addEventListener('nativeresize', () => this.layout());
    window.addEventListener('resize', () => this.layout());
    this.bindButtons();
    this.buildSkinPickers();
    if ('ontouchstart' in window) $('#dpad').classList.remove('hidden');
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
  }

  // ---------------------------------------------------------------- screens

  show(s: Screen): void {
    this.screen = s;
    for (const id of ['title', 'setup', 'lobby', 'game', 'over'])
      $(`#screen-${id}`).classList.toggle('hidden', id !== s);
    if (s === 'game') this.layout();
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
      saveProfile(this.profile);
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
        this.startSingle();
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
    $('#ghost-section').classList.toggle('hidden', !multi);
    $('#setup-single').classList.toggle('hidden', multi);
    $('#setup-multi').classList.toggle('hidden', !multi);
    $<HTMLInputElement>('#nick').value = this.profile.nick === 'PLAYER' ? '' : this.profile.nick;
    this.refreshSkinSelection();
    this.show('setup');
    $<HTMLInputElement>('#nick').focus();
  }

  // ---------------------------------------------------------------- skins

  private skinCanvases: { canvas: HTMLCanvasElement; kind: 'pac' | 'ghost'; id: string }[] = [];

  private buildSkinPickers(): void {
    const mk = (kind: 'pac' | 'ghost', list: readonly { id: string; name: string; blurb: string }[], host: HTMLElement) => {
      for (const s of list) {
        const card = document.createElement('button');
        card.className = 'skin';
        card.dataset.kind = kind;
        card.dataset.id = s.id;
        const c = document.createElement('canvas');
        c.width = SPRITE;
        c.height = SPRITE;
        card.append(c);
        card.insertAdjacentHTML('beforeend', `<span class="name">${s.name}</span><span class="blurb">${s.blurb}</span>`);
        card.addEventListener('click', () => {
          this.audio.unlock();
          this.audio.play('select');
          if (kind === 'pac') this.profile.pacSkin = s.id;
          else this.profile.ghostSkin = s.id;
          saveProfile(this.profile);
          this.refreshSkinSelection();
        });
        host.append(card);
        this.skinCanvases.push({ canvas: c, kind, id: s.id });
      }
    };
    mk('pac', PAC_SKINS, $('#pac-skins'));
    mk('ghost', GHOST_SKINS, $('#ghost-skins'));
  }

  private refreshSkinSelection(): void {
    document.querySelectorAll<HTMLElement>('.skin').forEach((el) => {
      const sel = el.dataset.kind === 'pac' ? this.profile.pacSkin : this.profile.ghostSkin;
      el.classList.toggle('selected', el.dataset.id === sel);
    });
  }

  private drawSkinPreviews(): void {
    const dirs: Dir[] = ['right', 'down', 'left', 'up'];
    for (const s of this.skinCanvases) {
      const ctx = s.canvas.getContext('2d')!;
      ctx.clearRect(0, 0, SPRITE, SPRITE);
      const img =
        s.kind === 'pac'
          ? pacFrame(s.id, Math.floor(this.time * 8) % 4)
          : ghostFrame(s.id, 'normal', dirs[Math.floor(this.time / 1.2) % 4]!, Math.floor(this.time * 6));
      ctx.drawImage(img, 0, 0);
    }
  }

  // ---------------------------------------------------------------- games

  private startSingle(): void {
    const params = new URLSearchParams(location.search);
    const startLevel = Math.max(1, Number(params.get('level') ?? 1) || 1);
    this.room = null;
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
    saveHighScore(Math.max(...s.players.map((p) => (s.mode === 'single' || p.id === this.session?.myId ? p.score : 0))));
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
    this.audio.stop();
    this.show('over');
  }

  private onKey(code: string): void {
    if (code === 'KeyM') this.audio.toggleMute();
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
    if (this.screen === 'setup') this.drawSkinPreviews();
    const s = this.session;
    if (!s || this.screen !== 'game') return;
    s.setInput(this.input.dir);
    s.update(dt);
    const snap = s.view();
    if (!snap) return;
    this.lastSnap = snap;
    if (document.hidden) return;
    const paused = s instanceof LocalSession && s.paused;
    this.renderer.render(snap, { myId: s.myId, time: this.time, dt: paused ? 0 : dt, paused });
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
