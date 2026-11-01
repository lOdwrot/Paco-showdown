# Networking

## Model
The **host is authoritative**. The host's browser runs `Match` at 60 Hz and broadcasts a full
`Snapshot` (~2 KB JSON) at 30 Hz. Clients send only their desired direction when it changes, and
they render by interpolating between the last two snapshots. Sound events carry sequence numbers,
and every snapshot repeats the last ~1.5 s of events, so dropped or merged snapshots don't lose
sounds.

## Layers
```
session/hostRoom.ts, session/clientRoom.ts   ← game protocol (net/protocol.ts), transport-agnostic
net/transport.ts                             ← HostTransport / ClientTransport / NetFactory
net/peerTransport.ts   WebRTC via PeerJS (default)
net/wsTransport.ts     WebSocket via server/relay.ts
net/localTransport.ts  BroadcastChannel (same-browser tabs, tests)
```
Pick the transport at runtime with `?net=peer|ws|local`, or at build time with `VITE_NET`.

### WebRTC (PeerJS)
* Room code `ABCDE` maps to PeerJS id `paco-showdown-v1-ABCDE`. Signalling uses the public PeerJS
  cloud broker by default. To self-host it (`npx peerjs --port 9000`), set `VITE_PEER_HOST`,
  `VITE_PEER_PORT`, `VITE_PEER_PATH`, and `VITE_PEER_SECURE`.
* Data channels are reliable and use JSON serialisation.
* **Mobile networks**: the host keeps retrying the signalling connection (backoff, plus on
  `online`/tab-visible events) so the room stays registered; joiners retry "peer-unavailable" for
  ~7 s before showing "Room not found". PeerJS's default STUN/TURN servers are used. For strict
  carrier NATs set `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` at build time to add your own
  TURN relay.

### Switching to a WebSocket server
1. Run `npm run relay` (Node, `ws`, `PORT` env var, default 8787) somewhere reachable.
2. Build with `VITE_NET=ws VITE_RELAY_URL=wss://your-relay` or open `?net=ws&relay=wss://…`.
The relay only routes messages. To make the server authoritative instead, run `Match` in Node,
since `src/game` has no DOM dependencies, and send the same `HostMsg` messages.

## Protocol (`net/protocol.ts`, version 2)
Client → host: `hello{v, profile}`, `profile{profile}` (lobby only), `input{dir}`, `ping{at}`.
Host → client: `welcome{id, code}`, `reject{reason}`, `lobby{players}`, `start`,
`snap{s: Snapshot}`, `end{reason}`, `pong{at}`.
The host validates every inbound message: it sanitises nicknames and checks skins against the
catalog.
