import express, { type NextFunction, type Request, type Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import * as crypto from "node:crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import { config as loadEnv } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.join(__dirname, ".env.local") });
loadEnv();
const APP_ROOT = __dirname;
const ADMIN_STATE_FILE = path.join(APP_ROOT, ".admin-state.json");
const DATA_DIR = path.resolve(process.env.BEATPULSE_DATA_DIR || path.join(APP_ROOT, ".server-data"));
const UPLOAD_DIR = path.resolve(process.env.BEATPULSE_UPLOAD_DIR || path.join(APP_ROOT, "uploads"));
const SONGS_FILE = path.join(DATA_DIR, "songs.json");
const GLOBAL_SCORES_FILE = path.join(DATA_DIR, "global-scores.json");
const REPLAYS_FILE = path.join(DATA_DIR, "replays.json");
const SOCIAL_FILE = path.join(DATA_DIR, "social.json");
const STORAGE_META_FILE = path.join(DATA_DIR, "storage-meta.json");
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const STORAGE_SCHEMA_VERSION = 3;

interface AdminState {
  passwordHash: string;
  tokenSecret: string;
  updatedAt: string;
}

interface ScoreRecord {
  score: number;
  accuracy: number;
  date: string;
  username: string;
}

interface CommunitySongRecord {
  id: string;
  name: string;
  artist: string;
  audioUrl: string;
  audioPath: string;
  notesUrl: string;
  notesPath: string;
  difficulty: number;
  density: number;
  laneVariety: number;
  sliderProbability: number;
  stamina: number;
  topScore: number;
  scores: ScoreRecord[];
  authorName: string;
  createdAt: string;
  status: "ready";
}

interface ReplayRecord {
  id: string;
  songId: string;
  songName: string;
  artist: string;
  difficulty: number;
  density: number;
  laneVariety: number;
  sliderProbability: number;
  stamina: number;
  score: number;
  accuracy: number;
  date: string;
  createdAt: string;
  events: unknown[];
}

interface GlobalScoreRecord {
  id: string;
  songId?: string;
  score: number;
  accuracy: number;
  date: string;
  username: string;
  createdAt: string;
  songName: string;
  artist: string;
}

type FriendshipStatus = "pending" | "accepted";
type RoomStatus = "lobby" | "countdown" | "playing" | "results";

interface PlayerProfile {
  id: string;
  username: string;
  friendCode: string;
  createdAt: string;
  lastSeen: string;
  blockedIds: string[];
  credentialHash?: string;
}

interface FriendshipRecord {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: string;
  updatedAt: string;
}

interface SocialMessageRecord {
  id: string;
  senderId: string;
  recipientId?: string;
  roomId?: string;
  body: string;
  kind: "text" | "invite" | "system";
  roomCode?: string;
  createdAt: string;
  readAt?: string;
}

interface RoomParticipant {
  playerId: string;
  username: string;
  ready: boolean;
  score: number;
  combo: number;
  accuracy: number;
  progress: number;
  finished: boolean;
  joinedAt: string;
  updatedAt: string;
}

interface MultiplayerRoomRecord {
  id: string;
  code: string;
  hostId: string;
  songId: string;
  status: RoomStatus;
  startAt?: string;
  createdAt: string;
  updatedAt: string;
  maxPlayers: number;
  participants: RoomParticipant[];
}

interface SocialState {
  profiles: PlayerProfile[];
  friendships: FriendshipRecord[];
  messages: SocialMessageRecord[];
  rooms: MultiplayerRoomRecord[];
}

interface SongStorageIssue {
  id: string;
  name: string;
  artist: string;
  missingAudio: boolean;
  missingNotes: boolean;
}

interface LeaderboardModerationResult {
  username: string;
  reason: string;
  removedGlobalScores: number;
  removedSongScores: number;
  affectedSongs: number;
}

interface StorageNormalizedRows {
  songs: number;
  globalScores: number;
  replays: number;
}

interface ReplayLinkIssue {
  id: string;
  songId: string;
  songName: string;
  artist: string;
  issue: "missing-song" | "metadata-mismatch";
  expectedSongId?: string;
  expectedSongName?: string;
  expectedArtist?: string;
}

interface GlobalScoreLinkIssue {
  id: string;
  songId?: string;
  songName: string;
  artist: string;
  issue: "missing-song" | "missing-song-link" | "metadata-mismatch";
  expectedSongId?: string;
  expectedSongName?: string;
  expectedArtist?: string;
}

interface DataRelationshipMaintenance {
  linkedGlobalScores: number;
  updatedGlobalScoreMetadata: number;
  linkedReplays: number;
  updatedReplayMetadata: number;
  removedOrphanReplays: number;
  unresolvedGlobalScores: number;
  unresolvedReplays: number;
}

interface StorageMetaRecord {
  schemaVersion: number;
  updatedAt: string;
  migratedCollections: string[];
  backups: string[];
  checkedCollections: string[];
  normalizedRows: StorageNormalizedRows;
  relationshipActions?: DataRelationshipMaintenance;
}

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function readCollection<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const invalidBackupPath = `${filePath}.invalid-${Date.now()}.bak`;
    try {
      fs.copyFileSync(filePath, invalidBackupPath);
    } catch {
      // Ignore backup failures and fall back to a clean file.
    }
    writeCollection(filePath, fallback);
    return fallback;
  }
}

function writeCollection<T>(filePath: string, payload: T) {
  const tmpFilePath = `${filePath}.tmp-${Date.now()}-${crypto.randomUUID()}`;
  fs.writeFileSync(tmpFilePath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpFilePath, filePath);
}

function writeFileAtomic(filePath: string, payload: string | Buffer | Uint8Array) {
  const tmpFilePath = `${filePath}.tmp-${Date.now()}-${crypto.randomUUID()}`;
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
  fs.writeFileSync(tmpFilePath, payload);
  fs.renameSync(tmpFilePath, filePath);
}

const EMPTY_SOCIAL_STATE: SocialState = {
  profiles: [],
  friendships: [],
  messages: [],
  rooms: [],
};

function readSocialState(): SocialState {
  const raw = readCollection<Partial<SocialState>>(SOCIAL_FILE, EMPTY_SOCIAL_STATE);
  return {
    profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
    friendships: Array.isArray(raw.friendships) ? raw.friendships : [],
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    rooms: Array.isArray(raw.rooms) ? raw.rooms : [],
  };
}

function writeSocialState(state: SocialState) {
  const twelveHoursAgo = Date.now() - 1000 * 60 * 60 * 12;
  const thirtyDaysAgo = Date.now() - 1000 * 60 * 60 * 24 * 30;
  writeCollection(SOCIAL_FILE, {
    ...state,
    messages: state.messages
      .filter((message) => new Date(message.createdAt).getTime() > thirtyDaysAgo)
      .slice(-5000),
    rooms: state.rooms.filter((room) => new Date(room.updatedAt).getTime() > twelveHoursAgo),
  });
}

function sanitizeUsername(value: unknown) {
  if (typeof value !== "string") return "Player";
  return value.trim().replace(/\s+/g, " ").slice(0, 24) || "Player";
}

function createFriendCode(username: string, profiles: PlayerProfile[]) {
  const prefix = username.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase() || "PLAYER";
  let code = "";
  do {
    code = `${prefix}#${crypto.randomInt(1000, 10000)}`;
  } while (profiles.some((profile) => profile.friendCode === code));
  return code;
}

