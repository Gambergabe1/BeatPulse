import * as crypto from "node:crypto";
import { sql } from "@vercel/postgres";
import multer from "multer";
import { del, put } from "@vercel/blob";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

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
  coverUrl?: string;
  coverPath?: string;
  tags: string[];
  chartVersion: number;
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

interface SongColumnInfo {
  column_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface SongInsertColumn {
  column: string;
  value: string | number | null;
  cast?: "jsonb";
}

const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 150 } });
const BLOB_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

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

function ensureBlobConfig() {
  if (!BLOB_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured.");
  }
}

function queryValue(req: any, key: string) {
  const value = req.query?.[key];
  if (Array.isArray(value)) return String(value[0] || "");
  if (value !== undefined && value !== null) return String(value);
  try { return new URL(typeof req.url === "string" ? req.url : "/api/songs", "http://localhost").searchParams.get(key) || ""; }
  catch { return ""; }
}

function isPasswordHash(value: unknown) {
  if (typeof value !== "string") return false;
  const [salt, hash] = value.split(":");
  return Boolean(salt && hash);
}

function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  const received = Buffer.from(actual, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(padding)}`, "base64").toString("utf8");
}

function verifyAdminToken(token: string, secret: string) {
  try {
    const [expiresAtRaw, signature] = decodeBase64Url(token).split(".");
    const expiresAt = Number(expiresAtRaw);
    if (!expiresAtRaw || !signature || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
    const expectedSignature = crypto.createHmac("sha256", secret).update(expiresAtRaw).digest("hex");
    const received = Buffer.from(signature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

function extractBearerToken(req: any) {
  const header = req.headers?.authorization;
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
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

function isSafeSongId(value: string) {
  return /^[A-Za-z0-9-]{8,64}$/.test(value);
}

function isSafeSongAssetPath(id: string, value: string) {
  return value.startsWith(`songs/${id}/`) && /^songs\/[A-Za-z0-9-]{8,64}\/[A-Za-z0-9_.-]{1,180}$/.test(value);
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
  }).sort((a, b) => b.score - a.score);
}

function toTopScoreFromScores(scores: ScoreRecord[]) {
  return scores.reduce((max, entry) => Math.max(max, entry.score || 0), 0);
}

function sanitizeTags(value: unknown) {
  const source = typeof value === "string"
    ? (() => { try { return JSON.parse(value) as unknown; } catch { return value.split(","); } })()
    : value;
  if (!Array.isArray(source)) return [];
  return Array.from(new Set(source.flatMap((tag) => typeof tag === "string"
    ? [tag.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").slice(0, 24)]
    : []).filter(Boolean))).slice(0, 8);
}

function normalizeSongRow(row: any): CommunitySongRecord {
  const id = toText(row.id, crypto.randomUUID());
  const createdAt = toIsoTimestamp(row.created_at ?? row.createdAt);
  const difficulty = clampNumber(row.difficulty ?? row.complexity, 0.5);
  const density = clampNumber(row.density, difficulty);
  const laneVariety = clampNumber(row.lane_variety ?? row.laneVariety, difficulty);
  const sliderProbability = clampNumber(row.slider_probability ?? row.sliderProbability, 0.3);
  const stamina = clampNumber(row.stamina, 0.5);
  const scores = parseScoreArray(row.scores as Json, createdAt);
  const audioPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(
      row.audio_path ?? row.audioPath ?? row.audio_blob_key ?? row.audio_url ?? row.audio_blob_url ?? row.audioUrl
    ),
    "audio.mp3"
  );
  const notesPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(
      row.notes_path ?? row.notesPath ?? row.notes_blob_key ?? row.notes_url ?? row.notes_blob_url ?? row.notesUrl
    ),
    "notes.json"
  );
  const rawCoverUrl = toText(row.cover_url ?? row.coverUrl, "");
  const rawCoverPath = extractRelativeAssetPath(row.cover_path ?? row.coverPath ?? rawCoverUrl);
  const coverPath = rawCoverUrl && rawCoverPath ? canonicalizeSongAssetPath(id, rawCoverPath, "cover.png") : undefined;

  return {
    id,
    name: toText(row.name, "Untitled"),
    artist: toText(row.artist, "Unknown Artist"),
    audioUrl: toText(row.audio_url ?? row.audio_blob_url ?? row.audioUrl, ""),
    audioPath,
    notesUrl: toText(row.notes_url ?? row.notes_blob_url ?? row.notesUrl, ""),
    notesPath,
    coverUrl: rawCoverUrl || undefined,
    coverPath,
    tags: sanitizeTags(row.tags),
    chartVersion: Math.max(1, Math.round(clampNumber(row.chart_version ?? row.chartVersion, 1))),
    difficulty,
    density,
    laneVariety,
    sliderProbability,
    stamina,
    topScore: Math.max(clampNumber(row.top_score ?? row.topScore, 0), toTopScoreFromScores(scores)),
    scores,
    authorName: toText(row.author_name ?? row.authorName, "Anonymous"),
    createdAt,
    status: "ready",
  };
}

function parseRequestBody(req: any) {
  if (req.body && typeof req.body === "object") {
    return req.body as Record<string, unknown>;
  }

  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return {};
}

function sanitizeFileName(input: string) {
  return input.replace(/[^\w.-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "upload";
}

function isMultipartRequest(req: any) {
  const contentType = typeof req.headers?.["content-type"] === "string" ? req.headers["content-type"] : "";
  return contentType.toLowerCase().includes("multipart/form-data");
}

function runMiddleware(req: any, res: any, middleware: (req: any, res: any, next: (error?: unknown) => void) => void) {
  return new Promise<void>((resolve, reject) => {
    middleware(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function parseNotesPayload(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getSongInsertColumns(song: CommunitySongRecord, columns: SongColumnInfo[]) {
  const defs: SongInsertColumn[] = [
    { column: "id", value: song.id },
    { column: "name", value: song.name },
    { column: "artist", value: song.artist },
    { column: "audio_url", value: song.audioUrl },
    { column: "audio_path", value: song.audioPath },
    { column: "notes_url", value: song.notesUrl },
    { column: "notes_path", value: song.notesPath },
    { column: "cover_url", value: song.coverUrl || null },
    { column: "cover_path", value: song.coverPath || null },
    { column: "tags", value: JSON.stringify(song.tags), cast: "jsonb" },
    { column: "chart_version", value: song.chartVersion },
    { column: "difficulty", value: song.difficulty },
    { column: "density", value: song.density },
    { column: "lane_variety", value: song.laneVariety },
    { column: "slider_probability", value: song.sliderProbability },
    { column: "stamina", value: song.stamina },
    { column: "top_score", value: song.topScore },
    { column: "scores", value: JSON.stringify(song.scores), cast: "jsonb" },
    { column: "author_name", value: song.authorName },
    { column: "created_at", value: song.createdAt },
    { column: "status", value: song.status },
  ];

  const legacyColumns = new Map<string, SongInsertColumn>([
    ["complexity", { column: "complexity", value: song.difficulty }],
    ["audio_blob_key", { column: "audio_blob_key", value: song.audioPath }],
    ["audio_blob_url", { column: "audio_blob_url", value: song.audioUrl }],
    ["notes_blob_key", { column: "notes_blob_key", value: song.notesPath }],
    ["notes_blob_url", { column: "notes_blob_url", value: song.notesUrl }],
  ]);

  const existingColumns = new Set(columns.map((column) => column.column_name));
  for (const [columnName, def] of legacyColumns) {
    if (existingColumns.has(columnName)) {
      defs.push(def);
    }
  }

  const includedColumns = new Set(defs.map((def) => def.column));
  const unsupportedRequiredColumns = columns
    .filter((column) => column.is_nullable === "NO" && column.column_default == null && !includedColumns.has(column.column_name))
    .map((column) => column.column_name);

  if (unsupportedRequiredColumns.length > 0) {
    throw new Error(`Songs table has unsupported required columns: ${unsupportedRequiredColumns.join(", ")}`);
  }

  return defs;
}

async function insertSongRow(song: CommunitySongRecord) {
  const { rows } = await sql<SongColumnInfo>`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'songs'
  `;

  const columns = getSongInsertColumns(song, rows);
  const columnNames = columns.map((column) => column.column).join(", ");
  const placeholders = columns
    .map((column, index) => `$${index + 1}${column.cast ? `::${column.cast}` : ""}`)
    .join(", ");

  await sql.query(
    `INSERT INTO songs (${columnNames}) VALUES (${placeholders})`,
    columns.map((column) => column.value)
  );
}

async function ensureSongIdUsesText() {
  const { rows } = await sql<{ data_type: string }>`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'songs' AND column_name = 'id'
    LIMIT 1
  `;
  const dataType = rows[0]?.data_type;
  if (!dataType || ["text", "character varying"].includes(dataType)) return;

  await sql.query("ALTER TABLE songs ALTER COLUMN id DROP DEFAULT");
  await sql.query("ALTER TABLE songs ALTER COLUMN id TYPE TEXT USING id::text");
}

async function prepareSongsSchema() {
  ensureDatabaseConfig();

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

  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS name TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS artist TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_path TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_path TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_blob_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_blob_key TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_blob_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_blob_key TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS complexity REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS difficulty REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS density REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS cover_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS cover_path TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS chart_version INTEGER NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS lane_variety REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS slider_probability REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS stamina REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS top_score REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS scores JSONB`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS author_name TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS status TEXT`;
  await ensureSongIdUsesText();
}

async function prepareAdminStateSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS admin_state (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      token_secret TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`ALTER TABLE admin_state ADD COLUMN IF NOT EXISTS password_hash TEXT`;
  await sql`ALTER TABLE admin_state ADD COLUMN IF NOT EXISTS token_secret TEXT`;
  await sql`ALTER TABLE admin_state ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
}

