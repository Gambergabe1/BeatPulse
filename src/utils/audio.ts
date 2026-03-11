export interface NoteGenerationConfig {
  complexity?: number;
  density?: number;
  laneVariety?: number;
  maxConsecutive?: number;
  minNoteSpacing?: number;
  sliderProbability?: number;
  stamina?: number;
}

interface AnalysisFrame {
  time: number;
  low: number;
  mid: number;
  high: number;
  total: number;
  centroid: number;
  toneChange: number;
  onset: number;
  lowRatio: number;
  midRatio: number;
  highRatio: number;
  totalRatio: number;
  onsetRatio: number;
  toneRatio: number;
  combinedScore: number;
  dominantBand: "low" | "mid" | "high";
}

interface LaneStrainState {
  strain: number;
  updatedAt: number;
  lastNoteTime: number;
}

interface HandStrainState {
  strain: number;
  updatedAt: number;
  lastNoteTime: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createNoteId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 11);
}

function getHandForLane(lane: number): 0 | 1 {
  return lane <= 1 ? 0 : 1;
}

function decayStrain(strain: number, deltaTime: number, decayRate: number): number {
  if (deltaTime <= 0) return strain;
  return strain * Math.exp(-deltaTime * decayRate);
}

function getLaneStrainAt(state: LaneStrainState, time: number): number {
  return decayStrain(state.strain, time - state.updatedAt, 3.1);
}

function getHandStrainAt(state: HandStrainState, time: number): number {
  return decayStrain(state.strain, time - state.updatedAt, 1.65);
}

function applyStrainToLane(
  laneStates: LaneStrainState[],
  handStates: HandStrainState[],
  lane: number,
  time: number,
  stamina: number,
  isChord: boolean,
  hasSlider: boolean
) {
  const laneState = laneStates[lane];
  const hand = getHandForLane(lane);
  const handState = handStates[hand];
  const laneStrain = getLaneStrainAt(laneState, time);
  const handStrain = getHandStrainAt(handState, time);
  const laneInterval =
    Number.isFinite(laneState.lastNoteTime) && laneState.lastNoteTime > 0
      ? time - laneState.lastNoteTime
      : 1;
  const handInterval =
    Number.isFinite(handState.lastNoteTime) && handState.lastNoteTime > 0
      ? time - handState.lastNoteTime
      : 1;

  const repeatFactor = laneInterval < 0.18 ? 1.18 + ((0.18 - laneInterval) * 5.4) : 1;
  const handSpeedFactor = 1 + clamp((0.22 - handInterval) * 4.6, 0, 1.8);
  const laneSpeedFactor = 1 + clamp((0.2 - laneInterval) * 4.8, 0, 1.9);
  const staminaRelief = 1 - (stamina * 0.22);
  const chordFactor = isChord ? 0.76 : 1;
  const sliderFactor = hasSlider ? 0.82 : 1;

  laneState.strain = laneStrain + (0.44 * laneSpeedFactor * repeatFactor * sliderFactor * staminaRelief);
  laneState.updatedAt = time;
  laneState.lastNoteTime = time;

  handState.strain = handStrain + (0.58 * handSpeedFactor * Math.max(1, repeatFactor * 0.85) * chordFactor * staminaRelief);
  handState.updatedAt = time;
  handState.lastNoteTime = time;
}