function touchSocialProfile(state: SocialState, playerId: unknown, username: unknown, playerToken: unknown): PlayerProfile | null {
  if (typeof playerId !== "string" || !playerId.trim() || playerId.length > 100) return null;
  if (typeof playerToken !== "string" || playerToken.length < 32 || playerToken.length > 200) return null;
  const id = playerId.trim();
  const now = new Date().toISOString();
  const nextUsername = sanitizeUsername(username);
  const credentialHash = crypto.createHash("sha256").update(playerToken).digest("hex");
  let profile = state.profiles.find((entry) => entry.id === id);
  if (!profile) {
    profile = {
      id,
      username: nextUsername,
      friendCode: createFriendCode(nextUsername, state.profiles),
      createdAt: now,
      lastSeen: now,
      blockedIds: [],
      credentialHash,
    };
    state.profiles.push(profile);
  } else {
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
    state.rooms.forEach((room) => {
      const participant = room.participants.find((entry) => entry.playerId === id);
      if (participant) participant.username = nextUsername;
    });
  }
  return profile;
}

function areFriends(state: SocialState, firstId: string, secondId: string) {
  return state.friendships.some((friendship) =>
    friendship.status === "accepted" &&
    ((friendship.requesterId === firstId && friendship.addresseeId === secondId) ||
      (friendship.requesterId === secondId && friendship.addresseeId === firstId))
  );
}

function publicProfile(profile: PlayerProfile, state: SocialState) {
  const activeRoom = state.rooms.find((room) =>
    room.participants.some((participant) => participant.playerId === profile.id) &&
    room.status !== "results"
  );
  const age = Date.now() - new Date(profile.lastSeen).getTime();
  return {
    id: profile.id,
    username: profile.username,
    friendCode: profile.friendCode,
    status: activeRoom?.status === "playing" || activeRoom?.status === "countdown"
      ? "in-game"
      : age < 45_000 ? "online" : "offline",
    lastSeen: profile.lastSeen,
  };
}

function socialSnapshot(state: SocialState, playerId: string) {
  const self = state.profiles.find((profile) => profile.id === playerId);
  if (!self) return null;
  const accepted = state.friendships.filter((friendship) =>
    friendship.status === "accepted" &&
    (friendship.requesterId === playerId || friendship.addresseeId === playerId)
  );
  const friends = accepted.flatMap((friendship) => {
    const friendId = friendship.requesterId === playerId ? friendship.addresseeId : friendship.requesterId;
    const profile = state.profiles.find((entry) => entry.id === friendId);
    if (!profile) return [];
    const unread = state.messages.filter((message) =>
      message.senderId === friendId && message.recipientId === playerId && !message.readAt
    ).length;
    return [{ ...publicProfile(profile, state), friendshipId: friendship.id, unread }];
  });
  const mapRequest = (friendship: FriendshipRecord, incoming: boolean) => {
    const profileId = incoming ? friendship.requesterId : friendship.addresseeId;
    const profile = state.profiles.find((entry) => entry.id === profileId);
    return profile ? { ...publicProfile(profile, state), friendshipId: friendship.id } : null;
  };
  const pendingIncoming = state.friendships
    .filter((friendship) => friendship.status === "pending" && friendship.addresseeId === playerId)
    .map((friendship) => mapRequest(friendship, true)).filter(Boolean);
  const pendingOutgoing = state.friendships
    .filter((friendship) => friendship.status === "pending" && friendship.requesterId === playerId)
    .map((friendship) => mapRequest(friendship, false)).filter(Boolean);
  const activeRoom = state.rooms.find((room) => room.participants.some((participant) => participant.playerId === playerId));
  return {
    self: publicProfile(self, state),
    friends: friends.sort((a, b) => (a.status === "offline" ? 1 : 0) - (b.status === "offline" ? 1 : 0)),
    pendingIncoming,
    pendingOutgoing,
    activeRoom: activeRoom || null,
    unreadCount: friends.reduce((sum, friend) => sum + friend.unread, 0),
  };
}

function getRoomForPlayer(state: SocialState, roomId: string, playerId: string) {
  const room = state.rooms.find((entry) => entry.id === roomId);
  if (!room || !room.participants.some((participant) => participant.playerId === playerId)) return null;
  return room;
}

function hasSongAssets(song: CommunitySongRecord) {
  return {
    missingAudio: !hasSongAsset(song.audioPath),
    missingNotes: !hasSongAsset(song.notesPath),
  };
}

function isExistingFile(filePath: string) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function hasSongAsset(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const primary = path.join(UPLOAD_DIR, normalized);
  if (isExistingFile(primary)) return true;

  if (normalized.startsWith("songs/")) {
    const legacyRelative = normalized.substring("songs/".length);
    const legacy = path.join(UPLOAD_DIR, legacyRelative);
    if (isExistingFile(legacy)) return true;
  }

  return false;
}

