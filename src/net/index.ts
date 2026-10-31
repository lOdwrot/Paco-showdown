import type { NetFactory, NetKind } from './transport.ts';
import { peerFactory } from './peerTransport.ts';
import { wsFactory } from './wsTransport.ts';
import { localFactory } from './localTransport.ts';

const FACTORIES: Record<NetKind, NetFactory> = { peer: peerFactory, ws: wsFactory, local: localFactory };

/** Picks the transport: ?net=peer|ws|local, else VITE_NET, else WebRTC (peer). */
export function getNetFactory(kind?: NetKind): NetFactory {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('net') : null;
  const k = (kind ?? q ?? import.meta.env?.VITE_NET ?? 'peer') as NetKind;
  return FACTORIES[k] ?? peerFactory;
}

export type { NetFactory, NetKind, HostTransport, ClientTransport } from './transport.ts';
