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
  replayLinkIssuesCount: number;
  replayLinkIssues: ReplayLinkIssue[];
  globalScoreLinkIssuesCount: number;
  globalScoreLinkIssues: GlobalScoreLinkIssue[];
  configurationIssues: string[];
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

interface SongRow {
  id: string;
  name: string;
  artist: string;
  audio_url: string;
  notes_url: string;
}

interface GlobalScoreRow {
  id: string;
  song_id?: string;
  song_name: string;
  artist: string;
}

interface ReplayRow {
  id: string;
  song_id: string;
  song_name: string;
  artist: string;
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

async function ensureGlobalScoreColumns() {
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS song_id TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS song_name TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS artist TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
}

async function ensureReplayColumns() {
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS song_id TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS song_name TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS artist TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
}

function toLookupKey(name: string, artist: string) {
  return `${name.trim().toLowerCase()}::${artist.trim().toLowerCase()}`;
}

function buildSongLookup(songRows: SongRow[]) {
  const byId = new Map<string, SongRow>();
  const byMetadata = new Map<string, SongRow[]>();

  songRows.forEach((song) => {
    const normalizedSong: SongRow = {
      id: toText(song.id, ""),
      name: toText(song.name, "Untitled"),
      artist: toText(song.artist, "Unknown Artist"),
      audio_url: toText(song.audio_url, ""),
      notes_url: toText(song.notes_url, ""),
    };

    byId.set(normalizedSong.id, normalizedSong);
    const key = toLookupKey(normalizedSong.name, normalizedSong.artist);
    const bucket = byMetadata.get(key) || [];
    bucket.push(normalizedSong);
    byMetadata.set(key, bucket);
  });

  return { byId, byMetadata };
}

function getUniqueSongMatch(
  lookup: ReturnType<typeof buildSongLookup>,
  songName: string,
  artist: string
) {
  const matches = lookup.byMetadata.get(toLookupKey(songName, artist)) || [];
  return matches.length === 1 ? matches[0] : null;
}

function resolveSongForReplay(
  replay: ReplayRow,
  lookup: ReturnType<typeof buildSongLookup>
) {
  const replaySongId = toText(replay.song_id, "");
  if (replaySongId) {
    const linked = lookup.byId.get(replaySongId);
    if (linked) return linked;
  }

  return getUniqueSongMatch(lookup, toText(replay.song_name, ""), toText(replay.artist, ""));
}

function resolveSongForGlobalScore(
  score: GlobalScoreRow,
  lookup: ReturnType<typeof buildSongLookup>
) {
  const scoreSongId = toText(score.song_id, "");
  if (scoreSongId) {
    const linked = lookup.byId.get(scoreSongId);
    if (linked) return linked;
  }

  return getUniqueSongMatch(lookup, toText(score.song_name, ""), toText(score.artist, ""));
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
    replayLinkIssuesCount: 0,
    replayLinkIssues: [],
    globalScoreLinkIssuesCount: 0,
    globalScoreLinkIssues: [],
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
    if (globalScoresTablePresent) {
      await ensureGlobalScoreColumns();
    }
    if (replaysTablePresent) {
      await ensureReplayColumns();
    }

    const [{ rows: songRows }, { rows: globalRows }, { rows: replayRows }, { rows: globalScoreRows }, { rows: replayDataRows }] = await Promise.all([
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
      globalScoresTablePresent
        ? sql`SELECT id, song_id, song_name, artist FROM global_scores`
        : Promise.resolve({ rows: [] }),
      replaysTablePresent
        ? sql`SELECT id, song_id, song_name, artist FROM replays`
        : Promise.resolve({ rows: [] }),
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

    const lookup = buildSongLookup(songRows as SongRow[]);
    report.globalScoreLinkIssues = [];
    (globalScoreRows as GlobalScoreRow[]).forEach((score) => {
      const linkedSong = resolveSongForGlobalScore(score, lookup);
      const scoreSongId = toText(score.song_id, "");
      const scoreSongName = toText(score.song_name, "Unknown Song");
      const scoreArtist = toText(score.artist, "Unknown Artist");

      if (!linkedSong) {
        if (scoreSongId) {
          report.globalScoreLinkIssues.push({
              id: toText(score.id, ""),
              songId: scoreSongId,
              songName: scoreSongName,
              artist: scoreArtist,
              issue: "missing-song" as const,
            });
        }
        return;
      }

      if (!scoreSongId) {
        report.globalScoreLinkIssues.push({
          id: toText(score.id, ""),
          songId: scoreSongId,
          songName: scoreSongName,
          artist: scoreArtist,
          issue: "missing-song-link" as const,
          expectedSongId: linkedSong.id,
          expectedSongName: linkedSong.name,
          expectedArtist: linkedSong.artist,
        });
        return;
      }

      if (scoreSongName !== linkedSong.name || scoreArtist !== linkedSong.artist) {
        report.globalScoreLinkIssues.push({
          id: toText(score.id, ""),
          songId: scoreSongId,
          songName: scoreSongName,
          artist: scoreArtist,
          issue: "metadata-mismatch" as const,
          expectedSongId: linkedSong.id,
          expectedSongName: linkedSong.name,
          expectedArtist: linkedSong.artist,
        });
      }
    });
    report.globalScoreLinkIssuesCount = report.globalScoreLinkIssues.length;

    report.replayLinkIssues = [];
    (replayDataRows as ReplayRow[]).forEach((replay) => {
      const linkedSong = resolveSongForReplay(replay, lookup);
      const replaySongId = toText(replay.song_id, "");
      const replaySongName = toText(replay.song_name, "Unknown Song");
      const replayArtist = toText(replay.artist, "Unknown Artist");

      if (!linkedSong) {
        report.replayLinkIssues.push({
          id: toText(replay.id, ""),
          songId: replaySongId,
          songName: replaySongName,
          artist: replayArtist,
          issue: "missing-song" as const,
        });
        return;
      }

      if (
        replaySongId !== linkedSong.id ||
        replaySongName !== linkedSong.name ||
        replayArtist !== linkedSong.artist
      ) {
        report.replayLinkIssues.push({
          id: toText(replay.id, ""),
          songId: replaySongId,
          songName: replaySongName,
          artist: replayArtist,
          issue: "metadata-mismatch" as const,
          expectedSongId: linkedSong.id,
          expectedSongName: linkedSong.name,
          expectedArtist: linkedSong.artist,
        });
      }
    });
    report.replayLinkIssuesCount = report.replayLinkIssues.length;

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
