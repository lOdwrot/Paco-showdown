import { MAX_PLAYERS, SIM_DT, SNAPSHOT_HZ } from '../config.ts';
import { Match } from '../game/match.ts';
import type { Snapshot } from '../game/snapshot.ts';
import type { Dir } from '../game/types.ts';
import type { HostTransport } from '../net/transport.ts';
import {
  PROTOCOL_VERSION,
  parseClientMsg,
  type HostMsg,
  type LobbyPlayer,
  type Profile,
} from '../net/protocol.ts';
import type { GameSession } from './types.ts';

export const HOST_ID = 'host';

/**
 * Multiplayer host: owns the lobby and, after start, the authoritative Match.
 * Inputs arrive from clients; snapshots are broadcast at SNAPSHOT_HZ.
 */
export class HostRoom implements GameSession {
  readonly mode = 'multi' as const;
  readonly myId = HOST_ID;
  players: LobbyPlayer[];
  match: Match | null = null;
  onLobbyChange: (players: LobbyPlayer[]) => void = () => {};
  private acc = 0;
  private sendAcc = 0;
  private snap: Snapshot | null = null;

  constructor(
    readonly transport: HostTransport,
    profile: Profile,
  ) {
    this.players = [{ id: HOST_ID, isHost: true, ...profile }];
    transport.onMessage((peer, raw) => this.handle(peer, raw));
    transport.onPeerLeave((peer) => this.leave(peer));
  }

  get code(): string {
    return this.transport.code;
  }

  get over(): boolean {
    return !!this.match?.finished;
  }

  private send(peer: string, m: HostMsg) {
    this.transport.send(peer, m);
  }

  private broadcast(m: HostMsg) {
    this.transport.broadcast(m);
  }

  private handle(peer: string, raw: unknown) {
    const msg = parseClientMsg(raw);
    if (!msg) return;
    switch (msg.t) {
      case 'hello': {
        if (msg.v !== PROTOCOL_VERSION) return this.reject(peer, 'Version mismatch – reload the page');
        if (this.match) return this.reject(peer, 'Game already started');
        const existing = this.players.find((p) => p.id === peer);
        if (!existing && this.players.length >= MAX_PLAYERS) return this.reject(peer, 'Room is full');
        if (existing) Object.assign(existing, msg.profile);
        else this.players.push({ id: peer, isHost: false, ...msg.profile });
        this.send(peer, { t: 'welcome', id: peer, code: this.code });
        this.lobbyChanged();
        break;
      }
      case 'input':
        this.match?.setInput(peer, msg.dir);
        break;
      case 'ping':
        this.send(peer, { t: 'pong', at: msg.at });
        break;
    }
  }

  private reject(peer: string, reason: string) {
    this.send(peer, { t: 'reject', reason });
    setTimeout(() => this.transport.kick(peer), 300);
  }

  private leave(peer: string) {
    if (this.match) {
      this.match.disconnect(peer);
      return;
    }
    const before = this.players.length;
    this.players = this.players.filter((p) => p.id !== peer);
    if (this.players.length !== before) this.lobbyChanged();
  }

  private lobbyChanged() {
    this.broadcast({ t: 'lobby', players: this.players });
    this.onLobbyChange(this.players);
  }

  updateProfile(profile: Profile) {
    Object.assign(this.players[0]!, profile);
    this.lobbyChanged();
  }

  start(opts: { highScore?: number } = {}): void {
    if (this.match) return;
    this.match = new Match(
      'multi',
      this.players.map(({ id, nick, pacSkin, ghostSkin }) => ({ id, nick, pacSkin, ghostSkin })),
      { seed: Math.floor(Math.random() * 1e9), highScore: opts.highScore },
    );
    this.broadcast({ t: 'start' });
    this.snap = this.match.snapshot();
    this.broadcast({ t: 'snap', s: this.snap });
  }

  update(dt: number): void {
    if (!this.match) return;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= SIM_DT) {
      this.match.step(SIM_DT);
      this.acc -= SIM_DT;
    }
    this.snap = this.match.snapshot();
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / SNAPSHOT_HZ) {
      this.sendAcc %= 1 / SNAPSHOT_HZ;
      this.broadcast({ t: 'snap', s: this.snap });
    }
  }

  view(): Snapshot | null {
    return this.snap;
  }

  setInput(dir: Dir | null): void {
    this.match?.setInput(HOST_ID, dir);
  }

  dispose(): void {
    this.broadcast({ t: 'end', reason: 'Host left the game' });
    setTimeout(() => this.transport.close(), 100);
  }
}
