// Room relay: hashcash-gated room creation, lobby/active states, byte rate cap.
// No game logic lives here; game messages are forwarded verbatim (see server.mjs for sockets).
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { WORDS } from './words.mjs';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_NAME = 24;
const MAX_RETURN_URL = 1024;

export const fail = (code, message) => Object.assign(new Error(message), { code });

export function leadingZeroBits(buf) {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export class Bucket {
  constructor(rateBps, now) {
    this.rate = rateBps;
    this.tokens = rateBps;
    this.at = now;
  }

  take(bytes, now) {
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (bytes > this.tokens) return false;
    this.tokens -= bytes;
    return true;
  }
}

const cleanName = (name, fallback) =>
  String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME) || fallback;

const cleanReturn = (value) => {
  const text = String(value ?? '').trim();
  if (!text || text.length > MAX_RETURN_URL) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
};

export class Relay {
  constructor({
    now = Date.now,
    hashcashBits = 19,
    roomTtlMs = 2 * 3600e3,
    idleTtlMs = 10 * 60e3,
    rateBps = 5 * 1024,
    maxPlayers = 12,
  } = {}) {
    this.now = now;
    this.hashcashBits = hashcashBits;
    this.roomTtlMs = roomTtlMs;
    this.idleTtlMs = idleTtlMs;
    this.rateBps = rateBps;
    this.maxPlayers = maxPlayers;
    this.rooms = new Map();
    this.challenges = new Map(); // challenge -> expiry
  }

  issueChallenge() {
    const challenge = randomBytes(16).toString('hex');
    this.challenges.set(challenge, this.now() + CHALLENGE_TTL_MS);
    return { challenge, bits: this.hashcashBits };
  }

  verifyProof(proof) {
    const text = String(proof ?? '');
    const sep = text.lastIndexOf(':');
    if (sep < 0) throw fail('bad-proof', 'malformed proof');
    const challenge = text.slice(0, sep);
    const counter = text.slice(sep + 1);
    if (!/^\d{1,20}$/.test(counter)) throw fail('bad-proof', 'malformed proof');
    const expiry = this.challenges.get(challenge);
    if (expiry === undefined || expiry < this.now()) throw fail('bad-proof', 'unknown or expired challenge');
    const bits = leadingZeroBits(createHash('sha256').update(text).digest());
    if (bits < this.hashcashBits) throw fail('bad-proof', 'not enough work');
    this.challenges.delete(challenge); // single use
  }

  create(proof, name, returnUrl = '', maxPlayers) {
    const now = this.now();
    this.verifyProof(proof);
    const limit = Number.isInteger(maxPlayers) ? maxPlayers : this.maxPlayers;
    const room = {
      id: this.#roomId(),
      createdAt: now,
      idleAt: now,
      started: false,
      host: null,
      returnUrl: cleanReturn(returnUrl),
      maxPlayers: Math.max(1, Math.min(this.maxPlayers, limit)),
      members: new Map(),
    };
    const member = this.#member(name, room, now);
    room.host = member.token;
    room.members.set(member.token, member);
    this.rooms.set(room.id, room);
    return { room, member };
  }

  join(roomId, token, name) {
    const room = this.rooms.get(String(roomId ?? '').trim().toLowerCase());
    if (!room) throw fail('no-room', 'room does not exist (yet) or expired');
    const existing = token && room.members.get(token);
    if (existing) {
      existing.name = cleanName(name, existing.name);
      return { room, member: existing, rejoin: true };
    }
    if (room.started) throw fail('closed', 'room already started');
    if (room.members.size >= room.maxPlayers) throw fail('full', 'room is full');
    const member = this.#member(name, room, this.now());
    room.members.set(member.token, member);
    return { room, member, rejoin: false };
  }

  start(roomId, token) {
    const room = this.rooms.get(roomId);
    if (!room) throw fail('no-room', 'room does not exist');
    if (room.host !== token) throw fail('forbidden', 'only the host can start');
    if (room.started) throw fail('started', 'already started');
    room.started = true;
    room.idleAt = this.now();
    return room;
  }

  kick(roomId, token, memberId) {
    const room = this.rooms.get(roomId);
    if (!room) throw fail('no-room', 'room does not exist');
    if (room.host !== token) throw fail('forbidden', 'only the host can remove players');
    const member = [...room.members.values()].find((m) => m.id === String(memberId ?? ''));
    if (!member) throw fail('no-member', 'player is not in this room');
    if (member.token === room.host) throw fail('forbidden', 'the host cannot remove themselves');
    // shortcut: a kicked player can rejoin with the room link; add a ban list if rooms go public
    room.members.delete(member.token);
    return { room, member };
  }

  say(roomId, token, data, bytes) {
    const room = this.rooms.get(roomId);
    const member = room?.members.get(token);
    if (!room || !member) throw fail('forbidden', 'not in this room');
    if (!room.started) throw fail('lobby', 'room not started yet');
    const now = this.now();
    if (!member.bucket.take(bytes, now)) return { room, member, recipients: [], limited: true };
    room.idleAt = now;
    return { room, member, recipients: [...room.members.values()].filter((m) => m !== member) };
  }

  sweep() {
    const now = this.now();
    const gone = [];
    for (const room of this.rooms.values()) {
      const reason =
        now - room.createdAt >= this.roomTtlMs ? 'room-timeout'
        : now - room.idleAt >= this.idleTtlMs ? 'idle-timeout'
        : null;
      if (reason) {
        this.rooms.delete(room.id);
        gone.push({ room, reason });
      }
    }
    for (const [challenge, expiry] of this.challenges) {
      if (expiry < now) this.challenges.delete(challenge);
    }
    return gone;
  }

  peers(room) {
    return [...room.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      host: m.token === room.host,
      online: !!m.ws,
    }));
  }

  #roomId() {
    let id;
    do {
      id = Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]).join('-');
    } while (this.rooms.has(id));
    return id;
  }

  #member(name, room, now) {
    return {
      token: randomUUID(),
      id: randomBytes(4).toString('hex'),
      name: cleanName(name, `Player ${room.members.size + 1}`),
      bucket: new Bucket(this.rateBps, now),
      ws: null,
    };
  }
}