async function getAdminState() {
  const { rows } = await sql`
    SELECT ctid::text AS row_ref, password_hash, token_secret, updated_at
    FROM admin_state
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `;
  if (rows.length === 0) {
    const passwordHash = createPasswordHash(ADMIN_DEFAULT_PASSWORD);
    const tokenSecret = crypto.randomBytes(32).toString("hex");
    const updatedAt = new Date().toISOString();
    try {
      await sql`INSERT INTO admin_state (id, password_hash, token_secret, updated_at) VALUES ('default', ${passwordHash}, ${tokenSecret}, ${updatedAt})`;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("invalid input syntax for type integer")) throw error;
      await sql`INSERT INTO admin_state (id, password_hash, token_secret, updated_at) VALUES (1, ${passwordHash}, ${tokenSecret}, ${updatedAt})`;
    }
    return getAdminState();
  }
  const row = rows[0] as { row_ref?: string; password_hash?: string | null; token_secret?: string | null };
  const passwordHash = isPasswordHash(row.password_hash) ? row.password_hash! : createPasswordHash(ADMIN_DEFAULT_PASSWORD);
  const tokenSecret = typeof row.token_secret === "string" && row.token_secret.trim() ? row.token_secret.trim() : crypto.randomBytes(32).toString("hex");
  if ((!isPasswordHash(row.password_hash) || !row.token_secret?.trim()) && row.row_ref) {
    await sql`UPDATE admin_state SET password_hash = ${passwordHash}, token_secret = ${tokenSecret}, updated_at = ${new Date().toISOString()} WHERE ctid::text = ${row.row_ref}`;
  }
  return { passwordHash, tokenSecret };
}