function backupStorageFile(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.${label}.${Date.now()}.bak`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function toText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toIsoTimestamp(value: unknown, fallback = new Date().toISOString()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function toDisplayDate(value: unknown, createdAt: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return new Date(createdAt).toLocaleDateString();
}

function extractRelativeAssetPath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  let normalized = value.trim();
  if (/^https?:\/\//i.test(normalized)) {
    try {
      normalized = new URL(normalized).pathname;
    } catch {
      return null;
    }
  }

  normalized = normalized.replace(/\\/g, "/").replace(/^\/+/, "");
  const uploadMarker = "api/uploads/";
  const uploadIndex = normalized.indexOf(uploadMarker);
  if (uploadIndex >= 0) {
    normalized = normalized.slice(uploadIndex + uploadMarker.length);
  }

  if (normalized.startsWith("uploads/")) {
    normalized = normalized.slice("uploads/".length);
  }

  normalized = normalized.replace(/^\.?\//, "");
  return normalized || null;
}

function canonicalizeSongAssetPath(id: string, candidate: string | null, fallbackFileName: string) {
  const fileName = candidate ? path.posix.basename(candidate) : fallbackFileName;
  if (!candidate) return `songs/${id}/${fallbackFileName}`;
  if (candidate.startsWith("songs/")) return candidate;
  return `songs/${id}/${fileName}`;
}

function toLocalUploadUrl(relativePath: string) {
  return `/api/uploads/${relativePath.replace(/\\/g, "/")}`;
}

function toLookupKey(name: string, artist: string) {
  return `${name.trim().toLowerCase()}::${artist.trim().toLowerCase()}`;
}

function buildSongLookup(songs: CommunitySongRecord[]) {
  const byId = new Map<string, CommunitySongRecord>();
  const byMetadata = new Map<string, CommunitySongRecord[]>();

  songs.forEach((song) => {
    byId.set(song.id, song);
    const key = toLookupKey(song.name, song.artist);
    const bucket = byMetadata.get(key) || [];
    bucket.push(song);
    byMetadata.set(key, bucket);
  });

  return { byId, byMetadata };
}

function getUniqueSongMatch(
  lookup: ReturnType<typeof buildSongLookup>,
  name: string,
  artist: string
) {
  const matches = lookup.byMetadata.get(toLookupKey(name, artist)) || [];
  return matches.length === 1 ? matches[0] : null;
}

function resolveSongForReplay(
  replay: Pick<ReplayRecord, "songId" | "songName" | "artist">,
  lookup: ReturnType<typeof buildSongLookup>
) {
  if (replay.songId) {
    const byId = lookup.byId.get(replay.songId);
    if (byId) return byId;
  }

  return getUniqueSongMatch(lookup, replay.songName, replay.artist);
}

function resolveSongForGlobalScore(
  score: Pick<GlobalScoreRecord, "songId" | "songName" | "artist">,
  lookup: ReturnType<typeof buildSongLookup>
) {
  if (score.songId) {
    const byId = lookup.byId.get(score.songId);
    if (byId) return byId;
  }

  return getUniqueSongMatch(lookup, score.songName, score.artist);
}

function normalizeScoreRecord(raw: any, createdAt: string): ScoreRecord {
  return {
    score: clampNumber(raw?.score, 0),
    accuracy: clampNumber(raw?.accuracy, 0),
    date: toDisplayDate(raw?.date, createdAt),
    username: toText(raw?.username, "Anonymous"),
  };
}

function normalizeSongRecord(raw: any): CommunitySongRecord {
  const id = toText(raw?.id, crypto.randomUUID());
  const createdAt = toIsoTimestamp(raw?.createdAt ?? raw?.created_at);
  const difficulty = clampNumber(raw?.difficulty ?? raw?.complexity, 0.5);
  const density = clampNumber(raw?.density, difficulty);
  const laneVariety = clampNumber(raw?.laneVariety ?? raw?.lane_variety, difficulty);
  const sliderProbability = clampNumber(raw?.sliderProbability ?? raw?.slider_probability, 0.3);
  const stamina = clampNumber(raw?.stamina, 0.5);
  const rawScores = Array.isArray(raw?.scores) ? raw.scores : [];
  const scores = sortScoresDesc(rawScores.map((entry) => normalizeScoreRecord(entry, createdAt)));
  const audioPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(raw?.audioPath ?? raw?.audio_path ?? raw?.audioUrl ?? raw?.audio_url),
    "audio.mp3"
  );
  const notesPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(raw?.notesPath ?? raw?.notes_path ?? raw?.notesUrl ?? raw?.notes_url),
    "notes.json"
  );

  return {
    id,
    name: toText(raw?.name, "Untitled"),
    artist: toText(raw?.artist, "Unknown Artist"),
    audioUrl: toLocalUploadUrl(audioPath),
    audioPath,
    notesUrl: toLocalUploadUrl(notesPath),
    notesPath,
    difficulty,
    density,
    laneVariety,
    sliderProbability,
    stamina,
    topScore: Math.max(clampNumber(raw?.topScore ?? raw?.top_score, 0), toTopScoreFromScores(scores)),
    scores,
    authorName: toText(raw?.authorName ?? raw?.author_name, "Anonymous"),
    createdAt,
    status: "ready",
  };
}

function normalizeGlobalScoreRecord(raw: any): GlobalScoreRecord {
  const createdAt = toIsoTimestamp(raw?.createdAt ?? raw?.created_at);
  return {
    id: toText(raw?.id, crypto.randomUUID()),
    songId: toText(raw?.songId ?? raw?.song_id, ""),
    score: clampNumber(raw?.score, 0),
    accuracy: clampNumber(raw?.accuracy, 0),
    date: toDisplayDate(raw?.date, createdAt),
    username: toText(raw?.username, "Anonymous"),
    createdAt,
    songName: toText(raw?.songName ?? raw?.song_name, "Unknown Song"),
    artist: toText(raw?.artist, "Unknown Artist"),
  };
}

function normalizeReplayRecord(raw: any): ReplayRecord {
  const createdAt = toIsoTimestamp(raw?.createdAt ?? raw?.created_at);
  const difficulty = clampNumber(raw?.difficulty ?? raw?.complexity, 0.5);
  return {
    id: toText(raw?.id, crypto.randomUUID()),
    songId: toText(raw?.songId ?? raw?.song_id, ""),
    songName: toText(raw?.songName ?? raw?.song_name, "Unknown Song"),
    artist: toText(raw?.artist, "Unknown Artist"),
    difficulty,
    density: clampNumber(raw?.density, difficulty),
    laneVariety: clampNumber(raw?.laneVariety ?? raw?.lane_variety, difficulty),
    sliderProbability: clampNumber(raw?.sliderProbability ?? raw?.slider_probability, 0.3),
    stamina: clampNumber(raw?.stamina, 0.5),
    score: clampNumber(raw?.score, 0),
    accuracy: clampNumber(raw?.accuracy, 0),
    date: toDisplayDate(raw?.date, createdAt),
    createdAt,
    events: Array.isArray(raw?.events) ? raw.events : [],
  };
}

function readSongs(): CommunitySongRecord[] {
  const raw = readCollection<unknown>(SONGS_FILE, []);
  return sortSongsDesc((Array.isArray(raw) ? raw : []).map((entry) => normalizeSongRecord(entry)));
}

function writeSongs(songs: CommunitySongRecord[]) {
  writeCollection(SONGS_FILE, songs);
}

function readGlobalScores(): GlobalScoreRecord[] {
  const raw = readCollection<unknown>(GLOBAL_SCORES_FILE, []);
  return sortGlobalScoresDesc((Array.isArray(raw) ? raw : []).map((entry) => normalizeGlobalScoreRecord(entry)));
}

function writeGlobalScores(scores: GlobalScoreRecord[]) {
  writeCollection(GLOBAL_SCORES_FILE, scores);
}

function readReplays(): ReplayRecord[] {
  const raw = readCollection<unknown>(REPLAYS_FILE, []);
  return sortReplaysDesc((Array.isArray(raw) ? raw : []).map((entry) => normalizeReplayRecord(entry)));
}

function writeReplays(replays: ReplayRecord[]) {
  writeCollection(REPLAYS_FILE, replays);
}

function reconcileLocalDataRelationships(options?: { pruneOrphanReplays?: boolean }): DataRelationshipMaintenance {
  const songs = readSongs();
  const globalScores = readGlobalScores();
  const replays = readReplays();
  const lookup = buildSongLookup(songs);
  const pruneOrphanReplays = options?.pruneOrphanReplays ?? false;

  const summary: DataRelationshipMaintenance = {
    linkedGlobalScores: 0,
    updatedGlobalScoreMetadata: 0,
    linkedReplays: 0,
    updatedReplayMetadata: 0,
    removedOrphanReplays: 0,
    unresolvedGlobalScores: 0,
    unresolvedReplays: 0,
  };

  let globalScoresChanged = false;
  const nextGlobalScores = globalScores.map((score) => {
    const linkedSong = resolveSongForGlobalScore(score, lookup);
    if (!linkedSong) {
      if (score.songId) {
        summary.unresolvedGlobalScores += 1;
      }
      return score;
    }

    const nextSongId = linkedSong.id;
    const nextSongName = linkedSong.name;
    const nextArtist = linkedSong.artist;
    const needsSongLink = score.songId !== nextSongId;
    const needsMetadata = score.songName !== nextSongName || score.artist !== nextArtist;

    if (!needsSongLink && !needsMetadata) {
      return score;
    }

    if (needsSongLink) summary.linkedGlobalScores += 1;
    if (needsMetadata) summary.updatedGlobalScoreMetadata += 1;
    globalScoresChanged = true;

    return {
      ...score,
      songId: nextSongId,
      songName: nextSongName,
      artist: nextArtist,
    };
  });

  let replayChanged = false;
  const nextReplays: ReplayRecord[] = [];
  for (const replay of replays) {
    const linkedSong = resolveSongForReplay(replay, lookup);
    if (!linkedSong) {
      summary.unresolvedReplays += 1;
      if (pruneOrphanReplays) {
        summary.removedOrphanReplays += 1;
        replayChanged = true;
        continue;
      }

      nextReplays.push(replay);
      continue;
    }

    const needsSongLink = replay.songId !== linkedSong.id;
    const needsMetadata = replay.songName !== linkedSong.name || replay.artist !== linkedSong.artist;
    if (!needsSongLink && !needsMetadata) {
      nextReplays.push(replay);
      continue;
    }

    if (needsSongLink) summary.linkedReplays += 1;
    if (needsMetadata) summary.updatedReplayMetadata += 1;
    replayChanged = true;
    nextReplays.push({
      ...replay,
      songId: linkedSong.id,
      songName: linkedSong.name,
      artist: linkedSong.artist,
    });
  }

  if (globalScoresChanged) {
    writeGlobalScores(sortGlobalScoresDesc(nextGlobalScores));
  }

  if (replayChanged) {
    writeReplays(sortReplaysDesc(nextReplays));
  }

  return summary;
}

function collectLocalIntegrityReport() {
  const songs = readSongs();
  const scores = readGlobalScores();
  const replays = readReplays();
  const lookup = buildSongLookup(songs);

  const missingAssetSongs = songs
    .map((song) => {
      const { missingAudio, missingNotes } = hasSongAssets(song);
      return {
        id: song.id,
        name: song.name,
        artist: song.artist,
        missingAudio,
        missingNotes,
      } as SongStorageIssue;
    })
    .filter((issue) => issue.missingAudio || issue.missingNotes);

  const replayLinkIssues: ReplayLinkIssue[] = [];
  replays.forEach((replay) => {
    const linkedSong = resolveSongForReplay(replay, lookup);
    if (!linkedSong) {
      replayLinkIssues.push({
        id: replay.id,
        songId: replay.songId,
        songName: replay.songName,
        artist: replay.artist,
        issue: "missing-song" as const,
      });
      return;
    }

    if (
      replay.songId !== linkedSong.id ||
      replay.songName !== linkedSong.name ||
      replay.artist !== linkedSong.artist
    ) {
      replayLinkIssues.push({
        id: replay.id,
        songId: replay.songId,
        songName: replay.songName,
        artist: replay.artist,
        issue: "metadata-mismatch" as const,
        expectedSongId: linkedSong.id,
        expectedSongName: linkedSong.name,
        expectedArtist: linkedSong.artist,
      });
    }
  });

  const globalScoreLinkIssues: GlobalScoreLinkIssue[] = [];
  scores.forEach((score) => {
    const linkedSong = resolveSongForGlobalScore(score, lookup);
    if (!linkedSong) {
      if (score.songId) {
        globalScoreLinkIssues.push({
            id: score.id,
            songId: score.songId,
            songName: score.songName,
            artist: score.artist,
            issue: "missing-song" as const,
          });
      }
      return;
    }

    if (!score.songId) {
      globalScoreLinkIssues.push({
        id: score.id,
        songId: score.songId,
        songName: score.songName,
        artist: score.artist,
        issue: "missing-song-link" as const,
        expectedSongId: linkedSong.id,
        expectedSongName: linkedSong.name,
        expectedArtist: linkedSong.artist,
      });
      return;
    }

    if (score.songName !== linkedSong.name || score.artist !== linkedSong.artist) {
      globalScoreLinkIssues.push({
        id: score.id,
        songId: score.songId,
        songName: score.songName,
        artist: score.artist,
        issue: "metadata-mismatch" as const,
        expectedSongId: linkedSong.id,
        expectedSongName: linkedSong.name,
        expectedArtist: linkedSong.artist,
      });
    }
  });

  return {
    songsCount: songs.length,
    scoresCount: scores.length,
    replaysCount: replays.length,
    missingAssetSongsCount: missingAssetSongs.length,
    missingAssetSongs,
    replayLinkIssuesCount: replayLinkIssues.length,
    replayLinkIssues,
    globalScoreLinkIssuesCount: globalScoreLinkIssues.length,
    globalScoreLinkIssues,
    configurationIssues: [] as string[],
  };
}

function migrateLocalStorage(options?: { pruneOrphanReplays?: boolean }): StorageMetaRecord {
  const migratedCollections: string[] = [];
  const backups: string[] = [];
  const checkedCollections = ["songs", "global-scores", "replays"];

  const normalizedSongs = readSongs();
  const normalizedGlobalScores = readGlobalScores();
  const normalizedReplays = readReplays();
  const normalizedRows: StorageNormalizedRows = {
    songs: normalizedSongs.length,
    globalScores: normalizedGlobalScores.length,
    replays: normalizedReplays.length,
  };

  const rawSongs = readCollection<unknown>(SONGS_FILE, []);
  if (JSON.stringify(rawSongs) !== JSON.stringify(normalizedSongs)) {
    const backup = backupStorageFile(SONGS_FILE, `schema-v${STORAGE_SCHEMA_VERSION}`);
    if (backup) backups.push(backup);
    writeSongs(normalizedSongs);
    migratedCollections.push("songs");
  }

  const rawGlobalScores = readCollection<unknown>(GLOBAL_SCORES_FILE, []);
  if (JSON.stringify(rawGlobalScores) !== JSON.stringify(normalizedGlobalScores)) {
    const backup = backupStorageFile(GLOBAL_SCORES_FILE, `schema-v${STORAGE_SCHEMA_VERSION}`);
    if (backup) backups.push(backup);
    writeGlobalScores(normalizedGlobalScores);
    migratedCollections.push("global-scores");
  }

  const rawReplays = readCollection<unknown>(REPLAYS_FILE, []);
  if (JSON.stringify(rawReplays) !== JSON.stringify(normalizedReplays)) {
    const backup = backupStorageFile(REPLAYS_FILE, `schema-v${STORAGE_SCHEMA_VERSION}`);
    if (backup) backups.push(backup);
    writeReplays(normalizedReplays);
    migratedCollections.push("replays");
  }

  const relationshipActions = reconcileLocalDataRelationships({
    pruneOrphanReplays: options?.pruneOrphanReplays,
  });

  const meta: StorageMetaRecord = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    migratedCollections,
    backups,
    checkedCollections,
    normalizedRows,
    relationshipActions,
  };

  writeCollection(STORAGE_META_FILE, meta);
  return meta;
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^\w.-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "upload";
}

function clampNumber(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function sortSongsDesc(songs: CommunitySongRecord[]) {
  return songs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sortScoresDesc(scores: ScoreRecord[]) {
  return scores.sort((a, b) => b.score - a.score);
}

function toTopScoreFromScores(scores: ScoreRecord[]) {
  if (scores.length === 0) return 0;
  return sortScoresDesc([...scores])[0]?.score ?? 0;
}

function createSongScoreEntry(score: number, accuracy: number, username: string, date = new Date().toLocaleDateString()): ScoreRecord {
  return {
    score,
    accuracy,
    date,
    username,
  };
}

function applySongScoreEntry(song: CommunitySongRecord, entry: ScoreRecord): CommunitySongRecord {
  const nextScores = sortScoresDesc([...(song.scores || []), entry]).slice(0, 5);
  return {
    ...song,
    scores: nextScores,
    topScore: toTopScoreFromScores(nextScores),
  };
}

function sortGlobalScoresDesc(scores: GlobalScoreRecord[]) {
  return scores.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
}

function sortReplaysDesc(replays: ReplayRecord[]) {
  return replays.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function createPasswordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(actualHash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createAdminToken(secret: string): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`, "utf8").toString("base64url");
}

