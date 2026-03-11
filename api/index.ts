import express, { NextFunction, Request, Response } from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { del, put } from "@vercel/blob";
import { createPool } from "@vercel/postgres";

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const wrappedInDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
  const wrappedInSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'");
  if (wrappedInDoubleQuotes || wrappedInSingleQuotes) {
    return trimmed.slice(1, -1).trim() || undefined;
  }

  return trimmed;
}

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ADMIN_DEFAULT_PASSWORD = readEnv("ADMIN_PASSWORD") || "admin1234";
const UPLOAD_SIZE_BYTES = 1024 * 1024 * 150;

interface ScoreRecord {
  score: number;
  accuracy: number;
  date: string;
  username: string;
}

interface AdminState {
  passwordHash: string;
  tokenSecret: string;
  updatedAt: string;
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
  score: number;
  accuracy: number;
  date: string;
  username: string;
  createdAt: string;
  songName: string;
  artist: string;
}

interface SongStorageIssue {
  id: string;
  name: string;
  artist: string;
  missingAudio: boolean;
  missingNotes: boolean;
}

let schemaPromise: Promise<void> | null = null;
let isSchemaReady = false;
const databaseConnectionString =
  readEnv("POSTGRES_URL") ||
  readEnv("DATABASE_URL") ||
  readEnv("POSTGRES_URL_NON_POOLING") ||
  "";
const db = databaseConnectionString
  ? createPool({ connectionString: databaseConnectionString })
  : null;

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_SIZE_BYTES },
});

function normalizeNumber(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^\w.-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "upload";
}

function parseDateText(value: unknown): string {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toLocaleDateString();
  }
  return parsed.toLocaleDateString();
}

