import * as crypto from "node:crypto";
import { db, type VercelPoolClient } from "@vercel/postgres";

type FriendshipStatus = "pending" | "accepted";
type RoomStatus = "lobby" | "countdown" | "playing" | "results";

interface ProfileRecentRun { id: string; songId?: string; songName: string; artist: string; score: number; accuracy: number; fullCombo: boolean; playedAt: string; }
interface ProfileStats { level: number; xp: number; achievements: string[]; favoriteSongIds: string[]; recentRuns: ProfileRecentRun[]; pulseShards: number; selectedAvatar: string; selectedBadge?: string; selectedTitle: string; selectedFrame: string; selectedTitleColor?: string; }
interface PlayerProfile { id: string; username: string; friendCode: string; createdAt: string; lastSeen: string; blockedIds: string[]; credentialHash?: string; stats?: ProfileStats; }
interface FriendshipRecord { id: string; requesterId: string; addresseeId: string; status: FriendshipStatus; createdAt: string; updatedAt: string; }
interface SocialMessage { id: string; senderId: string; recipientId?: string; roomId?: string; body: string; kind: "text" | "invite" | "system"; roomCode?: string; createdAt: string; readAt?: string; }
interface RoomParticipant { playerId: string; username: string; ready: boolean; score: number; combo: number; accuracy: number; progress: number; finished: boolean; joinedAt: string; updatedAt: string; }
interface RoomSpectator { playerId: string; username: string; joinedAt: string; }
interface MultiplayerRoom { id: string; code: string; hostId: string; songId: string; status: RoomStatus; startAt?: string; createdAt: string; updatedAt: string; maxPlayers: number; participants: RoomParticipant[]; spectators?: RoomSpectator[]; rematchVotes?: string[]; }
interface SocialState { profiles: PlayerProfile[]; friendships: FriendshipRecord[]; messages: SocialMessage[]; rooms: MultiplayerRoom[]; }
interface ApiResult { status: number; data?: unknown; error?: string; persist?: boolean; }

const EMPTY_STATE: SocialState = { profiles: [], friendships: [], messages: [], rooms: [] };

function ok(data: unknown, persist = true): ApiResult {
  return { status: 200, data, persist };
}

function fail(status: number, error: string, persist = false): ApiResult {
  return { status, error, persist };
}

function clampNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseBody(req: any): Record<string, unknown> {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  if (typeof req.body === "string" && req.body.trim()) {
    try { return JSON.parse(req.body) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function queryValue(req: any, key: string) {
  const value = req.query?.[key];
  if (Array.isArray(value)) return String(value[0] || "");
  if (value !== undefined && value !== null) return String(value);
  try { return new URL(typeof req.url === "string" ? req.url : "/api/social", "http://localhost").searchParams.get(key) || ""; }
  catch { return ""; }
}

function headerValue(req: any, name: string) {
  const header = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(header) ? String(header[0] || "") : typeof header === "string" ? header : "";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function username(value: unknown) {
  return typeof value === "string" ? (value.trim().replace(/\s+/g, " ").slice(0, 24) || "Player") : "Player";
}

function profileStats(value: unknown): ProfileStats {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const recentRuns = Array.isArray(source.recentRuns) ? source.recentRuns.slice(0, 12).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const run = entry as Record<string, unknown>;
    const songName = text(run.songName).slice(0, 100);
    if (!songName) return [];
    return [{
      id: text(run.id).slice(0, 100) || crypto.randomUUID(),
      songId: text(run.songId).slice(0, 100) || undefined,
      songName,
      artist: text(run.artist).slice(0, 100) || "Unknown Artist",
      score: Math.max(0, Math.round(clampNumber(run.score, 0))),
      accuracy: Math.max(0, Math.min(100, clampNumber(run.accuracy, 0))),
      fullCombo: run.fullCombo === true,
      playedAt: text(run.playedAt) || new Date().toISOString(),
    }];
  }) : [];
  return {
    level: Math.max(1, Math.min(999, Math.round(clampNumber(source.level, 1)))),
    xp: Math.max(0, Math.min(10_000_000, Math.round(clampNumber(source.xp, 0)))),
    achievements: Array.isArray(source.achievements) ? Array.from(new Set(source.achievements.flatMap((entry) => typeof entry === "string" ? [entry.slice(0, 80)] : []))).slice(0, 40) : [],
    favoriteSongIds: Array.isArray(source.favoriteSongIds) ? Array.from(new Set(source.favoriteSongIds.flatMap((entry) => typeof entry === "string" && entry.length <= 100 ? [entry] : []))).slice(0, 12) : [],
    recentRuns,
    pulseShards: Math.max(0, Math.min(10_000_000, Math.round(clampNumber(source.pulseShards, 0)))),
    selectedAvatar: ["pulse", "wave", "comet", "vinyl", "prism", "nova", "synth", "echo"].includes(text(source.selectedAvatar)) ? text(source.selectedAvatar) : "pulse",
    selectedBadge: ["rookie", "combo", "crown"].includes(text(source.selectedBadge)) ? text(source.selectedBadge) : undefined,
    selectedTitle: ["newcomer", "beat-chaser", "pulse-weaver", "rhythm-legend"].includes(text(source.selectedTitle)) ? text(source.selectedTitle) : "newcomer",
    selectedFrame: ["standard", "ripple", "crown", "prism", "orbit"].includes(text(source.selectedFrame)) ? text(source.selectedFrame) : "standard",
    selectedTitleColor: ["violet", "cyan", "gold"].includes(text(source.selectedTitleColor)) ? text(source.selectedTitleColor) : "violet",
  };
}

function createFriendCode(name: string, profiles: PlayerProfile[]) {
  const prefix = name.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase() || "PLAYER";
  let code = "";
  do { code = `${prefix}#${crypto.randomInt(1000, 10000)}`; } while (profiles.some((profile) => profile.friendCode === code));
  return code;
}

function touchProfile(state: SocialState, playerId: unknown, rawUsername: unknown, token: unknown): PlayerProfile | null {
  const id = text(playerId);
  if (!id || id.length > 100 || typeof token !== "string" || token.length < 32 || token.length > 200) return null;
  const now = new Date().toISOString();
  const nextUsername = username(rawUsername);
  const credentialHash = crypto.createHash("sha256").update(token).digest("hex");
  let profile = state.profiles.find((entry) => entry.id === id);
  if (!profile) {
    profile = { id, username: nextUsername, friendCode: createFriendCode(nextUsername, state.profiles), createdAt: now, lastSeen: now, blockedIds: [], credentialHash };
    state.profiles.push(profile);
    return profile;
  }

  if (profile.credentialHash) {
    const provided = Buffer.from(credentialHash, "utf8");
    const expected = Buffer.from(profile.credentialHash, "utf8");
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  } else {
    profile.credentialHash = credentialHash;
  }
  profile.username = nextUsername;
  profile.lastSeen = now;
  profile.blockedIds = Array.isArray(profile.blockedIds) ? profile.blockedIds : [];
  state.rooms.forEach((room) => room.participants.forEach((participant) => {
    if (participant.playerId === id) participant.username = nextUsername;
  }));
  return profile;
}

function areFriends(state: SocialState, firstId: string, secondId: string) {
  return state.friendships.some((friendship) => friendship.status === "accepted" && (
    (friendship.requesterId === firstId && friendship.addresseeId === secondId) ||
    (friendship.requesterId === secondId && friendship.addresseeId === firstId)
  ));
}

function publicProfile(profile: PlayerProfile, state: SocialState) {
  const activeRoom = state.rooms.find((room) => room.status !== "results" && (room.participants.some((participant) => participant.playerId === profile.id) || room.spectators?.some((spectator) => spectator.playerId === profile.id)));
  const age = Date.now() - new Date(profile.lastSeen).getTime();
  const stats = profileStats(profile.stats);
  return {
    id: profile.id,
    username: profile.username,
    friendCode: profile.friendCode,
    status: activeRoom?.status === "playing" || activeRoom?.status === "countdown" ? "in-game" : age < 45_000 ? "online" : "offline",
    lastSeen: profile.lastSeen,
    ...stats,
  };
}

function snapshot(state: SocialState, playerId: string) {
  const self = state.profiles.find((profile) => profile.id === playerId);
  if (!self) return null;
  const friends = state.friendships
    .filter((friendship) => friendship.status === "accepted" && (friendship.requesterId === playerId || friendship.addresseeId === playerId))
    .flatMap((friendship) => {
      const friendId = friendship.requesterId === playerId ? friendship.addresseeId : friendship.requesterId;
      const profile = state.profiles.find((entry) => entry.id === friendId);
      if (!profile) return [];
      const unread = state.messages.filter((message) => message.senderId === friendId && message.recipientId === playerId && !message.readAt).length;
      return [{ ...publicProfile(profile, state), friendshipId: friendship.id, unread }];
    });
  const pending = (incoming: boolean) => state.friendships
    .filter((friendship) => friendship.status === "pending" && (incoming ? friendship.addresseeId === playerId : friendship.requesterId === playerId))
    .flatMap((friendship) => {
      const profile = state.profiles.find((entry) => entry.id === (incoming ? friendship.requesterId : friendship.addresseeId));
      return profile ? [{ ...publicProfile(profile, state), friendshipId: friendship.id }] : [];
    });
  return {
    self: publicProfile(self, state),
    friends,
    pendingIncoming: pending(true),
    pendingOutgoing: pending(false),
    activeRoom: state.rooms.find((room) => room.participants.some((participant) => participant.playerId === playerId) || room.spectators?.some((spectator) => spectator.playerId === playerId)) || null,
    unreadCount: friends.reduce((total, friend) => total + friend.unread, 0),
  };
}

function roomForPlayer(state: SocialState, roomId: string, playerId: string) {
  const room = state.rooms.find((entry) => entry.id === roomId);
  return room?.participants.some((participant) => participant.playerId === playerId) || room?.spectators?.some((spectator) => spectator.playerId === playerId) ? room : null;
}

async function prepareSchema(client: VercelPoolClient) {
  await client.sql`
    CREATE TABLE IF NOT EXISTS beatpulse_social (
      id TEXT PRIMARY KEY,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `;
}

async function readState(client: VercelPoolClient): Promise<SocialState> {
  const { rows } = await client.sql`SELECT state FROM beatpulse_social WHERE id = 'default' LIMIT 1`;
  const raw = (rows[0]?.state || EMPTY_STATE) as Partial<SocialState>;
  return {
    profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
    friendships: Array.isArray(raw.friendships) ? raw.friendships : [],
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    rooms: Array.isArray(raw.rooms) ? raw.rooms : [],
  };
}

async function writeState(client: VercelPoolClient, state: SocialState) {
  const twelveHoursAgo = Date.now() - 1000 * 60 * 60 * 12;
  const thirtyDaysAgo = Date.now() - 1000 * 60 * 60 * 24 * 30;
  const compacted = {
    ...state,
    messages: state.messages.filter((message) => new Date(message.createdAt).getTime() > thirtyDaysAgo).slice(-5000),
    rooms: state.rooms.filter((room) => new Date(room.updatedAt).getTime() > twelveHoursAgo),
  };
  await client.sql`
    INSERT INTO beatpulse_social (id, state, updated_at)
    VALUES ('default', ${JSON.stringify(compacted)}::jsonb, ${new Date().toISOString()})
    ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
  `;
}

function identityFromRequest(req: any, body: Record<string, unknown>) {
  const isGet = req.method === "GET";
  return {
    playerId: isGet ? queryValue(req, "playerId") : body.playerId,
    username: isGet ? queryValue(req, "username") : body.username,
    token: headerValue(req, "x-beatpulse-token"),
  };
}

async function songExists(client: VercelPoolClient, songId: string) {
  if (!songId) return false;
  try {
    const { rows } = await client.sql`SELECT id FROM songs WHERE id = ${songId} LIMIT 1`;
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function dispatch(req: any, state: SocialState, client: VercelPoolClient): Promise<ApiResult> {
  const action = queryValue(req, "action");
  const body = parseBody(req);
  const method = String(req.method || "GET").toUpperCase();
  const identity = identityFromRequest(req, body);
  const actor = touchProfile(state, identity.playerId, identity.username, identity.token);
  const requireActor = () => actor || null;

  if (action === "session" && method === "POST") {
    return actor ? ok(snapshot(state, actor.id)) : fail(400, "A valid player identity is required.");
  }
  if (action === "profile/update" && method === "POST") {
    if (!actor) return fail(400, "A valid player identity is required.");
    actor.stats = profileStats(body.profile);
    return ok(snapshot(state, actor.id));
  }
  if (action === "snapshot" && method === "GET") {
    if (!actor) return fail(400, "A valid player identity is required.");
    state.rooms.forEach((room) => { if (room.status === "countdown" && room.startAt && Date.now() >= new Date(room.startAt).getTime()) room.status = "playing"; });
    return ok(snapshot(state, actor.id));
  }
  if (action === "friends/request" && method === "POST") {
    if (!actor) return fail(400, "Player identity and friend code are required.");
    const friendCode = text(body.friendCode).toUpperCase();
    const target = state.profiles.find((profile) => profile.friendCode.toUpperCase() === friendCode);
    if (!friendCode || !target) return fail(404, "No player has that friend code.", true);
    if (target.id === actor.id) return fail(400, "You cannot add yourself.", true);
    if (actor.blockedIds.includes(target.id) || target.blockedIds.includes(actor.id)) return fail(403, "This player is unavailable.", true);
    const existing = state.friendships.find((friendship) => (
      (friendship.requesterId === actor.id && friendship.addresseeId === target.id) ||
      (friendship.requesterId === target.id && friendship.addresseeId === actor.id)
    ));
    if (existing?.status === "accepted") return fail(409, "You are already friends.", true);
    if (existing?.requesterId === target.id) { existing.status = "accepted"; existing.updatedAt = new Date().toISOString(); }
    else if (!existing) { const now = new Date().toISOString(); state.friendships.push({ id: crypto.randomUUID(), requesterId: actor.id, addresseeId: target.id, status: "pending", createdAt: now, updatedAt: now }); }
    else return fail(409, "Friend request already sent.", true);
    return ok(snapshot(state, actor.id));
  }
  if (action === "friends/respond" && method === "POST") {
    const friendship = state.friendships.find((entry) => entry.id === body.friendshipId);
    if (!actor || !friendship || friendship.addresseeId !== actor.id || friendship.status !== "pending") return fail(404, "Friend request not found.", Boolean(actor));
    if (body.accept === true) { friendship.status = "accepted"; friendship.updatedAt = new Date().toISOString(); }
    else state.friendships = state.friendships.filter((entry) => entry.id !== friendship.id);
    return ok(snapshot(state, actor.id));
  }
  if (action === "friends/remove" && method === "POST") {
    const friendId = text(body.friendId);
    if (!actor || !friendId) return fail(400, "Player and friend are required.", Boolean(actor));
    state.friendships = state.friendships.filter((friendship) => !(
      (friendship.requesterId === actor.id && friendship.addresseeId === friendId) ||
      (friendship.requesterId === friendId && friendship.addresseeId === actor.id)
    ));
    return ok(snapshot(state, actor.id));
  }
  if (action === "block" && method === "POST") {
    const targetId = text(body.targetId);
    if (!actor || !targetId || targetId === actor.id) return fail(400, "A valid player is required.", Boolean(actor));
    if (body.blocked === false) actor.blockedIds = actor.blockedIds.filter((id) => id !== targetId);
    else if (!actor.blockedIds.includes(targetId)) {
      actor.blockedIds.push(targetId);
      state.friendships = state.friendships.filter((friendship) => !(
        (friendship.requesterId === actor.id && friendship.addresseeId === targetId) ||
        (friendship.requesterId === targetId && friendship.addresseeId === actor.id)
      ));
    }
    return ok(snapshot(state, actor.id));
  }
  if (action === "messages" && method === "GET") {
    const friendId = queryValue(req, "friendId");
    if (!actor || !friendId || !areFriends(state, actor.id, friendId)) return fail(403, "Messages are available between friends.", Boolean(actor));
    const messages = state.messages.filter((message) => !message.roomId && (
      (message.senderId === actor.id && message.recipientId === friendId) ||
      (message.senderId === friendId && message.recipientId === actor.id)
    )).slice(-200);
    const now = new Date().toISOString();
    messages.forEach((message) => { if (message.recipientId === actor.id && !message.readAt) message.readAt = now; });
    return ok(messages);
  }
  if (action === "messages" && method === "POST") {
    const recipientId = text(body.recipientId);
    const messageBody = text(body.body).slice(0, 500);
    const recipient = state.profiles.find((profile) => profile.id === recipientId);
    if (!actor || !recipient || !messageBody || !areFriends(state, actor.id, recipientId)) return fail(400, "A friend and message are required.", Boolean(actor));
    if (actor.blockedIds.includes(recipientId) || recipient.blockedIds.includes(actor.id)) return fail(403, "Messages cannot be sent to this player.", true);
    const kind = body.kind === "invite" ? "invite" : "text";
    const roomCode = kind === "invite" ? text(body.roomCode) || undefined : undefined;
    const message: SocialMessage = { id: crypto.randomUUID(), senderId: actor.id, recipientId, body: messageBody, kind, roomCode, createdAt: new Date().toISOString() };
    state.messages.push(message);
    return ok(message);
  }
  if (action === "multiplayer/rooms" && method === "POST") {
    const songId = text(body.songId);
    if (!actor || !(await songExists(client, songId))) return fail(400, "Choose a community song before creating a room.", Boolean(actor));
    state.rooms.forEach((room) => { room.participants = room.participants.filter((participant) => participant.playerId !== actor.id); room.spectators = (room.spectators || []).filter((spectator) => spectator.playerId !== actor.id); });
    let code = "";
    do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (state.rooms.some((room) => room.code === code));
    const now = new Date().toISOString();
    const room: MultiplayerRoom = {
      id: crypto.randomUUID(), code, hostId: actor.id, songId, status: "lobby", createdAt: now, updatedAt: now, maxPlayers: 8, spectators: [], rematchVotes: [],
      participants: [{ playerId: actor.id, username: actor.username, ready: true, score: 0, combo: 0, accuracy: 0, progress: 0, finished: false, joinedAt: now, updatedAt: now }],
    };
    state.rooms.push(room);
    return ok(room);
  }
  if (action === "multiplayer/rooms/join" && method === "POST") {
    const room = state.rooms.find((entry) => entry.code === text(body.code).toUpperCase());
    if (!actor || !room) return fail(404, "Room not found. Check the six-character code.", Boolean(actor));
    if (room.status !== "lobby") {
      if (room.participants.some((participant) => participant.playerId === actor.id)) return ok(room);
      const otherActiveRoom = state.rooms.find((entry) => entry.id !== room.id && entry.status !== "results" && (entry.participants.some((participant) => participant.playerId === actor.id) || entry.spectators?.some((spectator) => spectator.playerId === actor.id)));
      if (otherActiveRoom) return fail(409, "Leave your current room before spectating another match.", true);
      room.spectators = room.spectators || [];
      if (!room.spectators.some((spectator) => spectator.playerId === actor.id)) {
        if (room.spectators.length >= 20) return fail(409, "That room already has the maximum number of spectators.", true);
        const now = new Date().toISOString();
        room.spectators.push({ playerId: actor.id, username: actor.username, joinedAt: now });
        room.updatedAt = now;
        state.messages.push({ id: crypto.randomUUID(), senderId: actor.id, roomId: room.id, body: `${actor.username} joined as a spectator.`, kind: "system", createdAt: now });
      }
      return ok(room);
    }
    if (room.participants.length >= room.maxPlayers) return fail(409, "That room is full.", true);
    state.rooms.forEach((entry) => { if (entry.id !== room.id) { entry.participants = entry.participants.filter((participant) => participant.playerId !== actor.id); entry.spectators = (entry.spectators || []).filter((spectator) => spectator.playerId !== actor.id); } });
    if (!room.participants.some((participant) => participant.playerId === actor.id)) {
      const now = new Date().toISOString();
      room.participants.push({ playerId: actor.id, username: actor.username, ready: false, score: 0, combo: 0, accuracy: 0, progress: 0, finished: false, joinedAt: now, updatedAt: now });
      room.updatedAt = now;
    }
    return ok(room);
  }

  const roomId = method === "GET" ? queryValue(req, "roomId") : text(body.roomId);
  const room = actor ? roomForPlayer(state, roomId, actor.id) : null;
  if (action === "multiplayer/rooms/song" && method === "POST") {
    const songId = text(body.songId);
    if (!actor || !room || room.hostId !== actor.id || room.status !== "lobby") {
      return fail(403, "Only the host can change the song in an open lobby.", Boolean(actor));
    }
    if (!(await songExists(client, songId))) return fail(400, "Choose a valid community song.", true);
    if (room.songId === songId) return ok(room);

    const now = new Date().toISOString();
    room.songId = songId;
    room.updatedAt = now;
    room.participants.forEach((participant) => {
      participant.ready = participant.playerId === room.hostId;
      participant.updatedAt = now;
    });
    state.messages.push({
      id: crypto.randomUUID(),
      senderId: actor.id,
      roomId: room.id,
      body: "The host changed the match song. Ready checks were reset.",
      kind: "system",
      createdAt: now,
    });
    return ok(room);
  }
  if (action === "multiplayer/rooms/ready" && method === "POST") {
    if (!actor || !room || room.status !== "lobby") return fail(404, "Open lobby not found.", Boolean(actor));
    const participant = room.participants.find((entry) => entry.playerId === actor.id);
    if (!participant) return fail(403, "Spectators cannot ready up.", true);
    participant.ready = actor.id === room.hostId || body.ready === true;
    participant.updatedAt = new Date().toISOString(); room.updatedAt = participant.updatedAt;
    return ok(room);
  }
  if (action === "multiplayer/rooms/start" && method === "POST") {
    if (!actor || !room || room.hostId !== actor.id || room.status !== "lobby") return fail(403, "Only the host can start an open lobby.", Boolean(actor));
    if (room.participants.length < 2) return fail(409, "At least two players are needed to start.", true);
    if (room.participants.some((participant) => !participant.ready)) return fail(409, "Everyone must be ready.", true);
    const now = Date.now(); room.status = "countdown"; room.startAt = new Date(now + 15_000).toISOString(); room.updatedAt = new Date(now).toISOString();
    room.participants.forEach((participant) => { participant.score = 0; participant.combo = 0; participant.accuracy = 0; participant.progress = 0; participant.finished = false; });
    return ok(room);
  }
  if (action === "multiplayer/rooms/progress" && method === "POST") {
    if (!actor || !room || !["countdown", "playing", "results"].includes(room.status)) return fail(404, "Active match not found.", Boolean(actor));
    const participant = room.participants.find((entry) => entry.playerId === actor.id);
    if (!participant) return fail(403, "Spectators cannot submit match progress.", true);
    participant.score = Math.max(participant.score, clampNumber(body.score, 0));
    participant.combo = Math.max(0, clampNumber(body.combo, 0));
    participant.accuracy = Math.max(0, Math.min(100, clampNumber(body.accuracy, 0)));
    participant.progress = Math.max(participant.progress, Math.min(1, clampNumber(body.progress, 0)));
    participant.finished = participant.finished || body.finished === true;
    participant.updatedAt = new Date().toISOString();
    if (room.status === "countdown" && room.startAt && Date.now() >= new Date(room.startAt).getTime()) room.status = "playing";
    if (room.participants.every((entry) => entry.finished)) room.status = "results";
    room.updatedAt = participant.updatedAt;
    return ok(room);
  }
  if (action === "multiplayer/rooms/rematch" && method === "POST") {
    if (!actor || !room || room.status !== "results" || !room.participants.some((participant) => participant.playerId === actor.id)) return fail(403, "Only players in the completed match can vote for a rematch.", Boolean(actor));
    const now = new Date().toISOString();
    const votes = new Set(room.rematchVotes || []);
    if (votes.has(actor.id)) votes.delete(actor.id); else votes.add(actor.id);
    room.rematchVotes = [...votes]; room.updatedAt = now;
    if (room.participants.every((participant) => votes.has(participant.playerId))) {
      room.status = "lobby"; room.startAt = undefined; room.rematchVotes = [];
      room.participants.forEach((participant) => { participant.ready = participant.playerId === room.hostId; participant.score = 0; participant.combo = 0; participant.accuracy = 0; participant.progress = 0; participant.finished = false; });
      state.messages.push({ id: crypto.randomUUID(), senderId: actor.id, roomId: room.id, body: "Everyone voted. The room is ready for a rematch.", kind: "system", createdAt: now });
    } else {
      state.messages.push({ id: crypto.randomUUID(), senderId: actor.id, roomId: room.id, body: `${actor.username} voted for a rematch (${votes.size}/${room.participants.length}).`, kind: "system", createdAt: now });
    }
    return ok(room);
  }
  if (action === "multiplayer/rooms/leave" && method === "POST") {
    if (!actor || !room) return fail(404, "Room not found.", Boolean(actor));
    room.participants = room.participants.filter((participant) => participant.playerId !== actor.id);
    room.spectators = (room.spectators || []).filter((spectator) => spectator.playerId !== actor.id);
    if (room.participants.length === 0) state.rooms = state.rooms.filter((entry) => entry.id !== room.id);
    else if (room.hostId === actor.id) { room.hostId = room.participants[0].playerId; room.participants[0].ready = true; }
    return ok({ left: true });
  }
  if (action === "multiplayer/rooms/messages" && method === "GET") {
    if (!actor || !room) return fail(404, "Room not found.", Boolean(actor));
    return ok(state.messages.filter((message) => message.roomId === room.id).slice(-100));
  }
  if (action === "multiplayer/rooms/messages" && method === "POST") {
    const messageBody = text(body.body).slice(0, 500);
    if (!actor || !room || !messageBody) return fail(400, "Room and message are required.", Boolean(actor));
    const message: SocialMessage = { id: crypto.randomUUID(), senderId: actor.id, roomId: room.id, body: messageBody, kind: "text", createdAt: new Date().toISOString() };
    state.messages.push(message); room.updatedAt = message.createdAt;
    return ok(message);
  }
  if (["session", "profile/update", "friends/request", "friends/respond", "friends/remove", "block", "messages", "multiplayer/rooms", "multiplayer/rooms/join", "multiplayer/rooms/song", "multiplayer/rooms/ready", "multiplayer/rooms/start", "multiplayer/rooms/progress", "multiplayer/rooms/rematch", "multiplayer/rooms/leave", "multiplayer/rooms/messages"].includes(action)) {
    return fail(405, "This action does not support that request method.", Boolean(requireActor()));
  }
  return fail(404, "Social action not found.", Boolean(requireActor()));
}

export default async function handler(req: any, res: any) {
  if (!["GET", "POST"].includes(String(req.method || "GET").toUpperCase())) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    return res.status(503).json({ success: false, error: "Social service is not configured." });
  }

  let client: VercelPoolClient | undefined;
  try {
    client = await db.connect();
    await client.sql`BEGIN`;
    await client.sql`SELECT pg_advisory_xact_lock(20260816)`;
    await prepareSchema(client);
    const state = await readState(client);
    const result = await dispatch(req, state, client);
    if (result.persist) await writeState(client, state);
    await client.sql`COMMIT`;
    return result.error
      ? res.status(result.status).json({ success: false, error: result.error })
      : res.status(result.status).json({ success: true, data: result.data });
  } catch (error) {
    if (client) {
      try { await client.sql`ROLLBACK`; } catch { /* The connection may already be closed. */ }
    }
    console.error("[api/social] request failed", error);
    return res.status(500).json({ success: false, error: "Social service is temporarily unavailable." });
  } finally {
    client?.release();
  }
}
