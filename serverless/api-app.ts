import express, { type NextFunction, type Request, type Response } from "express";
import { sql } from "@vercel/postgres";
import multer from "multer";
import { put, del as deleteBlob } from "@vercel/blob";
import * as crypto from "node:crypto";
import { handleBlobUploadRequest } from "./blob-upload-handler.ts";

const app = express();
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 150 } });
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const BLOB_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const STORAGE_SCHEMA_VERSION = 3;

let storageReadyPromise: Promise<void> | null = null;

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface AdminState {
  passwordHash: string;
  tokenSecret: string;
  updatedAt: string;
}

interface PersistedAdminState extends AdminState {
  rowRef: string | null;
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

function ensureDatabaseEnvironment() {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL/POSTGRES_URL is not configured.");
  }
}

function ensureBlobEnvironment() {
  if (!BLOB_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured.");
  }
}

async function prepareStorageSchema() {
  ensureDatabaseEnvironment();

  await sql`
    CREATE TABLE IF NOT EXISTS admin_state (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      token_secret TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      audio_url TEXT NOT NULL,
      audio_path TEXT NOT NULL,
      notes_url TEXT NOT NULL,
      notes_path TEXT NOT NULL,
      difficulty REAL NOT NULL,
      density REAL NOT NULL,
      lane_variety REAL NOT NULL,
      slider_probability REAL NOT NULL,
      stamina REAL NOT NULL,
      top_score REAL NOT NULL,
      scores JSONB NOT NULL DEFAULT '[]'::jsonb,
      author_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS global_scores (
      id TEXT PRIMARY KEY,
      song_id TEXT,
      score REAL NOT NULL,
      accuracy REAL NOT NULL,
      date TEXT NOT NULL,
      username TEXT NOT NULL,
      song_name TEXT NOT NULL,
      artist TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS replays (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL,
      song_name TEXT NOT NULL,
      artist TEXT NOT NULL,
      difficulty REAL NOT NULL,
      density REAL NOT NULL,
      lane_variety REAL NOT NULL,
      slider_probability REAL NOT NULL,
      stamina REAL NOT NULL,
      score REAL NOT NULL,
      accuracy REAL NOT NULL,
      date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      events JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS storage_meta (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `;

  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_path TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_path TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS density REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS lane_variety REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS slider_probability REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS stamina REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS top_score REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS scores JSONB`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS author_name TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS status TEXT`;

  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS song_id TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS song_name TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS artist TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;

  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS song_id TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS song_name TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS density REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS lane_variety REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS slider_probability REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS stamina REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS events JSONB`;
}

async function ensureStorageReady() {
  if (!storageReadyPromise) {
    storageReadyPromise = (async () => {
      await prepareStorageSchema();
      await migratePersistedStorage();
    })().catch((error) => {
      storageReadyPromise = null;
      throw error;
    });
  }

  return storageReadyPromise;
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

function clampNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
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
  return normalized || null;
}

function basenameFromPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "file";
}

function canonicalizeSongAssetPath(id: string, candidate: string | null, fallbackFileName: string) {
  const fileName = candidate ? basenameFromPath(candidate) : fallbackFileName;
  if (!candidate) return `songs/${id}/${fallbackFileName}`;
  if (candidate.startsWith("songs/")) return candidate;
  return `songs/${id}/${fileName}`;
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
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

function isSafeSongId(value: string) {
  return /^[A-Za-z0-9-]{8,64}$/.test(value);
}

function isSafeSongAssetPath(id: string, value: string) {
  return value.startsWith(`songs/${id}/`) && /^songs\/[A-Za-z0-9-]{8,64}\/[A-Za-z0-9_.-]{1,180}$/.test(value);
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

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^\w.-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "upload";
}

function parseScoreArray(raw: Json, createdAt = new Date().toISOString()): ScoreRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const row = entry as Partial<ScoreRecord>;
    return {
      score: clampNumber(row.score, 0),
      accuracy: clampNumber(row.accuracy, 0),
      date: toDisplayDate(row.date, createdAt),
      username: toText(row.username, "Anonymous"),
    };
  });
}

function parseEventsArray(raw: Json): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function normalizeSongRow(row: any): CommunitySongRecord {
  const id = toText(row.id, crypto.randomUUID());
  const createdAt = toIsoTimestamp(row.created_at ?? row.createdAt);
  const difficulty = clampNumber(row.difficulty ?? row.complexity, 0.5);
  const density = clampNumber(row.density, difficulty);
  const laneVariety = clampNumber(row.lane_variety ?? row.laneVariety, difficulty);
  const sliderProbability = clampNumber(row.slider_probability ?? row.sliderProbability, 0.3);
  const stamina = clampNumber(row.stamina, 0.5);
  const scores = sortScoresDesc(parseScoreArray(row.scores as Json, createdAt));
  const audioPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(row.audio_path ?? row.audioPath ?? row.audio_url ?? row.audioUrl),
    "audio.mp3"
  );
  const notesPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(row.notes_path ?? row.notesPath ?? row.notes_url ?? row.notesUrl),
    "notes.json"
  );
  const topScore = Math.max(clampNumber(row.top_score ?? row.topScore, 0), toTopScoreFromScores(scores));
  return {
    id,
    name: toText(row.name, "Untitled"),
    artist: toText(row.artist, "Unknown Artist"),
    audioUrl: toText(row.audio_url ?? row.audioUrl, ""),
    audioPath,
    notesUrl: toText(row.notes_url ?? row.notesUrl, ""),
    notesPath,
    difficulty,
    density,
    laneVariety,
    sliderProbability,
    stamina,
    topScore,
    scores,
    authorName: toText(row.author_name ?? row.authorName, "Anonymous"),
    createdAt,
    status: "ready",
  };
}

function normalizeReplayRow(row: any): ReplayRecord {
  const createdAt = toIsoTimestamp(row.created_at ?? row.createdAt);
  const difficulty = clampNumber(row.difficulty ?? row.complexity, 0.5);
  return {
    id: toText(row.id, crypto.randomUUID()),
    songId: toText(row.song_id ?? row.songId, ""),
    songName: toText(row.song_name ?? row.songName, "Unknown Song"),
    artist: toText(row.artist, "Unknown Artist"),
    difficulty,
    density: clampNumber(row.density, difficulty),
    laneVariety: clampNumber(row.lane_variety ?? row.laneVariety, difficulty),
    sliderProbability: clampNumber(row.slider_probability ?? row.sliderProbability, 0.3),
    stamina: clampNumber(row.stamina, 0.5),
    score: clampNumber(row.score, 0),
    accuracy: clampNumber(row.accuracy, 0),
    date: toDisplayDate(row.date, createdAt),
    createdAt,
    events: parseEventsArray(row.events as Json),
  };
}

function normalizeGlobalScoreRow(row: any): GlobalScoreRecord {
  const createdAt = toIsoTimestamp(row.created_at ?? row.createdAt);
  return {
    id: toText(row.id, crypto.randomUUID()),
    songId: toText(row.song_id ?? row.songId, ""),
    score: clampNumber(row.score, 0),
    accuracy: clampNumber(row.accuracy, 0),
    date: toDisplayDate(row.date, createdAt),
    username: toText(row.username, "Anonymous"),
    createdAt,
    songName: toText(row.song_name ?? row.songName, "Unknown Song"),
    artist: toText(row.artist, "Unknown Artist"),
  };
}

function sortScoresDesc(scores: ScoreRecord[]) {
  return scores.sort((a, b) => b.score - a.score);
}

function ok<T>(res: Response, data: T) {
  res.json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ success: false, error });
}

async function getAdminState(): Promise<PersistedAdminState> {
  const { rows } = await sql`
    SELECT ctid::text AS row_ref, password_hash, token_secret, updated_at
    FROM admin_state
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `;
  if (rows.length === 0) {
    const initialState: AdminState = {
      passwordHash: createPasswordHash(ADMIN_DEFAULT_PASSWORD),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    try {
      await sql`
        INSERT INTO admin_state (id, password_hash, token_secret, updated_at)
        VALUES ('default', ${initialState.passwordHash}, ${initialState.tokenSecret}, ${initialState.updatedAt})
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("invalid input syntax for type integer")) {
        throw error;
      }

      await sql`
        INSERT INTO admin_state (id, password_hash, token_secret, updated_at)
        VALUES (1, ${initialState.passwordHash}, ${initialState.tokenSecret}, ${initialState.updatedAt})
      `;
    }

    return getAdminState();
  }

  const state = rows[0] as { row_ref: string; password_hash: string; token_secret: string; updated_at: Date };
  const resolvedState: PersistedAdminState = {
    passwordHash: state.password_hash,
    tokenSecret: state.token_secret,
    updatedAt: new Date(state.updated_at).toISOString(),
    rowRef: state.row_ref,
  };

  if (process.env.ADMIN_PASSWORD && !verifyPassword(process.env.ADMIN_PASSWORD, resolvedState.passwordHash)) {
    resolvedState.passwordHash = createPasswordHash(process.env.ADMIN_PASSWORD);
    resolvedState.updatedAt = new Date().toISOString();
    await sql`
      UPDATE admin_state
      SET password_hash = ${resolvedState.passwordHash}, updated_at = ${resolvedState.updatedAt}
      WHERE ctid::text = ${resolvedState.rowRef}
    `;
  }

  return resolvedState;
}

