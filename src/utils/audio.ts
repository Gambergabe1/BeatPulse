export interface NoteGenerationConfig {
  complexity?: number;
  density?: number;
  laneVariety?: number;
  maxConsecutive?: number;
  minNoteSpacing?: number; // Minimum time between notes (seconds)
  sliderProbability?: number; // 0-1 (Hold note frequency)
  stamina?: number; // 0-1 (Higher means more notes allowed in bursts)
}

/**
 * Detects beats in an AudioBuffer to generate a sophisticated note map.
 * Uses multi-band analysis and stamina management for better rhythms.
 */
export async function generateNotesFromAudio(
  audioBuffer: AudioBuffer, 
  config: number | NoteGenerationConfig = 0.5
): Promise<any[]> {
  const c = typeof config === 'number' ? config : (config.complexity ?? 0.5);
  const density = typeof config === 'object' ? (config.density ?? c) : c;
  const laneVariety = typeof config === 'object' ? (config.laneVariety ?? c) : c;
  const maxConsecutive = typeof config === 'object' ? (config.maxConsecutive ?? Math.floor(2 + c * 4)) : Math.floor(2 + c * 4);
  const minNoteSpacing = typeof config === 'object' ? (config.minNoteSpacing ?? 0.08) : 0.08;
  const sliderProbability = typeof config === 'object' ? (config.sliderProbability ?? 0.3) : 0.3;
  const stamina = typeof config === 'object' ? (config.stamina ?? 0.5) : 0.5;

  // We'll use a single render but with a filter that captures both bass and some transients
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  // Band-pass filter to focus on the most rhythmic frequencies (kick and snare)
  const filter = offlineCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 400; // Center around 400Hz
  filter.Q.value = 0.5; // Wide enough to catch kicks and snares

  source.connect(filter);
  filter.connect(offlineCtx.destination);
  source.start(0);

  const filteredBuffer = await offlineCtx.startRendering();
  const data = filteredBuffer.getChannelData(0);
  const sampleRate = filteredBuffer.sampleRate;
  
  const notes: any[] = [];
  const winSize = Math.floor(sampleRate * 0.01); // 10ms window for high precision
  const energyData: number[] = [];

  // RMS energy calculation
  for (let i = 0; i < data.length; i += winSize) {
    let energy = 0;
    for (let j = 0; j < winSize && i + j < data.length; j++) {
      energy += data[i + j] * data[i + j];
    }
    energyData.push(Math.sqrt(energy / winSize));
  }

  const globalAvgEnergy = energyData.reduce((a, b) => a + b, 0) / (energyData.length || 1);
  
  // Stamina management: track notes in a rolling window
  const staminaWindow = 1.0; // 1 second
  const getStaminaCost = (time: number) => {
    return notes.filter(n => time - n.time < staminaWindow).length;
  };

  // Pattern state
  let lastNoteTime = 0;
  let lastLane = -1;
  let currentPattern: 'stream' | 'jump' | 'chord' | 'none' = 'none';
  let patternRemaining = 0;
  const laneOccupancy = [0, 0, 0, 0];

  // Dynamic thresholds based on density and complexity
  const baseSensitivity = 2.5 - (density * 1.5);
  const baseMinInterval = 0.35 - (density * 0.25);
  
  const avgWin = 40; // 400ms local window
  for (let i = avgWin; i < energyData.length - avgWin; i++) {
    const currentTime = (i * winSize) / sampleRate;
    
    // Local average for dynamic thresholding
    let localAvg = 0;
    for (let j = i - avgWin; j < i + avgWin; j++) {
      localAvg += energyData[j];
    }
    localAvg /= (avgWin * 2);

    const energyRatio = energyData[i] / (localAvg || 0.001);
    const isPeak = energyRatio > baseSensitivity && 
                   energyData[i] > energyData[i-1] && 
                   energyData[i] > energyData[i+1];

    if (isPeak) {
      // Stamina management
      const currentStamina = getStaminaCost(currentTime);
      const staminaThreshold = 3 + (stamina * 12); // 3 to 15 notes per second
      
      // If over stamina, only allow extremely strong peaks
      if (currentStamina > staminaThreshold && energyRatio < baseSensitivity * 2.0) {
        continue;
      }

      const timeSinceLast = currentTime - lastNoteTime;
      if (timeSinceLast < Math.max(minNoteSpacing, baseMinInterval * 0.4)) {
        continue;
      }

      // Lane Selection & Pattern Logic
      let lanesToCreate = [0]; // Default to one note
      const availableLanes = [0, 1, 2, 3].filter(l => laneOccupancy[l] <= currentTime);
      if (availableLanes.length === 0) continue;

      if (patternRemaining > 0 && availableLanes.includes(lastLane)) {
        // Continue existing pattern
        if (currentPattern === 'stream') {
          const dir = Math.random() > 0.5 ? 1 : -1;
          lanesToCreate = [(lastLane + dir + 4) % 4];
        } else if (currentPattern === 'jump') {
          lanesToCreate = [(lastLane + 2) % 4];
        } else if (currentPattern === 'chord') {
          lanesToCreate = [lastLane, (lastLane + 2) % 4];
        }
        patternRemaining--;
      } else {
        // Start new pattern or single note
        const rand = Math.random();
        if (rand < 0.3 * c && timeSinceLast < 0.25) {
          currentPattern = 'stream';
          patternRemaining = Math.floor(3 + c * 5);
          lanesToCreate = [(lastLane + 1) % 4];
        } else if (rand < 0.5 * c && timeSinceLast > 0.4) {
          currentPattern = 'jump';
          patternRemaining = 2;
          lanesToCreate = [(lastLane + 2) % 4];
        } else if (rand < 0.2 * c && timeSinceLast > 0.5 && availableLanes.length >= 2) {
          currentPattern = 'chord';
          patternRemaining = 1;
          const l1 = availableLanes[Math.floor(Math.random() * availableLanes.length)];
          const l2 = (l1 + 2) % 4;
          lanesToCreate = availableLanes.includes(l2) ? [l1, l2] : [l1];
        } else {
          currentPattern = 'none';
          lanesToCreate = [availableLanes[Math.floor(Math.random() * availableLanes.length)]];
        }
      }

      // Create the notes
      for (const lane of lanesToCreate) {
        if (!availableLanes.includes(lane)) continue;

        // Hold note (slider) logic
        let duration = 0;
        const canHaveSlider = timeSinceLast > 0.4 && 
                             currentPattern === 'none' && 
                             !notes.some(n => n.duration && n.time + n.duration > currentTime);
        
        if (canHaveSlider && Math.random() < sliderProbability) {
          duration = 0.5 + (Math.random() * 1.0 * c);
        }

        notes.push({
          id: Math.random().toString(36).substring(2, 11),
          time: currentTime,
          lane,
          duration: duration > 0 ? duration : undefined,
          hit: false,
          missed: false
        });

        if (duration > 0) laneOccupancy[lane] = currentTime + duration;
        lastLane = lane;
      }
      
      lastNoteTime = currentTime;
    }
  }

  // Sort and return
  return notes.sort((a, b) => a.time - b.time);
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
