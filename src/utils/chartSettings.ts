const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const DEFAULT_DIFFICULTY = 0.4;

export interface DifficultyProfile {
  complexity: number;
  density: number;
  laneVariety: number;
  sliderProbability: number;
  stamina: number;
}

export interface DifficultyPreset {
  id: 'easy' | 'normal' | 'hard' | 'expert';
  label: string;
  value: number;
  description: string;
  pace: string;
}

export const DIFFICULTY_PRESETS: DifficultyPreset[] = [
  {
    id: 'easy',
    label: 'Easy',
    value: 0.12,
    description: 'Roomy patterns and forgiving bursts.',
    pace: 'Learn the rhythm',
  },
  {
    id: 'normal',
    label: 'Normal',
    value: DEFAULT_DIFFICULTY,
    description: 'Balanced patterns for everyday play.',
    pace: 'Recommended',
  },
  {
    id: 'hard',
    label: 'Hard',
    value: 0.68,
    description: 'Faster streams and active lane movement.',
    pace: 'Push your timing',
  },
  {
    id: 'expert',
    label: 'Expert',
    value: 0.92,
    description: 'Dense phrases built for endurance.',
    pace: 'Maximum challenge',
  },
];

export function getChartSettingsForDifficulty(rawDifficulty: number): DifficultyProfile {
  const difficulty = clamp(rawDifficulty, 0, 1);
  const paceCurve = Math.pow(difficulty, 0.86);
  const staminaCurve = Math.pow(difficulty, 1.06);

  return {
    complexity: difficulty,
    density: clamp(0.18 + paceCurve * 0.7, 0.18, 0.88),
    laneVariety: clamp(0.2 + difficulty * 0.62, 0.2, 0.82),
    sliderProbability: clamp(0.1 + difficulty * 0.34, 0.1, 0.44),
    stamina: clamp(0.18 + staminaCurve * 0.68, 0.18, 0.86),
  };
}

export function getDifficultyPreset(value: number) {
  const difficulty = clamp(value, 0, 1);
  return DIFFICULTY_PRESETS.reduce((closest, preset) =>
    Math.abs(preset.value - difficulty) < Math.abs(closest.value - difficulty) ? preset : closest
  );
}
