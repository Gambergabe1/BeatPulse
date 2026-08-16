import * as crypto from "node:crypto";
import { sql } from "@vercel/postgres";

const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const STORAGE_SCHEMA_VERSION = 3;

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
  fullCombo: boolean;
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

interface StorageNormalizedRows {
  songs: number;
  globalScores: number;
  replays: number;
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

function ok(res: any, data: unknown) {
  return res.status(200).json({ success: true, data });
}

function fail(res: any, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

function ensureDatabaseConfig() {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL/POSTGRES_URL is not configured.");
  }
}

function clampNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    const linked = lookup.byId.get(replay.songId);
    if (linked) return linked;
  }

  return getUniqueSongMatch(lookup, replay.songName, replay.artist);
}

function resolveSongForGlobalScore(
  score: Pick<GlobalScoreRecord, "songId" | "songName" | "artist">,
  lookup: ReturnType<typeof buildSongLookup>
) {
  if (score.songId) {
    const linked = lookup.byId.get(score.songId);
    if (linked) return linked;
  }

  return getUniqueSongMatch(lookup, score.songName, score.artist);
}

function sortScoresDesc(scores: ScoreRecord[]) {
  return scores.sort((a, b) => b.score - a.score);
}

function toTopScoreFromScores(scores: ScoreRecord[]) {
  if (scores.length === 0) return 0;
  return sortScoresDesc([...scores])[0]?.score ?? 0;
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
      fullCombo: row.fullCombo === true,
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

function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(actualHash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyAdminToken(token: string, secret: string) {
  try {
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    const decoded = Buffer.from(`${normalized}${"=".repeat(padding)}`, "base64").toString("utf8");
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

function extractBearerToken(req: any) {
  const header = req.headers?.authorization;
  if (!header || typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

async function prepareAdminStateSchema() {
  ensureDatabaseConfig();
  await sql`
    CREATE TABLE IF NOT EXISTS admin_state (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      token_secret TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `;
}

async function prepareStorageSchema() {
  ensureDatabaseConfig();

  await prepareAdminStateSchema();
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

async function readSongs(): Promise<CommunitySongRecord[]> {
  const { rows } = await sql`SELECT * FROM songs ORDER BY created_at DESC`;
  return rows.map(normalizeSongRow);
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
  const [songs, globalScores, replays] = await Promise.all([readSongs(), readGlobalScores(), readReplays()]);
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
      if (normalized.songId) summary.unresolvedGlobalScores += 1;
      continue;
    }

    const needsSongLink = normalized.songId !== linkedSong.id;
    const needsMetadata = normalized.songName !== linkedSong.name || normalized.artist !== linkedSong.artist;
    if (!needsSongLink && !needsMetadata) continue;

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
    if (!needsSongLink && !needsMetadata) continue;

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

async function migratePersistedStorage() {
  const [songsMigrated, globalScoresMigrated, replaysMigrated] = await Promise.all([
    migrateSongRows(),
    migrateGlobalScoreRows(),
    migrateReplayRows(),
  ]);
  const relationshipActions = await reconcileDataRelationships({ pruneOrphanReplays: true });

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
    checkedCollections: ["songs", "global-scores", "replays"],
    normalizedRows: {
      songs: songsMigrated,
      globalScores: globalScoresMigrated,
      replays: replaysMigrated,
    },
    relationshipActions,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return fail(res, 405, "Method not allowed.");
  }

  try {
    ensureDatabaseConfig();
    await prepareAdminStateSchema();

    const token = extractBearerToken(req);
    const adminState = await getAdminState();
    if (!token || !verifyAdminToken(token, adminState.tokenSecret)) {
      return fail(res, 401, "Unauthorized.");
    }

    await prepareStorageSchema();
    const previousVersion = await getStoredSchemaVersion();
    const migration = await migratePersistedStorage();
    const counts = await getStorageCollectionCounts();

    return ok(res, {
      ...migration,
      previousSchemaVersion: previousVersion,
      songsCount: counts.songs,
      globalScoresCount: counts.globalScores,
      replaysCount: counts.replays,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to force storage update.";
    return fail(res, 500, message);
  }
}
