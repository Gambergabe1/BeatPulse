import { createChartBundle, difficultyIdForValue, DIFFICULTY_IDS, type ChartBundle, type DifficultyId, type StoredNote } from '../../shared/chartFormat';
import type { Note } from '../types';
import { generateChart } from './chartGenerator';
import { getChartSettingsForDifficulty, DIFFICULTY_PRESETS } from './chartSettings';

/** Turns stored notes into fresh runtime notes (ids are kept so replays stay aligned). */
export const toPlayableNotes = (notes: StoredNote[], difficulty: DifficultyId): Note[] =>
  notes.map((note, index) => ({
    id: note.id || `${difficulty}-${index}`,
    time: note.time,
    lane: note.lane,
    duration: note.duration,
    endLane: note.endLane,
    tickInterval: note.tickInterval,
    hit: false,
    missed: false,
  }));

export const toPlayableCharts = (bundle: ChartBundle): Partial<Record<DifficultyId, Note[]>> => {
  const charts: Partial<Record<DifficultyId, Note[]>> = {};
  for (const id of DIFFICULTY_IDS) {
    const notes = bundle.charts[id];
    if (notes?.length) charts[id] = toPlayableNotes(notes, id);
  }
  return charts;
};

/**
 * The official chart for a difficulty, when the song has one. Custom (advanced)
 * chart settings never use official charts, so those runs stay unranked.
 */
export const pickOfficialChart = (
  charts: Partial<Record<DifficultyId, Note[]>> | undefined,
  difficulty: number,
  advancedChartMode: boolean
) => {
  if (!charts || advancedChartMode) return null;
  const id = difficultyIdForValue(difficulty);
  const notes = charts[id];
  return notes?.length ? { id, notes: notes.map((note) => ({ ...note, hit: false, missed: false, held: false })) } : null;
};

/**
 * Builds the four official charts stored with a community song. Moving sliders are
 * always included; desktop play converts them to straight holds at runtime.
 */
export const generateChartBundle = async (audioBuffer: AudioBuffer, onProgress?: (done: number, total: number) => void) => {
  const charts: Partial<Record<DifficultyId, Note[]>> = {};
  for (const [index, preset] of DIFFICULTY_PRESETS.entries()) {
    const { notes } = await generateChart(audioBuffer, { ...getChartSettingsForDifficulty(preset.value), allowMovingSliders: true });
    charts[preset.id] = notes;
    onProgress?.(index + 1, DIFFICULTY_PRESETS.length);
  }
  return { bundle: createChartBundle(charts), charts };
};
