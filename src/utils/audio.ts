import type { Note, SongSection, SongSectionKind } from '../types';
import { mixAudioBufferToMono } from './monoAudio';

export interface NoteGenerationConfig {
  complexity?: number;
  density?: number;
  laneVariety?: number;
  maxConsecutive?: number;
  minNoteSpacing?: number;
  sliderProbability?: number;
  stamina?: number;
  allowMovingSliders?: boolean;
}

interface AudioWindowFeature {
  time: number;
  rms: number;
  transient: number;
  zeroCrossings: number;
  peak: number;
  lowEnergy: number;
  highEnergy: number;
}

interface OnsetCandidate {
  time: number;
  score: number;
  strength: number;
  rms: number;
  transient: number;
  peak: number;
  sourceIndex: number;
  localPace?: number;
  sectionEnergy?: number;
  sustain?: number;
  beatPosition?: number;
  /** 0 (bass-heavy) to 1 (bright), ranked against the rest of the song. */
  brightness?: number;
}

interface TempoEstimate {
  bpm: number;
  confidence: number;
  origin: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildPrefixSum = (values: number[]) => {
  const prefix = new Array(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
  return prefix;
};

const averageFromPrefix = (prefix: number[], start: number, end: number) => {
  const safeStart = clamp(Math.floor(start), 0, prefix.length - 1);
  const safeEnd = clamp(Math.ceil(end), safeStart + 1, prefix.length - 1);
  return (prefix[safeEnd] - prefix[safeStart]) / Math.max(1, safeEnd - safeStart);
};

const percentile = (values: number[], amount: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(clamp(amount, 0, 1) * (sorted.length - 1)))];
};

const normalizeEstimatedBpm = (bpm: number) => {
  let normalized = bpm;
  while (normalized < 58) normalized *= 2;
  while (normalized > 205) normalized /= 2;
  return normalized;
};

