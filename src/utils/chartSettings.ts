const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const DEFAULT_DIFFICULTY = 0.4;

export interface DifficultyProfile {
  complexity: number;
  density: number;
  laneVariety: number;
  sliderProbability: number;
  stamina: number;
}

export function getChartSettingsForDifficulty(rawDifficulty: number): DifficultyProfile {
  const difficulty = clamp(rawDifficulty, 0, 1);

  return {
    complexity: difficulty,
    density: clamp(0.2 + difficulty * 0.7, 0.2, 0.9),
    laneVariety: clamp(0.22 + difficulty * 0.5, 0.22, 0.72),
    sliderProbability: clamp(0.08 + difficulty * 0.24, 0.08, 0.32),
    stamina: clamp(0.2 + difficulty * 0.58, 0.2, 0.78),
  };
}

export function getDifficultyPreset(value: number) {
  if (value < 0.25) {
    return {
      label: 'Beginner',
      description: 'Spacious patterns with gentle movement.',
    };
  }

  if (value < 0.5) {
    return {
      label: 'Standard',
      description: 'Friendly charts that still feel active.',
    };
  }

  if (value < 0.75) {
    return {
      label: 'Advanced',
      description: 'Faster streams and stronger bursts.',
    };
  }

  return {
    label: 'Expert',
    description: 'Dense charts with heavier endurance.',
  };
}