async function renderFilteredChannel(
  audioBuffer: AudioBuffer,
  type: BiquadFilterType,
  frequency: number,
  q = 0.9
): Promise<Float32Array> {
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  const filter = offlineCtx.createBiquadFilter();

  source.buffer = audioBuffer;
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;

  source.connect(filter);
  filter.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

function computeRmsFrames(data: Float32Array, frameSize: number, hopSize: number): number[] {
  const frames: number[] = [];

  for (let start = 0; start < data.length; start += hopSize) {
    let energy = 0;
    let samples = 0;

    for (let i = 0; i < frameSize && start + i < data.length; i++) {
      const sample = data[start + i];
      energy += sample * sample;
      samples++;
    }

    if (samples === 0) break;
    frames.push(Math.sqrt(energy / samples));
  }

  return frames;
}

function getLocalAverage(values: number[], index: number, radius: number): number {
  let total = 0;
  let count = 0;

  for (let i = Math.max(0, index - radius); i <= Math.min(values.length - 1, index + radius); i++) {
    total += values[i];
    count++;
  }

  return count > 0 ? total / count : 0;
}

function estimateSliderDuration(
  frames: AnalysisFrame[],
  index: number,
  hopTime: number,
  sliderProbability: number
): number | undefined {
  const frame = frames[index];
  const bandEnergy =
    frame.dominantBand === "low" ? frame.low :
    frame.dominantBand === "mid" ? frame.mid :
    frame.high;

  const sustainFloor = bandEnergy * (0.72 - sliderProbability * 0.12);
  const limit = Math.min(frames.length, index + 42);
  let sustainedFrames = 0;
  let misses = 0;

  for (let i = index + 1; i < limit; i++) {
    const next = frames[i];
    const nextBandEnergy =
      frame.dominantBand === "low" ? next.low :
      frame.dominantBand === "mid" ? next.mid :
      next.high;

    if (nextBandEnergy >= sustainFloor || next.totalRatio > 1.08) {
      sustainedFrames++;
      misses = 0;
      continue;
    }

    misses++;
    if (misses > 1) break;
  }

  const duration = sustainedFrames * hopTime;
  return duration >= 0.22 ? clamp(duration, 0.22, 1.55) : undefined;
}

function chooseLane(
  availableLanes: number[],
  frame: AnalysisFrame,
  lastLane: number,
  laneVariety: number,
  consecutiveOnLane: number,
  maxConsecutive: number,
  laneStates: LaneStrainState[],
  handStates: HandStrainState[],
  currentTime: number,
  stamina: number
): number {
  const centroidLane = clamp(Math.round(frame.centroid * 3), 0, 3);
  const bandAnchor =
    frame.dominantBand === "low" ? 0.6 :
    frame.dominantBand === "mid" ? 1.5 :
    2.4;
  const tonalLane = clamp(Math.round((centroidLane * 0.65) + (bandAnchor * 0.35)), 0, 3);
  const toneDirection = lastLane === -1 ? 0 : centroidLane - lastLane;

  let bestLane = availableLanes[0];
  let bestScore = -Infinity;

  for (const lane of availableLanes) {
    const laneStrain = getLaneStrainAt(laneStates[lane], currentTime);
    const handStrain = getHandStrainAt(handStates[getHandForLane(lane)], currentTime);
    let score = 0;
    score += 1.6 - Math.abs(lane - tonalLane) * (1.05 - laneVariety * 0.35);
    score += 0.5 - Math.abs(lane - centroidLane) * 0.25;
    score -= laneStrain * (1.45 - stamina * 0.9);
    score -= handStrain * (1.2 - stamina * 0.65);

    if (lastLane !== -1) {
      const distance = Math.abs(lane - lastLane);
      score += laneVariety >= 0.55 ? distance * 0.35 : -distance * 0.45;

      if (toneDirection > 0.15 && lane > lastLane) score += 0.35;
      if (toneDirection < -0.15 && lane < lastLane) score += 0.35;
      if (consecutiveOnLane >= maxConsecutive && lane === lastLane) score -= 5;
    }

    const laneInterval =
      Number.isFinite(laneStates[lane].lastNoteTime) && laneStates[lane].lastNoteTime > 0
        ? currentTime - laneStates[lane].lastNoteTime
        : 1;
    const handInterval =
      Number.isFinite(handStates[getHandForLane(lane)].lastNoteTime) && handStates[getHandForLane(lane)].lastNoteTime > 0
        ? currentTime - handStates[getHandForLane(lane)].lastNoteTime
        : 1;

    if (laneInterval < 0.16) {
      score -= (0.16 - laneInterval) * (9.5 - stamina * 3.2);
    }
    if (handInterval < 0.12) {
      score -= (0.12 - handInterval) * (7.8 - stamina * 2.8);
    }

    score += (Math.random() - 0.5) * (0.08 + laneVariety * 0.22);

    if (score > bestScore) {
      bestScore = score;
      bestLane = lane;
    }
  }

  return bestLane;
}

function buildAnalysisFrames(
  lowFrames: number[],
  midFrames: number[],
  highFrames: number[],
  hopTime: number
): AnalysisFrame[] {
  const frameCount = Math.min(lowFrames.length, midFrames.length, highFrames.length);
  const rawTotal: number[] = [];
  const rawOnset: number[] = [];
  const rawTone: number[] = [];
  const centroids: number[] = [];

  for (let i = 0; i < frameCount; i++) {
    const low = lowFrames[i];
    const mid = midFrames[i];
    const high = highFrames[i];
    const total = (low * 1.15) + (mid * 1.0) + (high * 0.82);
    rawTotal.push(total);

    const prevLow = i > 0 ? lowFrames[i - 1] : low;
    const prevMid = i > 0 ? midFrames[i - 1] : mid;
    const prevHigh = i > 0 ? highFrames[i - 1] : high;

    rawOnset.push(
      Math.max(0, low - prevLow) * 1.2 +
      Math.max(0, mid - prevMid) * 1.05 +
      Math.max(0, high - prevHigh) * 0.85
    );

    const sum = low + mid + high || 0.0001;
    const centroid = ((low * 0.14) + (mid * 0.5) + (high * 0.86)) / sum;
    centroids.push(centroid);
    rawTone.push(i > 0 ? Math.abs(centroid - centroids[i - 1]) : 0);
  }

  const frames: AnalysisFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const low = lowFrames[i];
    const mid = midFrames[i];
    const high = highFrames[i];
    const total = rawTotal[i];
    const lowAvg = getLocalAverage(lowFrames, i, 12) || 0.0001;
    const midAvg = getLocalAverage(midFrames, i, 12) || 0.0001;
    const highAvg = getLocalAverage(highFrames, i, 12) || 0.0001;
    const totalAvg = getLocalAverage(rawTotal, i, 14) || 0.0001;
    const onsetAvg = getLocalAverage(rawOnset, i, 10) || 0.0001;
    const toneAvg = getLocalAverage(rawTone, i, 10) || 0.0001;
    const lowRatio = low / lowAvg;
    const midRatio = mid / midAvg;
    const highRatio = high / highAvg;
    const totalRatio = total / totalAvg;
    const onsetRatio = rawOnset[i] / onsetAvg;
    const toneRatio = rawTone[i] / toneAvg;
    const dominantBand =
      low >= mid && low >= high ? "low" :
      mid >= high ? "mid" :
      "high";

    frames.push({
      time: i * hopTime,
      low,
      mid,
      high,
      total,
      centroid: centroids[i],
      toneChange: rawTone[i],
      onset: rawOnset[i],
      lowRatio,
      midRatio,
      highRatio,
      totalRatio,
      onsetRatio,
      toneRatio,
      combinedScore: 0,
      dominantBand,
    });
  }

  return frames;
}

