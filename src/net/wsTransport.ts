import { Listeners, type ClientTransport, type HostTransport, type NetFactory } from './transport.ts';

/**
 * WebSocket transport. Talks to the tiny relay in server/relay.ts which only
 * routes messages between a room's host and its clients (the game still runs
 * on the host browser). Relay URL: ?relay=ws://host:port, VITE_RELAY_URL, or
 * ws(s)://<page host>:8787.
 *
 * Relay wire protocol (JSON):
 *   → {op:'host'}                      ← {op:'hosted', code}
 *   → {op:'join', code}                ← {op:'joined', id} | {op:'error', reason}
 *   → {op:'send', to?, data}           (host: to = peer id or omitted = broadcast)
 *   → {op:'kick', id}
 *   ← {op:'peerJoin', id} / {op:'peerLeave', id} / {op:'msg', from?, data} / {op:'closed', reason}
 */
export function relayUrl(): string {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('relay') : null;
  if (q) return q;
  const env = import.meta.env?.VITE_RELAY_URL as string | undefined;
  if (env) return env;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:';
  const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
  return `${secure ? 'wss' : 'ws'}://${host}:8787`;
}

type RelayIn =
  | { op: 'hosted'; code: string }
  | { op: 'joined'; id: string }
  | { op: 'error'; reason: string }
  | { op: 'peerJoin'; id: string }
  | { op: 'peerLeave'; id: string }
  | { op: 'msg'; from?: string; data: unknown }
  | { op: 'closed'; reason: string };

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`Cannot reach relay at ${url}`));
  });
}

function firstReply(ws: WebSocket): Promise<RelayIn> {
  return new Promise((resolve) => {
    ws.onmessage = (e) => resolve(JSON.parse(String(e.data)) as RelayIn);
  });
}

class WsHost implements HostTransport {
  private joins = new Listeners<[string]>();
  private leaves = new Listeners<[string]>();
  private msgs = new Listeners<[string, unknown]>();
  constructor(
    readonly code: string,
    private ws: WebSocket,
  ) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as RelayIn;
      if (m.op === 'peerJoin') this.joins.fire(m.id);
      else if (m.op === 'peerLeave') this.leaves.fire(m.id);
      else if (m.op === 'msg' && m.from) this.msgs.fire(m.from, m.data);
    };
  }
  private out(o: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }
  send(peerId: string, msg: unknown) {
    this.out({ op: 'send', to: peerId, data: msg });
  }
  broadcast(msg: unknown) {
    this.out({ op: 'send', data: msg });
  }
  kick(peerId: string) {
    this.out({ op: 'kick', id: peerId });
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
    this.ws.close();
  }
}

class WsClient implements ClientTransport {
  private msgs = new Listeners<[unknown]>();
  private closes = new Listeners<[string]>();
  private done = false;
  constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as RelayIn;
      if (m.op === 'msg') this.msgs.fire(m.data);
      else if (m.op === 'closed') this.finish(m.reason);
    };
    ws.onclose = () => this.finish('Connection to relay lost');
  }
  private finish(r: string) {
    if (this.done) return;
    this.done = true;
    this.closes.fire(r);
    this.ws.close();
  }
  send(msg: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op: 'send', data: msg }));
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

export function createWsFactory(url: () => string = relayUrl): NetFactory {
  return {
    kind: 'ws',
    async host() {
      const ws = await open(url());
      const reply = firstReply(ws);
      ws.send(JSON.stringify({ op: 'host' }));
      const m = await reply;
      if (m.op !== 'hosted') throw new Error(m.op === 'error' ? m.reason : 'Relay refused');
      return new WsHost(m.code, ws);
    },
    async join(code: string) {
      const ws = await open(url());
      const reply = firstReply(ws);
      ws.send(JSON.stringify({ op: 'join', code }));
      const m = await reply;
      if (m.op !== 'joined') {
        ws.close();
        throw new Error(m.op === 'error' ? m.reason : 'Relay refused');
      }
      return new WsClient(ws);
    },
  };
}

export const wsFactory = createWsFactory();