const hashAudio = (data: Float32Array) => {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(data.length / 4096));
  for (let i = 0; i < data.length; i += step) {
    const quantized = Math.round((data[i] + 1) * 32767);
    hash = Math.imul(hash ^ quantized, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seed: number) => {
  let state = seed || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const mixToMono = mixAudioBufferToMono;

/**
 * Finds broad musical phrases from the energy envelope. It intentionally uses
 * long windows: section labels should be stable and useful for a playfield
 * timeline, not flicker with every drum hit.
 */
export const analyzeSongSections = (audioBuffer: AudioBuffer): SongSection[] =>
  analyzeSectionsFromMono(mixToMono(audioBuffer), audioBuffer.sampleRate, audioBuffer.duration);

const analyzeSectionsFromMono = (mono: Float32Array, sampleRate: number, duration: number): SongSection[] => {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const windowSeconds = clamp(duration / 9, 5.5, 12);
  const windowSize = Math.max(1, Math.floor(sampleRate * windowSeconds));
  const windows: Array<{ start: number; end: number; energy: number }> = [];

  for (let start = 0; start < mono.length; start += windowSize) {
    const end = Math.min(mono.length, start + windowSize);
    let sum = 0;
    for (let index = start; index < end; index += 4) sum += mono[index] * mono[index];
    windows.push({
      start: start / sampleRate,
      end: end / sampleRate,
      energy: Math.sqrt(sum / Math.max(1, Math.ceil((end - start) / 4))),
    });
  }
  if (windows.length === 1) return [{ id: 'section-1', label: 'Full track', kind: 'verse', start: 0, end: duration, intensity: 0.5 }];

  const energies = windows.map((window) => window.energy);
  const highEnergy = percentile(energies, 0.72);
  const lowEnergy = percentile(energies, 0.34);
  const maxEnergy = Math.max(0.00001, ...energies);
  const edgeCount = duration >= 36 ? 1 : 0;
  const raw = windows.map((window, index) => {
    let kind: SongSectionKind;
    if (edgeCount && index < edgeCount) kind = 'intro';
    else if (edgeCount && index >= windows.length - edgeCount) kind = 'outro';
    else if (window.energy >= highEnergy) kind = 'chorus';
    else if (index > 1 && window.energy <= lowEnergy && windows.slice(0, index).some((entry) => entry.energy >= highEnergy)) kind = 'bridge';
    else kind = 'verse';
    return { ...window, kind };
  });

  const combined: Array<{ start: number; end: number; kind: SongSectionKind; energy: number; count: number }> = [];
  raw.forEach((section) => {
    const previous = combined[combined.length - 1];
    if (previous && previous.kind === section.kind) {
      previous.end = section.end;
      previous.energy += section.energy;
      previous.count += 1;
    } else {
      combined.push({ start: section.start, end: section.end, kind: section.kind, energy: section.energy, count: 1 });
    }
  });
  const labelCounts: Partial<Record<SongSectionKind, number>> = {};
  const labels: Record<SongSectionKind, string> = { intro: 'Intro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', outro: 'Outro' };
  return combined.map((section, index) => {
    labelCounts[section.kind] = (labelCounts[section.kind] ?? 0) + 1;
    const suffix = ['verse', 'chorus', 'bridge'].includes(section.kind) ? ` ${labelCounts[section.kind]}` : '';
    return {
      id: `section-${index + 1}`,
      label: `${labels[section.kind]}${suffix}`,
      kind: section.kind,
      start: section.start,
      end: Math.min(duration, section.end),
      intensity: clamp((section.energy / section.count) / maxEnergy, 0.15, 1),
    };
  });
};

const analyzeAudioWindows = (monoData: Float32Array, sampleRate: number, windowSize: number) => {
  const features: AudioWindowFeature[] = [];
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
  const midAlpha = 1 - Math.exp((-2 * Math.PI * 1800) / sampleRate);
  let lowPass = 0;
  let midPass = 0;
  let previousSample = 0;

  for (let i = 0; i < monoData.length; i += windowSize) {
    let energy = 0;
    let lowEnergy = 0;
    let highEnergy = 0;
    let transient = 0;
    let peak = 0;
    let zeroCrossings = 0;
    let localPrevious = previousSample;
    let sampleCount = 0;

    for (let j = 0; j < windowSize && i + j < monoData.length; j++) {
      const sample = monoData[i + j];
      lowPass += lowAlpha * (sample - lowPass);
      midPass += midAlpha * (sample - midPass);
      const high = sample - midPass;
      energy += sample * sample;
      lowEnergy += lowPass * lowPass;
      highEnergy += high * high;
      transient += Math.abs(sample - localPrevious);
      if ((sample >= 0) !== (localPrevious >= 0)) zeroCrossings += 1;
      peak = Math.max(peak, Math.abs(sample));
      localPrevious = sample;
      sampleCount += 1;
    }

    previousSample = localPrevious;
    const divisor = Math.max(1, sampleCount);
    features.push({
      time: i / sampleRate,
      rms: Math.sqrt(energy / divisor),
      transient: transient / divisor,
      zeroCrossings: zeroCrossings / divisor,
      peak,
      lowEnergy: Math.sqrt(lowEnergy / divisor),
      highEnergy: Math.sqrt(highEnergy / divisor),
    });
  }
  return features;
};

const findGridOrigin = (candidates: OnsetCandidate[], beatInterval: number) => {
  const possibleOrigins = [...candidates]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 48)
    .map((candidate) => candidate.time);
  let bestOrigin = candidates[0]?.time ?? 0;
  let bestScore = -Infinity;
  const tolerance = Math.max(0.028, beatInterval * 0.12);

  possibleOrigins.forEach((origin) => {
    let score = 0;
    candidates.forEach((candidate) => {
      const beats = (candidate.time - origin) / beatInterval;
      const distance = Math.abs(beats - Math.round(beats)) * beatInterval;
      score += candidate.strength * Math.exp(-Math.pow(distance / tolerance, 2));
    });
    if (score > bestScore) {
      bestScore = score;
      bestOrigin = origin;
    }
  });

  return bestOrigin;
};

const estimateTempo = (
  candidates: OnsetCandidate[],
  onsetScores: number[],
  windowDuration: number,
  onsetThreshold: number
): TempoEstimate | null => {
  if (candidates.length < 4) return null;

  const intervalHistogram = new Map<number, number>();
  const adjacentIntervals: number[] = [];
  for (let i = 1; i < candidates.length; i++) {
    const adjacent = candidates[i].time - candidates[i - 1].time;
    if (adjacent >= 0.18 && adjacent <= 1.1) adjacentIntervals.push(adjacent);
    for (let j = Math.max(0, i - 10); j < i; j++) {
      const interval = candidates[i].time - candidates[j].time;
      if (interval < 0.28 || interval > 1.08) continue;
      const bpm = normalizeEstimatedBpm(60 / interval);
      if (bpm < 58 || bpm > 205) continue;
      const bucket = Math.round(bpm * 2);
      const adjacencyWeight = 1 / Math.sqrt(i - j);
      const weight = (candidates[i].strength + candidates[j].strength) * adjacencyWeight;
      intervalHistogram.set(bucket, (intervalHistogram.get(bucket) ?? 0) + weight);
    }
  }

  const envelope = onsetScores.map((value) => Math.max(0, value - onsetThreshold * 0.68));
  const tempoRows: Array<{ bpm: number; correlation: number; interval: number; score: number }> = [];
  let maxCorrelation = 0;
  let maxInterval = 0;
  for (let bpm = 58; bpm <= 205; bpm += 0.5) {
    const lag = Math.max(1, Math.round((60 / bpm) / windowDuration));
    let product = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let i = lag; i < envelope.length; i += 2) {
      product += envelope[i] * envelope[i - lag];
      leftEnergy += envelope[i] * envelope[i];
      rightEnergy += envelope[i - lag] * envelope[i - lag];
    }
    const correlation = product / Math.max(0.000001, Math.sqrt(leftEnergy * rightEnergy));
    const intervalScore = intervalHistogram.get(Math.round(bpm * 2)) ?? 0;
    maxCorrelation = Math.max(maxCorrelation, correlation);
    maxInterval = Math.max(maxInterval, intervalScore);
    tempoRows.push({ bpm, correlation, interval: intervalScore, score: 0 });
  }

  const medianInterval = percentile(adjacentIntervals, 0.5);
  const paceBpm = medianInterval > 0 ? normalizeEstimatedBpm(60 / medianInterval) : 120;
  tempoRows.forEach((row) => {
    const correlation = row.correlation / Math.max(0.0001, maxCorrelation);
    const interval = row.interval / Math.max(0.0001, maxInterval);
    const paceAgreement = Math.exp(-Math.pow(Math.log2(row.bpm / paceBpm) / 0.36, 2));
    const comfortPrior = 1 - Math.min(1, Math.abs(row.bpm - 128) / 170);
    row.score = correlation * 0.61 + interval * 0.29 + paceAgreement * 0.08 + comfortPrior * 0.02;
  });

  tempoRows.sort((a, b) => b.score - a.score);
  let winner = tempoRows[0];
  if (!winner || winner.score <= 0) return null;

  if (winner.bpm > 168) {
    const halfTempo = tempoRows.find((row) => Math.abs(row.bpm - winner.bpm / 2) <= 0.3);
    if (halfTempo && halfTempo.score >= winner.score * 0.9 && paceBpm < 145) winner = halfTempo;
  } else if (winner.bpm < 78 && paceBpm > 120) {
    const doubleTempo = tempoRows.find((row) => Math.abs(row.bpm - winner.bpm * 2) <= 0.3);
    if (doubleTempo && doubleTempo.score >= winner.score * 0.92) winner = doubleTempo;
  }

  const runnerUp = tempoRows.find((row) => Math.abs(row.bpm - winner.bpm) > 5)?.score ?? 0;
  const confidence = clamp(0.25 + (winner.score - runnerUp) / Math.max(0.001, winner.score), 0.2, 0.95);
  const beatInterval = 60 / winner.bpm;
  return { bpm: winner.bpm, confidence, origin: findGridOrigin(candidates, beatInterval) };
};

interface BeatSegment {
  center: number;
  /** A beat time close to `center`. */
  anchor: number;
  interval: number;
  /** Running beat count of `anchor` from the start of the song. */
  beatIndex: number;
}

interface GridPoint {
  time: number;
  /** Unique id of the grid cell for the requested subdivision. */
  cell: number;
  /** Beat index of the grid cell (fractional for off-beat subdivisions). */
  beat: number;
}

interface BeatGrid {
  beatInterval: number;
  /** Beat index (0-3) inside the bar that carries the strongest accents. */
  downbeatPhase: number;
  snap: (time: number, subdivision: number) => GridPoint;
}

