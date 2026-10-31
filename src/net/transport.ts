/**
 * Transport abstraction. The game only talks to these interfaces, so swapping
 * WebRTC (PeerJS) for a WebSocket relay or BroadcastChannel is a factory change.
 * Messages are plain JSON-serialisable values; validation happens in protocol.ts.
 *
 * To add a transport: implement NetFactory and register it in net/index.ts.
 */
export interface HostTransport {
  /** Room code clients use to join. */
  readonly code: string;
  send(peerId: string, msg: unknown): void;
  broadcast(msg: unknown): void;
  /** Drop a peer (e.g. room full). */
  kick(peerId: string): void;
  onPeerJoin(cb: (peerId: string) => void): void;
  onPeerLeave(cb: (peerId: string) => void): void;
  onMessage(cb: (peerId: string, msg: unknown) => void): void;
  close(): void;
}

export interface ClientTransport {
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

export interface NetFactory {
  readonly kind: NetKind;
  /** Creates a room and resolves once clients can join. */
  host(): Promise<HostTransport>;
  /** Connects to a room; rejects with a readable Error if it can't. */
  join(code: string): Promise<ClientTransport>;
}

export type NetKind = 'peer' | 'ws' | 'local';

/** Tiny multi-listener helper used by transport implementations. */
export class Listeners<A extends unknown[]> {
  private fns: ((...a: A) => void)[] = [];
  add(fn: (...a: A) => void): void {
    this.fns.push(fn);
  }
  fire(...a: A): void {
    for (const f of this.fns) {
      try {
        f(...a);
      } catch (e) {
        console.error(e);
      }
    }
  }
  clear(): void {
    this.fns = [];
  }
}
