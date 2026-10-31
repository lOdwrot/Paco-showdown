import { Listeners, type ClientTransport, type HostTransport, type NetFactory } from './transport.ts';
import { makeRoomCode } from './roomCode.ts';

/**
 * BroadcastChannel transport: multiplayer between tabs of the same browser (and
 * between instances in one Node process – used by tests). No network needed.
 * Open the game with ?net=local in several tabs.
 */
type Frame =
  | { k: 'join'; from: string }
  | { k: 'accept'; to: string }
  | { k: 'leave'; from: string }
  | { k: 'kick'; to: string }
  | { k: 'c2h'; from: string; data: unknown }
  | { k: 'h2c'; to: string | null; data: unknown }
  | { k: 'closed' };

const channelName = (code: string) => `paco-showdown-room-${code}`;
const rid = () => Math.random().toString(36).slice(2, 10);

class LocalHost implements HostTransport {
  readonly code: string;
  private ch: BroadcastChannel;
  private peers = new Set<string>();
  private joins = new Listeners<[string]>();
  private leaves = new Listeners<[string]>();
  private msgs = new Listeners<[string, unknown]>();

  constructor(code: string) {
    this.code = code;
    this.ch = new BroadcastChannel(channelName(code));
    this.ch.onmessage = (e: MessageEvent<Frame>) => {
      const f = e.data;
      if (f.k === 'join') {
        this.peers.add(f.from);
        this.post({ k: 'accept', to: f.from });
        this.joins.fire(f.from);
      } else if (f.k === 'leave' && this.peers.delete(f.from)) {
        this.leaves.fire(f.from);
      } else if (f.k === 'c2h' && this.peers.has(f.from)) {
        this.msgs.fire(f.from, f.data);
      }
    };
  }
  private post(f: Frame) {
    this.ch.postMessage(f);
  }
  send(peerId: string, msg: unknown) {
    this.post({ k: 'h2c', to: peerId, data: msg });
  }
  broadcast(msg: unknown) {
    this.post({ k: 'h2c', to: null, data: msg });
  }
  kick(peerId: string) {
    this.post({ k: 'kick', to: peerId });
    if (this.peers.delete(peerId)) this.leaves.fire(peerId);
  }
  onPeerJoin(cb: (p: string) => void) {
    this.joins.add(cb);
  }
  onPeerLeave(cb: (p: string) => void) {
    this.leaves.add(cb);
  }
  onMessage(cb: (p: string, m: unknown) => void) {
    this.msgs.add(cb);
  }
  close() {
    this.post({ k: 'closed' });
    this.ch.close();
  }
}

class LocalClient implements ClientTransport {
  readonly id = rid();
  private ch: BroadcastChannel;
  private msgs = new Listeners<[unknown]>();
  private closes = new Listeners<[string]>();
  private closed = false;

  constructor(code: string, onAccept: () => void) {
    this.ch = new BroadcastChannel(channelName(code));
    this.ch.onmessage = (e: MessageEvent<Frame>) => {
      const f = e.data;
      if (f.k === 'accept' && f.to === this.id) onAccept();
      else if (f.k === 'h2c' && (f.to === null || f.to === this.id)) this.msgs.fire(f.data);
      else if (f.k === 'closed') this.shutdown('Host closed the room');
      else if (f.k === 'kick' && f.to === this.id) this.shutdown('Removed from room');
    };
    this.ch.postMessage({ k: 'join', from: this.id } satisfies Frame);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.close());
  }
  private shutdown(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.ch.close();
    this.closes.fire(reason);
  }
  send(msg: unknown) {
    if (!this.closed) this.ch.postMessage({ k: 'c2h', from: this.id, data: msg } satisfies Frame);
  }
  onMessage(cb: (m: unknown) => void) {
    this.msgs.add(cb);
  }
  onClose(cb: (r: string) => void) {
    this.closes.add(cb);
  }
  close() {
    if (this.closed) return;
    this.ch.postMessage({ k: 'leave', from: this.id } satisfies Frame);
    this.shutdown('Left room');
  }
}

export const localFactory: NetFactory = {
  kind: 'local',
  async host() {
    return new LocalHost(makeRoomCode());
  },
  join(code: string) {
    return new Promise<ClientTransport>((resolve, reject) => {
      let client: LocalClient | null = null;
      const timer = setTimeout(() => {
        client?.close();
        reject(new Error('Room not found'));
      }, 2500);
      client = new LocalClient(code, () => {
        clearTimeout(timer);
        resolve(client!);
      });
    });
  },
};
