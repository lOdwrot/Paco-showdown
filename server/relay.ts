/**
 * Paco Showdown WebSocket relay (optional alternative to WebRTC).
 * It only routes JSON messages between a room's host and its clients; the game
 * itself still runs in the host's browser. Run: `npm run relay` (PORT=8787).
 * Clients use it with ?net=ws (and ?relay=ws://host:port if not same host).
 * Wire protocol: see src/net/wsTransport.ts.
 */
import { WebSocketServer, type WebSocket } from 'ws';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CLIENTS_PER_ROOM = 8;
const MAX_MSG_BYTES = 64 * 1024;

interface Room {
  code: string;
  host: WebSocket;
  clients: Map<string, WebSocket>;
}

export function startRelay(port: number): { close(): Promise<void>; port: number } {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ port, maxPayload: MAX_MSG_BYTES });
  let nextId = 1;

  const out = (ws: WebSocket, o: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(o));
  };
  const newCode = () => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
  };

  wss.on('connection', (ws) => {
    let role: { kind: 'host'; room: Room } | { kind: 'client'; room: Room; id: string } | null = null;

    ws.on('message', (buf) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(buf));
      } catch {
        return;
      }
      if (!role) {
        if (m.op === 'host') {
          const room: Room = { code: newCode(), host: ws, clients: new Map() };
          rooms.set(room.code, room);
          role = { kind: 'host', room };
          out(ws, { op: 'hosted', code: room.code });
        } else if (m.op === 'join') {
          const room = rooms.get(String(m.code ?? '').toUpperCase());
          if (!room) return out(ws, { op: 'error', reason: 'Room not found' });
          if (room.clients.size >= MAX_CLIENTS_PER_ROOM) return out(ws, { op: 'error', reason: 'Room is full' });
          const id = `p${nextId++}`;
          room.clients.set(id, ws);
          role = { kind: 'client', room, id };
          out(ws, { op: 'joined', id });
          out(room.host, { op: 'peerJoin', id });
        }
        return;
      }
      if (role.kind === 'host') {
        if (m.op === 'send') {
          if (typeof m.to === 'string') {
            const c = role.room.clients.get(m.to);
            if (c) out(c, { op: 'msg', data: m.data });
          } else {
            const frame = JSON.stringify({ op: 'msg', data: m.data });
            for (const c of role.room.clients.values()) if (c.readyState === c.OPEN) c.send(frame);
          }
        } else if (m.op === 'kick' && typeof m.id === 'string') {
          const c = role.room.clients.get(m.id);
          if (c) {
            out(c, { op: 'closed', reason: 'Removed from room' });
            c.close();
          }
        }
      } else if (m.op === 'send') {
        out(role.room.host, { op: 'msg', from: role.id, data: m.data });
      }
    });

    ws.on('close', () => {
      if (!role) return;
      if (role.kind === 'host') {
        for (const c of role.room.clients.values()) {
          out(c, { op: 'closed', reason: 'Host closed the room' });
          c.close();
        }
        rooms.delete(role.room.code);
      } else if (role.room.clients.delete(role.id)) {
        out(role.room.host, { op: 'peerLeave', id: role.id });
      }
    });
  });

  return {
    port,
    close: () => new Promise<void>((r) => wss.close(() => r())),
  };
}

const isMain = typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  startRelay(port);
  console.log(`Paco Showdown relay listening on ws://0.0.0.0:${port}`);
}
