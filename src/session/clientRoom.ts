import { SIM_HZ } from '../config.ts';
import type { Snapshot } from '../game/snapshot.ts';
import type { Dir } from '../game/types.ts';
import type { ClientTransport } from '../net/transport.ts';
import { PROTOCOL_VERSION, parseHostMsg, type ClientMsg, type LobbyPlayer, type Profile } from '../net/protocol.ts';
import type { GameSession } from './types.ts';

/**
 * Multiplayer client: shows the lobby, sends inputs, renders host snapshots with
 * linear interpolation between the last two received.
 */
export class ClientRoom implements GameSession {
  readonly mode = 'multi' as const;
  myId = '';
  code = '';
  players: LobbyPlayer[] = [];
  started = false;
  onLobbyChange: (players: LobbyPlayer[]) => void = () => {};
  onStart: () => void = () => {};
  onClosed: (reason: string) => void = () => {};
  private prev: Snapshot | null = null;
  private last: Snapshot | null = null;
  private since = 0;
  private lastDir: Dir | null = null;
  private closed = false;

  constructor(
    readonly transport: ClientTransport,
    profile: Profile,
  ) {
    transport.onMessage((raw) => this.handle(raw));
    transport.onClose((r) => this.close(r));
    this.send({ t: 'hello', v: PROTOCOL_VERSION, profile });
  }

  get over(): boolean {
    return this.last?.phase === 'gameOver' && this.last.phaseLeft <= 0;
  }

  private send(m: ClientMsg) {
    this.transport.send(m);
  }

  private close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.onClosed(reason);
  }

  private handle(raw: unknown) {
    const m = parseHostMsg(raw);
    if (!m) return;
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.code = m.code;
        break;
      case 'lobby':
        this.players = m.players;
        this.onLobbyChange(m.players);
        break;
      case 'start':
        this.started = true;
        this.onStart();
        break;
      case 'snap':
        if (this.last && m.s.tick <= this.last.tick) return;
        this.prev = this.last;
        this.last = m.s;
        this.since = 0;
        if (!this.started) {
          this.started = true;
          this.onStart();
        }
        break;
      case 'reject':
      case 'end':
        this.close(m.reason);
        this.transport.close();
        break;
      case 'pong':
        break;
    }
  }

  update(dt: number): void {
    this.since += dt;
  }

  view(): Snapshot | null {
    const a = this.prev;
    const b = this.last;
    if (!b) return null;
    if (!a || a.mapIndex !== b.mapIndex || a.level !== b.level) return b;
    const interval = Math.max(1, b.tick - a.tick) / SIM_HZ;
    const t = Math.min(1, this.since / interval);
    const lerp = (p: number, q: number) => (Math.abs(q - p) > 2 ? q : p + (q - p) * t);
    return {
      ...b,
      paco: { ...b.paco, x: lerp(a.paco.x, b.paco.x), y: lerp(a.paco.y, b.paco.y), chomp: lerp(a.paco.chomp, b.paco.chomp) },
      ghosts: b.ghosts.map((g, i) => {
        const pg = a.ghosts[i];
        return pg ? { ...g, x: lerp(pg.x, g.x), y: lerp(pg.y, g.y) } : g;
      }),
    };
  }

  /** Changes nickname/skins while still in the lobby. */
  updateProfile(profile: Profile): void {
    if (!this.started) this.send({ t: 'profile', profile });
  }

  setInput(dir: Dir | null): void {
    if (dir === this.lastDir) return;
    this.lastDir = dir;
    this.send({ t: 'input', dir });
  }

  dispose(): void {
    this.closed = true;
    this.transport.close();
  }
}
