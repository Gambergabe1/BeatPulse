export interface NoteGenerationConfig {
  complexity?: number;
  density?: number;
  laneVariety?: number;
  maxConsecutive?: number;
  minNoteSpacing?: number; // Minimum time between notes (seconds)
  sliderProbability?: number; // 0-1 (Hold note frequency)
  stamina?: number; // 0-1 (Higher means more notes allowed in bursts)
}

interface AudioWindowFeature {
  time: number;
  rms: number;
  transient: number;
  zeroCrossings: number;
  peak: number;
}

interface OnsetCandidate {
  time: number;
  score: number;
  rms: number;
  transient: number;
  peak: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildPrefixSum = (values: number[]) => {
  const prefix = new Array(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i++) {
    prefix[i + 1] = prefix[i] + values[i];
  }
  return prefix;
};

const averageFromPrefix = (prefix: number[], start: number, end: number) => {
  const safeStart = clamp(Math.floor(start), 0, prefix.length - 1);
  const safeEnd = clamp(Math.ceil(end), safeStart + 1, prefix.length - 1);
  return (prefix[safeEnd] - prefix[safeStart]) / Math.max(1, safeEnd - safeStart);
};

const normalizeEstimatedBpm = (bpm: number) => {
  let normalized = bpm;
  while (normalized < 70) normalized *= 2;
  while (normalized > 200) normalized /= 2;
  return normalized;
};

const createNoteId = () => Math.random().toString(36).slice(2, 11);

const mixToMono = (audioBuffer: AudioBuffer) => {
  const mono = new Float32Array(audioBuffer.length);
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let i = 0; i < channelData.length; i++) {
      mono[i] += channelData[i] / channelCount;
    }
  }

  return mono;
};

const analyzeAudioWindows = (monoData: Float32Array, sampleRate: number, windowSize: number) => {
  const features: AudioWindowFeature[] = [];
  let previousSample = 0;

  for (let i = 0; i < monoData.length; i += windowSize) {
    let energy = 0;
    let transient = 0;
    let peak = 0;
    let zeroCrossings = 0;
    let localPrevious = previousSample;
    let sampleCount = 0;

    for (let j = 0; j < windowSize && i + j < monoData.length; j++) {
      const sample = monoData[i + j];
      energy += sample * sample;
      transient += Math.abs(sample - localPrevious);
      if ((sample >= 0) !== (localPrevious >= 0)) zeroCrossings += 1;
      peak = Math.max(peak, Math.abs(sample));
      localPrevious = sample;
      sampleCount += 1;
    }

    previousSample = localPrevious;

    features.push({
      time: i / sampleRate,
      rms: Math.sqrt(energy / Math.max(1, sampleCount)),
      transient: transient / Math.max(1, sampleCount),
      zeroCrossings: zeroCrossings / Math.max(1, sampleCount),
      peak,
    });
  }

  return features;
};

const estimateTempoFromCandidates = (candidates: OnsetCandidate[]) => {
  if (candidates.length < 4) return null;

  const histogram = new Map<number, number>();
  for (let i = 1; i < candidates.length; i++) {
    for (let j = Math.max(0, i - 8); j < i; j++) {
      const interval = candidates[i].time - candidates[j].time;
      if (interval < 0.12 || interval > 1.0) continue;

      const bpm = normalizeEstimatedBpm(60 / interval);
      const bucket = Math.round(bpm);
      const spacingWeight = 1 - Math.min(0.45, (i - j - 1) * 0.07);
      const weight = (candidates[i].score + candidates[j].score) * spacingWeight;
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + weight);
    }
  }

  if (histogram.size === 0) return null;

  const [bestBucket] = [...histogram.entries()].sort((a, b) => b[1] - a[1])[0];
  let weightedSum = 0;
  let weightTotal = 0;

  histogram.forEach((weight, bucket) => {
    if (Math.abs(bucket - bestBucket) <= 2) {
      weightedSum += bucket * weight;
      weightTotal += weight;
    }
  });

  return weightTotal > 0 ? weightedSum / weightTotal : bestBucket;
};

