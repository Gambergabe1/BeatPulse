/**
 * Chart storage format shared by the browser and the serverless API.
 *
 * Community songs store one chart per difficulty in a single JSON bundle so every
 * player of a difficulty plays exactly the same notes, and leaderboards can be kept
 * per difficulty. Songs uploaded before bundles existed stored a bare note array;
 * that is read as the chart for the difficulty the song was uploaded at.
 */

export const DIFFICULTY_IDS = ['easy', 'normal', 'hard', 'expert'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

/** Difficulty slider value each preset charts at; nearest preset wins for other values. */
export const DIFFICULTY_VALUES: Record<DifficultyId, number> = { easy: 0.12, normal: 0.4, hard: 0.68, expert: 0.92 };

export const difficultyIdForValue = (value: number): DifficultyId => {
  const safe = Number.isFinite(value) ? value : DIFFICULTY_VALUES.normal;
  return DIFFICULTY_IDS.reduce((closest, id) =>
    Math.abs(DIFFICULTY_VALUES[id] - safe) < Math.abs(DIFFICULTY_VALUES[closest] - safe) ? id : closest);
};

/** Bump when the generator changes enough that stored charts should be rebuilt. */
export const CURRENT_CHART_VERSION = 2;

export interface StoredNote {
  id?: string;
  time: number;
  lane: number;
  duration?: number;
  endLane?: number;
  tickInterval?: number;
}

export interface ChartBundle {
  format: 'beatpulse-charts';
  version: number;
  charts: Partial<Record<DifficultyId, StoredNote[]>>;
}

export const isDifficultyId = (value: unknown): value is DifficultyId =>
  typeof value === 'string' && (DIFFICULTY_IDS as readonly string[]).includes(value);

const isNoteLike = (value: unknown): value is StoredNote =>
  Boolean(value && typeof value === 'object'
    && Number.isFinite((value as StoredNote).time)
    && Number.isInteger((value as StoredNote).lane));

const cleanNotes = (value: unknown): StoredNote[] =>
  Array.isArray(value) ? value.filter(isNoteLike) : [];

export function createChartBundle(charts: Partial<Record<DifficultyId, StoredNote[]>>, version = CURRENT_CHART_VERSION): ChartBundle {
  const stripped: Partial<Record<DifficultyId, StoredNote[]>> = {};
  for (const id of DIFFICULTY_IDS) {
    const notes = charts[id];
    if (!notes) continue;
    stripped[id] = notes.map((note) => ({
      id: note.id,
      time: note.time,
      lane: note.lane,
      ...(note.duration ? { duration: note.duration } : {}),
      ...(note.endLane !== undefined ? { endLane: note.endLane } : {}),
      ...(note.tickInterval ? { tickInterval: note.tickInterval } : {}),
    }));
  }
  return { format: 'beatpulse-charts', version, charts: stripped };
}

/** Reads a stored notes file in either the bundle or the legacy single-array format. */
export function parseChartBundle(raw: unknown, legacyDifficulty: DifficultyId): ChartBundle {
  if (Array.isArray(raw)) {
    return { format: 'beatpulse-charts', version: 1, charts: { [legacyDifficulty]: cleanNotes(raw) } };
  }
  if (raw && typeof raw === 'object' && (raw as ChartBundle).format === 'beatpulse-charts') {
    const source = (raw as ChartBundle).charts ?? {};
    const charts: Partial<Record<DifficultyId, StoredNote[]>> = {};
    for (const id of DIFFICULTY_IDS) {
      const notes = cleanNotes(source[id]);
      if (notes.length > 0) charts[id] = notes;
    }
    const version = Number((raw as ChartBundle).version);
    return { format: 'beatpulse-charts', version: Number.isFinite(version) ? version : 1, charts };
  }
  return { format: 'beatpulse-charts', version: 1, charts: {} };
}

// Mirrors the scoring in GameCanvas: 100 points for a perfect hit, up to 2x combo
// multiplier, a second judged hit at a hold's tail, and up to 50 points per sustain tick.
const MAX_HIT_POINTS = 200;
const MAX_TICK_POINTS = 50;

const tickIntervalFor = (note: StoredNote) =>
  note.tickInterval ?? Math.max(0.16, Math.min(0.45, (note.duration ?? 0) / 4));

/** The highest score the game can award for a chart. */
export function maxScoreForChart(notes: StoredNote[]) {
  return notes.reduce((total, note) => {
    if (!note.duration || note.duration <= 0) return total + MAX_HIT_POINTS;
    const ticks = Math.floor(note.duration / tickIntervalFor(note)) + 1;
    return total + MAX_HIT_POINTS * 2 + ticks * MAX_TICK_POINTS;
  }, 0);
}

export interface ScoreClaim {
  score: number;
  accuracy: number;
  fullCombo: boolean;
}

/** Returns a reason the claimed result is impossible on this chart, or null if it is plausible. */
export function findImplausibleScore(claim: ScoreClaim, notes: StoredNote[]): string | null {
  if (!Number.isFinite(claim.score) || claim.score < 0) return 'Score must be a positive number.';
  if (!Number.isFinite(claim.accuracy) || claim.accuracy < 0 || claim.accuracy > 100) return 'Accuracy must be between 0 and 100.';
  if (notes.length === 0) return 'This chart has no notes.';
  const maxScore = maxScoreForChart(notes);
  if (claim.score > maxScore * 1.01) return 'Score is higher than this chart allows.';
  // Accuracy caps the share of hit-note points a run can earn; holds and ticks give some headroom.
  if (claim.score > maxScore * Math.min(1, claim.accuracy / 100 + 0.35)) return 'Score is too high for the reported accuracy.';
  if (claim.fullCombo && claim.accuracy < 49) return 'A full combo cannot have this accuracy.';
  return null;
}
