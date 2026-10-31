import { GHOST_SKINS, PAC_SKINS } from '../skins/catalog.ts';
import type { Snapshot } from '../game/snapshot.ts';
import { isDir, type Dir } from '../game/types.ts';

/**
 * Application protocol between host and clients (transport-agnostic).
 * Bump PROTOCOL_VERSION on breaking changes. Every inbound message is validated
 * by parseClientMsg / parseHostMsg – never trust the wire.
 */
export const PROTOCOL_VERSION = 1;
export const NICK_MAX = 10;

export interface Profile {
  nick: string;
  pacSkin: string;
  ghostSkin: string;
}

export interface LobbyPlayer extends Profile {
  id: string;
  isHost: boolean;
}

export type ClientMsg =
  | { t: 'hello'; v: number; profile: Profile }
  | { t: 'input'; dir: Dir | null }
  | { t: 'ping'; at: number };

export type HostMsg =
  | { t: 'welcome'; id: string; code: string }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; players: LobbyPlayer[] }
  | { t: 'start' }
  | { t: 'snap'; s: Snapshot }
  | { t: 'end'; reason: string }
  | { t: 'pong'; at: number };

export function sanitizeNick(n: unknown): string {
  const s = typeof n === 'string' ? n : '';
  const clean = s
    .toUpperCase()
    .replace(/[^A-Z0-9 _\-!?.]/g, '')
    .trim()
    .slice(0, NICK_MAX);
  return clean || 'PLAYER';
}

export function sanitizeProfile(p: unknown): Profile {
  const o = (p ?? {}) as Record<string, unknown>;
  const pac = PAC_SKINS.some((s) => s.id === o.pacSkin) ? (o.pacSkin as string) : PAC_SKINS[0]!.id;
  const ghost = GHOST_SKINS.some((s) => s.id === o.ghostSkin) ? (o.ghostSkin as string) : GHOST_SKINS[0]!.id;
  return { nick: sanitizeNick(o.nick), pacSkin: pac, ghostSkin: ghost };
}

export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return typeof m.v === 'number' ? { t: 'hello', v: m.v, profile: sanitizeProfile(m.profile) } : null;
    case 'input':
      return m.dir === null || isDir(m.dir) ? { t: 'input', dir: m.dir as Dir | null } : null;
    case 'ping':
      return typeof m.at === 'number' ? { t: 'ping', at: m.at } : null;
    default:
      return null;
  }
}

/** Host messages are trusted more (the host runs the game) but still shape-checked. */
export function parseHostMsg(raw: unknown): HostMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'welcome':
      return typeof m.id === 'string' && typeof m.code === 'string' ? (m as HostMsg) : null;
    case 'reject':
    case 'end':
      return typeof m.reason === 'string' ? (m as HostMsg) : null;
    case 'lobby':
      return Array.isArray(m.players) ? (m as HostMsg) : null;
    case 'start':
      return { t: 'start' };
    case 'snap':
      return m.s && typeof m.s === 'object' && typeof (m.s as Snapshot).tick === 'number' ? (m as HostMsg) : null;
    case 'pong':
      return typeof m.at === 'number' ? (m as HostMsg) : null;
    default:
      return null;
  }
}
