import { DIFFICULTY_PRESETS, getDifficultyPreset, type DifficultyPreset } from './chartSettings';

export type RankLabel = 'S' | 'A' | 'B' | 'C' | 'F';

export interface RankTier {
  label: RankLabel;
  minAccuracy: number;
  color: string;
}

/** Ordered best to worst. Keep in sync with the results screen styling. */
export const RANK_TIERS: RankTier[] = [
  { label: 'S', minAccuracy: 95, color: 'text-neon-blue' },
  { label: 'A', minAccuracy: 85, color: 'text-neon-green' },
  { label: 'B', minAccuracy: 75, color: 'text-neon-purple' },
  { label: 'C', minAccuracy: 60, color: 'text-neon-pink' },
  { label: 'F', minAccuracy: 0, color: 'text-white/40' },
];

export const CLEAR_ACCURACY = 60;

export const getRank = (accuracy: number) =>
  RANK_TIERS.find((tier) => accuracy >= tier.minAccuracy) ?? RANK_TIERS[RANK_TIERS.length - 1];

const rankValue = (label: RankLabel) => RANK_TIERS.length - RANK_TIERS.findIndex((tier) => tier.label === label);

export interface ChartRecord {
  bestScore: number;
  bestAccuracy: number;
  bestCombo: number;
  bestRank: RankLabel;
  fullCombo: boolean;
  plays: number;
  clears: number;
  lastPlayedAt: string;
}

export interface ChartIdentity {
  songId?: string;
  name: string;
  artist: string;
  duration: number;
  difficulty: number;
}

export interface RunResult {
  score: number;
  accuracy: number;
  maxCombo: number;
  fullCombo: boolean;
}

export interface RecordUpdate {
  chartKey: string;
  preset: DifficultyPreset;
  previous: ChartRecord | null;
  record: ChartRecord;
  isNewBest: boolean;
  firstClear: boolean;
  newRank: boolean;
  firstFullCombo: boolean;
  attempt: number;
}

export interface NextGoal {
  title: string;
  detail: string;
  /** Present when the goal is best reached on the next difficulty up. */
  stepUp?: DifficultyPreset;
}

const STORAGE_KEY = 'beatpulse_chart_records_v1';
const MAX_RECORDS = 400;

/**
 * Records are kept per song *and* difficulty: an Expert score and an Easy score on
 * the same track are different charts. Local uploads have no server id, so they are
 * identified by title, artist and length.
 */
export const getChartKey = (chart: ChartIdentity) => {
  const song = chart.songId
    ? `song:${chart.songId}`
    : `local:${chart.name.trim().toLowerCase()}|${chart.artist.trim().toLowerCase()}|${Math.round(chart.duration)}`;
  return `${song}@${getDifficultyPreset(chart.difficulty).id}`;
};

const readAll = (): Record<string, ChartRecord> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeAll = (records: Record<string, ChartRecord>) => {
  const entries = Object.entries(records);
  const trimmed = entries.length > MAX_RECORDS
    ? Object.fromEntries(entries.sort(([, a], [, b]) => b.lastPlayedAt.localeCompare(a.lastPlayedAt)).slice(0, MAX_RECORDS))
    : records;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full or blocked: records are a convenience, gameplay continues without them.
  }
};

export const getChartRecord = (chart: ChartIdentity) => readAll()[getChartKey(chart)] ?? null;

/** Records every difficulty played for a song, for menu badges. */
export const getSongRecords = (chart: Omit<ChartIdentity, 'difficulty'>) => {
  const records = readAll();
  return DIFFICULTY_PRESETS.flatMap((preset) => {
    const record = records[getChartKey({ ...chart, difficulty: preset.value })];
    return record ? [{ preset, record }] : [];
  });
};

export const recordRun = (chart: ChartIdentity, run: RunResult): RecordUpdate => {
  const chartKey = getChartKey(chart);
  const records = readAll();
  const previous = records[chartKey] ?? null;
  const rank = getRank(run.accuracy).label;
  const cleared = run.accuracy >= CLEAR_ACCURACY;
  const isNewBest = !previous || run.score > previous.bestScore || (run.score === previous.bestScore && run.accuracy > previous.bestAccuracy);
  const record: ChartRecord = {
    bestScore: Math.max(previous?.bestScore ?? 0, run.score),
    bestAccuracy: Math.max(previous?.bestAccuracy ?? 0, run.accuracy),
    bestCombo: Math.max(previous?.bestCombo ?? 0, run.maxCombo),
    bestRank: previous && rankValue(previous.bestRank) >= rankValue(rank) ? previous.bestRank : rank,
    fullCombo: Boolean(previous?.fullCombo) || run.fullCombo,
    plays: (previous?.plays ?? 0) + 1,
    clears: (previous?.clears ?? 0) + (cleared ? 1 : 0),
    lastPlayedAt: new Date().toISOString(),
  };
  records[chartKey] = record;
  writeAll(records);
  return {
    chartKey,
    preset: getDifficultyPreset(chart.difficulty),
    previous,
    record,
    isNewBest,
    firstClear: cleared && !(previous && previous.clears > 0),
    newRank: !previous || rankValue(rank) > rankValue(previous.bestRank),
    firstFullCombo: run.fullCombo && !previous?.fullCombo,
    attempt: record.plays,
  };
};

export const getNextDifficulty = (difficulty: number) => {
  const index = DIFFICULTY_PRESETS.findIndex((preset) => preset.id === getDifficultyPreset(difficulty).id);
  return DIFFICULTY_PRESETS[index + 1];
};

/** The single most motivating next target for this chart, based on the best record so far. */
export const getNextGoal = (record: ChartRecord, difficulty: number): NextGoal => {
  if (record.bestAccuracy < CLEAR_ACCURACY) {
    return {
      title: 'Clear the chart',
      detail: `${(CLEAR_ACCURACY - record.bestAccuracy).toFixed(1)}% more accuracy to reach a C rank clear.`,
    };
  }
  const currentIndex = RANK_TIERS.findIndex((tier) => tier.label === record.bestRank);
  const nextTier = currentIndex > 0 ? RANK_TIERS[currentIndex - 1] : undefined;
  if (nextTier) {
    return {
      title: `Reach ${nextTier.label} rank`,
      detail: `${Math.max(0.1, nextTier.minAccuracy - record.bestAccuracy).toFixed(1)}% more accuracy for ${nextTier.label}.`,
    };
  }
  if (!record.fullCombo) {
    return { title: 'Full combo it', detail: 'You have the S rank. Now finish without a miss or dropped hold.' };
  }
  const stepUp = getNextDifficulty(difficulty);
  if (stepUp) {
    return { title: `Try ${stepUp.label}`, detail: `This chart is mastered. ${stepUp.label}: ${stepUp.description}`, stepUp };
  }
  return { title: 'Chase the top score', detail: `Mastered on ${getDifficultyPreset(difficulty).label}. Every point now counts.` };
};