function toIso(value: unknown): string {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
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

function getDb() {
  if (!db) {
    throw new Error("Database is not configured. Set POSTGRES_URL or DATABASE_URL in Vercel.");
  }
  return db;
}

function getBlobToken() {
  const token = readEnv("BLOB_READ_WRITE_TOKEN");
  if (!token) {
    throw new Error("Blob storage is not configured. Set BLOB_READ_WRITE_TOKEN in Vercel.");
  }
  return token;
}

function getPublicErrorMessage(error: unknown): string {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return "Audio file is too large for this upload.";
    }
    return error.message;
  }

  if (error instanceof Error) {
    if (
      error.message.includes("POSTGRES_URL") ||
      error.message.includes("DATABASE_URL") ||
      error.message.includes("BLOB_READ_WRITE_TOKEN") ||
      error.message.includes("Blob storage is not configured") ||
      error.message.includes("Database is not configured")
    ) {
      return error.message;
    }
  }

  return "Internal Server Error";
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function withAsync(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function toSongRecord(row: any, scores: ScoreRecord[]): CommunitySongRecord {
  return {
    id: row.id,
    name: row.name,
    artist: row.artist,
    audioUrl: row.audio_url,
    audioPath: row.audio_blob_key,
    notesUrl: row.notes_url,
    notesPath: row.notes_blob_key,
    difficulty: Number(row.difficulty),
    density: Number(row.density),
    laneVariety: Number(row.lane_variety),
    sliderProbability: Number(row.slider_probability),
    stamina: Number(row.stamina),
    topScore: Number(row.top_score || 0),
    scores,
    authorName: row.author_name,
    createdAt: toIso(row.created_at),
    status: "ready",
  };
}

function parseSongNotes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) {
    return Array.isArray(value) ? value : [];
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseNotesPayload(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function ensureStorageReady() {
  if (isSchemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    const database = getDb();

    await database.sql`CREATE TABLE IF NOT EXISTS admin_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      token_secret TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`;

    await database.sql`CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      audio_url TEXT NOT NULL,
      audio_blob_key TEXT NOT NULL,
      notes_url TEXT NOT NULL,
      notes_blob_key TEXT NOT NULL,
      difficulty DOUBLE PRECISION NOT NULL,
      density DOUBLE PRECISION NOT NULL,
      lane_variety DOUBLE PRECISION NOT NULL,
      slider_probability DOUBLE PRECISION NOT NULL,
      stamina DOUBLE PRECISION NOT NULL,
      top_score INTEGER NOT NULL DEFAULT 0,
      author_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'ready'
    );`;

    await database.sql`CREATE TABLE IF NOT EXISTS song_scores (
      id BIGSERIAL PRIMARY KEY,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      accuracy DOUBLE PRECISION NOT NULL,
      username TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`;

    await database.sql`CREATE TABLE IF NOT EXISTS global_scores (
      id BIGSERIAL PRIMARY KEY,
      score INTEGER NOT NULL,
      accuracy DOUBLE PRECISION NOT NULL,
      username TEXT NOT NULL,
      song_name TEXT NOT NULL,
      artist TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`;

    await database.sql`CREATE TABLE IF NOT EXISTS replays (
      id BIGSERIAL PRIMARY KEY,
      song_id TEXT NOT NULL,
      song_name TEXT NOT NULL,
      artist TEXT NOT NULL,
      difficulty DOUBLE PRECISION NOT NULL,
      density DOUBLE PRECISION NOT NULL,
      lane_variety DOUBLE PRECISION NOT NULL,
      slider_probability DOUBLE PRECISION NOT NULL,
      stamina DOUBLE PRECISION NOT NULL,
      score INTEGER NOT NULL,
      accuracy DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      events JSONB NOT NULL DEFAULT '[]'::jsonb
    );`;

    await database.sql`CREATE INDEX IF NOT EXISTS song_scores_song_idx ON song_scores(song_id);`;
    await database.sql`CREATE INDEX IF NOT EXISTS global_scores_created_idx ON global_scores(created_at DESC);`;
    await database.sql`CREATE INDEX IF NOT EXISTS replays_created_idx ON replays(created_at DESC);`;

    const defaultPassword = createPasswordHash(ADMIN_DEFAULT_PASSWORD);
    const defaultSecret = crypto.randomBytes(32).toString("hex");
    await database.sql`
      INSERT INTO admin_state (id, password_hash, token_secret)
      VALUES (1, ${defaultPassword}, ${defaultSecret})
      ON CONFLICT (id) DO NOTHING;
    `;

    isSchemaReady = true;
    schemaPromise = null;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  await schemaPromise;
}

async function getAdminState(): Promise<AdminState> {
  await ensureStorageReady();
  const database = getDb();
  const { rows } = await database.sql`
    SELECT password_hash, token_secret, updated_at
    FROM admin_state
    WHERE id = 1
  `;

  const existing = rows[0];
  if (!existing) {
    const passwordHash = createPasswordHash(ADMIN_DEFAULT_PASSWORD);
    const tokenSecret = crypto.randomBytes(32).toString("hex");
    await database.sql`
      INSERT INTO admin_state (id, password_hash, token_secret)
      VALUES (1, ${passwordHash}, ${tokenSecret});
    `;
    return {
      passwordHash,
      tokenSecret,
      updatedAt: new Date().toISOString(),
    };
  }

  let passwordHash = String(existing.password_hash);
  let tokenSecret = String(existing.token_secret);
  let updatedAt = String(existing.updated_at);

  const configuredAdminPassword = readEnv("ADMIN_PASSWORD");
  if (configuredAdminPassword && !verifyPassword(configuredAdminPassword, passwordHash)) {
    passwordHash = createPasswordHash(configuredAdminPassword);
    tokenSecret = crypto.randomBytes(32).toString("hex");
    updatedAt = new Date().toISOString();
    await database.sql`
      UPDATE admin_state
      SET password_hash = ${passwordHash}, token_secret = ${tokenSecret}, updated_at = ${updatedAt}
      WHERE id = 1
    `;
  }

  return { passwordHash, tokenSecret, updatedAt };
}

async function getAllSongs() {
  const database = getDb();
  const { rows } = await database.sql`
    SELECT id, name, artist, audio_url, audio_blob_key, notes_url, notes_blob_key,
      difficulty, density, lane_variety, slider_probability, stamina,
      top_score, author_name, created_at, status
    FROM songs
    ORDER BY created_at DESC
  `;

  const songs: CommunitySongRecord[] = [];

  for (const row of rows) {
    const { rows: scoreRows } = await database.sql`
      SELECT score, accuracy, username, created_at
      FROM song_scores
      WHERE song_id = ${row.id}
      ORDER BY score DESC, created_at DESC
      LIMIT 5
    `;

    const scores = scoreRows.map((scoreRow: any) => ({
      score: Number(scoreRow.score),
      accuracy: Number(scoreRow.accuracy),
      date: parseDateText(scoreRow.created_at),
      username: String(scoreRow.username || "Anonymous"),
    }));
    songs.push(toSongRecord(row, scores));
  }

  return songs;
}

async function getSongById(id: string) {
  const database = getDb();
  const { rows } = await database.sql`
    SELECT id, name, artist, audio_url, audio_blob_key, notes_url, notes_blob_key,
      difficulty, density, lane_variety, slider_probability, stamina,
      top_score, author_name, created_at, status
    FROM songs
    WHERE id = ${id}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  const { rows: scoreRows } = await database.sql`
    SELECT score, accuracy, username, created_at
    FROM song_scores
    WHERE song_id = ${id}
    ORDER BY score DESC, created_at DESC
    LIMIT 5
  `;
  const scores = scoreRows.map((scoreRow: any) => ({
    score: Number(scoreRow.score),
    accuracy: Number(scoreRow.accuracy),
    date: parseDateText(scoreRow.created_at),
    username: String(scoreRow.username || "Anonymous"),
  }));

  return toSongRecord(row, scores);
}

async function getSongByIdRaw(id: string) {
  const database = getDb();
  const { rows } = await database.sql`
    SELECT id, name, artist, audio_url, audio_blob_key, notes_url, notes_blob_key,
      difficulty, density, lane_variety, slider_probability, stamina,
      top_score, author_name, created_at, status
    FROM songs
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function deleteBlobSafe(...urls: Array<string | undefined>) {
  const target = urls.filter(Boolean) as string[];
  if (target.length === 0) return;
  let token: string;
  try {
    token = getBlobToken();
  } catch {
    return;
  }
  try {
    await del(target, { token });
  } catch {
    // Cleanup errors shouldn't break API responses.
  }
}

async function checkBlobExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

function getRequireAdmin() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = extractBearerToken(req);
      const state = await getAdminState();
      if (!token || !verifyAdminToken(token, state.tokenSecret)) {
        return fail(res, 401, "Unauthorized.");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

async function ensureAppConfig(req: Request, _res: Response, next: NextFunction) {
  try {
    await ensureStorageReady();
    next();
  } catch (error) {
    next(error);
  }
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api", ensureAppConfig);

app.get("/api/health", (_req, res) => {
  ok(res, { status: "ok", message: "BeatPulse server is healthy" });
});

app.post("/api/admin/login", withAsync(async (req, res) => {
  const state = await getAdminState();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!password) {
    return fail(res, 400, "Password is required.");
  }

  if (!verifyPassword(password, state.passwordHash)) {
    return fail(res, 401, "Invalid password.");
  }

  const token = createAdminToken(state.tokenSecret);
  return ok(res, { token });
}));

app.post("/api/admin/password", getRequireAdmin(), withAsync(async (req, res) => {
  const database = getDb();
  const state = await getAdminState();
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword.trim() : "";

  if (newPassword.length < 4) {
    return fail(res, 400, "Password must be at least 4 characters.");
  }

  const nextState = {
    passwordHash: createPasswordHash(newPassword),
    tokenSecret: crypto.randomBytes(32).toString("hex"),
    updatedAt: new Date().toISOString(),
  };

  await database.sql`
    UPDATE admin_state
    SET password_hash = ${nextState.passwordHash}, token_secret = ${nextState.tokenSecret}, updated_at = ${nextState.updatedAt}
    WHERE id = 1
  `;

  if (state.tokenSecret !== nextState.tokenSecret) {
    await getAdminState();
  }
  return ok(res, { message: "Password updated." });
}));

app.get("/api/songs", withAsync(async (_req, res) => {
  const songs = await getAllSongs();
  return ok(res, songs);
}));

app.get("/api/songs/:id", withAsync(async (req, res) => {
  const song = await getSongById(req.params.id);
  if (!song) return fail(res, 404, "Song not found");
  return ok(res, song);
}));

app.post("/api/songs", uploader.single("audio"), withAsync(async (req, res) => {
  const database = getDb();
  if (!req.file) {
    return fail(res, 400, "Audio file is required.");
  }

  const id = crypto.randomUUID();
  const name = (typeof req.body?.name === "string" && req.body.name.trim()) || "Untitled";
  const artist = (typeof req.body?.artist === "string" && req.body.artist.trim()) || "Unknown Artist";
  const difficulty = normalizeNumber(req.body?.difficulty, 0.5);
  const density = normalizeNumber(req.body?.density, 0.5);
  const laneVariety = normalizeNumber(req.body?.laneVariety, 0.5);
  const sliderProbability = normalizeNumber(req.body?.sliderProbability, 0.3);
  const stamina = normalizeNumber(req.body?.stamina, 0.5);
  const authorName = (typeof req.body?.authorName === "string" && req.body.authorName.trim()) || "Anonymous";
  const notes = parseNotesPayload((req.body as any)?.notes);

  const ext = req.file.originalname ? path.extname(req.file.originalname) : ".mp3";
  const safeBaseName = sanitizeFileName(req.file.originalname ? path.parse(req.file.originalname).name : "audio");
  const audioFileName = `${safeBaseName}${ext || ".mp3"}`;
  const audioKey = `songs/${id}/${audioFileName}`;
  const notesKey = `songs/${id}/notes.json`;
  const token = getBlobToken();

  let audioBlob: { url: string } | null = null;
  let notesBlob: { url: string } | null = null;
  try {
    audioBlob = await put(audioKey, req.file.buffer, {
      access: "public",
      token,
      contentType: req.file.mimetype || "audio/mpeg",
    });
    notesBlob = await put(notesKey, JSON.stringify(notes), {
      access: "public",
      token,
      contentType: "application/json",
    });

    await database.sql`
      INSERT INTO songs (
        id, name, artist, audio_url, audio_blob_key, notes_url, notes_blob_key,
        difficulty, density, lane_variety, slider_probability, stamina, top_score, author_name
      ) VALUES (
        ${id}, ${name}, ${artist}, ${audioBlob.url}, ${audioKey}, ${notesBlob.url}, ${notesKey},
        ${difficulty}, ${density}, ${laneVariety}, ${sliderProbability}, ${stamina}, 0, ${authorName}
      )
    `;

    const saved = await getSongById(id);
    if (!saved) {
      throw new Error("Song persisted but could not be loaded.");
    }

    return ok(res, saved);
  } catch (error) {
    if (audioBlob?.url || notesBlob?.url) {
      await deleteBlobSafe(audioBlob?.url, notesBlob?.url);
    }
    console.error("Song upload failed:", error);
    const publicMessage = getPublicErrorMessage(error);
    return fail(res, 500, publicMessage === "Internal Server Error" ? "Failed to save song." : publicMessage);
  }
}));

app.patch("/api/songs/:id", getRequireAdmin(), withAsync(async (req, res) => {
  const body = req.body || {};
  const id = req.params.id;

  const existing = await getSongById(id);
  if (!existing) return fail(res, 404, "Song not found");

  const next = {
    name: existing.name,
    artist: existing.artist,
    difficulty: existing.difficulty,
    density: existing.density,
    laneVariety: existing.laneVariety,
    sliderProbability: existing.sliderProbability,
    stamina: existing.stamina,
    authorName: existing.authorName,
  };

  if (typeof body.name === "string" && body.name.trim()) next.name = body.name.trim();
  if (typeof body.artist === "string" && body.artist.trim()) next.artist = body.artist.trim();
  if (typeof body.difficulty === "number") next.difficulty = body.difficulty;
  if (typeof body.density === "number") next.density = body.density;
  if (typeof body.laneVariety === "number") next.laneVariety = body.laneVariety;
  if (typeof body.sliderProbability === "number") next.sliderProbability = body.sliderProbability;
  if (typeof body.stamina === "number") next.stamina = body.stamina;
  if (typeof body.authorName === "string" && body.authorName.trim()) next.authorName = body.authorName.trim();

  const cleanDifficulty = normalizeNumber(next.difficulty, existing.difficulty);
  const cleanDensity = normalizeNumber(next.density, existing.density);
  const cleanLaneVariety = normalizeNumber(next.laneVariety, existing.laneVariety);
  const cleanSliderProbability = normalizeNumber(next.sliderProbability, existing.sliderProbability);
  const cleanStamina = normalizeNumber(next.stamina, existing.stamina);

  const database = getDb();
  await database.sql`
    UPDATE songs
    SET name = ${next.name},
        artist = ${next.artist},
        difficulty = ${cleanDifficulty},
        density = ${cleanDensity},
        lane_variety = ${cleanLaneVariety},
        slider_probability = ${cleanSliderProbability},
        stamina = ${cleanStamina},
        author_name = ${next.authorName}
    WHERE id = ${id}
  `;

  const updated = await getSongById(id);
  if (!updated) return fail(res, 500, "Failed to read updated song.");
  return ok(res, updated);
}));

app.post("/api/songs/:id/scores", withAsync(async (req, res) => {
  const id = req.params.id;
  const song = await getSongByIdRaw(id);
  if (!song) return fail(res, 404, "Song not found");

  const score = normalizeNumber(req.body?.score, Number.NaN);
  const accuracy = normalizeNumber(req.body?.accuracy, Number.NaN);
  const username = (typeof req.body?.username === "string" && req.body.username.trim()) || "Anonymous";

  if (!Number.isFinite(score) || !Number.isFinite(accuracy)) {
    return fail(res, 400, "Score and accuracy must be numbers.");
  }

  const database = getDb();
  await database.sql`
    INSERT INTO song_scores (song_id, score, accuracy, username)
    VALUES (${id}, ${score}, ${accuracy}, ${username});
  `;
  await database.sql`
    UPDATE songs
    SET top_score = GREATEST(top_score, ${score})
    WHERE id = ${id}
  `;

  const updated = await getSongById(id);
  if (!updated) return fail(res, 500, "Failed to read updated song.");
  return ok(res, updated);
}));

app.delete("/api/songs/:id", getRequireAdmin(), withAsync(async (req, res) => {
  const id = req.params.id;
  const database = getDb();
  const { rows } = await database.sql`
    DELETE FROM songs
    WHERE id = ${id}
    RETURNING audio_url, notes_url
  `;

  if (rows.length === 0) {
    return fail(res, 404, "Song not found");
  }

  const songRow = rows[0] as any;
  await deleteBlobSafe(songRow.audio_url, songRow.notes_url);
  return ok(res, { message: "Song deleted." });
}));

app.get("/api/global-scores", withAsync(async (req, res) => {
  const limit = Math.max(1, Math.min(500, normalizeNumber(req.query.limit, 100)));
  const offset = Math.max(0, normalizeNumber(req.query.offset, 0));

  const database = getDb();
  const { rows: items } = await database.sql`
    SELECT id, score, accuracy, username, date, song_name, artist, created_at
    FROM global_scores
    ORDER BY score DESC, created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const { rows: countRows } = await database.sql`SELECT COUNT(*)::int AS count FROM global_scores`;
  const total = Number(countRows[0]?.count || 0);
  const nextOffset = offset + limit < total ? offset + limit : null;

  const scores: GlobalScoreRecord[] = items.map((row: any) => ({
    id: String(row.id),
    score: Number(row.score),
    accuracy: Number(row.accuracy),
    date: String(row.date || ""),
    username: String(row.username || "Anonymous"),
    createdAt: toIso(row.created_at),
    songName: String(row.song_name || "Unknown Song"),
    artist: String(row.artist || "Unknown Artist"),
  }));

  return ok(res, { scores, nextOffset });
}));

app.post("/api/global-scores", withAsync(async (req, res) => {
  const score = normalizeNumber(req.body?.score, Number.NaN);
  const accuracy = normalizeNumber(req.body?.accuracy, Number.NaN);
  const songName = (typeof req.body?.songName === "string" && req.body.songName.trim()) || "Unknown Song";
  const artist = (typeof req.body?.artist === "string" && req.body.artist.trim()) || "Unknown Artist";
  const username = (typeof req.body?.username === "string" && req.body.username.trim()) || "Anonymous";
  const date = (typeof req.body?.date === "string" && req.body.date.trim()) || new Date().toLocaleDateString();

  if (!Number.isFinite(score) || !Number.isFinite(accuracy)) {
    return fail(res, 400, "Score and accuracy must be numbers.");
  }

  const database = getDb();
  const { rows } = await database.sql`
    INSERT INTO global_scores (score, accuracy, username, song_name, artist, date)
    VALUES (${score}, ${accuracy}, ${username}, ${songName}, ${artist}, ${date})
    RETURNING id
  `;

  return ok(res, { id: String(rows[0]?.id ?? crypto.randomUUID()) });
}));

app.get("/api/replays", withAsync(async (_req, res) => {
  const database = getDb();
  const { rows } = await database.sql`
    SELECT id, song_id, song_name, artist, difficulty, density, lane_variety,
      slider_probability, stamina, score, accuracy, date, created_at, events
    FROM replays
    ORDER BY created_at DESC
  `;
  const replays: ReplayRecord[] = rows.map((row: any) => ({
    id: String(row.id),
    songId: String(row.song_id),
    songName: String(row.song_name || ""),
    artist: String(row.artist || "Unknown Artist"),
    difficulty: Number(row.difficulty || 0),
    density: Number(row.density || 0.5),
    laneVariety: Number(row.lane_variety || 0.5),
    sliderProbability: Number(row.slider_probability || 0.3),
    stamina: Number(row.stamina || 0.5),
    score: Number(row.score),
    accuracy: Number(row.accuracy),
    date: String(row.date || ""),
    createdAt: toIso(row.created_at),
    events: parseSongNotes(row.events),
  }));
  return ok(res, replays);
}));

app.post("/api/replays", withAsync(async (req, res) => {
  const body = req.body || {};
  const songId = (typeof body.songId === "string" && body.songId.trim()) || "";
  const songName = (typeof body.songName === "string" && body.songName.trim()) || "";
  const score = normalizeNumber(body.score, Number.NaN);
  const accuracy = normalizeNumber(body.accuracy, Number.NaN);

  if (!songId || !songName || !Number.isFinite(score) || !Number.isFinite(accuracy)) {
    return fail(res, 400, "songId, songName, score and accuracy are required.");
  }

  const replayId = crypto.randomUUID();
  const record = {
    id: replayId,
    songId,
    songName,
    artist: (typeof body.artist === "string" && body.artist.trim()) || "Unknown Artist",
    difficulty: normalizeNumber(body.difficulty, 0.5),
    density: normalizeNumber(body.density, 0.5),
    laneVariety: normalizeNumber(body.laneVariety, 0.5),
    sliderProbability: normalizeNumber(body.sliderProbability, 0.3),
    stamina: normalizeNumber(body.stamina, 0.5),
    score,
    accuracy,
    date: (typeof body.date === "string" && body.date.trim()) || new Date().toLocaleDateString(),
    createdAt: new Date().toISOString(),
    events: Array.isArray(body.events) ? body.events : [],
  };

  const database = getDb();
  await database.sql`
    INSERT INTO replays (
      song_id, song_name, artist, difficulty, density, lane_variety,
      slider_probability, stamina, score, accuracy, date, events
    ) VALUES (
      ${record.songId},
      ${record.songName},
      ${record.artist},
      ${record.difficulty},
      ${record.density},
      ${record.laneVariety},
      ${record.sliderProbability},
      ${record.stamina},
      ${record.score},
      ${record.accuracy},
      ${record.date},
      ${JSON.stringify(record.events)}
    )
  `;

  return ok(res, record);
}));

app.get("/api/integrity", withAsync(async (_req, res) => {
  const songs = await getAllSongs();
  const report = await Promise.all(
    songs.map(async (song) => {
      const missingAudio = !(await checkBlobExists(song.audioUrl));
      const missingNotes = !(await checkBlobExists(song.notesUrl));
      return {
        id: song.id,
        name: song.name,
        artist: song.artist,
        missingAudio,
        missingNotes,
      } as SongStorageIssue;
    })
  );

  const database = getDb();
  const { rows: scoreRows } = await database.sql`SELECT COUNT(*)::int AS count FROM global_scores`;
  const { rows: replayRows } = await database.sql`SELECT COUNT(*)::int AS count FROM replays`;

  return ok(res, {
    songsCount: songs.length,
    scoresCount: scoreRows[0]?.count ? Number(scoreRows[0].count) : 0,
    replaysCount: replayRows[0]?.count ? Number(replayRows[0].count) : 0,
    missingAssetSongsCount: report.filter((entry) => entry.missingAudio || entry.missingNotes).length,
    missingAssetSongs: report.filter((entry) => entry.missingAudio || entry.missingNotes),
  });
}));

app.get("/api/audio-proxy", withAsync(async (req, res) => {
  const audioUrl = req.query.url as string;
  if (!audioUrl) {
    return res.status(400).send("Missing URL");
  }
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      return res.status(response.status).send("Failed to fetch audio");
    }
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", response.headers.get("Content-Type") || "audio/mpeg");
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send("Internal Server Error");
  }
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("API error:", error);
  return fail(res, 500, getPublicErrorMessage(error));
});

export default app;