async function writeAdminState(state: PersistedAdminState) {
  await sql`
    UPDATE admin_state
    SET password_hash = ${state.passwordHash}, token_secret = ${state.tokenSecret}, updated_at = ${state.updatedAt}
    WHERE ctid::text = ${state.rowRef}
  `;
}

async function readSongs(): Promise<CommunitySongRecord[]> {
  const { rows } = await sql`SELECT * FROM songs ORDER BY created_at DESC`;
  return rows.map(normalizeSongRow);
}

async function readSong(id: string): Promise<CommunitySongRecord | null> {
  const { rows } = await sql`SELECT * FROM songs WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return null;
  return normalizeSongRow(rows[0]);
}

async function readGlobalScores(): Promise<GlobalScoreRecord[]> {
  const { rows } = await sql`SELECT * FROM global_scores ORDER BY score DESC, created_at DESC`;
  return rows.map(normalizeGlobalScoreRow);
}

async function readReplays(): Promise<ReplayRecord[]> {
  const { rows } = await sql`SELECT * FROM replays ORDER BY created_at DESC`;
  return rows.map(normalizeReplayRow);
}

async function reconcileDataRelationships(options?: { pruneOrphanReplays?: boolean }) {
  const [songs, globalScores, replays] = await Promise.all([
    readSongs(),
    readGlobalScores(),
    readReplays(),
  ]);
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

  const { rows: globalRows } = await sql`SELECT ctid::text AS ctid, * FROM global_scores`;
  for (const row of globalRows) {
    const normalized = normalizeGlobalScoreRow(row);
    const linkedSong = resolveSongForGlobalScore(normalized, lookup);
    if (!linkedSong) {
      if (normalized.songId) {
        summary.unresolvedGlobalScores += 1;
      }
      continue;
    }

    const needsSongLink = normalized.songId !== linkedSong.id;
    const needsMetadata = normalized.songName !== linkedSong.name || normalized.artist !== linkedSong.artist;
    if (!needsSongLink && !needsMetadata) {
      continue;
    }

    if (needsSongLink) summary.linkedGlobalScores += 1;
    if (needsMetadata) summary.updatedGlobalScoreMetadata += 1;

    await sql`
      UPDATE global_scores
      SET song_id = ${linkedSong.id}, song_name = ${linkedSong.name}, artist = ${linkedSong.artist}
      WHERE ctid::text = ${row.ctid}
    `;
  }

  const { rows: replayRows } = await sql`SELECT ctid::text AS ctid, * FROM replays`;
  for (const row of replayRows) {
    const normalized = normalizeReplayRow(row);
    const linkedSong = resolveSongForReplay(normalized, lookup);
    if (!linkedSong) {
      summary.unresolvedReplays += 1;
      if (pruneOrphanReplays) {
        await sql`DELETE FROM replays WHERE ctid::text = ${row.ctid}`;
        summary.removedOrphanReplays += 1;
      }
      continue;
    }

    const needsSongLink = normalized.songId !== linkedSong.id;
    const needsMetadata = normalized.songName !== linkedSong.name || normalized.artist !== linkedSong.artist;
    if (!needsSongLink && !needsMetadata) {
      continue;
    }

    if (needsSongLink) summary.linkedReplays += 1;
    if (needsMetadata) summary.updatedReplayMetadata += 1;

    await sql`
      UPDATE replays
      SET song_id = ${linkedSong.id}, song_name = ${linkedSong.name}, artist = ${linkedSong.artist}
      WHERE ctid::text = ${row.ctid}
    `;
  }

  return summary;
}

async function collectIntegrityIssues() {
  const [songs, globalScores, replays] = await Promise.all([
    readSongs(),
    readGlobalScores(),
    readReplays(),
  ]);
  const lookup = buildSongLookup(songs);

  const replayLinkIssues: ReplayLinkIssue[] = [];
  replays.forEach((replay) => {
    const linkedSong = resolveSongForReplay(replay, lookup);
    if (!linkedSong) {
      replayLinkIssues.push({
        id: replay.id,
        songId: replay.songId,
        songName: replay.songName,
        artist: replay.artist,
        issue: "missing-song",
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
        issue: "metadata-mismatch",
        expectedSongId: linkedSong.id,
        expectedSongName: linkedSong.name,
        expectedArtist: linkedSong.artist,
      });
    }
  });

  const globalScoreLinkIssues: GlobalScoreLinkIssue[] = [];
  globalScores.forEach((score) => {
    const linkedSong = resolveSongForGlobalScore(score, lookup);
    if (!linkedSong) {
      if (score.songId) {
        globalScoreLinkIssues.push({
            id: score.id,
            songId: score.songId,
            songName: score.songName,
            artist: score.artist,
            issue: "missing-song",
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
        issue: "missing-song-link",
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
        issue: "metadata-mismatch",
        expectedSongId: linkedSong.id,
        expectedSongName: linkedSong.name,
        expectedArtist: linkedSong.artist,
      });
    }
  });

  return {
    songs,
    globalScores,
    replays,
    replayLinkIssues,
    globalScoreLinkIssues,
  };
}

async function getStoredSchemaVersion() {
  const { rows } = await sql`SELECT value FROM storage_meta WHERE key = 'schema_version' LIMIT 1`;
  const rawValue = rows[0]?.value as { version?: number | string } | undefined;
  return clampNumber(rawValue?.version, 0);
}

async function setStoredSchemaVersion(details: Record<string, number>) {
  const payload = {
    version: STORAGE_SCHEMA_VERSION,
    ...details,
  };

  await sql`
    INSERT INTO storage_meta (key, value, updated_at)
    VALUES ('schema_version', ${JSON.stringify(payload)}::jsonb, ${new Date().toISOString()})
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `;
}

async function getStorageCollectionCounts(): Promise<StorageNormalizedRows> {
  const [{ rows: songRows }, { rows: globalScoreRows }, { rows: replayRows }] = await Promise.all([
    sql`SELECT COUNT(*) AS c FROM songs`,
    sql`SELECT COUNT(*) AS c FROM global_scores`,
    sql`SELECT COUNT(*) AS c FROM replays`,
  ]);

  return {
    songs: clampNumber(songRows[0]?.c, 0),
    globalScores: clampNumber(globalScoreRows[0]?.c, 0),
    replays: clampNumber(replayRows[0]?.c, 0),
  };
}

async function migrateSongRows() {
  const { rows } = await sql`SELECT ctid::text AS ctid, * FROM songs`;
  let migrated = 0;

  for (const row of rows) {
    const normalized = normalizeSongRow(row);
    await sql`
      UPDATE songs
      SET
        id = ${normalized.id},
        name = ${normalized.name},
        artist = ${normalized.artist},
        audio_url = ${normalized.audioUrl},
        audio_path = ${normalized.audioPath},
        notes_url = ${normalized.notesUrl},
        notes_path = ${normalized.notesPath},
        difficulty = ${normalized.difficulty},
        density = ${normalized.density},
        lane_variety = ${normalized.laneVariety},
        slider_probability = ${normalized.sliderProbability},
        stamina = ${normalized.stamina},
        top_score = ${normalized.topScore},
        scores = ${JSON.stringify(normalized.scores)}::jsonb,
        author_name = ${normalized.authorName},
        created_at = ${normalized.createdAt},
        status = ${normalized.status}
      WHERE ctid::text = ${row.ctid}
    `;
    migrated += 1;
  }

  return migrated;
}

async function migrateGlobalScoreRows() {
  const { rows } = await sql`SELECT ctid::text AS ctid, * FROM global_scores`;
  let migrated = 0;

  for (const row of rows) {
    const normalized = normalizeGlobalScoreRow(row);
    await sql`
      UPDATE global_scores
      SET
        id = ${normalized.id},
        song_id = ${normalized.songId || null},
        score = ${normalized.score},
        accuracy = ${normalized.accuracy},
        date = ${normalized.date},
        username = ${normalized.username},
        song_name = ${normalized.songName},
        artist = ${normalized.artist},
        created_at = ${normalized.createdAt}
      WHERE ctid::text = ${row.ctid}
    `;
    migrated += 1;
  }

  return migrated;
}

async function migrateReplayRows() {
  const { rows } = await sql`SELECT ctid::text AS ctid, * FROM replays`;
  let migrated = 0;

  for (const row of rows) {
    const normalized = normalizeReplayRow(row);
    await sql`
      UPDATE replays
      SET
        id = ${normalized.id},
        song_id = ${normalized.songId},
        song_name = ${normalized.songName},
        artist = ${normalized.artist},
        difficulty = ${normalized.difficulty},
        density = ${normalized.density},
        lane_variety = ${normalized.laneVariety},
        slider_probability = ${normalized.sliderProbability},
        stamina = ${normalized.stamina},
        score = ${normalized.score},
        accuracy = ${normalized.accuracy},
        date = ${normalized.date},
        created_at = ${normalized.createdAt},
        events = ${JSON.stringify(normalized.events)}::jsonb
      WHERE ctid::text = ${row.ctid}
    `;
    migrated += 1;
  }

  return migrated;
}

async function migratePersistedStorage(force = false) {
  const currentVersion = await getStoredSchemaVersion();
  const checkedCollections = ["songs", "global-scores", "replays"];

  if (!force && currentVersion >= STORAGE_SCHEMA_VERSION) {
    const relationshipActions = await reconcileDataRelationships();
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      checkedCollections,
      normalizedRows: await getStorageCollectionCounts(),
      relationshipActions,
    };
  }

  const [songsMigrated, globalScoresMigrated, replaysMigrated] = await Promise.all([
    migrateSongRows(),
    migrateGlobalScoreRows(),
    migrateReplayRows(),
  ]);
  const relationshipActions = await reconcileDataRelationships({ pruneOrphanReplays: force });

  await setStoredSchemaVersion({
    songsMigrated,
    globalScoresMigrated,
    replaysMigrated,
    linkedGlobalScores: relationshipActions.linkedGlobalScores,
    updatedGlobalScoreMetadata: relationshipActions.updatedGlobalScoreMetadata,
    linkedReplays: relationshipActions.linkedReplays,
    updatedReplayMetadata: relationshipActions.updatedReplayMetadata,
    removedOrphanReplays: relationshipActions.removedOrphanReplays,
  });

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    checkedCollections,
    normalizedRows: {
      songs: songsMigrated,
      globalScores: globalScoresMigrated,
      replays: replaysMigrated,
    },
    relationshipActions,
  };
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

async function persistSongScoreboard(song: CommunitySongRecord) {
  await sql`
    UPDATE songs
    SET scores = ${JSON.stringify(song.scores)}::jsonb, top_score = ${song.topScore}
    WHERE id = ${song.id}
  `;
}

async function hasRemoteBlob(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  ok(res, { status: "ok", message: "BeatPulse server is healthy" });
});

app.post("/api/blob/upload", async (req, res) => {
  return handleBlobUploadRequest(req, res);
});

app.post("/api/admin/login", async (req, res) => {
  try {
    await ensureStorageReady();
    const adminState = await getAdminState();

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) {
      return fail(res, 400, "Password is required.");
    }
    if (!verifyPassword(password, adminState.passwordHash)) {
      return fail(res, 401, "Invalid password.");
    }

    const token = createAdminToken(adminState.tokenSecret);
    return ok(res, { token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process login.";
    return fail(res, 500, message);
  }
});

const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureStorageReady();
    const token = extractBearerToken(req);
    const adminState = await getAdminState();
    if (!token || !verifyAdminToken(token, adminState.tokenSecret)) {
      return fail(res, 401, "Unauthorized.");
    }
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized.";
    return fail(res, 500, message);
  }
};

app.post("/api/admin/password", requireAdmin, async (req, res) => {
  try {
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword.trim() : "";
    if (newPassword.length < 4) {
      return fail(res, 400, "Password must be at least 4 characters.");
    }

    const adminState: PersistedAdminState = {
      ...(await getAdminState()),
      passwordHash: createPasswordHash(newPassword),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    await writeAdminState(adminState);
    return ok(res, { message: "Password updated." });
  } catch {
    return fail(res, 500, "Failed to update password.");
  }
});

app.post("/api/admin/storage/force-update", requireAdmin, async (_req, res) => {
  try {
    await prepareStorageSchema();
    const migration = await migratePersistedStorage(true);
    const counts = await getStorageCollectionCounts();

    return ok(res, {
      ...migration,
      songsCount: counts.songs,
      globalScoresCount: counts.globalScores,
      replaysCount: counts.replays,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to force storage update.";
    return fail(res, 500, message);
  }
});

app.post("/api/admin/leaderboard/remove-player", requireAdmin, async (req, res) => {
  try {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    if (!username) {
      return fail(res, 400, "Username is required.");
    }

    if (!reason) {
      return fail(res, 400, "Removal reason is required.");
    }

    await ensureStorageReady();

    const normalizedUsername = normalizeUsername(username);
    const { rows: matchingGlobalRows } = await sql`
      SELECT id FROM global_scores WHERE LOWER(username) = ${normalizedUsername}
    `;
    const removedGlobalScores = matchingGlobalRows.length;

    if (removedGlobalScores > 0) {
      await sql`DELETE FROM global_scores WHERE LOWER(username) = ${normalizedUsername}`;
    }

    const songs = await readSongs();
    let affectedSongs = 0;
    let removedSongScores = 0;

    for (const song of songs) {
      const currentScores = song.scores || [];
      const filteredScores = currentScores.filter(
        (entry) => normalizeUsername(entry.username) !== normalizedUsername
      );

      if (filteredScores.length === currentScores.length) {
        continue;
      }

      affectedSongs += 1;
      removedSongScores += currentScores.length - filteredScores.length;
      const topScore = toTopScoreFromScores(filteredScores);

      await sql`
        UPDATE songs
        SET scores = ${JSON.stringify(filteredScores)}::jsonb, top_score = ${topScore}
        WHERE id = ${song.id}
      `;
    }

    if (removedGlobalScores === 0 && removedSongScores === 0) {
      return fail(res, 404, "Player not found on any leaderboard.");
    }

    const result: LeaderboardModerationResult = {
      username,
      reason,
      removedGlobalScores,
      removedSongScores,
      affectedSongs,
    };

    return ok(res, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove player from leaderboard.";
    return fail(res, 500, message);
  }
});

app.get("/api/songs", async (_req, res) => {
  try {
    await ensureStorageReady();
    const songs = await readSongs();
    return ok(res, songs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load songs.";
    return fail(res, 500, message);
  }
});

app.get("/api/songs/:id", async (req, res) => {
  try {
    await ensureStorageReady();
    const song = await readSong(req.params.id);
    if (!song) return fail(res, 404, "Song not found");
    return ok(res, song);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load song.";
    return fail(res, 500, message);
  }
});

app.post("/api/songs", uploader.single("audio"), async (req, res) => {
  try {
    await ensureStorageReady();
    const name = (typeof req.body?.name === "string" && req.body.name.trim()) || "Untitled";
    const artist = (typeof req.body?.artist === "string" && req.body.artist.trim()) || "Unknown Artist";
    const difficulty = clampNumber(req.body?.difficulty, 0.5);
    const density = clampNumber(req.body?.density, 0.5);
    const laneVariety = clampNumber(req.body?.laneVariety, 0.5);
    const sliderProbability = clampNumber(req.body?.sliderProbability, 0.3);
    const stamina = clampNumber(req.body?.stamina, 0.5);
    const authorName = (typeof req.body?.authorName === "string" && req.body.authorName.trim()) || "Anonymous";
    const createdAt = new Date().toISOString();
    let id = "";
    let audioPath = "";
    let notesPath = "";
    let audioUrl = "";
    let notesUrl = "";

    if (req.file) {
      ensureBlobEnvironment();
      id = crypto.randomUUID();

      let notes: unknown[] = [];
      try {
        const parsed = typeof req.body?.notes === "string" ? JSON.parse(req.body.notes) : [];
        if (Array.isArray(parsed)) notes = parsed;
      } catch {
        notes = [];
      }

      const fileExt = (req.file.originalname || ".mp3").match(/\.[0-9a-z]{1,8}$/i)?.[0] || ".mp3";
      const safeAudioName = sanitizeFileName(
        req.file.originalname ? req.file.originalname.replace(fileExt, "") : "audio"
      );
      const safeFileName = `${safeAudioName}${fileExt}`;
      audioPath = `songs/${id}/${safeFileName}`;
      notesPath = `songs/${id}/notes.json`;

      const audioBlob = await put(audioPath, req.file.buffer, {
        access: "public",
        token: BLOB_WRITE_TOKEN,
      });
      const notesBlob = await put(notesPath, JSON.stringify(notes), {
        access: "public",
        contentType: "application/json",
        token: BLOB_WRITE_TOKEN,
      });

      audioUrl = audioBlob.url;
      notesUrl = notesBlob.url;
    } else {
      id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      audioUrl = typeof req.body?.audioUrl === "string" ? req.body.audioUrl.trim() : "";
      notesUrl = typeof req.body?.notesUrl === "string" ? req.body.notesUrl.trim() : "";
      const providedAudioPath = extractRelativeAssetPath(req.body?.audioPath);
      const providedNotesPath = extractRelativeAssetPath(req.body?.notesPath);

      if (!id || !isSafeSongId(id)) {
        return fail(res, 400, "A valid song id is required.");
      }

      if (!audioUrl || !notesUrl || !providedAudioPath || !providedNotesPath) {
        return fail(res, 400, "Uploaded song asset details are required.");
      }

      audioPath = canonicalizeSongAssetPath(id, providedAudioPath, "audio.mp3");
      notesPath = canonicalizeSongAssetPath(id, providedNotesPath, "notes.json");

      if (
        !isAbsoluteHttpUrl(audioUrl) ||
        !isAbsoluteHttpUrl(notesUrl) ||
        !isSafeSongAssetPath(id, audioPath) ||
        !isSafeSongAssetPath(id, notesPath)
      ) {
        return fail(res, 400, "Uploaded asset details are invalid.");
      }
    }

    if (await readSong(id)) {
      return fail(res, 409, "Song already exists.");
    }

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
      createdAt,
      audioPath,
      notesPath,
      audioUrl,
      notesUrl,
      status: "ready",
    };

    await sql`
      INSERT INTO songs (
        id, name, artist, audio_url, audio_path, notes_url, notes_path,
        difficulty, density, lane_variety, slider_probability, stamina,
        top_score, scores, author_name, created_at, status
      )
      VALUES (
        ${newSong.id}, ${newSong.name}, ${newSong.artist}, ${newSong.audioUrl}, ${newSong.audioPath}, ${newSong.notesUrl}, ${newSong.notesPath},
        ${newSong.difficulty}, ${newSong.density}, ${newSong.laneVariety}, ${newSong.sliderProbability}, ${newSong.stamina},
        ${newSong.topScore}, ${JSON.stringify(newSong.scores)}::jsonb, ${newSong.authorName}, ${newSong.createdAt}, ${newSong.status}
      )
    `;

    return ok(res, newSong);
  } catch (error) {
    return fail(res, 500, error instanceof Error ? error.message : "Failed to save song.");
  }
});

app.patch("/api/songs/:id", requireAdmin, async (req, res) => {
  try {
    await ensureStorageReady();
    const song = await readSong(req.params.id);
    if (!song) return fail(res, 404, "Song not found");

    const updates = req.body || {};
    const next: CommunitySongRecord = {
      ...song,
      ...updates,
      difficulty: clampNumber(updates.difficulty, song.difficulty),
      density: clampNumber(updates.density, song.density),
      laneVariety: clampNumber(updates.laneVariety, song.laneVariety),
      sliderProbability: clampNumber(updates.sliderProbability, song.sliderProbability),
      stamina: clampNumber(updates.stamina, song.stamina),
      topScore: clampNumber(updates.topScore, song.topScore),
      name: typeof updates.name === "string" && updates.name.trim() ? updates.name.trim() : song.name,
      artist: typeof updates.artist === "string" && updates.artist.trim() ? updates.artist.trim() : song.artist,
      authorName: typeof updates.authorName === "string" && updates.authorName.trim() ? updates.authorName.trim() : song.authorName,
    };

    await sql`
      UPDATE songs
      SET
        name = ${next.name},
        artist = ${next.artist},
        difficulty = ${next.difficulty},
        density = ${next.density},
        lane_variety = ${next.laneVariety},
        slider_probability = ${next.sliderProbability},
        stamina = ${next.stamina},
        top_score = ${next.topScore},
        scores = ${JSON.stringify(next.scores)}::jsonb,
        author_name = ${next.authorName},
        status = ${next.status}
      WHERE id = ${req.params.id}
    `;

    await sql`
      UPDATE global_scores
      SET song_id = ${song.id}, song_name = ${next.name}, artist = ${next.artist}
      WHERE song_id = ${song.id}
         OR ((song_id IS NULL OR song_id = '') AND song_name = ${song.name} AND artist = ${song.artist})
    `;

    await sql`
      UPDATE replays
      SET song_id = ${song.id}, song_name = ${next.name}, artist = ${next.artist}
      WHERE song_id = ${song.id}
         OR ((song_id IS NULL OR song_id = '') AND song_name = ${song.name} AND artist = ${song.artist})
    `;

    return ok(res, next);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update song.";
    return fail(res, 500, message);
  }
});

app.post("/api/songs/:id/scores", async (req, res) => {
  try {
    await ensureStorageReady();
    const song = await readSong(req.params.id);
    if (!song) return fail(res, 404, "Song not found");

    const score = clampNumber(req.body?.score, Number.NaN);
    const accuracy = clampNumber(req.body?.accuracy, Number.NaN);
    const username = (typeof req.body?.username === "string" && req.body.username.trim()) || "Anonymous";

    if (!Number.isFinite(score) || !Number.isFinite(accuracy)) {
      return fail(res, 400, "Score and accuracy must be numbers.");
    }

    const nextSong = applySongScoreEntry(song, createSongScoreEntry(score, accuracy, username));
    await persistSongScoreboard(nextSong);

    return ok(res, nextSong);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save score.";
    return fail(res, 500, message);
  }
});

app.delete("/api/songs/:id", requireAdmin, async (req, res) => {
  try {
    await ensureStorageReady();
    ensureBlobEnvironment();
    const song = await readSong(req.params.id);
    if (!song) return fail(res, 404, "Song not found");

    await sql`DELETE FROM songs WHERE id = ${req.params.id}`;
    await sql`
      DELETE FROM replays
      WHERE song_id = ${song.id}
         OR ((song_id IS NULL OR song_id = '') AND song_name = ${song.name} AND artist = ${song.artist})
    `;
    await sql`
      DELETE FROM global_scores
      WHERE song_id = ${song.id}
         OR ((song_id IS NULL OR song_id = '') AND song_name = ${song.name} AND artist = ${song.artist})
    `;

    await deleteBlob([song.audioPath, song.notesPath], { token: BLOB_WRITE_TOKEN });
    return ok(res, { message: "Song deleted." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete song.";
    return fail(res, 500, message);
  }
});

app.get("/api/global-scores", async (req, res) => {
  try {
    await ensureStorageReady();
    const limit = Math.max(1, Math.min(500, clampNumber(req.query.limit, 100)));
    const offset = Math.max(0, clampNumber(req.query.offset, 0));

    const { rows } = await sql`
      SELECT * FROM global_scores ORDER BY score DESC, created_at DESC LIMIT ${limit + 1} OFFSET ${offset}
    `;
    const scores = rows.map(normalizeGlobalScoreRow);
    const chunk = scores.slice(0, limit);
    const nextOffset = scores.length > limit ? offset + limit : null;
    return ok(res, { scores: chunk, nextOffset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load global scores.";
    return fail(res, 500, message);
  }
});

app.post("/api/global-scores", async (req, res) => {
  try {
    await ensureStorageReady();
    const score = clampNumber(req.body?.score, Number.NaN);
    const accuracy = clampNumber(req.body?.accuracy, Number.NaN);
    const requestedSongId = (typeof req.body?.songId === "string" && req.body.songId.trim()) || "";
    const username = (typeof req.body?.username === "string" && req.body.username.trim()) || "Anonymous";
    const date = (typeof req.body?.date === "string" && req.body.date.trim()) || new Date().toLocaleDateString();

    if (!Number.isFinite(score) || !Number.isFinite(accuracy)) {
      return fail(res, 400, "Score and accuracy must be numbers.");
    }

    const linkedSong = requestedSongId ? await readSong(requestedSongId) : null;
    if (requestedSongId && !linkedSong) {
      return fail(res, 404, "Song not found.");
    }

    const songName = linkedSong
      ? linkedSong.name
      : (typeof req.body?.songName === "string" && req.body.songName.trim()) || "Unknown Song";
    const artist = linkedSong
      ? linkedSong.artist
      : (typeof req.body?.artist === "string" && req.body.artist.trim()) || "Unknown Artist";

    const newScore: GlobalScoreRecord = {
      id: crypto.randomUUID(),
      songId: linkedSong?.id || requestedSongId || undefined,
      score,
      accuracy,
      date,
      username,
      createdAt: new Date().toISOString(),
      songName,
      artist,
    };

    await sql`
      INSERT INTO global_scores (id, song_id, score, accuracy, date, username, song_name, artist, created_at)
      VALUES (${newScore.id}, ${newScore.songId || null}, ${newScore.score}, ${newScore.accuracy}, ${newScore.date}, ${newScore.username}, ${newScore.songName}, ${newScore.artist}, ${newScore.createdAt})
    `;

    const updatedSong = linkedSong
      ? applySongScoreEntry(linkedSong, createSongScoreEntry(score, accuracy, username, date))
      : null;

    if (updatedSong) {
      await persistSongScoreboard(updatedSong);
    }

    return ok(res, { id: newScore.id, song: updatedSong });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save global score.";
    return fail(res, 500, message);
  }
});

app.get("/api/replays", async (_req, res) => {
  try {
    await ensureStorageReady();
    const { rows } = await sql`SELECT * FROM replays ORDER BY created_at DESC`;
    const replays = rows.map(normalizeReplayRow);
    return ok(res, replays);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load replays.";
    return fail(res, 500, message);
  }
});

app.post("/api/replays", async (req, res) => {
  try {
    await ensureStorageReady();
    const body = req.body || {};
    const songId = (typeof body.songId === "string" && body.songId.trim()) || "";
    const songName = (typeof body.songName === "string" && body.songName.trim()) || "";
    const score = clampNumber(body.score, Number.NaN);
    const accuracy = clampNumber(body.accuracy, Number.NaN);
    if (!songId || !songName || !Number.isFinite(score) || !Number.isFinite(accuracy)) {
      return fail(res, 400, "songId, songName, score and accuracy are required.");
    }

    const linkedSong = await readSong(songId);
    if (!linkedSong) {
      return fail(res, 404, "Song not found.");
    }

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
      events: parseEventsArray(body.events as Json),
    };

    await sql`
      INSERT INTO replays (
        id, song_id, song_name, artist, difficulty, density, lane_variety,
        slider_probability, stamina, score, accuracy, date, created_at, events
      )
      VALUES (
        ${newReplay.id}, ${newReplay.songId}, ${newReplay.songName}, ${newReplay.artist},
        ${newReplay.difficulty}, ${newReplay.density}, ${newReplay.laneVariety},
        ${newReplay.sliderProbability}, ${newReplay.stamina}, ${newReplay.score}, ${newReplay.accuracy},
        ${newReplay.date}, ${newReplay.createdAt}, ${JSON.stringify(newReplay.events)}::jsonb
      )
    `;

    return ok(res, newReplay);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save replay.";
    return fail(res, 500, message);
  }
});

app.get("/api/integrity", async (_req, res) => {
  try {
    await ensureStorageReady();
    const { songs, globalScores, replays, replayLinkIssues, globalScoreLinkIssues } = await collectIntegrityIssues();

    const missingAssetSongs = (await Promise.all(
      songs.map(async (song) => {
        const [missingAudio, missingNotes] = [!(await hasRemoteBlob(song.audioUrl)), !(await hasRemoteBlob(song.notesUrl))];
        return { ...song, missingAudio, missingNotes };
      })
    ))
      .filter((entry) => entry.missingAudio || entry.missingNotes)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        artist: entry.artist,
        missingAudio: entry.missingAudio,
        missingNotes: entry.missingNotes,
      }));

    return ok(res, {
      songsCount: songs.length,
      scoresCount: globalScores.length,
      replaysCount: replays.length,
      missingAssetSongsCount: missingAssetSongs.length,
      missingAssetSongs,
      replayLinkIssuesCount: replayLinkIssues.length,
      replayLinkIssues,
      globalScoreLinkIssuesCount: globalScoreLinkIssues.length,
      globalScoreLinkIssues,
      configurationIssues: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run integrity check.";
    return fail(res, 500, message);
  }
});

app.get("/api/audio-proxy", async (req, res) => {
  const audioUrl = req.query.url as string;
  if (!audioUrl) return res.status(400).send("Missing URL");

  try {
    const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"].split(",")[0]
      : req.protocol;
    const baseUrl = `${forwardedProto}://${req.get("host")}`;
    const resolvedUrl = new URL(audioUrl, baseUrl).toString();
    const response = await fetch(resolvedUrl);
    if (!response.ok) return res.status(response.status).send("Failed to fetch audio");
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send("Internal Server Error");
  }
});

export default app;
