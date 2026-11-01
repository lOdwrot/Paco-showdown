import { util, type DataConnection, type Peer as PeerType } from 'peerjs';
import { Listeners, type ClientTransport, type HostTransport, type NetFactory } from './transport.ts';
import { makeRoomCode } from './roomCode.ts';

/**
 * WebRTC transport using PeerJS (DataChannels). The room code maps to a PeerJS id,
 * signalling goes through the PeerJS broker (public cloud by default; set
 * VITE_PEER_HOST/VITE_PEER_PORT/VITE_PEER_PATH to self-host `peerjs-server`).
 * After the handshake, all game traffic is peer-to-peer.
 */
const ID_PREFIX = 'paco-showdown-v1-';

async function loadPeer(): Promise<typeof PeerType> {
  const mod = await import('peerjs');
  return mod.Peer;
}

/** How long a joiner keeps retrying while the broker says the room isn't registered (yet). */
const JOIN_RETRIES = 5;
const JOIN_RETRY_MS = 1500;
const JOIN_TIMEOUT_MS = 25000;

/** Delay before the n-th (0-based) attempt to get a dropped broker connection back. */
export function reconnectDelay(n: number): number {
  return Math.min(5000, 500 * 2 ** n);
}

function peerOptions(): Record<string, unknown> {
  const env = import.meta.env ?? {};
  const opts: Record<string, unknown> = { debug: 1 };
  // Optional TURN relay for strict mobile-carrier NATs (PeerJS's built-in defaults stay in place).
  if (env.VITE_TURN_URL) {
    opts.config = {
      ...util.defaultConfig,
      iceServers: [
        ...util.defaultConfig.iceServers,
        { urls: env.VITE_TURN_URL, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS },
      ],
    };
  }
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT ?? 443);
    opts.path = env.VITE_PEER_PATH ?? '/';
    opts.secure = (env.VITE_PEER_SECURE ?? 'true') === 'true';
  }
  return opts;
}

class PeerHost implements HostTransport {
  private conns = new Map<string, DataConnection>();
  private joins = new Listeners<[string]>();
  private leaves = new Listeners<[string]>();
  private msgs = new Listeners<[string, unknown]>();

  constructor(
    readonly code: string,
    private peer: PeerType,
  ) {
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this.joins.fire(conn.peer);
      });
      conn.on('data', (d) => this.msgs.fire(conn.peer, d));
      const drop = () => {
        if (this.conns.delete(conn.peer)) this.leaves.fire(conn.peer);
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });
    // Keep the room registered with the broker, otherwise joiners get "Room not found".
    // Mobile connections drop the signalling socket often (network switch, app in the
    // background while the code is shared), so retry until it is back.
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const revive = () => {
      if (peer.destroyed || !peer.disconnected || timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (peer.destroyed || !peer.disconnected) return;
        attempt++;
        try {
          peer.reconnect();
        } catch {
          /* retried below */
        }
        revive();
      }, reconnectDelay(attempt));
    };
    peer.on('open', () => (attempt = 0));
    peer.on('disconnected', revive);
    // Errors while reconnecting (e.g. id still held by the broker) are retried, not fatal.
    peer.on('error', revive);
    const wake = () => {
      attempt = 0;
      if (timer) clearTimeout(timer);
      timer = null;
      if (!peer.destroyed && peer.disconnected) peer.reconnect();
      revive();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
  }
  send(peerId: string, msg: unknown) {
    const c = this.conns.get(peerId);
    if (c?.open) c.send(msg);
  }
  broadcast(msg: unknown) {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }
  kick(peerId: string) {
    this.conns.get(peerId)?.close();
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
    this.peer.destroy();
  }
}

class PeerClient implements ClientTransport {
  private msgs = new Listeners<[unknown]>();
  private closes = new Listeners<[string]>();
  private done = false;
  constructor(
    private peer: PeerType,
    private conn: DataConnection,
  ) {
    conn.on('data', (d) => this.msgs.fire(d));
    conn.on('close', () => this.finish('Connection to host lost'));
    conn.on('error', () => this.finish('Connection error'));
  }
  private finish(reason: string) {
    if (this.done) return;
    this.done = true;
    this.closes.fire(reason);
    this.peer.destroy();
  }
  send(msg: unknown) {
    if (this.conn.open) this.conn.send(msg);
  }
  onMessage(cb: (m: unknown) => void) {
    this.msgs.add(cb);
  }
  onClose(cb: (r: string) => void) {
    this.closes.add(cb);
  }
  close() {
    this.finish('Left room');
  }
}

export const peerFactory: NetFactory = {
  kind: 'peer',
  async host() {
    const Peer = await loadPeer();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeRoomCode();
      const peer = new Peer(ID_PREFIX + code, peerOptions());
      const ok = await new Promise<boolean>((resolve, reject) => {
        peer.once('open', () => resolve(true));
        peer.once('error', (e: { type?: string; message?: string }) => {
          peer.destroy();
          if (e.type === 'unavailable-id') resolve(false);
          else reject(new Error(`Could not create room (${e.type ?? e.message ?? 'network'})`));
        });
      });
      if (ok) return new PeerHost(code, peer);
    }
    throw new Error('Could not allocate a room code, try again');
  },
  async join(code: string) {
    const Peer = await loadPeer();
    const peer = new Peer(peerOptions());
    return new Promise<ClientTransport>((resolve, reject) => {
      const fail = (msg: string) => {
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(msg));
      };
      const timer = setTimeout(
        () => fail('Timed out connecting – check both phones have a good connection and try again'),
        JOIN_TIMEOUT_MS,
      );
      let tries = 0;
      const connect = () => {
        const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
        conn.once('open', () => {
          clearTimeout(timer);
          resolve(new PeerClient(peer, conn));
        });
      };
      // "peer-unavailable" can be transient: the host's signalling link may be re-establishing.
      peer.on('error', (e: { type?: string }) => {
        if (e.type === 'peer-unavailable') {
          if (++tries <= JOIN_RETRIES) setTimeout(() => !peer.destroyed && connect(), JOIN_RETRY_MS);
          else fail('Room not found – check the code and that the host is still in the lobby');
        } else fail(`Connection failed (${e.type ?? 'network'})`);
      });
      peer.once('open', connect);
    });
  },
};