async function isAuthorizedAdmin(req: any) {
  await prepareAdminStateSchema();
  const token = extractBearerToken(req);
  if (!token) return false;
  const state = await getAdminState();
  return verifyAdminToken(token, state.tokenSecret);
}

async function tableExists(tableName: "global_scores" | "replays") {
  const { rows } = await sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS present`;
  return Boolean(rows[0]?.present);
}

async function readSong(id: string) {
  const { rows } = await sql`SELECT * FROM songs WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return null;
  return normalizeSongRow(rows[0]);
}

async function handleGet(req: any, res: any) {
  await prepareSongsSchema();
  const id = queryValue(req, "id").trim();
  if (id) {
    const song = await readSong(id);
    return song ? ok(res, song) : fail(res, 404, "Song not found.");
  }
  const { rows } = await sql`SELECT * FROM songs ORDER BY created_at DESC`;
  return ok(res, rows.map(normalizeSongRow));
}

async function handlePost(req: any, res: any) {
  await prepareSongsSchema();

  if (isMultipartRequest(req)) {
    await runMiddleware(req, res, uploader.single("audio"));
  }

  const body = req.file ? (req.body as Record<string, unknown>) : parseRequestBody(req);
  const createdAt = new Date().toISOString();
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled";
  const artist = typeof body.artist === "string" && body.artist.trim() ? body.artist.trim() : "Unknown Artist";
  const authorName =
    typeof body.authorName === "string" && body.authorName.trim() ? body.authorName.trim() : "Anonymous";
  const difficulty = clampNumber(body.difficulty, 0.5);
  const density = clampNumber(body.density, 0.5);
  const laneVariety = clampNumber(body.laneVariety, 0.5);
  const sliderProbability = clampNumber(body.sliderProbability, 0.3);
  const stamina = clampNumber(body.stamina, 0.5);
  const tags = sanitizeTags(body.tags);
  const chartVersion = Math.max(1, Math.round(clampNumber(body.chartVersion, 1)));

  let id = "";
  let audioUrl = "";
  let audioPath = "";
  let notesUrl = "";
  let notesPath = "";
  let coverUrl = "";
  let coverPath = "";

  if (req.file) {
    ensureBlobConfig();
    id = crypto.randomUUID();

    const fileExt = (req.file.originalname || ".mp3").match(/\.[0-9a-z]{1,8}$/i)?.[0] || ".mp3";
    const safeAudioName = sanitizeFileName(
      req.file.originalname ? req.file.originalname.replace(fileExt, "") : "audio"
    );
    audioPath = `songs/${id}/${safeAudioName}${fileExt}`;
    notesPath = `songs/${id}/notes.json`;

    const [audioUpload, notesUpload] = await Promise.all([
      put(audioPath, req.file.buffer, {
        access: "public",
        token: BLOB_WRITE_TOKEN,
        contentType: req.file.mimetype || undefined,
      }),
      put(notesPath, JSON.stringify(parseNotesPayload(body.notes)), {
        access: "public",
        token: BLOB_WRITE_TOKEN,
        contentType: "application/json",
      }),
    ]);

    audioUrl = audioUpload.url;
    notesUrl = notesUpload.url;
  } else {
    id = typeof body.id === "string" ? body.id.trim() : "";
    audioUrl = typeof body.audioUrl === "string" ? body.audioUrl.trim() : "";
    notesUrl = typeof body.notesUrl === "string" ? body.notesUrl.trim() : "";
    const providedAudioPath = extractRelativeAssetPath(body.audioPath);
    const providedNotesPath = extractRelativeAssetPath(body.notesPath);
    coverUrl = typeof body.coverUrl === "string" ? body.coverUrl.trim() : "";
    const providedCoverPath = extractRelativeAssetPath(body.coverPath);

    if (!id || !isSafeSongId(id)) {
      return fail(res, 400, "A valid song id is required.");
    }

    if (!audioUrl || !notesUrl || !providedAudioPath || !providedNotesPath) {
      return fail(res, 400, "Uploaded song asset details are required.");
    }

    audioPath = canonicalizeSongAssetPath(id, providedAudioPath, "audio.mp3");
    notesPath = canonicalizeSongAssetPath(id, providedNotesPath, "notes.json");
    if (coverUrl || providedCoverPath) {
      if (!coverUrl || !providedCoverPath) return fail(res, 400, "Cover asset details are incomplete.");
      coverPath = canonicalizeSongAssetPath(id, providedCoverPath, "cover.png");
    }
    if (
      !isAbsoluteHttpUrl(audioUrl) ||
      !isAbsoluteHttpUrl(notesUrl) ||
      !isSafeSongAssetPath(id, audioPath) ||
      !isSafeSongAssetPath(id, notesPath)
      || (coverUrl && (!isAbsoluteHttpUrl(coverUrl) || !isSafeSongAssetPath(id, coverPath)))
    ) {
      return fail(res, 400, "Uploaded asset details are invalid.");
    }
  }

  if (await readSong(id)) {
    return fail(res, 409, "Song already exists.");
  }

  const song: CommunitySongRecord = {
    id,
    name,
    artist,
    audioUrl,
    audioPath,
    notesUrl,
    notesPath,
    coverUrl: coverUrl || undefined,
    coverPath: coverPath || undefined,
    tags,
    chartVersion,
    difficulty,
    density,
    laneVariety,
    sliderProbability,
    stamina,
    topScore: 0,
    scores: [],
    authorName,
    createdAt,
    status: "ready",
  };

  await insertSongRow(song);

  return ok(res, song);
}

