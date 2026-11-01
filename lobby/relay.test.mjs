import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Relay, Bucket, leadingZeroBits } from './relay.mjs';
import { WORDS } from './words.mjs';
import { sha256Hex, solve } from './public/hashcash.js';

const BITS = 8;

async function createRoom(relay, name = 'Host', returnUrl = '', maxPlayers) {
  const { challenge } = relay.issueChallenge();
  const proof = await solve(challenge, BITS);
  return relay.create(proof, name, returnUrl, maxPlayers);
}

test('browser sha256 matches node crypto', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(200)]) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'));
  }
});

test('proof needs work and is single use', async () => {
  const relay = new Relay({ hashcashBits: BITS });
  const { challenge } = relay.issueChallenge();
  assert.throws(() => relay.create(`${challenge}:0`), /not enough work/);

  const proof = await solve(challenge, BITS);
  relay.create(proof, 'Host');
  assert.throws(() => relay.create(proof, 'Again'), /unknown or expired challenge/);
});

test('expired challenge is rejected', async () => {
  let now = 1000;
  const relay = new Relay({ now: () => now, hashcashBits: BITS });
  const { challenge } = relay.issueChallenge();
  const proof = await solve(challenge, BITS);
  now += 6 * 60 * 1000;
  assert.throws(() => relay.create(proof, 'Host'), /expired/);
});

test('the room carries the return url to every participant', async () => {
  const relay = new Relay({ hashcashBits: BITS });
  const returnUrl = 'https://co3d.eu/dreiziehn/dreiziehn.html';
  const { room } = await createRoom(relay, 'Ada', returnUrl);
  assert.equal(room.returnUrl, returnUrl);
  relay.join(room.id, null, 'Bob');
  assert.equal(room.returnUrl, returnUrl);
});

test('a dangerous return url is dropped', async () => {
  const relay = new Relay({ hashcashBits: BITS });
  const { room } = await createRoom(relay, 'Ada', 'javascript:alert(1)');
  assert.equal(room.returnUrl, '');
});

test('a room enforces its own player limit', async () => {
  const relay = new Relay({ hashcashBits: BITS, maxPlayers: 12 });
  const { room } = await createRoom(relay, 'Host', '', 2);
  assert.equal(room.maxPlayers, 2);
  relay.join(room.id, null, 'Bob');
  assert.throws(() => relay.join(room.id, null, 'Cara'), /full/);
});

test('a room limit cannot exceed the server cap', async () => {
  const relay = new Relay({ hashcashBits: BITS, maxPlayers: 3 });
  const { room } = await createRoom(relay, 'Host', '', 99);
  assert.equal(room.maxPlayers, 3);
});

test('room ids are four EFF short words', async () => {
  const relay = new Relay({ hashcashBits: BITS });
  const { room } = await createRoom(relay);
  assert.ok(WORDS.every((word) => /^[a-z]+$/.test(word)), 'words must not contain the id separator');
  const words = room.id.split('-');
  assert.equal(words.length, 4);
  for (const word of words) assert.ok(WORDS.includes(word), word);
  assert.equal(relay.join(room.id.toUpperCase(), null, 'Bob').room, room);
});

test('only the host can remove players, and not themselves', async () => {
  const relay = new Relay({ hashcashBits: BITS });
  const { room, member: host } = await createRoom(relay, 'Ada');
  const { member: guest } = relay.join(room.id, null, 'Bob');

  assert.throws(() => relay.kick(room.id, guest.token, host.id), /only the host/);
  assert.throws(() => relay.kick(room.id, host.token, host.id), /themselves/);
  assert.throws(() => relay.kick(room.id, host.token, 'nope'), /not in this room/);

  const kicked = relay.kick(room.id, host.token, guest.id);
  assert.equal(kicked.member, guest);
  assert.deepEqual(relay.peers(room).map((p) => p.name), ['Ada']);
});

test('lobby join, host-only start, relay only after start', async () => {
  const relay = new Relay({ hashcashBits: BITS, rateBps: 1000 });
  const { room, member: host } = await createRoom(relay, 'Ada');
  const { member: guest } = relay.join(room.id, null, 'Bob');

  assert.deepEqual(relay.peers(room).map((p) => p.name), ['Ada', 'Bob']);
  assert.equal(relay.peers(room).find((p) => p.host).name, 'Ada');
  assert.throws(() => relay.say(room.id, host.token, { text: 'hi' }, 10), /not started/);
  assert.throws(() => relay.start(room.id, guest.token), /only the host/);

  relay.start(room.id, host.token);
  const out = relay.say(room.id, host.token, { text: 'hi' }, 10);
  assert.deepEqual(out.recipients.map((m) => m.name), ['Bob']);
  assert.equal(relay.say(room.id, guest.token, { text: 'yo' }, 10).recipients[0].name, 'Ada');
});

test('started room rejects new players but lets a known token rejoin', async () => {
  const relay = new Relay({ hashcashBits: BITS });
  const { room, member: host } = await createRoom(relay);
  const { member: guest } = relay.join(room.id, null, 'Bob');
  relay.start(room.id, host.token);

  assert.throws(() => relay.join(room.id, null, 'Eve'), /already started/);
  const again = relay.join(room.id, guest.token, 'Bob');
  assert.equal(again.rejoin, true);
  assert.equal(again.member, guest);
});

test('unknown room and stray token', async () => {
  const relay = new Relay({ hashcashBits: BITS });
  assert.throws(() => relay.join('nope', null, 'X'), /does not exist/);
  const { room } = await createRoom(relay);
  assert.throws(() => relay.say(room.id, 'nope', {}, 1), /not in this room/);
});

test('byte bucket drops over-rate messages and refills', () => {
  const bucket = new Bucket(100, 0);
  assert.equal(bucket.take(80, 0), true);
  assert.equal(bucket.take(80, 0), false);
  assert.equal(bucket.take(80, 1000), true); // one second refills 100 bytes
});

test('rate limit applies per participant', async () => {
  const relay = new Relay({ hashcashBits: BITS, rateBps: 100 });
  const { room, member: host } = await createRoom(relay);
  relay.join(room.id, null, 'Bob');
  relay.start(room.id, host.token);

  assert.equal(relay.say(room.id, host.token, {}, 80).limited, undefined);
  assert.equal(relay.say(room.id, host.token, {}, 80).limited, true);
});

test('sweep drops rooms after the idle timeout', async () => {
  let now = 0;
  const relay = new Relay({ now: () => now, hashcashBits: BITS, idleTtlMs: 100, roomTtlMs: 10_000 });
  const { room } = await createRoom(relay);
  now = 150;
  assert.deepEqual(relay.sweep().map((g) => [g.room.id, g.reason]), [[room.id, 'idle-timeout']]);
  assert.equal(relay.rooms.size, 0);
});

test('sweep drops rooms after the global timeout even when active', async () => {
  let now = 0;
  const relay = new Relay({ now: () => now, hashcashBits: BITS, idleTtlMs: 10_000, roomTtlMs: 1000 });
  const { room, member: host } = await createRoom(relay);
  relay.start(room.id, host.token);
  now = 900;
  relay.say(room.id, host.token, {}, 1); // activity does not extend the global ttl
  now = 1001;
  assert.deepEqual(relay.sweep().map((g) => g.reason), ['room-timeout']);
});