const strongOnsets = (candidates: OnsetCandidate[]) => {
  const threshold = percentile(candidates.map((candidate) => candidate.strength), 0.45);
  return candidates.filter((candidate) => candidate.strength >= threshold);
};

const phaseVector = (onsets: OnsetCandidate[], period: number, origin = 0, weightAt?: (candidate: OnsetCandidate) => number) => {
  let re = 0;
  let im = 0;
  let total = 0;
  for (const onset of onsets) {
    // Log-compressed so one very loud hit cannot outvote a whole bar of steady ones.
    const weight = (weightAt ? weightAt(onset) : 1) * Math.log1p(onset.strength);
    if (weight <= 0) continue;
    const angle = (2 * Math.PI * (onset.time - origin)) / period;
    re += weight * Math.cos(angle);
    im += weight * Math.sin(angle);
    total += weight;
  }
  return { magnitude: total > 0 ? Math.hypot(re, im) / total : 0, angle: Math.atan2(im, re), total };
};

/**
 * The coarse estimator works in 0.5 BPM steps, which is enough to drift a full
 * beat over a few minutes. This sharpens the tempo to 0.01 BPM by maximising how
 * tightly the strong onsets line up with the beat period, then derives the phase.
 */
const refineTempo = (candidates: OnsetCandidate[], estimate: TempoEstimate): TempoEstimate => {
  const onsets = strongOnsets(candidates);
  if (onsets.length < 8) return estimate;
  let bestBpm = estimate.bpm;
  let best = phaseVector(onsets, 60 / estimate.bpm);
  for (let bpm = estimate.bpm - 1.2; bpm <= estimate.bpm + 1.2; bpm += 0.01) {
    const vector = phaseVector(onsets, 60 / bpm);
    if (vector.magnitude > best.magnitude) {
      best = vector;
      bestBpm = bpm;
    }
  }
  const period = 60 / bestBpm;
  let origin = ((best.angle / (2 * Math.PI)) * period) % period;
  if (origin < 0) origin += period;
  return {
    bpm: bestBpm,
    origin,
    confidence: clamp(Math.max(estimate.confidence, best.magnitude), 0.2, 0.97),
  };
};

/**
 * Real recordings rarely hold a perfectly fixed tempo, so the beat phase and period
 * are re-fitted every two bars. Snapping then follows the band instead of a grid
 * that slowly slides off the music.
 */
const buildBeatGrid = (candidates: OnsetCandidate[], tempo: TempoEstimate, duration: number): BeatGrid => {
  const beatInterval = 60 / tempo.bpm;
  const onsets = strongOnsets(candidates);
  const segmentLength = beatInterval * 8;
  const reach = beatInterval * 5;
  const segmentCount = Math.max(1, Math.ceil((duration - tempo.origin) / segmentLength));
  const centers: number[] = [];
  const fittedAnchors: Array<number | null> = [];

  // Fit only the phase in each window: over a few beats a slightly wrong period barely
  // smears the fit, and the local period falls out of the spacing between anchors below.
  // The fit runs on the half-beat lattice so loud off-beats reinforce instead of cancel;
  // beat parity is then carried forward from the previous anchor.
  const halfBeat = beatInterval / 2;
  let cursor = 0;
  let predicted = tempo.origin;
  for (let segment = 0; segment < segmentCount; segment++) {
    const center = tempo.origin + (segment + 0.5) * segmentLength;
    centers.push(center);
    while (cursor < onsets.length && onsets[cursor].time < center - reach) cursor += 1;
    const local: OnsetCandidate[] = [];
    for (let i = cursor; i < onsets.length && onsets[i].time <= center + reach; i++) local.push(onsets[i]);
    const vector = phaseVector(local, halfBeat, center, (onset) => 1 - Math.abs(onset.time - center) / (reach * 1.05));
    const expected = predicted + Math.round((center - predicted) / beatInterval) * beatInterval;
    if (local.length >= 4 && vector.magnitude >= 0.35) {
      const halfAnchor = center + (vector.angle / (2 * Math.PI)) * halfBeat;
      const anchor = halfAnchor + Math.round((expected - halfAnchor) / beatInterval) * beatInterval;
      const alternate = anchor + (expected >= anchor ? halfBeat : -halfBeat);
      const chosen = Math.abs(alternate - expected) < Math.abs(anchor - expected) ? alternate : anchor;
      fittedAnchors.push(chosen);
      predicted = chosen;
    } else {
      fittedAnchors.push(null);
    }
  }

  // Quiet segments inherit the nearest earlier fit (or the global phase before any fit).
  const anchors: number[] = [];
  fittedAnchors.forEach((anchor, index) => {
    const reference = anchor ?? (index > 0 ? anchors[index - 1] : tempo.origin);
    anchors.push(anchor ?? reference + Math.round((centers[index] - reference) / beatInterval) * beatInterval);
  });
  const beatsBetween = anchors.slice(1).map((anchor, index) => Math.max(1, Math.round((anchor - anchors[index]) / beatInterval)));
  const spanInterval = (index: number) => {
    if (index < 0 || index >= beatsBetween.length) return null;
    const interval = (anchors[index + 1] - anchors[index]) / beatsBetween[index];
    return Math.abs(interval / beatInterval - 1) <= 0.05 ? interval : null;
  };
  let beatIndex = Math.round((anchors[0] - tempo.origin) / beatInterval);
  const segments: BeatSegment[] = anchors.map((anchor, index) => {
    if (index > 0) beatIndex += beatsBetween[index - 1];
    const around = [spanInterval(index - 1), spanInterval(index)].filter((value): value is number => value !== null);
    const interval = around.length > 0 ? around.reduce((sum, value) => sum + value, 0) / around.length : beatInterval;
    return { center: centers[index], anchor, interval, beatIndex };
  });

  const segmentAt = (time: number) => segments[clamp(Math.floor((time - tempo.origin) / segmentLength), 0, segments.length - 1)];
  const snap = (time: number, subdivision: number): GridPoint => {
    const segment = segmentAt(time);
    const step = segment.interval / subdivision;
    const offset = Math.round((time - segment.anchor) / step);
    return {
      time: segment.anchor + offset * step,
      cell: segment.beatIndex * subdivision + offset,
      beat: segment.beatIndex + offset / subdivision,
    };
  };

  const phaseWeights = [0, 0, 0, 0];
  onsets.forEach((onset) => {
    const point = snap(onset.time, 1);
    if (Math.abs(onset.time - point.time) <= beatInterval * 0.12) {
      phaseWeights[((point.beat % 4) + 4) % 4] += onset.strength * (0.6 + onset.peak);
    }
  });
  const downbeatPhase = phaseWeights.indexOf(Math.max(...phaseWeights));

  return { beatInterval, downbeatPhase, snap };
};

