import { afterEach, describe, expect, it } from 'vitest';
import { localFactory } from '../src/net/localTransport.ts';
import { HostRoom } from '../src/session/hostRoom.ts';
import { ClientRoom } from '../src/session/clientRoom.ts';
import { parseClientMsg, sanitizeNick } from '../src/net/protocol.ts';
import { isValidRoomCode, makeRoomCode } from '../src/net/roomCode.ts';
import { SIM_DT } from '../src/config.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (pred: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await wait(5);
  }
};

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

describe('protocol', () => {
  it('rejects junk and sanitises profiles', () => {
    expect(parseClientMsg(null)).toBeNull();
    expect(parseClientMsg({ t: 'input', dir: 'sideways' })).toBeNull();
    expect(parseClientMsg({ t: 'input', dir: 'up' })).toEqual({ t: 'input', dir: 'up' });
    expect(parseClientMsg({ t: 'profile', profile: { nick: 'x', pacSkin: 'girl', ghostSkin: '??' } })).toEqual({
      t: 'profile',
      profile: { nick: 'X', pacSkin: 'girl', ghostSkin: 'blaze' },
    });
    const h = parseClientMsg({ t: 'hello', v: 1, profile: { nick: '<script>evil</script>long', pacSkin: 'nope' } });
    expect(h).toMatchObject({ t: 'hello', profile: { pacSkin: 'classic', ghostSkin: 'blaze' } });
    expect(sanitizeNick('')).toBe('PLAYER');
    expect(isValidRoomCode(makeRoomCode())).toBe(true);
  });
});