async function handlePatch(req: any, res: any) {
  await prepareSongsSchema();
  if (!(await isAuthorizedAdmin(req))) return fail(res, 401, "Unauthorized.");
  const id = queryValue(req, "id").trim();
  if (!id) return fail(res, 400, "A song id is required.");
  const song = await readSong(id);
  if (!song) return fail(res, 404, "Song not found.");
  const updates = parseRequestBody(req);
  const next: CommunitySongRecord = {
    ...song,
    name: typeof updates.name === "string" && updates.name.trim() ? updates.name.trim() : song.name,
    artist: typeof updates.artist === "string" && updates.artist.trim() ? updates.artist.trim() : song.artist,
    authorName: typeof updates.authorName === "string" && updates.authorName.trim() ? updates.authorName.trim() : song.authorName,
    difficulty: clampNumber(updates.difficulty, song.difficulty),
    density: clampNumber(updates.density, song.density),
    laneVariety: clampNumber(updates.laneVariety, song.laneVariety),
    sliderProbability: clampNumber(updates.sliderProbability, song.sliderProbability),
    stamina: clampNumber(updates.stamina, song.stamina),
    topScore: clampNumber(updates.topScore, song.topScore),
    tags: updates.tags === undefined ? song.tags : sanitizeTags(updates.tags),
    chartVersion: updates.chartVersion === undefined ? song.chartVersion : Math.max(1, Math.round(clampNumber(updates.chartVersion, song.chartVersion))),
  };
  await sql`
    UPDATE songs SET name = ${next.name}, artist = ${next.artist}, difficulty = ${next.difficulty}, density = ${next.density},
      lane_variety = ${next.laneVariety}, slider_probability = ${next.sliderProbability}, stamina = ${next.stamina},
      top_score = ${next.topScore}, scores = ${JSON.stringify(next.scores)}::jsonb, author_name = ${next.authorName}, status = ${next.status},
      tags = ${JSON.stringify(next.tags)}::jsonb, chart_version = ${next.chartVersion}
    WHERE id = ${id}
  `;
  if (await tableExists("global_scores")) {
    await sql`UPDATE global_scores SET song_id = ${song.id}, song_name = ${next.name}, artist = ${next.artist} WHERE song_id = ${song.id} OR ((song_id IS NULL OR song_id = '') AND song_name = ${song.name} AND artist = ${song.artist})`;
  }
  if (await tableExists("replays")) {
    await sql`UPDATE replays SET song_id = ${song.id}, song_name = ${next.name}, artist = ${next.artist} WHERE song_id = ${song.id} OR ((song_id IS NULL OR song_id = '') AND song_name = ${song.name} AND artist = ${song.artist})`;
  }
  return ok(res, next);
}

