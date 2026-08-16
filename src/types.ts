export interface Note {
  id: string;
  time: number; // Time in seconds when the note should be hit
  lane: number; // 0, 1, 2, 3
  duration?: number; // Duration of a hold or slide in seconds
  endLane?: number; // Moving slides travel from lane to this lane; omitted for vertical holds
  tickInterval?: number; // Musical sustain-check interval chosen by the chart generator
  hit: boolean;
  missed: boolean;
  held?: boolean; // Runtime sustain state
}

export interface CommunitySong {
  id: string;
  name: string;
  artist: string;
  audioUrl: string;
  difficulty: number;
  density?: number;
  laneVariety?: number;
  sliderProbability?: number;
  stamina?: number;
  notes?: string;
  topScore: number;
  authorName?: string;
  createdAt?: any;
}

export interface GameState {
  isPlaying: boolean;
  score: number;
  combo: number;
  maxCombo: number;
  accuracy: number;
  totalNotes: number;
  hitNotes: number;
  currentTime: number;
  duration: number;
}

export interface Settings {
  volume: number;
  visualEffects: boolean;
  keybindings: [string, string, string, string];
  advancedChartMode: boolean;
  complexity: number;
  density: number;
  laneVariety: number;
  sliderProbability: number;
  stamina: number;
}

export interface SongData {
  id?: string;
  name: string;
  artist: string;
  audioBuffer: AudioBuffer;
  notes: Note[];
  difficulty: number; // 0 to 1
  density?: number;
  laneVariety?: number;
  sliderProbability?: number;
  stamina?: number;
}

export interface ReplayEvent {
  time: number;
  lane: number;
  type: string;
}

export interface SavedReplay {
  id: string;
  songId?: string;
  songName: string;
  artist: string;
  difficulty: number;
  density?: number;
  laneVariety?: number;
  sliderProbability?: number;
  stamina?: number;
  score: number;
  accuracy: number;
  date: string;
  events: ReplayEvent[];
}