const chooseSingleLane = (
  availableLanes: number[],
  lastLane: number,
  laneVariety: number,
  tempoFactor: number,
  laneHistory: number[],
  random: () => number,
  /** Lane the sound "belongs" in (low pitch left, high pitch right). */
  pitchLane?: number,
  pitchWeight = 0
) => {
  if (availableLanes.length <= 1) return availableLanes[0] ?? 0;
  if (lastLane < 0 && pitchLane === undefined) return availableLanes[Math.floor(random() * availableLanes.length)];

  const recentWindow = laneHistory.slice(-4);
  const previousLane = laneHistory[laneHistory.length - 2] ?? -1;
  let recentDirection = 0;
  let directionRun = 0;
  for (let i = laneHistory.length - 1; i > 0; i--) {
    const direction = Math.sign(laneHistory[i] - laneHistory[i - 1]);
    if (direction === 0) break;
    if (recentDirection === 0) recentDirection = direction;
    if (direction !== recentDirection) break;
    directionRun += 1;
  }

  return [...availableLanes].sort((a, b) => {
    const score = (lane: number) => {
      const distance = lastLane < 0 ? 0 : Math.abs(lane - lastLane);
      const direction = lastLane < 0 ? 0 : Math.sign(lane - lastLane);
      return Math.min(distance, 2) * (0.5 + laneVariety * 0.5 + tempoFactor * 0.15)
        - (lane === lastLane ? 1.2 + tempoFactor * 0.45 : 0)
        - recentWindow.filter((value) => value === lane).length * 0.2
        - (directionRun >= 2 && direction === recentDirection ? 0.9 + directionRun * 0.24 : 0)
        + (directionRun >= 2 && direction === -recentDirection ? 0.42 : 0)
        + (lane === previousLane ? 0.2 : 0)
        + (!recentWindow.includes(lane) ? laneVariety * 0.15 : 0)
        - (pitchLane !== undefined ? Math.abs(lane - pitchLane) * pitchWeight : 0)
        + random() * 0.18;
    };
    return score(b) - score(a);
  })[0];
};

const chooseChordLanes = (availableLanes: number[], random: () => number) => {
  if (availableLanes.length < 2) return availableLanes.slice(0, 1);
  let bestPair: number[] = availableLanes.slice(0, 2);
  let bestScore = -Infinity;
  for (let i = 0; i < availableLanes.length; i++) {
    for (let j = i + 1; j < availableLanes.length; j++) {
      const left = availableLanes[i];
      const right = availableLanes[j];
      const score = Math.abs(right - left) - Math.abs((left + right) / 2 - 1.5) * 0.08 + random() * 0.12;
      if (score > bestScore) {
        bestScore = score;
        bestPair = [left, right];
      }
    }
  }
  return bestPair;
};

interface RepeatedSections {
  /** Where a candidate sits within a repeated section, keyed to the first occurrence. */
  locate: (candidate: OnsetCandidate) => { key: string; isRepeat: boolean } | null;
  /** Whether the first occurrence had an onset at this position. */
  referenceHas: (key: string) => boolean;
}

/**
 * Finds sections that repeat (a second chorus, a returning verse) and lines each
 * repeat up with its first occurrence by the bar offset where their onset patterns
 * match best. Sections are only treated as repeats when the rhythm really matches.
 */
const findRepeatedSections = (
  sections: SongSection[],
  candidates: OnsetCandidate[],
  beatAt: (time: number) => number,
  downbeatPhase: number,
  beatInterval: number,
  envelopeAt: (time: number) => number
): RepeatedSections => {
  const barStart = (time: number) => {
    const beat = beatAt(time);
    const startBeat = downbeatPhase + Math.round((beat - downbeatPhase) / 4) * 4;
    return { startBeat, startTime: time + (startBeat - beat) * beatInterval };
  };
  // Onset strength sampled on the half-beat grid: a rhythm fingerprint that does not
  // depend on which onsets happened to become note candidates.
  const fingerprint = (section: SongSection, startTime: number) => {
    const values: number[] = [];
    for (let time = startTime; time < section.end; time += beatInterval / 2) values.push(Math.log1p(envelopeAt(time)));
    return values;
  };
  const similarity = (a: number[], b: number[], shift: number) => {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < b.length; i++) {
      const j = i + shift;
      if (j < 0 || j >= a.length) continue;
      const x = a[j] - 0.2;
      const y = b[i] - 0.2;
      dot += x * y;
      normA += x * x;
      normB += y * y;
    }
    return dot / Math.max(0.000001, Math.sqrt(normA * normB));
  };

  type Placement = { section: SongSection; startBeat: number; referenceId: string; shift: number; isRepeat: boolean };
  const placements: Placement[] = [];
  const referenceOffsets = new Map<string, Set<number>>();
  const firstByKind = new Map<string, { section: SongSection; fingerprint: number[] }>();

  for (const section of sections) {
    if (section.kind !== 'chorus' && section.kind !== 'verse') continue;
    const { startBeat, startTime } = barStart(section.start);
    const print = fingerprint(section, startTime);
    const reference = firstByKind.get(section.kind);
    if (!reference) {
      firstByKind.set(section.kind, { section, fingerprint: print });
      referenceOffsets.set(section.id, new Set(candidates
        .filter((candidate) => candidate.time >= section.start && candidate.time < section.end)
        .map((candidate) => Math.round(((candidate.beatPosition ?? 0) - startBeat) * 2))));
      placements.push({ section, startBeat, referenceId: section.id, shift: 0, isRepeat: false });
      continue;
    }
    let bestShift = 0;
    let bestScore = -1;
    // Nearest shifts first; a farther shift must be clearly better, since periodic
    // rhythms match equally well at many offsets.
    for (const bars of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      const score = similarity(reference.fingerprint, print, bars * 8);
      if (score > bestScore + 0.03) {
        bestScore = score;
        bestShift = bars * 8;
      }
    }
    if (print.length >= 16 && bestScore >= 0.55) {
      placements.push({ section, startBeat, referenceId: reference.section.id, shift: bestShift, isRepeat: true });
    }
  }

  return {
    locate: (candidate) => {
      const placement = placements.find((entry) => candidate.time >= entry.section.start && candidate.time < entry.section.end);
      if (!placement) return null;
      const offset = Math.round(((candidate.beatPosition ?? 0) - placement.startBeat) * 2) + placement.shift;
      return { key: `${placement.referenceId}:${offset}`, isRepeat: placement.isRepeat };
    },
    referenceHas: (key) => {
      const [referenceId, offset] = key.split(':');
      return referenceOffsets.get(referenceId)?.has(Number(offset)) ?? false;
    },
  };
};

