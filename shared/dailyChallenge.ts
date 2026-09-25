import { difficultyIdForValue, CURRENT_CHART_VERSION, type DifficultyId } from './chartFormat.js';

export interface DailyChallenge {
  day: string;
  songId: string;
  difficulty: DifficultyId;
}

interface ChallengeSong {
  id: string;
  difficulty: number;
  chartVersion?: number;
}

/** Challenges roll over at midnight UTC so every player shares the same day. */
export const challengeDay = (date = new Date()) => date.toISOString().slice(0, 10);

const hashText = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
};

const CHALLENGE_DIFFICULTIES: DifficultyId[] = ['normal', 'hard', 'hard', 'expert'];

/**
 * Picks today's song and difficulty deterministically from the community library, so
 * every client agrees without a server round trip. Songs with only a legacy single
 * chart are challenged on the difficulty they were uploaded at.
 */
export function pickDailyChallenge(songs: ChallengeSong[], day = challengeDay()): DailyChallenge | null {
  if (songs.length === 0) return null;
  const ordered = [...songs].sort((a, b) => a.id.localeCompare(b.id));
  const hash = hashText(`beatpulse:${day}`);
  const song = ordered[hash % ordered.length];
  const hasAllDifficulties = (Number(song.chartVersion) || 1) >= CURRENT_CHART_VERSION;
  const difficulty = hasAllDifficulties
    ? CHALLENGE_DIFFICULTIES[(hash >>> 8) % CHALLENGE_DIFFICULTIES.length]
    : difficultyIdForValue(Number(song.difficulty));
  return { day, songId: song.id, difficulty };
}