const chooseSingleLane = (
  availableLanes: number[],
  lastLane: number,
  laneVariety: number,
  tempoFactor: number
) => {
  if (availableLanes.length <= 1) return availableLanes[0] ?? 0;
  if (lastLane < 0) return availableLanes[Math.floor(Math.random() * availableLanes.length)];

  let bestLane = availableLanes[0];
  let bestScore = -Infinity;

  availableLanes.forEach((lane) => {
    const distance = Math.abs(lane - lastLane);
    const movementScore = distance * (0.6 + laneVariety * 0.8 + tempoFactor * 0.5);
    const repeatPenalty = lane === lastLane ? 1.15 + tempoFactor * 0.55 : 0;
    const centerBias = (lane === 1 || lane === 2) ? (1 - laneVariety) * 0.18 : 0;
    const edgeBias = (lane === 0 || lane === 3) ? laneVariety * 0.16 : 0;
    const randomBias = Math.random() * (0.25 + laneVariety * 0.2);
    const laneScore = movementScore + centerBias + edgeBias + randomBias - repeatPenalty;

    if (laneScore > bestScore) {
      bestScore = laneScore;
      bestLane = lane;
    }
  });

  return bestLane;
};

const chooseChordLanes = (availableLanes: number[]) => {
  if (availableLanes.length < 2) return availableLanes.slice(0, 1);

  let bestPair: [number, number] = [availableLanes[0], availableLanes[1]];
  let bestScore = -Infinity;

  for (let i = 0; i < availableLanes.length; i++) {
    for (let j = i + 1; j < availableLanes.length; j++) {
      const left = availableLanes[i];
      const right = availableLanes[j];
      const span = Math.abs(right - left);
      const centerPenalty = Math.abs((left + right) / 2 - 1.5) * 0.08;
      const score = span + Math.random() * 0.15 - centerPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestPair = [left, right];
      }
    }
  }

  return bestPair;
};

/**
 * Detects beats in an AudioBuffer to generate a more tempo-aware note map.
 * Faster songs now use transient-heavy onset detection, adaptive spacing,
 * and lane patterns that better preserve readability in dense sections.
 */