/**
 * Generates a note map by combining beat onsets with multi-band tonal movement.
 * Bass transients drive the pulse while mid/high spectral changes steer lane movement.
 */
export async function generateNotesFromAudio(
  audioBuffer: AudioBuffer,
  config: number | NoteGenerationConfig = 0.5
): Promise<any[]> {
  const complexity = typeof config === "number" ? config : (config.complexity ?? 0.5);
  const density = typeof config === "object" ? (config.density ?? complexity) : complexity;
  const laneVariety = typeof config === "object" ? (config.laneVariety ?? complexity) : complexity;
  const maxConsecutive = typeof config === "object" ? (config.maxConsecutive ?? Math.floor(2 + complexity * 3)) : Math.floor(2 + complexity * 3);
  const minNoteSpacing = typeof config === "object" ? (config.minNoteSpacing ?? 0.08) : 0.08;
  const sliderProbability = typeof config === "object" ? (config.sliderProbability ?? 0.3) : 0.3;
  const stamina = typeof config === "object" ? (config.stamina ?? 0.5) : 0.5;

  const [lowBand, midBand, highBand] = await Promise.all([
    renderFilteredChannel(audioBuffer, "lowpass", 180, 0.75),
    renderFilteredChannel(audioBuffer, "bandpass", 980, 0.9),
    renderFilteredChannel(audioBuffer, "highpass", 2400, 0.7),
  ]);

  const sampleRate = audioBuffer.sampleRate;
  const frameSize = Math.max(256, Math.floor(sampleRate * 0.03));
  const hopSize = Math.max(128, Math.floor(sampleRate * 0.018));
  const hopTime = hopSize / sampleRate;

  const lowFrames = computeRmsFrames(lowBand, frameSize, hopSize);
  const midFrames = computeRmsFrames(midBand, frameSize, hopSize);
  const highFrames = computeRmsFrames(highBand, frameSize, hopSize);
  const frames = buildAnalysisFrames(lowFrames, midFrames, highFrames, hopTime);
  const notes: any[] = [];

  const globalAverageEnergy =
    frames.reduce((sum, frame) => sum + frame.total, 0) / (frames.length || 1);
  const silenceFloor = globalAverageEnergy * 0.38;
  const laneAvailability = [0, 0, 0, 0];
  const laneStates: LaneStrainState[] = [0, 1, 2, 3].map(() => ({
    strain: 0,
    updatedAt: 0,
    lastNoteTime: -Infinity,
  }));
  const handStates: HandStrainState[] = [0, 1].map(() => ({
    strain: 0,
    updatedAt: 0,
    lastNoteTime: -Infinity,
  }));

  let lastNoteTime = -Infinity;
  let lastLane = -1;
  let consecutiveOnLane = 0;
  let currentQuickRunCount = 1;
  let currentQuickRunRegistered = false;
  let currentQuickRunStart = -Infinity;
  let recentBurstStarts: number[] = [];

  const baseSpacing = Math.max(minNoteSpacing, 0.24 - density * 0.11 - complexity * 0.025);
  const streamSpacingFloor = Math.max(minNoteSpacing, baseSpacing * 0.82);
  const streamSpacingCeiling = Math.max(streamSpacingFloor + 0.06, 0.3 - density * 0.04 - complexity * 0.015);
  const quickBurstSpacing = Math.max(streamSpacingFloor, 0.145 - density * 0.025 - stamina * 0.015);
  const burstSpacingFloor = Math.max(minNoteSpacing, quickBurstSpacing * 0.78);
  const burstWindowSeconds = 15;
  const maxBurstClustersPerWindow = 4;
  const handStrainCap = 0.92 + (stamina * 1.75) + (density * 0.45);
  const totalStrainCap = 1.7 + (stamina * 2.6);

  for (let i = 2; i < frames.length - 2; i++) {
    const frame = frames[i];
    const beatDrive = Math.max(0, frame.lowRatio - 1) * 1.08 + Math.max(0, frame.onsetRatio - 1) * 1.35;
    const toneDrive =
      Math.max(0, frame.toneRatio - 1) * (0.75 + complexity * 0.85) +
      Math.max(0, frame.midRatio - 1) * 0.42 +
      Math.max(0, frame.highRatio - 1) * 0.34;
    const intensityDrive = Math.max(0, frame.totalRatio - 1) * 0.45;
    frame.combinedScore = beatDrive + toneDrive + intensityDrive;

    if (frame.total < silenceFloor) continue;

    const threshold = 0.88 - density * 0.16 - complexity * 0.08;
    const timeSinceLast = frame.time - lastNoteTime;
    const isStreamContinuation =
      Number.isFinite(lastNoteTime) &&
      timeSinceLast >= streamSpacingFloor &&
      timeSinceLast <= streamSpacingCeiling &&
      (frame.lowRatio > 1.01 || frame.midRatio > 1.03 || frame.onsetRatio > 1.02);
    const requiredScore = isStreamContinuation
      ? threshold - (0.08 + density * 0.04 + complexity * 0.03)
      : threshold;
    const isLocalPeak =
      frame.combinedScore >= frames[i - 1].combinedScore &&
      frame.combinedScore >= frames[i + 1].combinedScore &&
      frame.combinedScore >= frames[i - 2].combinedScore * 0.95 &&
      frame.combinedScore >= frames[i + 2].combinedScore * 0.95;

    if (!isLocalPeak || frame.combinedScore < requiredScore) continue;

    recentBurstStarts = recentBurstStarts.filter((startTime) => frame.time - startTime <= burstWindowSeconds);
    const continuesQuickRun = Number.isFinite(lastNoteTime) && timeSinceLast < quickBurstSpacing;
    const leftHandStrain = getHandStrainAt(handStates[0], frame.time);
    const rightHandStrain = getHandStrainAt(handStates[1], frame.time);
    const peakHandStrain = Math.max(leftHandStrain, rightHandStrain);
    const totalHandStrain = leftHandStrain + rightHandStrain;
    const strongEnoughForBurst = frame.combinedScore > threshold + 0.55;
    const exceptionalBurstPeak = frame.combinedScore > threshold + 0.92;

    if ((peakHandStrain > handStrainCap || totalHandStrain > totalStrainCap) && !strongEnoughForBurst) continue;
    if (continuesQuickRun && currentQuickRunCount >= 4 && !strongEnoughForBurst) continue;
    if (continuesQuickRun && recentBurstStarts.length >= maxBurstClustersPerWindow && !exceptionalBurstPeak) continue;

    const spacingFloor = continuesQuickRun
      ? burstSpacingFloor
      : Math.max(minNoteSpacing, baseSpacing - Math.min(0.04, frame.combinedScore * 0.015));
    if (timeSinceLast < spacingFloor) continue;

    const availableLanes = [0, 1, 2, 3].filter((lane) => laneAvailability[lane] <= frame.time);
    if (availableLanes.length === 0) continue;

    const primaryLane = chooseLane(
      availableLanes,
      frame,
      lastLane,
      laneVariety,
      consecutiveOnLane,
      maxConsecutive,
      laneStates,
      handStates,
      frame.time,
      stamina
    );

    const shouldMakeChord =
      availableLanes.length >= 2 &&
      density > 0.52 &&
      timeSinceLast > Math.max(0.18, baseSpacing * 1.35) &&
      totalHandStrain < totalStrainCap * (0.88 + stamina * 0.12) &&
      (
        frame.combinedScore > threshold + 1.02 ||
        (frame.lowRatio > 1.45 && frame.highRatio > 1.32) ||
        (frame.toneRatio > 1.7 && laneVariety > 0.7)
      );

    const lanesToCreate = [primaryLane];
    if (shouldMakeChord) {
      const oppositeLane = clamp(primaryLane + (frame.centroid >= 0.5 ? -2 : 2), 0, 3);
      const secondaryLane = availableLanes.includes(oppositeLane)
        ? oppositeLane
        : availableLanes
            .filter((lane) => lane !== primaryLane)
            .sort((a, b) => Math.abs(b - primaryLane) - Math.abs(a - primaryLane))[0];

      if (secondaryLane !== undefined && !lanesToCreate.includes(secondaryLane)) {
        lanesToCreate.push(secondaryLane);
      }
    }

    const sliderDuration = estimateSliderDuration(frames, i, hopTime, sliderProbability);
    const canUseSlider =
      sliderDuration !== undefined &&
      timeSinceLast > 0.26 &&
      frame.toneRatio > 1.03 &&
      frame.onsetRatio < 2.8 &&
      Math.random() < sliderProbability * (0.7 + complexity * 0.55);

    for (let laneIndex = 0; laneIndex < lanesToCreate.length; laneIndex++) {
      const lane = lanesToCreate[laneIndex];
      const duration =
        laneIndex === 0 && canUseSlider && lanesToCreate.length === 1
          ? sliderDuration
          : undefined;

      notes.push({
        id: createNoteId(),
        time: frame.time,
        lane,
        duration,
        hit: false,
        missed: false,
      });

      if (duration) {
        laneAvailability[lane] = frame.time + duration;
      }

      applyStrainToLane(
        laneStates,
        handStates,
        lane,
        frame.time,
        stamina,
        lanesToCreate.length > 1,
        Boolean(duration)
      );
    }

    if (primaryLane === lastLane) {
      consecutiveOnLane++;
    } else {
      consecutiveOnLane = 1;
    }

    if (continuesQuickRun) {
      if (currentQuickRunCount <= 1 || !Number.isFinite(currentQuickRunStart)) {
        currentQuickRunCount = 2;
        currentQuickRunStart = lastNoteTime;
        currentQuickRunRegistered = false;
      } else {
        currentQuickRunCount++;
      }

      if (currentQuickRunCount >= 4 && !currentQuickRunRegistered) {
        recentBurstStarts.push(currentQuickRunStart);
        currentQuickRunRegistered = true;
      }
    } else {
      currentQuickRunCount = 1;
      currentQuickRunStart = frame.time;
      currentQuickRunRegistered = false;
    }

    lastLane = primaryLane;
    lastNoteTime = frame.time;
  }

  return notes
    .sort((a, b) => a.time - b.time || a.lane - b.lane)
    .filter((note, index, allNotes) => {
      const previous = allNotes[index - 1];
      if (!previous) return true;

      const sameLane = previous.lane === note.lane;
      const tooClose = note.time - previous.time < minNoteSpacing * 0.7;
      return !(sameLane && tooClose);
    });
}

export async function loadAudioFile(source: File | string, audioContext: AudioContext): Promise<AudioBuffer> {
  let arrayBuffer: ArrayBuffer;
  if (typeof source === "string") {
    const response = await fetch(source);
    arrayBuffer = await response.arrayBuffer();
  } else {
    arrayBuffer = await source.arrayBuffer();
  }
  return await audioContext.decodeAudioData(arrayBuffer);
}
