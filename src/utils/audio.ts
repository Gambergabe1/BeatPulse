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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createNoteId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 11);
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
  maxConsecutive: number
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
    let score = 0;
    score += 1.6 - Math.abs(lane - tonalLane) * (1.05 - laneVariety * 0.35);
    score += 0.5 - Math.abs(lane - centroidLane) * 0.25;

    if (lastLane !== -1) {
      const distance = Math.abs(lane - lastLane);
      score += laneVariety >= 0.55 ? distance * 0.35 : -distance * 0.45;

      if (toneDirection > 0.15 && lane > lastLane) score += 0.35;
      if (toneDirection < -0.15 && lane < lastLane) score += 0.35;
      if (consecutiveOnLane >= maxConsecutive && lane === lastLane) score -= 5;
    }

    score += (Math.random() - 0.5) * (0.12 + laneVariety * 0.38);

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

  let lastNoteTime = -Infinity;
  let lastLane = -1;
  let consecutiveOnLane = 0;

  const staminaWindow = 1.2;
  const staminaAllowance = 2 + (stamina * 8) + (density * 4);
  const baseSpacing = Math.max(minNoteSpacing, 0.3 - density * 0.18 - complexity * 0.05);

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
    const isLocalPeak =
      frame.combinedScore >= frames[i - 1].combinedScore &&
      frame.combinedScore >= frames[i + 1].combinedScore &&
      frame.combinedScore >= frames[i - 2].combinedScore * 0.95 &&
      frame.combinedScore >= frames[i + 2].combinedScore * 0.95;

    if (!isLocalPeak || frame.combinedScore < threshold) continue;

    const timeSinceLast = frame.time - lastNoteTime;
    const currentStamina = notes.filter((note) => frame.time - note.time < staminaWindow).length;
    const strongEnoughForBurst = frame.combinedScore > threshold + 0.55;

    if (currentStamina > staminaAllowance && !strongEnoughForBurst) continue;
    if (timeSinceLast < Math.max(minNoteSpacing, baseSpacing - Math.min(0.1, frame.combinedScore * 0.03))) continue;

    const availableLanes = [0, 1, 2, 3].filter((lane) => laneAvailability[lane] <= frame.time);
    if (availableLanes.length === 0) continue;

    const primaryLane = chooseLane(
      availableLanes,
      frame,
      lastLane,
      laneVariety,
      consecutiveOnLane,
      maxConsecutive
    );

    const shouldMakeChord =
      availableLanes.length >= 2 &&
      density > 0.45 &&
      timeSinceLast > Math.max(0.14, minNoteSpacing * 1.5) &&
      (
        frame.combinedScore > threshold + 0.9 ||
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
    }

    if (primaryLane === lastLane) {
      consecutiveOnLane++;
    } else {
      consecutiveOnLane = 1;
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
