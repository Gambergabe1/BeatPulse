import { sql } from "@vercel/postgres";

const ASSET_CHECK_TIMEOUT_MS = 1200;
const ASSET_CHECK_CONCURRENCY = 6;

interface SongStorageIssue {
  id: string;
  name: string;
  artist: string;
  missingAudio: boolean;
  missingNotes: boolean;
}

interface IntegrityReport {
  songsCount: number;
  scoresCount: number;
  replaysCount: number;
  missingAssetSongsCount: number;
  missingAssetSongs: SongStorageIssue[];
  configurationIssues: string[];
}

function ok(res: any, data: IntegrityReport) {
  res.status(200).json({ success: true, data });
}

function clampNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function hasDatabaseConfig() {
  return Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
}

async function tableExists(tableName: "songs" | "global_scores" | "replays") {
  const { rows } = await sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS present`;
  return Boolean(rows[0]?.present);
}

async function ensureSongColumns() {
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS name TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS artist TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_path TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_path TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

async function hasReachableAsset(url: string) {
  if (!url || !isAbsoluteHttpUrl(url)) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASSET_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    if (response.ok) {
      return true;
    }

    if (response.status === 405) {
      const fallbackResponse = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: controller.signal,
      });
      return fallbackResponse.ok;
    }

    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  });

  await Promise.all(runners);
  return results;
}

export default async function handler(_req: any, res: any) {
  const report: IntegrityReport = {
    songsCount: 0,
    scoresCount: 0,
    replaysCount: 0,
    missingAssetSongsCount: 0,
    missingAssetSongs: [],
    configurationIssues: [],
  };

  if (!hasDatabaseConfig()) {
    report.configurationIssues.push(
      "Serverless database is not configured. Set DATABASE_URL or POSTGRES_URL for deployment integrity checks."
    );
    return ok(res, report);
  }

  try {
    const songsTablePresent = await tableExists("songs");
    const globalScoresTablePresent = await tableExists("global_scores");
    const replaysTablePresent = await tableExists("replays");

    if (!songsTablePresent) {
      report.configurationIssues.push("Songs table was not found in the configured database.");
      return ok(res, report);
    }

    await ensureSongColumns();

    const [{ rows: songRows }, { rows: globalRows }, { rows: replayRows }] = await Promise.all([
      sql`
        SELECT id, name, artist, audio_url, audio_path, notes_url, notes_path
        FROM songs
        ORDER BY created_at DESC NULLS LAST
      `,
      globalScoresTablePresent
        ? sql`SELECT COUNT(*) AS c FROM global_scores`
        : Promise.resolve({ rows: [{ c: 0 }] }),
      replaysTablePresent
        ? sql`SELECT COUNT(*) AS c FROM replays`
        : Promise.resolve({ rows: [{ c: 0 }] }),
    ]);

    report.songsCount = songRows.length;
    report.scoresCount = clampNumber(globalRows?.[0]?.c, 0);
    report.replaysCount = clampNumber(replayRows?.[0]?.c, 0);

    const missingAssetSongs = await mapWithConcurrency(songRows, ASSET_CHECK_CONCURRENCY, async (row: any) => {
      const audioUrl = toText(row.audio_url, "");
      const notesUrl = toText(row.notes_url, "");

      const [audioExists, notesExist] = await Promise.all([
        hasReachableAsset(audioUrl),
        hasReachableAsset(notesUrl),
      ]);

      return {
        id: toText(row.id, ""),
        name: toText(row.name, "Untitled"),
        artist: toText(row.artist, "Unknown Artist"),
        missingAudio: !audioExists,
        missingNotes: !notesExist,
      };
    });

    report.missingAssetSongs = missingAssetSongs.filter((song) => song.missingAudio || song.missingNotes);
    report.missingAssetSongsCount = report.missingAssetSongs.length;

    if (!globalScoresTablePresent) {
      report.configurationIssues.push("Global scores table was not found in the configured database.");
    }

    if (!replaysTablePresent) {
      report.configurationIssues.push("Replays table was not found in the configured database.");
    }

    return ok(res, report);
  } catch (error) {
    report.configurationIssues.push(
      error instanceof Error ? error.message : "Integrity check could not read the deployment database."
    );
    return ok(res, report);
  }
}