async function handleDelete(req: any, res: any) {
  await prepareSongsSchema();
  if (!(await isAuthorizedAdmin(req))) return fail(res, 401, "Unauthorized.");
  ensureBlobConfig();
  const id = queryValue(req, "id").trim();
  if (!id) return fail(res, 400, "A song id is required.");
  const song = await readSong(id);
  if (!song) return fail(res, 404, "Song not found.");
  await sql`DELETE FROM songs WHERE id = ${id}`;
  if (await tableExists("replays")) {
    await sql`DELETE FROM replays WHERE song_id = ${song.id} OR ((song_id IS NULL OR song_id = '') AND song_name = ${song.name} AND artist = ${song.artist})`;
  }
  if (await tableExists("global_scores")) {
    await sql`DELETE FROM global_scores WHERE song_id = ${song.id} OR ((song_id IS NULL OR song_id = '') AND song_name = ${song.name} AND artist = ${song.artist})`;
  }
  await del([song.audioPath, song.notesPath, ...(song.coverPath ? [song.coverPath] : [])], { token: BLOB_WRITE_TOKEN });
  return ok(res, { message: "Song deleted." });
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      return await handleGet(req, res);
    }

    if (req.method === "POST") {
      return await handlePost(req, res);
    }

    if (req.method === "PATCH") {
      return await handlePatch(req, res);
    }

    if (req.method === "DELETE") {
      return await handleDelete(req, res);
    }

    return fail(res, 405, "Method not allowed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process songs.";
    return fail(res, 500, message);
  }
}