export async function generateNotesFromAudio(
  audioBuffer: AudioBuffer,
  config: number | NoteGenerationConfig = 0.5
): Promise<any[]> {
  const complexity = typeof config === 'number' ? config : (config.complexity ?? 0.5);
  const density = typeof config === 'object' ? (config.density ?? complexity) : complexity;
  const laneVariety = typeof config === 'object' ? (config.laneVariety ?? complexity) : complexity;
  const maxConsecutive = typeof config === 'object'
    ? (config.maxConsecutive ?? Math.floor(3 + complexity * 5))
    : Math.floor(3 + complexity * 5);
  const minNoteSpacing = typeof config === 'object' ? (config.minNoteSpacing ?? 0.08) : 0.08;
  const sliderProbability = typeof config === 'object' ? (config.sliderProbability ?? 0.3) : 0.3;
  const stamina = typeof config === 'object' ? (config.stamina ?? 0.5) : 0.5;

  const monoData = mixToMono(audioBuffer);
  const sampleRate = audioBuffer.sampleRate;
  const windowDuration = 0.008;
  const windowSize = Math.max(128, Math.floor(sampleRate * windowDuration));
  const features = analyzeAudioWindows(monoData, sampleRate, windowSize);

  if (features.length === 0) {
    return [];
  }

  const rmsValues = features.map((feature) => feature.rms);
  const transientValues = features.map((feature) => feature.transient);
  const peakValues = features.map((feature) => feature.peak);
  const zeroCrossValues = features.map((feature) => feature.zeroCrossings);

  const rmsPrefix = buildPrefixSum(rmsValues);
  const transientPrefix = buildPrefixSum(transientValues);
  const peakPrefix = buildPrefixSum(peakValues);
  const zeroCrossPrefix = buildPrefixSum(zeroCrossValues);

  const localWindow = Math.max(10, Math.floor((0.18 - density * 0.05) / windowDuration));
  const onsetScores = new Array(features.length).fill(0);

  for (let i = localWindow; i < features.length - localWindow; i++) {
    const localRms = averageFromPrefix(rmsPrefix, i - localWindow, i + localWindow + 1);
    const localTransient = averageFromPrefix(transientPrefix, i - localWindow, i + localWindow + 1);
    const localPeak = averageFromPrefix(peakPrefix, i - localWindow, i + localWindow + 1);
    const localZeroCross = averageFromPrefix(zeroCrossPrefix, i - localWindow, i + localWindow + 1);

    const energyRatio = features[i].rms / Math.max(0.0001, localRms);
    const transientRatio = features[i].transient / Math.max(0.0001, localTransient);
    const peakRatio = features[i].peak / Math.max(0.0001, localPeak);
    const zeroCrossRatio = features[i].zeroCrossings / Math.max(0.0001, localZeroCross);

    onsetScores[i] =
      transientRatio * 1.05 +
      energyRatio * 0.7 +
      peakRatio * 0.45 +
      Math.max(0, zeroCrossRatio - 1) * 0.18;
  }

  const globalAvgRms = rmsValues.reduce((sum, value) => sum + value, 0) / Math.max(1, rmsValues.length);
  const globalAvgTransient = transientValues.reduce((sum, value) => sum + value, 0) / Math.max(1, transientValues.length);
  const roughThreshold = 2.05 - density * 0.3 - complexity * 0.15;
  const roughCandidates: OnsetCandidate[] = [];

  let lastCandidateTime = -Infinity;
  for (let i = localWindow + 1; i < features.length - localWindow - 1; i++) {
    const score = onsetScores[i];
    const current = features[i];
    const isPeak = score > roughThreshold && score >= onsetScores[i - 1] && score > onsetScores[i + 1];
    const strongEnough =
      current.rms > globalAvgRms * (0.28 + density * 0.18) ||
      current.transient > globalAvgTransient * (0.45 + density * 0.25);

    if (!isPeak || !strongEnough) continue;
    if (current.time - lastCandidateTime < Math.max(0.055, minNoteSpacing * 0.65)) continue;

    roughCandidates.push({
      time: current.time,
      score,
      rms: current.rms,
      transient: current.transient,
      peak: current.peak,
    });
    lastCandidateTime = current.time;
  }

  if (roughCandidates.length === 0) {
    return [];
  }

  const estimatedBpm = estimateTempoFromCandidates(roughCandidates) ?? clamp(92 + density * 70 + complexity * 22, 92, 185);
  const tempoFactor = clamp((estimatedBpm - 120) / 70, 0, 1);
  const beatInterval = 60 / estimatedBpm;
  const subdivision =
    estimatedBpm >= 170 || density > 0.82
      ? 4
      : estimatedBpm >= 132 || density > 0.58
      ? 2
      : 1;
  const gridInterval = Math.max(minNoteSpacing, beatInterval / subdivision);
  const gridOrigin = roughCandidates[0]?.time ?? 0;
  const sameLaneCooldown = Math.max(minNoteSpacing * 1.35, gridInterval * 0.95);
  const recentPeakWindow = Math.max(0.55, beatInterval * 2);
  const recentNoteWindow = 1.0;
  const simultaneousWindow = Math.max(0.045, gridInterval * 0.3);
  const staminaThreshold = 3 + stamina * 10 + tempoFactor * 4 + density * 2;

  const notes: any[] = [];
  const laneOccupancy = [0, 0, 0, 0];
  const laneLastTime = [-Infinity, -Infinity, -Infinity, -Infinity];
  const recentNoteTimes: number[] = [];

  let lastNoteTime = -Infinity;
  let lastLane = -1;
  let streamDirection = Math.random() > 0.5 ? 1 : -1;
  let currentPattern: 'stream' | 'jump' | 'chord' | 'none' = 'none';
  let patternRemaining = 0;
  let recentPeakStartIndex = 0;

  for (let index = 0; index < roughCandidates.length; index++) {
    const candidate = roughCandidates[index];

    while (
      recentPeakStartIndex < index &&
      candidate.time - roughCandidates[recentPeakStartIndex].time > recentPeakWindow
    ) {
      recentPeakStartIndex += 1;
    }

    while (recentNoteTimes.length > 0 && candidate.time - recentNoteTimes[0] > recentNoteWindow) {
      recentNoteTimes.shift();
    }

    const recentActivityRate = (index - recentPeakStartIndex + 1) / recentPeakWindow;
    const fastSectionFactor = clamp((recentActivityRate - 3.5) / 7, 0, 1);
    const dynamicMinGap = Math.max(
      minNoteSpacing,
      (0.19 - density * 0.05 - complexity * 0.03) * (1 - tempoFactor * 0.35 - fastSectionFactor * 0.2)
    );

    const snappedTime = gridOrigin + Math.round((candidate.time - gridOrigin) / gridInterval) * gridInterval;
    const currentTime = Math.abs(snappedTime - candidate.time) <= gridInterval * 0.4 ? snappedTime : candidate.time;
    if (currentTime - lastNoteTime < dynamicMinGap && candidate.score < roughThreshold + 0.35) {
      continue;
    }

    const currentStaminaRate = recentNoteTimes.length / recentNoteWindow;
    if (currentStaminaRate > staminaThreshold && candidate.score < roughThreshold + 0.55) {
      continue;
    }

    const simultaneousNotes = notes.filter((note) => Math.abs(note.time - currentTime) < simultaneousWindow);
    const simultaneousLanes = new Set<number>(simultaneousNotes.map((note) => note.lane));
    const maxNotesAtMoment = fastSectionFactor > 0.38 || tempoFactor > 0.58 ? 1 : 2;
    if (simultaneousNotes.length >= maxNotesAtMoment) {
      continue;
    }

    const laneGapCooldown = Math.max(minNoteSpacing * 0.7, gridInterval * 0.55);
    let availableLanes = [0, 1, 2, 3].filter((lane) =>
      !simultaneousLanes.has(lane) &&
      laneOccupancy[lane] <= currentTime &&
      currentTime - laneLastTime[lane] >= (lane === lastLane ? sameLaneCooldown : laneGapCooldown)
    );

    if (availableLanes.length === 0) {
      availableLanes = [0, 1, 2, 3].filter((lane) =>
        !simultaneousLanes.has(lane) &&
        laneOccupancy[lane] <= currentTime
      );
    }
    if (availableLanes.length === 0) {
      continue;
    }

    const strongPeak = candidate.score >= roughThreshold + 0.55;
    const streamChance = clamp(
      0.12 + density * 0.2 + complexity * 0.12 + tempoFactor * 0.2 + fastSectionFactor * 0.22,
      0.1,
      0.78
    );
    const jumpChance = clamp(0.06 + laneVariety * 0.18 + complexity * 0.08, 0.05, 0.42);
    const chordChance = clamp(
      (0.05 + complexity * 0.1) * (1 - tempoFactor * 0.55) * (1 - fastSectionFactor * 0.35),
      0.02,
      0.22
    );

    let lanesToCreate: number[] = [];

    if (patternRemaining > 0) {
      if (currentPattern === 'stream') {
        if (lastLane <= 0) streamDirection = 1;
        if (lastLane >= 3) streamDirection = -1;

        let desiredLane = lastLane + streamDirection;
        if (desiredLane < 0 || desiredLane > 3) {
          streamDirection *= -1;
          desiredLane = clamp(lastLane + streamDirection, 0, 3);
        }

        if (!availableLanes.includes(desiredLane)) {
          const alternatives = [...availableLanes].sort(
            (a, b) => Math.abs(a - desiredLane) - Math.abs(b - desiredLane)
          );
          desiredLane = alternatives[0] ?? chooseSingleLane(availableLanes, lastLane, laneVariety, tempoFactor);
        }

        lanesToCreate = [desiredLane];
      } else if (currentPattern === 'jump') {
        const jumpLane = [...availableLanes].sort(
          (a, b) => Math.abs(b - lastLane) - Math.abs(a - lastLane)
        )[0] ?? chooseSingleLane(availableLanes, lastLane, laneVariety, tempoFactor);
        lanesToCreate = [jumpLane];
      }

      patternRemaining -= 1;
    }

    if (lanesToCreate.length === 0) {
      const randomRoll = Math.random();

      if (strongPeak && randomRoll < chordChance && availableLanes.length >= 2 && currentTime - lastNoteTime > beatInterval * 0.75) {
        currentPattern = 'none';
        lanesToCreate = chooseChordLanes(availableLanes);
      } else if (
        randomRoll < streamChance &&
        (strongPeak || currentTime - lastNoteTime <= beatInterval * 0.85)
      ) {
        currentPattern = 'stream';
        patternRemaining = Math.min(maxConsecutive, 2 + Math.floor(1 + density * 3 + tempoFactor * 2));

        if (lastLane < 0) {
          lanesToCreate = [chooseSingleLane(availableLanes, lastLane, laneVariety, tempoFactor)];
        } else {
          if (lastLane <= 0) streamDirection = 1;
          if (lastLane >= 3) streamDirection = -1;
          if (Math.random() < 0.08 + laneVariety * 0.2) {
            streamDirection *= -1;
          }

          const desiredLane = clamp(lastLane + streamDirection, 0, 3);
          lanesToCreate = [availableLanes.includes(desiredLane)
            ? desiredLane
            : chooseSingleLane(availableLanes, lastLane, laneVariety, tempoFactor)];
        }
      } else if (strongPeak && randomRoll < streamChance + jumpChance && currentTime - lastNoteTime > beatInterval * 0.65) {
        currentPattern = 'jump';
        patternRemaining = 1 + Math.floor(laneVariety * 2);
        lanesToCreate = [[...availableLanes].sort(
          (a, b) => Math.abs(b - lastLane) - Math.abs(a - lastLane)
        )[0] ?? chooseSingleLane(availableLanes, lastLane, laneVariety, tempoFactor)];
      } else {
        currentPattern = 'none';
        patternRemaining = 0;
        lanesToCreate = [chooseSingleLane(availableLanes, lastLane, laneVariety, tempoFactor)];
      }
    }

    const remainingSlots = Math.max(0, maxNotesAtMoment - simultaneousNotes.length);
    if (remainingSlots === 0) {
      continue;
    }
    if (lanesToCreate.length > remainingSlots) {
      lanesToCreate = lanesToCreate.slice(0, remainingSlots);
    }

    let noteCreated = false;
    for (const lane of lanesToCreate) {
      if (!availableLanes.includes(lane)) continue;

      const sliderChance = sliderProbability * (1 - tempoFactor * 0.7) * (1 - fastSectionFactor * 0.55);
      const canHaveSlider =
        currentPattern === 'none' &&
        strongPeak &&
        currentTime - lastNoteTime > Math.max(0.32, beatInterval * 0.9) &&
        currentStaminaRate < staminaThreshold * 0.72 &&
        !notes.some((note) => note.duration && note.time + note.duration > currentTime);

      let duration = 0;
      if (canHaveSlider && Math.random() < sliderChance) {
        duration = clamp(
          (0.35 + Math.random() * 0.65) * (0.7 + complexity * 0.5) * (1 - tempoFactor * 0.35),
          0.28,
          1.25
        );
      }

      notes.push({
        id: createNoteId(),
        time: currentTime,
        lane,
        duration: duration > 0 ? duration : undefined,
        hit: false,
        missed: false,
      });

      laneLastTime[lane] = currentTime;
      if (duration > 0) {
        laneOccupancy[lane] = currentTime + duration;
      }
      lastLane = lane;
      noteCreated = true;
      recentNoteTimes.push(currentTime);
    }

    if (noteCreated) {
      lastNoteTime = currentTime;
    }
  }

  const sortedNotes = notes.sort((a, b) => a.time - b.time);
  const dedupedNotes: any[] = [];

  for (const note of sortedNotes) {
    const previous = dedupedNotes[dedupedNotes.length - 1];
    if (
      previous &&
      previous.lane === note.lane &&
      Math.abs(previous.time - note.time) < 0.03
    ) {
      continue;
    }

    const notesAtSameMoment = dedupedNotes.filter((existingNote) => Math.abs(existingNote.time - note.time) < simultaneousWindow);
    const allowedAtMoment = note.duration ? 1 : 2;
    if (notesAtSameMoment.length >= allowedAtMoment) {
      continue;
    }

    dedupedNotes.push(note);
  }

  return dedupedNotes;
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