function verifyAdminToken(token: string, secret: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [expiresAtRaw, signature] = decoded.split(".");
    if (!expiresAtRaw || !signature) return false;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
    const expectedSignature = crypto.createHmac("sha256", secret).update(expiresAtRaw).digest("hex");
    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expectedSignature, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function loadAdminState(): AdminState {
  if (!fs.existsSync(ADMIN_STATE_FILE)) {
    const initialState: AdminState = {
      passwordHash: createPasswordHash(ADMIN_DEFAULT_PASSWORD),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ADMIN_STATE_FILE, JSON.stringify(initialState, null, 2), "utf8");
    return initialState;
  }

  try {
    const raw = fs.readFileSync(ADMIN_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AdminState>;
    if (!parsed.passwordHash || !parsed.tokenSecret) {
      throw new Error("Admin state file is missing required fields.");
    }

    const resolvedState: AdminState = {
      passwordHash: parsed.passwordHash,
      tokenSecret: parsed.tokenSecret,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };

    if (process.env.ADMIN_PASSWORD && !verifyPassword(process.env.ADMIN_PASSWORD, resolvedState.passwordHash)) {
      resolvedState.passwordHash = createPasswordHash(process.env.ADMIN_PASSWORD);
      resolvedState.updatedAt = new Date().toISOString();
      saveAdminState(resolvedState);
    }

    return resolvedState;
  } catch {
    const fallbackState: AdminState = {
      passwordHash: createPasswordHash(ADMIN_DEFAULT_PASSWORD),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ADMIN_STATE_FILE, JSON.stringify(fallbackState, null, 2), "utf8");
    return fallbackState;
  }
}

function saveAdminState(state: AdminState) {
  fs.writeFileSync(ADMIN_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function ok<T>(res: Response, data: T) {
  res.json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ success: false, error });
}

const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 150 } });

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  let adminState = loadAdminState();

  ensureDirectories();
  const storageMeta = migrateLocalStorage();
  if (storageMeta.migratedCollections.length > 0) {
    console.log(
      `Migrated local storage to schema v${storageMeta.schemaVersion}: ${storageMeta.migratedCollections.join(", ")}`
    );
  }
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/uploads", (req, res, next) => {
    if (!req.path.startsWith("/songs/")) return next();

    const legacyPath = req.path.replace(/^\/songs\//, "");
    const legacyFullPath = path.join(UPLOAD_DIR, legacyPath);
    if (isExistingFile(legacyFullPath)) {
      return res.sendFile(legacyFullPath);
    }

    return next();
  });
  app.use("/api/uploads", express.static(UPLOAD_DIR));

  app.get("/api/health", (_req, res) => {
    ok(res, { status: "ok", message: "BeatPulse server is healthy" });
  });

  app.post("/api/social/session", (req, res) => {
    const state = readSocialState();
    const profile = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    if (!profile) return fail(res, 400, "A valid player identity is required.");
    writeSocialState(state);
    return ok(res, socialSnapshot(state, profile.id));
  });

  app.get("/api/social/snapshot", (req, res) => {
    const state = readSocialState();
    const profile = touchSocialProfile(state, req.query.playerId, req.query.username, req.get("x-beatpulse-token"));
    if (!profile) return fail(res, 400, "A valid player identity is required.");
    state.rooms.forEach((room) => {
      if (room.status === "countdown" && room.startAt && Date.now() >= new Date(room.startAt).getTime()) {
        room.status = "playing";
        room.updatedAt = new Date().toISOString();
      }
    });
    writeSocialState(state);
    return ok(res, socialSnapshot(state, profile.id));
  });

  app.post("/api/social/friends/request", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const targetCode = typeof req.body?.friendCode === "string" ? req.body.friendCode.trim().toUpperCase() : "";
    if (!actor || !targetCode) return fail(res, 400, "Player identity and friend code are required.");
    const target = state.profiles.find((profile) => profile.friendCode.toUpperCase() === targetCode);
    if (!target) return fail(res, 404, "No player has that friend code.");
    if (target.id === actor.id) return fail(res, 400, "You cannot add yourself.");
    if (actor.blockedIds.includes(target.id) || target.blockedIds.includes(actor.id)) {
      return fail(res, 403, "This player is unavailable.");
    }
    const existing = state.friendships.find((friendship) =>
      (friendship.requesterId === actor.id && friendship.addresseeId === target.id) ||
      (friendship.requesterId === target.id && friendship.addresseeId === actor.id)
    );
    if (existing?.status === "accepted") return fail(res, 409, "You are already friends.");
    if (existing?.requesterId === target.id) {
      existing.status = "accepted";
      existing.updatedAt = new Date().toISOString();
    } else if (!existing) {
      const now = new Date().toISOString();
      state.friendships.push({
        id: crypto.randomUUID(), requesterId: actor.id, addresseeId: target.id,
        status: "pending", createdAt: now, updatedAt: now,
      });
    } else {
      return fail(res, 409, "Friend request already sent.");
    }
    writeSocialState(state);
    return ok(res, socialSnapshot(state, actor.id));
  });

  app.post("/api/social/friends/respond", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const friendship = state.friendships.find((entry) => entry.id === req.body?.friendshipId);
    if (!actor || !friendship || friendship.addresseeId !== actor.id || friendship.status !== "pending") {
      return fail(res, 404, "Friend request not found.");
    }
    if (req.body?.accept === true) {
      friendship.status = "accepted";
      friendship.updatedAt = new Date().toISOString();
    } else {
      state.friendships = state.friendships.filter((entry) => entry.id !== friendship.id);
    }
    writeSocialState(state);
    return ok(res, socialSnapshot(state, actor.id));
  });

  app.post("/api/social/friends/remove", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const friendId = typeof req.body?.friendId === "string" ? req.body.friendId : "";
    if (!actor || !friendId) return fail(res, 400, "Player and friend are required.");
    state.friendships = state.friendships.filter((friendship) => !(
      (friendship.requesterId === actor.id && friendship.addresseeId === friendId) ||
      (friendship.requesterId === friendId && friendship.addresseeId === actor.id)
    ));
    writeSocialState(state);
    return ok(res, socialSnapshot(state, actor.id));
  });

  app.post("/api/social/block", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const targetId = typeof req.body?.targetId === "string" ? req.body.targetId : "";
    if (!actor || !targetId || targetId === actor.id) return fail(res, 400, "A valid player is required.");
    if (req.body?.blocked === false) {
      actor.blockedIds = actor.blockedIds.filter((id) => id !== targetId);
    } else if (!actor.blockedIds.includes(targetId)) {
      actor.blockedIds.push(targetId);
      state.friendships = state.friendships.filter((friendship) => !(
        (friendship.requesterId === actor.id && friendship.addresseeId === targetId) ||
        (friendship.requesterId === targetId && friendship.addresseeId === actor.id)
      ));
    }
    writeSocialState(state);
    return ok(res, socialSnapshot(state, actor.id));
  });

  app.get("/api/social/messages", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.query.playerId, req.query.username, req.get("x-beatpulse-token"));
    const friendId = typeof req.query.friendId === "string" ? req.query.friendId : "";
    if (!actor || !friendId || !areFriends(state, actor.id, friendId)) {
      return fail(res, 403, "Messages are available between friends.");
    }
    const messages = state.messages.filter((message) =>
      !message.roomId &&
      ((message.senderId === actor.id && message.recipientId === friendId) ||
       (message.senderId === friendId && message.recipientId === actor.id))
    ).slice(-200);
    const now = new Date().toISOString();
    messages.forEach((message) => {
      if (message.recipientId === actor.id && !message.readAt) message.readAt = now;
    });
    writeSocialState(state);
    return ok(res, messages);
  });

  app.post("/api/social/messages", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const recipientId = typeof req.body?.recipientId === "string" ? req.body.recipientId : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 500) : "";
    const recipient = state.profiles.find((profile) => profile.id === recipientId);
    if (!actor || !recipient || !body || !areFriends(state, actor.id, recipientId)) {
      return fail(res, 400, "A friend and message are required.");
    }
    if (actor.blockedIds.includes(recipientId) || recipient.blockedIds.includes(actor.id)) {
      return fail(res, 403, "Messages cannot be sent to this player.");
    }
    const kind = req.body?.kind === "invite" ? "invite" : "text";
    const roomCode = kind === "invite" && typeof req.body?.roomCode === "string" ? req.body.roomCode : undefined;
    const message: SocialMessageRecord = {
      id: crypto.randomUUID(), senderId: actor.id, recipientId, body, kind, roomCode,
      createdAt: new Date().toISOString(),
    };
    state.messages.push(message);
    writeSocialState(state);
    return ok(res, message);
  });

  app.post("/api/multiplayer/rooms", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const songId = typeof req.body?.songId === "string" ? req.body.songId : "";
    if (!actor || !readSongs().some((song) => song.id === songId)) {
      return fail(res, 400, "Choose a community song before creating a room.");
    }
    state.rooms.forEach((room) => {
      room.participants = room.participants.filter((participant) => participant.playerId !== actor.id);
    });
    let code = "";
    do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); }
    while (state.rooms.some((room) => room.code === code));
    const now = new Date().toISOString();
    const room: MultiplayerRoomRecord = {
      id: crypto.randomUUID(), code, hostId: actor.id, songId, status: "lobby",
      createdAt: now, updatedAt: now, maxPlayers: 8,
      participants: [{
        playerId: actor.id, username: actor.username, ready: true, score: 0, combo: 0,
        accuracy: 0, progress: 0, finished: false, joinedAt: now, updatedAt: now,
      }],
    };
    state.rooms.push(room);
    writeSocialState(state);
    return ok(res, room);
  });

  app.post("/api/multiplayer/rooms/join", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
    const room = state.rooms.find((entry) => entry.code === code);
    if (!actor || !room) return fail(res, 404, "Room not found. Check the six-character code.");
    if (room.status !== "lobby") return fail(res, 409, "That match has already started.");
    if (room.participants.length >= room.maxPlayers) return fail(res, 409, "That room is full.");
    state.rooms.forEach((entry) => {
      if (entry.id !== room.id) entry.participants = entry.participants.filter((participant) => participant.playerId !== actor.id);
    });
    if (!room.participants.some((participant) => participant.playerId === actor.id)) {
      const now = new Date().toISOString();
      room.participants.push({
        playerId: actor.id, username: actor.username, ready: false, score: 0, combo: 0,
        accuracy: 0, progress: 0, finished: false, joinedAt: now, updatedAt: now,
      });
      room.updatedAt = now;
    }
    writeSocialState(state);
    return ok(res, room);
  });

  app.post("/api/multiplayer/rooms/:id/ready", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const room = actor ? getRoomForPlayer(state, req.params.id, actor.id) : null;
    if (!actor || !room || room.status !== "lobby") return fail(res, 404, "Open lobby not found.");
    const participant = room.participants.find((entry) => entry.playerId === actor.id)!;
    participant.ready = actor.id === room.hostId ? true : req.body?.ready === true;
    participant.updatedAt = new Date().toISOString();
    room.updatedAt = participant.updatedAt;
    writeSocialState(state);
    return ok(res, room);
  });

  app.post("/api/multiplayer/rooms/:id/start", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const room = actor ? getRoomForPlayer(state, req.params.id, actor.id) : null;
    if (!actor || !room || room.hostId !== actor.id || room.status !== "lobby") {
      return fail(res, 403, "Only the host can start an open lobby.");
    }
    if (room.participants.length < 2) return fail(res, 409, "At least two players are needed to start.");
    if (room.participants.some((participant) => !participant.ready)) return fail(res, 409, "Everyone must be ready.");
    const now = Date.now();
    room.status = "countdown";
    room.startAt = new Date(now + 15_000).toISOString();
    room.updatedAt = new Date(now).toISOString();
    room.participants.forEach((participant) => {
      participant.score = 0; participant.combo = 0; participant.accuracy = 0;
      participant.progress = 0; participant.finished = false;
    });
    writeSocialState(state);
    return ok(res, room);
  });

  app.post("/api/multiplayer/rooms/:id/progress", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const room = actor ? getRoomForPlayer(state, req.params.id, actor.id) : null;
    if (!actor || !room || !["countdown", "playing", "results"].includes(room.status)) {
      return fail(res, 404, "Active match not found.");
    }
    const participant = room.participants.find((entry) => entry.playerId === actor.id)!;
    participant.score = Math.max(participant.score, clampNumber(req.body?.score, 0));
    participant.combo = Math.max(0, clampNumber(req.body?.combo, 0));
    participant.accuracy = Math.max(0, Math.min(100, clampNumber(req.body?.accuracy, 0)));
    participant.progress = Math.max(participant.progress, Math.min(1, clampNumber(req.body?.progress, 0)));
    participant.finished = participant.finished || req.body?.finished === true;
    participant.updatedAt = new Date().toISOString();
    if (room.status === "countdown" && room.startAt && Date.now() >= new Date(room.startAt).getTime()) room.status = "playing";
    if (room.participants.every((entry) => entry.finished)) room.status = "results";
    room.updatedAt = participant.updatedAt;
    writeSocialState(state);
    return ok(res, room);
  });

  app.post("/api/multiplayer/rooms/:id/rematch", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const room = actor ? getRoomForPlayer(state, req.params.id, actor.id) : null;
    if (!actor || !room || room.hostId !== actor.id) return fail(res, 403, "Only the host can reset the room.");
    room.status = "lobby"; room.startAt = undefined; room.updatedAt = new Date().toISOString();
    room.participants.forEach((participant) => {
      participant.ready = participant.playerId === room.hostId;
      participant.score = 0; participant.combo = 0; participant.accuracy = 0;
      participant.progress = 0; participant.finished = false;
    });
    writeSocialState(state);
    return ok(res, room);
  });

  app.post("/api/multiplayer/rooms/:id/leave", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const room = actor ? getRoomForPlayer(state, req.params.id, actor.id) : null;
    if (!actor || !room) return fail(res, 404, "Room not found.");
    room.participants = room.participants.filter((participant) => participant.playerId !== actor.id);
    if (room.participants.length === 0) {
      state.rooms = state.rooms.filter((entry) => entry.id !== room.id);
    } else if (room.hostId === actor.id) {
      room.hostId = room.participants[0].playerId;
      room.participants[0].ready = true;
    }
    writeSocialState(state);
    return ok(res, { left: true });
  });

  app.get("/api/multiplayer/rooms/:id/messages", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.query.playerId, req.query.username, req.get("x-beatpulse-token"));
    const room = actor ? getRoomForPlayer(state, req.params.id, actor.id) : null;
    if (!actor || !room) return fail(res, 404, "Room not found.");
    return ok(res, state.messages.filter((message) => message.roomId === room.id).slice(-100));
  });

  app.post("/api/multiplayer/rooms/:id/messages", (req, res) => {
    const state = readSocialState();
    const actor = touchSocialProfile(state, req.body?.playerId, req.body?.username, req.get("x-beatpulse-token"));
    const room = actor ? getRoomForPlayer(state, req.params.id, actor.id) : null;
    const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 500) : "";
    if (!actor || !room || !body) return fail(res, 400, "Room and message are required.");
    const message: SocialMessageRecord = {
      id: crypto.randomUUID(), senderId: actor.id, roomId: room.id, body,
      kind: "text", createdAt: new Date().toISOString(),
    };
    state.messages.push(message);
    room.updatedAt = message.createdAt;
    writeSocialState(state);
    return ok(res, message);
  });

  app.post("/api/admin/login", (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) {
      return fail(res, 400, "Password is required.");
    }
    if (!verifyPassword(password, adminState.passwordHash)) {
      return fail(res, 401, "Invalid password.");
    }
    const token = createAdminToken(adminState.tokenSecret);
    return ok(res, { token });
  });

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token || !verifyAdminToken(token, adminState.tokenSecret)) {
      return fail(res, 401, "Unauthorized.");
    }
    next();
  };

  app.post("/api/admin/password", requireAdmin, (req, res) => {
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword.trim() : "";
    if (newPassword.length < 4) {
      return fail(res, 400, "Password must be at least 4 characters.");
    }
    adminState = {
      ...adminState,
      passwordHash: createPasswordHash(newPassword),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    saveAdminState(adminState);
    return ok(res, { message: "Password updated." });
  });

  app.post("/api/admin/storage/force-update", requireAdmin, (_req, res) => {
    try {
      ensureDirectories();
      const meta = migrateLocalStorage({ pruneOrphanReplays: true });
      const songs = readSongs();
      const globalScores = readGlobalScores();
      const replays = readReplays();

      return ok(res, {
        schemaVersion: meta.schemaVersion,
        checkedCollections: meta.checkedCollections,
        normalizedRows: meta.normalizedRows,
        rewrittenCollections: meta.migratedCollections,
        backups: meta.backups,
        songsCount: songs.length,
        globalScoresCount: globalScores.length,
        replaysCount: replays.length,
        relationshipActions: meta.relationshipActions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to force storage update.";
      return fail(res, 500, message);
    }
  });

  app.post("/api/admin/leaderboard/remove-player", requireAdmin, (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    if (!username) {
      return fail(res, 400, "Username is required.");
    }

    if (!reason) {
      return fail(res, 400, "Removal reason is required.");
    }

    const normalizedUsername = normalizeUsername(username);
    const currentGlobalScores = readGlobalScores();
    const removedGlobalScores = currentGlobalScores.filter(
      (entry) => normalizeUsername(entry.username) === normalizedUsername
    ).length;
    const nextGlobalScores = currentGlobalScores.filter(
      (entry) => normalizeUsername(entry.username) !== normalizedUsername
    );

    const currentSongs = readSongs();
    let affectedSongs = 0;
    let removedSongScores = 0;
    const nextSongs = currentSongs.map((song) => {
      const currentScores = song.scores || [];
      const filteredScores = currentScores.filter(
        (entry) => normalizeUsername(entry.username) !== normalizedUsername
      );

      if (filteredScores.length === currentScores.length) {
        return song;
      }

      affectedSongs += 1;
      removedSongScores += currentScores.length - filteredScores.length;
      return {
        ...song,
        scores: filteredScores,
        topScore: toTopScoreFromScores(filteredScores),
      };
    });

    if (removedGlobalScores === 0 && removedSongScores === 0) {
      return fail(res, 404, "Player not found on any leaderboard.");
    }

    writeGlobalScores(sortGlobalScoresDesc(nextGlobalScores));
    if (affectedSongs > 0) {
      writeSongs(nextSongs);
    }

    const result: LeaderboardModerationResult = {
      username,
      reason,
      removedGlobalScores,
      removedSongScores,
      affectedSongs,
    };

    return ok(res, result);
  });

  app.get("/api/songs", (_req, res) => {
    const songs = sortSongsDesc(readSongs());
    return ok(res, songs);
  });

  app.get("/api/songs/:id", (req, res) => {
    const songs = readSongs();
    const song = songs.find((entry) => entry.id === req.params.id);
    if (!song) return fail(res, 404, "Song not found");
    return ok(res, song);
  });

  app.post("/api/songs", uploader.single("audio"), (req, res) => {
    if (!req.file) {
      return fail(res, 400, "Audio file is required.");
    }

    const id = crypto.randomUUID();
    const name = (typeof req.body?.name === "string" && req.body.name.trim()) || "Untitled";
    const artist = (typeof req.body?.artist === "string" && req.body.artist.trim()) || "Unknown Artist";
    const difficulty = clampNumber(req.body?.difficulty, 0.5);
    const density = clampNumber(req.body?.density, 0.5);
    const laneVariety = clampNumber(req.body?.laneVariety, 0.5);
    const sliderProbability = clampNumber(req.body?.sliderProbability, 0.3);
    const stamina = clampNumber(req.body?.stamina, 0.5);
    const authorName = (typeof req.body?.authorName === "string" && req.body.authorName.trim()) || "Anonymous";

    let notes: unknown[] = [];
    try {
      const parsed = typeof req.body?.notes === "string" ? JSON.parse(req.body.notes) : [];
      if (Array.isArray(parsed)) notes = parsed;
    } catch {
      notes = [];
    }

    const fileExt = path.extname(req.file.originalname || ".mp3");
    const safeAudioName = sanitizeFileName(req.file.originalname ? path.parse(req.file.originalname).name : "audio");
    const safeFileName = `${safeAudioName}${fileExt || ".mp3"}`;
    const songDir = path.join(UPLOAD_DIR, "songs", id);
    const notesFile = "notes.json";
    const audioAbsolute = path.join(songDir, safeFileName);
    const notesAbsolute = path.join(songDir, notesFile);

    try {
      if (!fs.existsSync(songDir)) fs.mkdirSync(songDir, { recursive: true });
      writeFileAtomic(audioAbsolute, req.file.buffer);
      writeFileAtomic(notesAbsolute, JSON.stringify(notes));

      const newSong: CommunitySongRecord = {
        id,
        name,
        artist,
        difficulty,
        density,
        laneVariety,
        sliderProbability,
        stamina,
        topScore: 0,
        scores: [],
        authorName,
        createdAt: new Date().toISOString(),
      audioPath: `songs/${id}/${safeFileName}`,
      notesPath: `songs/${id}/${notesFile}`,
        audioUrl: `/api/uploads/songs/${id}/${safeFileName}`,
        notesUrl: `/api/uploads/songs/${id}/${notesFile}`,
        status: "ready",
      };

      const songs = readSongs();
      songs.push(newSong);
      writeSongs(songs);

      return ok(res, newSong);
    } catch (error) {
      if (fs.existsSync(songDir)) {
        fs.rmSync(songDir, { recursive: true, force: true });
      }
      console.error("Song upload failed:", error);
      return fail(res, 500, "Failed to save song.");
    }
  });

  app.patch("/api/songs/:id", requireAdmin, (req, res) => {
    const songs = readSongs();
    const index = songs.findIndex((entry) => entry.id === req.params.id);
    if (index === -1) return fail(res, 404, "Song not found");
    const current = songs[index];
    const updates = req.body || {};
    const next = {
      ...current,
      ...updates,
    };
    songs[index] = next as CommunitySongRecord;
    writeSongs(songs);

    const currentGlobalScores = readGlobalScores();
    const nextGlobalScores = currentGlobalScores.map((score) => {
      const matchesSong =
        score.songId === current.id ||
        ((!score.songId || score.songId.trim() === "") &&
          score.songName === current.name &&
          score.artist === current.artist);

      return matchesSong
        ? {
            ...score,
            songId: current.id,
            songName: next.name,
            artist: next.artist,
          }
        : score;
    });
    writeGlobalScores(sortGlobalScoresDesc(nextGlobalScores));

    const currentReplays = readReplays();
    const nextReplays = currentReplays.map((replay) => {
      const matchesSong =
        replay.songId === current.id ||
        ((!replay.songId || replay.songId.trim() === "") &&
          replay.songName === current.name &&
          replay.artist === current.artist);

      return matchesSong
        ? {
            ...replay,
            songId: current.id,
            songName: next.name,
            artist: next.artist,
          }
        : replay;
    });
    writeReplays(sortReplaysDesc(nextReplays));

    return ok(res, next as CommunitySongRecord);
  });

  app.post("/api/songs/:id/scores", (req, res) => {
    const songs = readSongs();
    const index = songs.findIndex((entry) => entry.id === req.params.id);
    if (index === -1) return fail(res, 404, "Song not found");
    const score = clampNumber(req.body?.score, Number.NaN);
    const accuracy = clampNumber(req.body?.accuracy, Number.NaN);
    const username = (typeof req.body?.username === "string" && req.body.username.trim()) || "Anonymous";

    if (!Number.isFinite(score) || !Number.isFinite(accuracy)) {
      return fail(res, 400, "Score and accuracy must be numbers.");
    }

    const song = songs[index];
    const nextSong = applySongScoreEntry(song, createSongScoreEntry(score, accuracy, username));
    songs[index] = nextSong;
    writeSongs(songs);
    return ok(res, nextSong);
  });

  app.delete("/api/songs/:id", requireAdmin, (req, res) => {
    const songs = readSongs();
    const song = songs.find((entry) => entry.id === req.params.id);
    if (!song) return fail(res, 404, "Song not found");

    const nextSongs = songs.filter((entry) => entry.id !== req.params.id);
    writeSongs(nextSongs);

    const nextGlobalScores = readGlobalScores().filter((score) => {
      if (score.songId === song.id) return false;
      if ((!score.songId || score.songId.trim() === "") && score.songName === song.name && score.artist === song.artist) {
        return false;
      }
      return true;
    });
    writeGlobalScores(sortGlobalScoresDesc(nextGlobalScores));

    const nextReplays = readReplays().filter((replay) => replay.songId !== song.id);
    writeReplays(sortReplaysDesc(nextReplays));

    const songDir = path.join(UPLOAD_DIR, "songs", req.params.id);
    const legacySongDir = path.join(UPLOAD_DIR, req.params.id);
    if (fs.existsSync(songDir)) {
      fs.rmSync(songDir, { recursive: true, force: true });
    }
    if (fs.existsSync(legacySongDir)) {
      fs.rmSync(legacySongDir, { recursive: true, force: true });
    }

    return ok(res, { message: "Song deleted." });
  });

  app.get("/api/global-scores", (req, res) => {
    const limit = clampNumber(req.query.limit, 100);
    const offset = clampNumber(req.query.offset, 0);
    const scores = sortGlobalScoresDesc(readGlobalScores());
    const start = Math.max(0, offset);
    const end = Math.min(scores.length, start + Math.max(1, limit));
    const chunk = scores.slice(start, end);
    const nextOffset = end < scores.length ? end : null;
    return ok(res, { scores: chunk, nextOffset });
  });

  app.post("/api/global-scores", (req, res) => {
    const score = clampNumber(req.body?.score, Number.NaN);
    const accuracy = clampNumber(req.body?.accuracy, Number.NaN);
    const requestedSongId = (typeof req.body?.songId === "string" && req.body.songId.trim()) || "";
    const username = (typeof req.body?.username === "string" && req.body.username.trim()) || "Anonymous";
    const date = (typeof req.body?.date === "string" && req.body.date.trim()) || new Date().toLocaleDateString();

    if (!Number.isFinite(score) || !Number.isFinite(accuracy)) {
      return fail(res, 400, "Score and accuracy must be numbers.");
    }

    const linkedSong = requestedSongId ? readSongs().find((entry) => entry.id === requestedSongId) || null : null;
    if (requestedSongId && !linkedSong) {
      return fail(res, 404, "Song not found.");
    }

    const songName = linkedSong
      ? linkedSong.name
      : (typeof req.body?.songName === "string" && req.body.songName.trim()) || "Unknown Song";
    const artist = linkedSong
      ? linkedSong.artist
      : (typeof req.body?.artist === "string" && req.body.artist.trim()) || "Unknown Artist";
    const scores = readGlobalScores();
    const newScore: GlobalScoreRecord = {
      id: crypto.randomUUID(),
      songId: linkedSong?.id || requestedSongId || undefined,
      score,
      accuracy,
      date,
      createdAt: new Date().toISOString(),
      username,
      songName,
      artist,
    };
    scores.push(newScore);
    writeGlobalScores(sortGlobalScoresDesc(scores));

    let updatedSong: CommunitySongRecord | null = null;
    if (linkedSong) {
      const songs = readSongs();
      const songIndex = songs.findIndex((entry) => entry.id === linkedSong.id);
      if (songIndex >= 0) {
        updatedSong = applySongScoreEntry(
          songs[songIndex],
          createSongScoreEntry(score, accuracy, username, date)
        );
        songs[songIndex] = updatedSong;
        writeSongs(songs);
      }
    }

    return ok(res, { id: newScore.id, song: updatedSong });
  });

  app.get("/api/replays", (_req, res) => {
    const replays = sortReplaysDesc(readReplays());
    return ok(res, replays);
  });

  app.post("/api/replays", (req, res) => {
    const body = req.body || {};
    const songId = (typeof body.songId === "string" && body.songId.trim()) || "";
    const songName = (typeof body.songName === "string" && body.songName.trim()) || "";
    const score = clampNumber(body.score, Number.NaN);
    const accuracy = clampNumber(body.accuracy, Number.NaN);

    if (!songId || !songName || !Number.isFinite(score) || !Number.isFinite(accuracy)) {
      return fail(res, 400, "songId, songName, score and accuracy are required.");
    }

    const linkedSong = readSongs().find((entry) => entry.id === songId);
    if (!linkedSong) {
      return fail(res, 404, "Song not found.");
    }

    const replays = readReplays();
    const newReplay: ReplayRecord = {
      id: crypto.randomUUID(),
      songId: linkedSong.id,
      songName: linkedSong.name,
      artist: linkedSong.artist,
      difficulty: clampNumber(body.difficulty, 0.5),
      density: clampNumber(body.density, 0.5),
      laneVariety: clampNumber(body.laneVariety, 0.5),
      sliderProbability: clampNumber(body.sliderProbability, 0.3),
      stamina: clampNumber(body.stamina, 0.5),
      score,
      accuracy,
      date: (typeof body.date === "string" && body.date.trim()) || new Date().toLocaleDateString(),
      createdAt: new Date().toISOString(),
      events: Array.isArray(body.events) ? body.events : [],
    };
    replays.push(newReplay);
    writeReplays(sortReplaysDesc(replays));
    return ok(res, newReplay);
  });

  app.get("/api/integrity", (_req, res) => {
    return ok(res, collectLocalIntegrityReport());
  });

  app.get("/api/audio-proxy", async (req, res) => {
    const audioUrl = req.query.url as string;
    if (!audioUrl) {
      return res.status(400).send("Missing URL");
    }
    try {
      const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string"
        ? req.headers["x-forwarded-proto"].split(",")[0]
        : req.protocol;
      const baseUrl = `${forwardedProto}://${req.get("host")}`;
      const resolvedUrl = new URL(audioUrl, baseUrl).toString();
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        return res.status(response.status).send("Failed to fetch audio");
      }
      const buffer = await response.arrayBuffer();
      res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Proxy error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
