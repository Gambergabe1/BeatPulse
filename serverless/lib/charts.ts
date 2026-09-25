import { parseChartBundle, type ChartBundle, type DifficultyId } from "../../shared/chartFormat.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const cache = new Map<string, { bundle: ChartBundle; loadedAt: number }>();

/**
 * Loads a song's stored charts from Blob storage. Cached per function instance so a
 * burst of score submissions for one song fetches its charts once.
 */
export async function loadSongChartBundle(notesUrl: string, legacyDifficulty: DifficultyId): Promise<ChartBundle | null> {
  const cached = cache.get(notesUrl);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.bundle;
  try {
    const response = await fetch(notesUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const bundle = parseChartBundle(await response.json(), legacyDifficulty);
    cache.set(notesUrl, { bundle, loadedAt: Date.now() });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return bundle;
  } catch {
    return null;
  }
}

export function forgetSongChartBundle(notesUrl: string) {
  cache.delete(notesUrl);
}