/**
 * Builds a deterministic, tempo-aware four-lane chart. Strong onsets establish
 * the beat grid; local activity and phrase energy then control playable density.
 */
export async function generateNotesFromAudio(
  audioBuffer: AudioBuffer,
  config: number | NoteGenerationConfig = 0.5
): Promise<Note[]> {
  const complexity = clamp(typeof config === 'number' ? config : (config.complexity ?? 0.5), 0, 1);
  const density = clamp(typeof config === 'object' ? (config.density ?? complexity) : complexity, 0, 1);
  const laneVariety = clamp(typeof config === 'object' ? (config.laneVariety ?? complexity) : complexity, 0, 1);
  const maxConsecutive = typeof config === 'object'
    ? (config.maxConsecutive ?? Math.floor(3 + complexity * 5))
    : Math.floor(3 + complexity * 5);
  const minNoteSpacing = Math.max(0.055, typeof config === 'object' ? (config.minNoteSpacing ?? 0.08) : 0.08);
  const sliderProbability = clamp(typeof config === 'object' ? (config.sliderProbability ?? 0.3) : 0.3, 0, 1);
  const stamina = clamp(typeof config === 'object' ? (config.stamina ?? 0.5) : 0.5, 0, 1);
  const allowMovingSliders = typeof config === 'object' ? (config.allowMovingSliders ?? true) : true;

  const monoData = mixToMono(audioBuffer);
  const random = createSeededRandom(hashAudio(monoData) ^ Math.round(complexity * 997) ^ Math.round(density * 7919));
  let noteCounter = 0;
  const createNoteId = () => `pulse-${(++noteCounter).toString(36)}-${Math.floor(random() * 0xffffff).toString(36)}`;
  const sampleRate = audioBuffer.sampleRate;
  const windowDuration = 0.008;
  const windowSize = Math.max(128, Math.floor(sampleRate * windowDuration));
  const features = analyzeAudioWindows(monoData, sampleRate, windowSize);
  if (features.length === 0) return [];

  const rmsValues = features.map((feature) => feature.rms);
  const transientValues = features.map((feature) => feature.transient);
  const peakValues = features.map((feature) => feature.peak);
  const zeroCrossValues = features.map((feature) => feature.zeroCrossings);
  const lowValues = features.map((feature) => feature.lowEnergy);
  const highValues = features.map((feature) => feature.highEnergy);
  const rmsPrefix = buildPrefixSum(rmsValues);
  const transientPrefix = buildPrefixSum(transientValues);
  const peakPrefix = buildPrefixSum(peakValues);
  const zeroCrossPrefix = buildPrefixSum(zeroCrossValues);
  const lowPrefix = buildPrefixSum(lowValues);
  const highPrefix = buildPrefixSum(highValues);
  const localWindow = Math.max(12, Math.floor((0.19 - density * 0.045) / windowDuration));
  const onsetScores = new Array(features.length).fill(0);

  for (let i = localWindow; i < features.length - localWindow; i++) {
    const pastStart = i - localWindow;
    const pastEnd = i;
    const localRms = averageFromPrefix(rmsPrefix, pastStart, pastEnd);
    const localTransient = averageFromPrefix(transientPrefix, pastStart, pastEnd);
    const localPeak = averageFromPrefix(peakPrefix, pastStart, pastEnd);
    const localZero = averageFromPrefix(zeroCrossPrefix, pastStart, pastEnd);
    const localLow = averageFromPrefix(lowPrefix, pastStart, pastEnd);
    const localHigh = averageFromPrefix(highPrefix, pastStart, pastEnd);
    const previousRms = averageFromPrefix(rmsPrefix, i - 5, i - 1);
    const previousLow = averageFromPrefix(lowPrefix, i - 5, i - 1);
    const previousHigh = averageFromPrefix(highPrefix, i - 5, i - 1);
    const current = features[i];

    const transientRatio = current.transient / Math.max(0.00001, localTransient);
    const peakRatio = current.peak / Math.max(0.00001, localPeak);
    const energyFlux = Math.max(0, current.rms - previousRms) / Math.max(0.00001, localRms);
    const lowFlux = Math.max(0, current.lowEnergy - previousLow) / Math.max(0.00001, localLow);
    const highFlux = Math.max(0, current.highEnergy - previousHigh) / Math.max(0.00001, localHigh);
    const zeroAccent = Math.max(0, current.zeroCrossings / Math.max(0.00001, localZero) - 1);
    onsetScores[i] = transientRatio * 0.72 + peakRatio * 0.16 + energyFlux * 0.76 + lowFlux * 0.42 + highFlux * 0.32 + zeroAccent * 0.08;
  }

  const usableScores = onsetScores.slice(localWindow, -localWindow).filter((value) => Number.isFinite(value) && value > 0);
  const onsetThreshold = Math.max(0.25, percentile(usableScores, 0.77 - density * 0.11 - complexity * 0.045));
  const globalRms = averageFromPrefix(rmsPrefix, 0, rmsValues.length);
  const globalTransient = averageFromPrefix(transientPrefix, 0, transientValues.length);
  const roughCandidates: OnsetCandidate[] = [];
  let lastCandidateTime = -Infinity;

  for (let i = localWindow + 1; i < features.length - localWindow - 1; i++) {
    const current = features[i];
    const score = onsetScores[i];
    const isPeak = score >= onsetThreshold && score >= onsetScores[i - 1] && score > onsetScores[i + 1];
    const audible = current.rms > globalRms * 0.22 || current.transient > globalTransient * 0.4;
    if (!isPeak || !audible || current.time - lastCandidateTime < Math.max(0.045, minNoteSpacing * 0.58)) continue;
    roughCandidates.push({
      time: current.time,
      score,
      strength: score / Math.max(0.001, onsetThreshold),
      rms: current.rms,
      transient: current.transient,
      peak: current.peak,
      sourceIndex: i,
    });
    lastCandidateTime = current.time;
  }
  if (roughCandidates.length === 0) return [];

  const fallbackBpm = clamp(78 + density * 62 + complexity * 30, 72, 178);
  const coarseTempo = estimateTempo(roughCandidates, onsetScores, windowDuration, onsetThreshold);
  const tempo = coarseTempo ? refineTempo(roughCandidates, coarseTempo) : {
    bpm: fallbackBpm,
    confidence: 0.2,
    origin: roughCandidates[0].time,
  };
  const estimatedBpm = tempo.bpm;
  const grid = buildBeatGrid(roughCandidates, tempo, audioBuffer.duration);
  const beatInterval = grid.beatInterval;
  const tempoFactor = clamp((estimatedBpm - 105) / 90, 0, 1);
  let subdivision = density > 0.76 || complexity > 0.82 ? 4 : density > 0.3 || complexity > 0.4 ? 2 : 1;
  while (subdivision > 1 && beatInterval / subdivision < minNoteSpacing * 1.08) subdivision /= 2;
  const gridInterval = beatInterval / subdivision;
  const snapTolerance = gridInterval * (0.28 + tempo.confidence * 0.18);
  // Drop marginal onsets that are dwarfed by nearby hits; they are usually bleed or
  // noise and would otherwise make quiet passages look as busy as loud ones.
  const strongReference = percentile(roughCandidates.map((candidate) => candidate.strength), 0.95);
  const salientCandidates = roughCandidates.filter((candidate, index) => {
    if (candidate.strength >= 1.35) return true;
    if (candidate.strength * 20 < strongReference) return false;
    let localMax = candidate.strength;
    for (let i = index - 1; i >= 0 && candidate.time - roughCandidates[i].time <= beatInterval * 2; i--) localMax = Math.max(localMax, roughCandidates[i].strength);
    for (let i = index + 1; i < roughCandidates.length && roughCandidates[i].time - candidate.time <= beatInterval * 2; i++) localMax = Math.max(localMax, roughCandidates[i].strength);
    return candidate.strength * 10 >= localMax;
  });
  const candidateRate = salientCandidates.length / Math.max(1, audioBuffer.duration);
  const phraseWindow = Math.max(1, Math.round((beatInterval * 4) / windowDuration));
  const candidateWindow = Math.max(0.75, beatInterval * 2);
  const quantizedByCell = new Map<number, OnsetCandidate>();
  const isDownbeat = (beatPosition: number) => (((beatPosition - grid.downbeatPhase) % 4) + 4) % 4 === 0;

  salientCandidates.forEach((candidate, index) => {
    const point = grid.snap(candidate.time, subdivision);
    const cell = point.cell;
    const snapped = point.time;
    const time = Math.abs(snapped - candidate.time) <= snapTolerance || candidate.strength < 1.55 ? snapped : candidate.time;
    let left = index;
    let right = index;
    while (left > 0 && candidate.time - salientCandidates[left - 1].time <= candidateWindow) left -= 1;
    while (right + 1 < salientCandidates.length && salientCandidates[right + 1].time - candidate.time <= candidateWindow) right += 1;
    const sectionEnergy = averageFromPrefix(rmsPrefix, candidate.sourceIndex - phraseWindow, candidate.sourceIndex + phraseWindow) / Math.max(0.00001, globalRms);
    const futureEnergy = averageFromPrefix(rmsPrefix, candidate.sourceIndex, candidate.sourceIndex + phraseWindow / 2);
    const futureLow = averageFromPrefix(lowPrefix, candidate.sourceIndex, candidate.sourceIndex + phraseWindow / 2);
    const localLow = averageFromPrefix(lowPrefix, candidate.sourceIndex - phraseWindow / 2, candidate.sourceIndex + 1);
    const enriched: OnsetCandidate = {
      ...candidate,
      time: Math.max(0.04, time),
      localPace: (right - left + 1) / Math.max(0.25, candidateWindow * 2),
      sectionEnergy,
      sustain: (futureEnergy / Math.max(0.00001, globalRms)) * 0.55 + (futureLow / Math.max(0.00001, localLow)) * 0.45,
      beatPosition: point.beat,
      brightness: averageFromPrefix(highPrefix, candidate.sourceIndex, candidate.sourceIndex + 4)
        / Math.max(0.000001, averageFromPrefix(highPrefix, candidate.sourceIndex, candidate.sourceIndex + 4) + averageFromPrefix(lowPrefix, candidate.sourceIndex, candidate.sourceIndex + 4)),
    };
    const existing = quantizedByCell.get(cell);
    const phraseAccent = isDownbeat(enriched.beatPosition!) ? 0.14 : 0;
    if (!existing || enriched.strength + phraseAccent > existing.strength + (isDownbeat(existing.beatPosition!) ? 0.14 : 0)) {
      quantizedByCell.set(cell, enriched);
    }
  });

  const candidates = [...quantizedByCell.values()].sort((a, b) => a.time - b.time);
  // Rank brightness across the song so lane placement follows relative pitch, not the mix.
  const brightnessOrder = candidates.map((candidate) => candidate.brightness ?? 0.5).sort((a, b) => a - b);
  candidates.forEach((candidate) => {
    const value = candidate.brightness ?? 0.5;
    let low = 0;
    let high = brightnessOrder.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (brightnessOrder[middle] < value) low = middle + 1;
      else high = middle;
    }
    candidate.brightness = brightnessOrder.length > 1 ? low / (brightnessOrder.length - 1) : 0.5;
  });
  const pitchWeight = 0.6 + (1 - laneVariety) * 0.4;
  const repeats = findRepeatedSections(
    analyzeSectionsFromMono(monoData, sampleRate, audioBuffer.duration),
    candidates,
    (time) => grid.snap(time, 1).beat,
    grid.downbeatPhase,
    beatInterval,
    (time) => {
      const center = Math.round(time / windowDuration);
      let peak = 0;
      for (let i = Math.max(0, center - 4); i <= Math.min(onsetScores.length - 1, center + 4); i++) peak = Math.max(peak, onsetScores[i]);
      return peak / Math.max(0.001, onsetThreshold);
    }
  );
  // Lanes chosen in the first occurrence of a section, replayed when the section repeats.
  const phraseMemory = new Map<string, number[]>();
  const notes: Note[] = [];
  const laneOccupancy = [0, 0, 0, 0];
  const laneLastTime = [-Infinity, -Infinity, -Infinity, -Infinity];
  const recentNoteTimes: number[] = [];
  const laneHistory: number[] = [];
  const simultaneousWindow = Math.max(0.035, gridInterval * 0.24);
  const targetNotesPerSecond = clamp((estimatedBpm / 60) * (0.42 + density * 1.02 + complexity * 0.26), 0.8, 7.2);
  const staminaLimit = targetNotesPerSecond * (1.05 + stamina * 0.55);
  let lastNoteTime = -Infinity;
  let lastLane = -1;
  let streamDirection = random() > 0.5 ? 1 : -1;
  let patternRemaining = 0;
  let patternKind: 'stream' | 'trill' = 'stream';
  let trillLanes: [number, number] = [1, 2];
  let longNoteEnd = -Infinity;
  const burstCapacity = 1.6 + stamina * 1.6;
  let noteBudget = 1;
  let budgetClock = candidates[0]?.time ?? 0;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    while (recentNoteTimes.length > 0 && candidate.time - recentNoteTimes[0] > 1) recentNoteTimes.shift();
    const paceRatio = (candidate.localPace ?? candidateRate) / Math.max(0.2, candidateRate);
    const fastSection = clamp((paceRatio - 0.72) / 1.15, 0, 1);
    const phraseEnergy = clamp(((candidate.sectionEnergy ?? 1) - 0.55) / 1.1, 0, 1);
    const edgeDistance = Math.min(candidate.time, audioBuffer.duration - candidate.time) / Math.max(1, audioBuffer.duration);
    const isIntroOrOutro = edgeDistance < 0.11;
    const chorusLift = clamp((phraseEnergy - 0.42) / 0.58, 0, 1);
    const downbeat = isDownbeat(candidate.beatPosition ?? 0);
    const localRate = targetNotesPerSecond * (0.78 + fastSection * 0.3 + chorusLift * 0.42 - (isIntroOrOutro ? 0.16 : 0));
    const dynamicGap = Math.max(minNoteSpacing, 1 / localRate);
    const strongPeak = candidate.strength >= (downbeat ? 0.96 : 1.08);
    // A note budget refills at the difficulty's target rate. Averaging over time (instead of
    // a hard minimum gap) keeps each difficulty distinct even when onsets sit on a coarse grid.
    noteBudget = Math.min(burstCapacity, noteBudget + Math.max(0, candidate.time - budgetClock) * localRate);
    budgetClock = candidate.time;
    const onBeat = Number.isInteger(candidate.beatPosition ?? 0.5);
    // Pronounced accents are cheaper so genuinely busy passages read busier than calm ones.
    let noteCost = candidate.strength >= 1.6 ? 0.6 : downbeat || candidate.strength >= 1.32 ? 1 : onBeat ? 1.12 : 1.3;
    // Repeated sections favour the same rhythm the first occurrence was charted with.
    const phrase = repeats.locate(candidate);
    const rememberedLanes = phrase?.isRepeat ? phraseMemory.get(phrase.key) : undefined;
    if (phrase?.isRepeat) noteCost *= rememberedLanes ? 0.7 : repeats.referenceHas(phrase.key) ? 3 : 1.3;
    const gapSinceLast = candidate.time - lastNoteTime;
    if (noteBudget < noteCost || gapSinceLast < dynamicGap * (0.55 - complexity * 0.25)) continue;
    if (recentNoteTimes.length > staminaLimit
      && (candidate.strength < 1.48 || recentNoteTimes.length > staminaLimit * (1.08 + stamina * 0.22))) continue;

    const simultaneous: Note[] = [];
    for (let noteIndex = notes.length - 1; noteIndex >= 0; noteIndex--) {
      if (candidate.time - notes[noteIndex].time >= simultaneousWindow) break;
      simultaneous.push(notes[noteIndex]);
    }
    const maxAtMoment = estimatedBpm > 165 || fastSection > 0.58 ? 1 : 2;
    if (simultaneous.length >= maxAtMoment) continue;
    const occupiedLanes = new Set(simultaneous.map((note) => note.lane));
    const sameLaneCooldown = Math.max(minNoteSpacing * 1.25, gridInterval * 0.72);
    let availableLanes = [0, 1, 2, 3].filter((lane) =>
      !occupiedLanes.has(lane) &&
      laneOccupancy[lane] <= candidate.time &&
      candidate.time - laneLastTime[lane] >= (lane === lastLane ? sameLaneCooldown : minNoteSpacing * 0.62)
    );
    if (availableLanes.length === 0) {
      availableLanes = [0, 1, 2, 3].filter((lane) => !occupiedLanes.has(lane) && laneOccupancy[lane] <= candidate.time);
    }
    if (availableLanes.length === 0) continue;

    let lanes: number[];
    const pitchLane = (candidate.brightness ?? 0.5) * 3;
    const pickLane = () => chooseSingleLane(availableLanes, lastLane, laneVariety, tempoFactor, laneHistory, random, pitchLane, pitchWeight);
    // Jumps (two-lane chords) land on strong downbeats, more often in loud choruses on harder charts.
    const chordChance = clamp((0.025 + complexity * 0.12 + phraseEnergy * 0.04) * (1 - tempoFactor * 0.56) * (1 + chorusLift * complexity), 0.01, 0.22);
    if (rememberedLanes && rememberedLanes.every((lane) => availableLanes.includes(lane)) && random() < 0.9) {
      lanes = [...rememberedLanes];
      patternRemaining = 0;
    } else if (strongPeak && downbeat && availableLanes.length >= 2 && random() < chordChance && candidate.time - lastNoteTime > beatInterval * 0.62) {
      lanes = chooseChordLanes(availableLanes, random);
      patternRemaining = 0;
    } else if (patternRemaining > 0 && lastLane >= 0) {
      let desired: number;
      if (patternKind === 'trill') {
        desired = trillLanes[0] === lastLane ? trillLanes[1] : trillLanes[0];
      } else {
        if (lastLane <= 0) streamDirection = 1;
        if (lastLane >= 3) streamDirection = -1;
        desired = clamp(lastLane + streamDirection, 0, 3);
      }
      lanes = [availableLanes.includes(desired) ? desired : pickLane()];
      patternRemaining -= 1;
    } else {
      lanes = [pickLane()];
      const streamChance = clamp(0.1 + density * 0.24 + complexity * 0.16 + fastSection * 0.22, 0.08, 0.65);
      patternRemaining = random() < streamChance ? Math.min(maxConsecutive, 1 + Math.floor(density * 2 + fastSection * 2)) : 0;
      // Trills (alternating two lanes) suit fast, intense passages on harder charts.
      const trillChance = clamp((complexity - 0.5) * 1.2 * (0.4 + fastSection * 0.6) * (0.5 + chorusLift * 0.5), 0, 0.45);
      patternKind = patternRemaining > 0 && random() < trillChance ? 'trill' : 'stream';
      if (patternKind === 'trill') {
        const partner = lanes[0] <= 1 ? lanes[0] + 1 + (random() < 0.5 ? 1 : 0) : lanes[0] - 1 - (random() < 0.5 ? 1 : 0);
        trillLanes = [lanes[0], clamp(partner, 0, 3)];
        patternRemaining = Math.min(maxConsecutive + 2, patternRemaining + 2);
      }
      if (random() < 0.2 + laneVariety * 0.18) streamDirection *= -1;
    }

    const remainingSlots = Math.max(0, maxAtMoment - simultaneous.length);
    lanes = lanes.slice(0, remainingSlots);
    let created = false;
    for (const lane of lanes) {
      if (!availableLanes.includes(lane)) continue;
      const noActiveLongNote = longNoteEnd <= candidate.time;
      const sliderChance = sliderProbability
        * (0.28 + phraseEnergy * 0.46 + clamp((candidate.sustain ?? 1) - 0.65, 0, 0.42))
        * (1 - fastSection * 0.46)
        * (1 - tempoFactor * 0.22)
        * (isIntroOrOutro ? 0.42 : 1);
      const canSlide = lanes.length === 1 && strongPeak && noActiveLongNote
        && candidate.time - lastNoteTime > Math.max(0.24, beatInterval * 0.5)
        && candidate.time < audioBuffer.duration - beatInterval * 1.25
        && !isIntroOrOutro
        && (candidate.sustain ?? 0) > 0.68;
      let duration: number | undefined;
      let endLane: number | undefined;
      let tickInterval: number | undefined;

      if (canSlide && random() < sliderChance) {
        const beatChoices = complexity > 0.68 && fastSection < 0.5 ? [1, 1.5, 2, 3] : [1, 1, 1.5, 2];
        const durationBeats = beatChoices[Math.floor(random() * beatChoices.length)];
        duration = clamp(durationBeats * beatInterval, Math.max(0.3, beatInterval * 0.75), 2.4);
        duration = Math.min(duration, audioBuffer.duration - candidate.time - 0.12);
        tickInterval = clamp(beatInterval / (density > 0.72 ? 2 : 1), 0.14, 0.48);

        const moveChance = 0.18 + laneVariety * 0.62 + complexity * 0.08;
        if (allowMovingSliders && duration >= beatInterval * 0.95 && random() < moveChance) {
          const destinations = [0, 1, 2, 3].filter((target) => target !== lane && Math.abs(target - lane) <= 2);
          if (destinations.length > 0) endLane = destinations[Math.floor(random() * destinations.length)];
        }
      }

      const note: Note = {
        id: createNoteId(),
        time: candidate.time,
        lane,
        duration,
        endLane,
        tickInterval,
        hit: false,
        missed: false,
      };
      notes.push(note);
      laneLastTime[lane] = candidate.time;
      if (duration) {
        longNoteEnd = Math.max(longNoteEnd, candidate.time + duration);
        const destination = endLane ?? lane;
        for (let pathLane = Math.min(lane, destination); pathLane <= Math.max(lane, destination); pathLane++) {
          laneOccupancy[pathLane] = Math.max(laneOccupancy[pathLane], candidate.time + duration);
        }
      }
      lastLane = endLane ?? lane;
      laneHistory.push(lastLane);
      if (laneHistory.length > 10) laneHistory.shift();
      recentNoteTimes.push(candidate.time);
      created = true;
    }
    if (created) {
      lastNoteTime = candidate.time;
      noteBudget -= 1;
      if (phrase && !phrase.isRepeat) {
        phraseMemory.set(phrase.key, notes.filter((note) => note.time === candidate.time).map((note) => note.lane));
      }
    }
  }

  // Long stretches with sound but no rhythmic hits (pads, breakdowns, ambient intros)
  // become slow sustained holds so the player keeps playing along with the music.
  const breakdownGap = beatInterval * 6;
  const anchors = [0, ...notes.map((note) => note.time + (note.duration ?? 0)), audioBuffer.duration];
  const nextStarts = [...notes.map((note) => note.time), audioBuffer.duration];
  let fillLane = 1;
  for (let i = 0; i < nextStarts.length; i++) {
    const gapStart = Math.max(anchors[i], i === 0 ? 1.5 : anchors[i]);
    const gapEnd = nextStarts[i] - beatInterval;
    if (gapEnd - gapStart < breakdownGap) continue;
    for (let time = grid.snap(gapStart + beatInterval, 1).time; ; time = grid.snap(time + beatInterval * 4, 1).time) {
      const holdLength = beatInterval * 2;
      if (time + holdLength > gapEnd) break;
      const index = Math.floor(time / windowDuration);
      const energy = averageFromPrefix(rmsPrefix, index, index + holdLength / windowDuration);
      if (energy < globalRms * 0.3) continue;
      notes.push({
        id: createNoteId(),
        time,
        lane: fillLane,
        duration: holdLength,
        tickInterval: clamp(beatInterval, 0.14, 0.48),
        hit: false,
        missed: false,
      });
      fillLane = fillLane === 1 ? 2 : 1;
    }
  }

  const lastTimeInLane = [-Infinity, -Infinity, -Infinity, -Infinity];
  return notes
    .sort((a, b) => a.time - b.time || a.lane - b.lane)
    .filter((note) => {
      if (note.time - lastTimeInLane[note.lane] < 0.025) return false;
      lastTimeInLane[note.lane] = note.time;
      return true;
    });
}

export async function loadAudioFile(source: File | string, audioContext: AudioContext): Promise<AudioBuffer> {
  let arrayBuffer: ArrayBuffer;
  if (typeof source === 'string') {
    const response = await fetch(source);
    arrayBuffer = await response.arrayBuffer();
  } else {
    arrayBuffer = await source.arrayBuffer();
  }
  return await audioContext.decodeAudioData(arrayBuffer);
}
