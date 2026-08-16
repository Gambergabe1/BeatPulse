import type { Note } from '../types';

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

const mixToMono = (audioBuffer: AudioBuffer) => {
  const mono = new Float32Array(audioBuffer.length);
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let i = 0; i < channelData.length; i++) mono[i] += channelData[i] / channelCount;
  }
  return mono;
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

const chooseSingleLane = (
  availableLanes: number[],
  lastLane: number,
  laneVariety: number,
  tempoFactor: number,
  laneHistory: number[],
  random: () => number
) => {
  if (availableLanes.length <= 1) return availableLanes[0] ?? 0;
  if (lastLane < 0) return availableLanes[Math.floor(random() * availableLanes.length)];

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
      const distance = Math.abs(lane - lastLane);
      const direction = Math.sign(lane - lastLane);
      return Math.min(distance, 2) * (0.5 + laneVariety * 0.5 + tempoFactor * 0.15)
        - (lane === lastLane ? 1.2 + tempoFactor * 0.45 : 0)
        - recentWindow.filter((value) => value === lane).length * 0.2
        - (directionRun >= 2 && direction === recentDirection ? 0.9 + directionRun * 0.24 : 0)
        + (directionRun >= 2 && direction === -recentDirection ? 0.42 : 0)
        + (lane === previousLane ? 0.2 : 0)
        + (!recentWindow.includes(lane) ? laneVariety * 0.15 : 0)
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
  const tempo = estimateTempo(roughCandidates, onsetScores, windowDuration, onsetThreshold) ?? {
    bpm: fallbackBpm,
    confidence: 0.2,
    origin: roughCandidates[0].time,
  };
  const estimatedBpm = tempo.bpm;
  const beatInterval = 60 / estimatedBpm;
  const tempoFactor = clamp((estimatedBpm - 105) / 90, 0, 1);
  let subdivision = density > 0.76 || complexity > 0.82 ? 4 : density > 0.3 || complexity > 0.4 ? 2 : 1;
  while (subdivision > 1 && beatInterval / subdivision < minNoteSpacing * 1.08) subdivision /= 2;
  const gridInterval = beatInterval / subdivision;
  const snapTolerance = gridInterval * (0.28 + tempo.confidence * 0.18);
  const candidateRate = roughCandidates.length / Math.max(1, audioBuffer.duration);
  const phraseWindow = Math.max(1, Math.round((beatInterval * 4) / windowDuration));
  const candidateWindow = Math.max(0.75, beatInterval * 2);
  const quantizedByCell = new Map<number, OnsetCandidate>();

  roughCandidates.forEach((candidate, index) => {
    const gridPosition = (candidate.time - tempo.origin) / gridInterval;
    const cell = Math.round(gridPosition);
    const snapped = tempo.origin + cell * gridInterval;
    const time = Math.abs(snapped - candidate.time) <= snapTolerance || candidate.strength < 1.55 ? snapped : candidate.time;
    let left = index;
    let right = index;
    while (left > 0 && candidate.time - roughCandidates[left - 1].time <= candidateWindow) left -= 1;
    while (right + 1 < roughCandidates.length && roughCandidates[right + 1].time - candidate.time <= candidateWindow) right += 1;
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
      beatPosition: Math.round((time - tempo.origin) / beatInterval),
    };
    const existing = quantizedByCell.get(cell);
    const phraseAccent = enriched.beatPosition! % 4 === 0 ? 0.14 : 0;
    if (!existing || enriched.strength + phraseAccent > existing.strength + (existing.beatPosition! % 4 === 0 ? 0.14 : 0)) {
      quantizedByCell.set(cell, enriched);
    }
  });

  const candidates = [...quantizedByCell.values()].sort((a, b) => a.time - b.time);
  const notes: Note[] = [];
  const laneOccupancy = [0, 0, 0, 0];
  const laneLastTime = [-Infinity, -Infinity, -Infinity, -Infinity];
  const recentNoteTimes: number[] = [];
  const laneHistory: number[] = [];
  const simultaneousWindow = Math.max(0.035, gridInterval * 0.24);
  const targetNotesPerSecond = clamp((estimatedBpm / 60) * (0.48 + density * 0.78 + complexity * 0.16), 0.8, 7.2);
  const staminaLimit = targetNotesPerSecond * (1.05 + stamina * 0.55);
  let lastNoteTime = -Infinity;
  let lastLane = -1;
  let streamDirection = random() > 0.5 ? 1 : -1;
  let patternRemaining = 0;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    while (recentNoteTimes.length > 0 && candidate.time - recentNoteTimes[0] > 1) recentNoteTimes.shift();
    const paceRatio = (candidate.localPace ?? candidateRate) / Math.max(0.2, candidateRate);
    const fastSection = clamp((paceRatio - 0.72) / 1.15, 0, 1);
    const phraseEnergy = clamp(((candidate.sectionEnergy ?? 1) - 0.55) / 1.1, 0, 1);
    const downbeat = ((candidate.beatPosition ?? 0) % 4 + 4) % 4 === 0;
    const dynamicGap = Math.max(
      minNoteSpacing,
      1 / (targetNotesPerSecond * (0.82 + fastSection * 0.27 + phraseEnergy * 0.14))
    );
    const strongPeak = candidate.strength >= (downbeat ? 0.96 : 1.08);
    if (candidate.time - lastNoteTime < dynamicGap && candidate.strength < 1.32 + fastSection * 0.16) continue;
    if (recentNoteTimes.length > staminaLimit && candidate.strength < 1.48) continue;

    const simultaneous = notes.filter((note) => Math.abs(note.time - candidate.time) < simultaneousWindow);
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
    const chordChance = clamp((0.025 + complexity * 0.12 + phraseEnergy * 0.04) * (1 - tempoFactor * 0.56), 0.01, 0.17);
    if (strongPeak && downbeat && availableLanes.length >= 2 && random() < chordChance && candidate.time - lastNoteTime > beatInterval * 0.62) {
      lanes = chooseChordLanes(availableLanes, random);
      patternRemaining = 0;
    } else if (patternRemaining > 0 && lastLane >= 0) {
      if (lastLane <= 0) streamDirection = 1;
      if (lastLane >= 3) streamDirection = -1;
      const desired = clamp(lastLane + streamDirection, 0, 3);
      lanes = [availableLanes.includes(desired)
        ? desired
        : chooseSingleLane(availableLanes, lastLane, laneVariety, tempoFactor, laneHistory, random)];
      patternRemaining -= 1;
    } else {
      lanes = [chooseSingleLane(availableLanes, lastLane, laneVariety, tempoFactor, laneHistory, random)];
      const streamChance = clamp(0.1 + density * 0.24 + complexity * 0.16 + fastSection * 0.22, 0.08, 0.65);
      patternRemaining = random() < streamChance ? Math.min(maxConsecutive, 1 + Math.floor(density * 2 + fastSection * 2)) : 0;
      if (random() < 0.2 + laneVariety * 0.18) streamDirection *= -1;
    }

    const remainingSlots = Math.max(0, maxAtMoment - simultaneous.length);
    lanes = lanes.slice(0, remainingSlots);
    let created = false;
    for (const lane of lanes) {
      if (!availableLanes.includes(lane)) continue;
      const noActiveLongNote = !notes.some((note) => note.duration && note.time + note.duration > candidate.time);
      const sliderChance = sliderProbability
        * (0.35 + phraseEnergy * 0.4 + clamp((candidate.sustain ?? 1) - 0.65, 0, 0.35))
        * (1 - fastSection * 0.46)
        * (1 - tempoFactor * 0.22);
      const canSlide = lanes.length === 1 && strongPeak && noActiveLongNote
        && candidate.time - lastNoteTime > Math.max(0.24, beatInterval * 0.5)
        && candidate.time < audioBuffer.duration - beatInterval * 1.25
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
    if (created) lastNoteTime = candidate.time;
  }

  return notes
    .sort((a, b) => a.time - b.time || a.lane - b.lane)
    .filter((note, index, sorted) => !sorted.slice(0, index).some((previous) =>
      previous.lane === note.lane && Math.abs(previous.time - note.time) < 0.025
    ));
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
