import type { JudgementSummary, Note } from '../../types';

/** Gameplay constants and pure helpers shared by the game view. */

export const LANE_COUNT = 4;
export const NOTE_SPEED = 600; // pixels per second
export const HOLD_GRACE_SECONDS = 0.115;
export const SOLO_LEAD_IN_SECONDS = 3;
/** Intros longer than this (before the first note) can be skipped. */
export const SKIPPABLE_INTRO_SECONDS = 6;
export const LANE_THEMES = {
  pulse: ['#00f3ff', '#a855f7', '#ff4fcf', '#65ff8f'],
  colorblind: ['#56b4e9', '#e69f00', '#009e73', '#cc79a7'],
  'high-contrast': ['#00e5ff', '#ffea00', '#ff6e40', '#76ff03'],
  ocean: ['#38bdf8', '#22d3ee', '#2dd4bf', '#60a5fa'],
  sunset: ['#fb7185', '#fb923c', '#facc15', '#c084fc'],
} as const;
export const VISUAL_BACKGROUNDS = {
  pulse: 'radial-gradient(circle at 50% 20%, rgba(99,102,241,0.12), transparent 38%), radial-gradient(circle at 16% 75%, rgba(0,243,255,0.06), transparent 32%), radial-gradient(circle at 84% 72%, rgba(188,19,254,0.07), transparent 32%)',
  aurora: 'radial-gradient(circle at 50% 12%, rgba(34,197,94,0.14), transparent 38%), radial-gradient(circle at 12% 72%, rgba(56,189,248,0.08), transparent 34%), radial-gradient(circle at 86% 70%, rgba(16,185,129,0.09), transparent 32%)',
  sunset: 'radial-gradient(circle at 50% 18%, rgba(251,146,60,0.15), transparent 38%), radial-gradient(circle at 16% 76%, rgba(244,63,94,0.08), transparent 32%), radial-gradient(circle at 82% 72%, rgba(168,85,247,0.09), transparent 34%)',
} as const;
export const TIMING_PRESETS = [
  { id: 'relaxed', label: 'Relaxed', hitWindow: 0.22, perfectWindow: 0.08, description: 'More room around every note.' },
  { id: 'standard', label: 'Standard', hitWindow: 0.15, perfectWindow: 0.05, description: 'Balanced timing for normal play.' },
  { id: 'precise', label: 'Precise', hitWindow: 0.11, perfectWindow: 0.035, description: 'Tighter timing for competitive runs.' },
] as const;

export interface HoldTracker {
  nextTickTime: number;
  tickInterval: number;
  lastValidTime: number;
  lastRequiredLane: number;
  headWeight: number;
}

export const getSlideProgress = (note: Note, time: number) =>
  note.duration ? Math.max(0, Math.min(1, (time - note.time) / note.duration)) : 0;

export const getSlideLanePosition = (note: Note, time: number) => {
  const endLane = note.endLane ?? note.lane;
  const progress = getSlideProgress(note, time);
  const easedProgress = progress * progress * (3 - 2 * progress);
  return note.lane + (endLane - note.lane) * easedProgress;
};

export const getRequiredSlideLane = (note: Note, time: number) =>
  Math.round(getSlideLanePosition(note, time));

/** Carries the last known score forward over seconds with no sample (pauses, skipped intros). */
export const fillTimeline = (timeline: number[]) => {
  const filled: number[] = [];
  let last = 0;
  for (let second = 0; second < timeline.length; second++) {
    if (typeof timeline[second] === 'number') last = timeline[second];
    filled.push(last);
  }
  return filled;
};

export const emptyJudgements = (): JudgementSummary => ({ perfect: 0, great: 0, miss: 0, holdBreak: 0, timingOffsets: [] });

export const createLaneOrder = (notes: Note[]) => {
  let seed = notes.reduce((value, note) => {
    for (const character of note.id) value = ((value << 5) - value + character.charCodeAt(0)) | 0;
    return value;
  }, notes.length * 97) >>> 0;
  const order = [0, 1, 2, 3];
  for (let index = order.length - 1; index > 0; index--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [order[index], order[target]] = [order[target], order[index]];
  }
  return order;
};

export const estimateVisualBeat = (notes: Note[]) => {
  const uniqueTimes = [...new Set(notes.map((note) => Number(note.time.toFixed(3))))].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < uniqueTimes.length; i++) {
    const interval = uniqueTimes[i] - uniqueTimes[i - 1];
    if (interval >= 0.14 && interval <= 1.1) intervals.push(interval);
  }
  intervals.sort((a, b) => a - b);
  let interval = intervals[Math.floor(intervals.length / 2)] ?? 0.5;
  while (interval < 0.34) interval *= 2;
  while (interval > 0.78) interval /= 2;
  return { interval, origin: notes[0]?.time ?? 0 };
};