describe('multiplayer over local transport', () => {
  it('lobby → start → snapshots and inputs flow both ways', async () => {
    const hostT = await localFactory.host();
    const host = new HostRoom(hostT, { nick: 'HOST', pacSkin: 'president', ghostSkin: 'count' });
    cleanups.push(() => hostT.close());

    const c1 = new ClientRoom(await localFactory.join(hostT.code), { nick: 'ANA', pacSkin: 'girl', ghostSkin: 'wisp' });
    const c2 = new ClientRoom(await localFactory.join(hostT.code), { nick: 'BOB', pacSkin: 'punk', ghostSkin: 'pirate' });
    cleanups.push(() => c1.dispose(), () => c2.dispose());

    await until(() => host.players.length === 3 && c2.players.length === 3);
    expect(c1.myId).not.toBe('');
    expect(c1.players.map((p) => p.nick)).toEqual(['HOST', 'ANA', 'BOB']);

    // Lobby: players can still change nickname / characters.
    c2.updateProfile({ nick: 'BOBBY', pacSkin: 'ninja', ghostSkin: 'sirspook' });
    host.updateProfile({ nick: 'BOSS', pacSkin: 'president', ghostSkin: 'count' });
    await until(() => c1.players.some((p) => p.nick === 'BOBBY') && c1.players[0]!.nick === 'BOSS');
    expect(host.players.find((p) => p.nick === 'BOBBY')).toMatchObject({ pacSkin: 'ninja', ghostSkin: 'sirspook' });
    c2.updateProfile({ nick: 'BOB', pacSkin: 'punk', ghostSkin: 'pirate' });
    await until(() => host.players.some((p) => p.nick === 'BOB'));

    host.start();
    await until(() => c1.started && c2.started && !!c1.view());
    const s = c1.view()!;
    expect(s.mode).toBe('multi');
    expect(s.phase).toBe('roleReveal');
    expect(s.players.find((p) => p.id === c1.myId)!.role).toBe('ghost');
    expect(s.ghosts[0]!.skin).toBe('wisp');

    // Client input reaches the host's match.
    c1.setInput('left');
    await until(() => (host.match as unknown as { inputs: Map<string, string> }).inputs.get(c1.myId) === 'left');

    // Host simulation advances and clients receive later snapshots.
    for (let i = 0; i < 30; i++) host.update(SIM_DT);
    await until(() => c2.view()!.tick >= 20);

    // A ghost player leaving becomes AI.
    c2.dispose();
    await until(() => host.match!.snapshot().players.find((p) => p.nick === 'BOB')!.connected === false);
    expect(host.match!.ghostOwners.filter(Boolean)).toHaveLength(1);
  });

  it('after a match the room returns to the lobby and can start a new game', async () => {
    const hostT = await localFactory.host();
    const host = new HostRoom(hostT, { nick: 'HOST', pacSkin: 'king', ghostSkin: 'gking' });
    cleanups.push(() => hostT.close());
    const c1 = new ClientRoom(await localFactory.join(hostT.code), { nick: 'ANA', pacSkin: 'queen', ghostSkin: 'gqueen' });
    const c2 = new ClientRoom(await localFactory.join(hostT.code), { nick: 'BOB', pacSkin: 'punk', ghostSkin: 'pirate' });
    cleanups.push(() => c1.dispose(), () => c2.dispose());
    await until(() => host.players.length === 3);

    host.start();
    await until(() => c1.started && !!c1.view());
    for (let i = 0; i < 10; i++) host.update(SIM_DT);
    c2.dispose();
    await until(() => host.match!.snapshot().players.find((p) => p.nick === 'BOB')!.connected === false);

    // The final snapshot reaches clients even between regular 30 Hz sends.
    const m = host.match! as unknown as { phase: string; phaseLeft: number };
    m.phase = 'gameOver';
    m.phaseLeft = 0.001;
    host.update(SIM_DT / 2);
    host.update(SIM_DT);
    expect(host.over).toBe(true);
    await until(() => c1.over);

    // Profile picked on the podium (while the match still exists) is applied after the reset.
    c1.updateProfile({ nick: 'ANA', pacSkin: 'girl', ghostSkin: 'wisp' });
    let resets = 0;
    c1.onReset = () => resets++;
    host.backToLobby();
    expect(host.match).toBeNull();
    await until(() => resets === 1 && !c1.started && c1.view() === null);
    await until(() => host.players.find((p) => p.nick === 'ANA')?.pacSkin === 'girl');
    expect(host.players.map((p) => p.nick)).toEqual(['HOST', 'ANA']); // leaver dropped

    // New players can join the same room again, and a fresh match starts.
    const c3 = new ClientRoom(await localFactory.join(hostT.code), { nick: 'CY', pacSkin: 'cool', ghostSkin: 'frosty' });
    cleanups.push(() => c3.dispose());
    await until(() => host.players.length === 3 && c1.players.length === 3);
    host.start();
    await until(() => c1.started && c3.started && !!c1.view() && !!c3.view());
    expect(c1.view()!.phase).toBe('roleReveal');
    expect(c1.view()!.players.map((p) => p.nick)).toEqual(['HOST', 'ANA', 'CY']);
  });

  it('joining a missing room fails with a readable error', async () => {
    await expect(localFactory.join('ZZZZZ')).rejects.toThrow('Room not found');
  });
});

describe('multiplayer over the WebSocket relay', () => {
  it('routes lobby and snapshots through server/relay.ts', async () => {
    const { startRelay } = await import('../server/relay.ts');
    const { createWsFactory } = await import('../src/net/wsTransport.ts');
    const relay = startRelay(18787);
    cleanups.push(() => void relay.close());
    const f = createWsFactory(() => 'ws://127.0.0.1:18787');
    const hostT = await f.host();
    const host = new HostRoom(hostT, { nick: 'H', pacSkin: 'classic', ghostSkin: 'blaze' });
    const c = new ClientRoom(await f.join(hostT.code), { nick: 'C', pacSkin: 'cool', ghostSkin: 'frosty' });
    cleanups.push(() => c.dispose(), () => hostT.close());
    await until(() => c.players.length === 2);
    host.start();
    await until(() => !!c.view());
    c.setInput('up');
    await until(() => (host.match as unknown as { inputs: Map<string, string> }).inputs.get(c.myId) === 'up');
    await expect(f.join('NOPE1')).rejects.toThrow('Room not found');
  });
});

describe('peer reconnect backoff', () => {
  it('grows and is capped', async () => {
    const { reconnectDelay } = await import('../src/net/peerTransport.ts');
    expect([0, 1, 2, 3, 10].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 5000]);
  });
});
