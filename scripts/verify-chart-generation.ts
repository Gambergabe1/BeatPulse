import assert from 'node:assert/strict';
import { generateNotesFromAudio } from '../src/utils/audio';
import { DEFAULT_DIFFICULTY, DIFFICULTY_PRESETS, getChartSettingsForDifficulty, getDifficultyPreset } from '../src/utils/chartSettings';
import { usesMovingSlidersForDevice } from '../src/utils/device';
import type { Note } from '../src/types';

const sampleRate = 22050;

const createSyntheticTrack = (bpm: number, duration = 24) => {
  const data = new Float32Array(Math.floor(sampleRate * duration));
  const beatInterval = 60 / bpm;
  const pulseTimes: number[] = [];

  for (let time = 0.5, beat = 0; time < duration - 0.5; time += beatInterval, beat++) {
    pulseTimes.push(time);
    const busyPhrase = time > duration / 2;
    if (busyPhrase) pulseTimes.push(time + beatInterval / 2);
    if (busyPhrase && beat % 4 === 3) pulseTimes.push(time + beatInterval * 0.75);
  }

  for (let index = 0; index < data.length; index++) {
    const time = index / sampleRate;
    const phraseGain = time > duration / 2 ? 1 : 0.72;
    data[index] = Math.sin(2 * Math.PI * 110 * time) * 0.025 * phraseGain
      + Math.sin(2 * Math.PI * 220 * time) * 0.012;
  }

  pulseTimes.forEach((pulseTime, index) => {
    const isMainBeat = Math.abs(((pulseTime - 0.5) / beatInterval) - Math.round((pulseTime - 0.5) / beatInterval)) < 0.02;
    const pulseLength = Math.floor(sampleRate * (isMainBeat ? 0.095 : 0.052));
    for (let offset = 0; offset < pulseLength; offset++) {
      const sampleIndex = Math.floor(pulseTime * sampleRate) + offset;
      if (sampleIndex >= data.length) break;
      const age = offset / sampleRate;
      const envelope = Math.exp(-age * (isMainBeat ? 28 : 50));
      const click = Math.sin((offset + 1) * (1.7 + (index % 3) * 0.17));
      const kick = Math.sin(2 * Math.PI * 74 * age);
      data[sampleIndex] += (kick * 0.5 + click * 0.16) * envelope * (isMainBeat ? 1 : 0.55);
    }
  });

  return {
    buffer: {
      length: data.length,
      duration,
      sampleRate,
      numberOfChannels: 1,
      getChannelData: () => data,
    } as unknown as AudioBuffer,
    beatInterval,
  };
};

const distanceToGrid = (time: number, origin: number, grid: number) => {
  const position = (time - origin) / grid;
  return Math.abs(position - Math.round(position)) * grid;
};

const verifyChart = async (bpm: number) => {
  const { buffer, beatInterval } = createSyntheticTrack(bpm);
  const config = {
    complexity: 0.72,
    density: 0.62,
    laneVariety: 0.82,
    sliderProbability: 0.82,
    stamina: 0.66,
    allowMovingSliders: true,
  };
  const notes = await generateNotesFromAudio(buffer, config);
  const repeated = await generateNotesFromAudio(buffer, config);
  assert.deepEqual(repeated, notes, `${bpm} BPM generation must be deterministic`);
  assert(notes.length >= 16, `${bpm} BPM chart generated too few notes`);

  const aligned = notes.filter((note) => distanceToGrid(note.time, 0.5, beatInterval / 4) <= 0.045).length;
  assert(aligned / notes.length >= 0.78, `${bpm} BPM chart is not sufficiently aligned to its pulse grid`);

  const firstPhrase = notes.filter((note) => note.time >= 1 && note.time < 12).length;
  const busyPhrase = notes.filter((note) => note.time >= 12 && note.time < 23).length;
  assert(busyPhrase > firstPhrase, `${bpm} BPM chart did not adapt to the busier second phrase`);

  notes.forEach((note) => {
    assert(note.lane >= 0 && note.lane <= 3, 'note lane is outside the playfield');
    if (note.endLane !== undefined) assert(note.endLane >= 0 && note.endLane <= 3, 'slide tail is outside the playfield');
    if (note.duration) assert(note.duration >= 0.29, 'slider is too short to read');
  });

  return {
    bpm,
    notes: notes.length,
    firstPhrase,
    busyPhrase,
    holds: notes.filter((note) => note.duration).length,
    movingSlides: notes.filter((note) => note.duration && note.endLane !== undefined).length,
    alignment: Math.round((aligned / notes.length) * 100),
    chart: notes as Note[],
  };
};

const results = await Promise.all([verifyChart(80), verifyChart(128), verifyChart(180)]);
assert(results.some((result) => result.holds > 0), 'tempo-aware generator did not create any holds');
assert(results.some((result) => result.movingSlides > 0), 'tempo-aware generator did not create any moving slides');
assert(results[2].notes > results[0].notes, 'fast songs should support a higher average pace than slow songs');

const desktopTrack = createSyntheticTrack(128);
const desktopNotes = await generateNotesFromAudio(desktopTrack.buffer, {
  complexity: 0.72,
  density: 0.62,
  laneVariety: 0.82,
  sliderProbability: 0.82,
  stamina: 0.66,
  allowMovingSliders: false,
});
assert(desktopNotes.some((note) => note.duration), 'desktop charts should retain straight hold notes');
assert(desktopNotes.every((note) => note.endLane === undefined), 'desktop charts must not contain moving sliders');
assert.equal(usesMovingSlidersForDevice({ coarsePointer: false, noHover: false, maxTouchPoints: 0, viewportWidth: 1440 }), false);
assert.equal(usesMovingSlidersForDevice({ coarsePointer: false, noHover: false, maxTouchPoints: 10, viewportWidth: 1440 }), false);
assert.equal(usesMovingSlidersForDevice({ coarsePointer: true, noHover: true, maxTouchPoints: 5, viewportWidth: 430 }), true);

assert.equal(getDifficultyPreset(DEFAULT_DIFFICULTY).id, 'normal', 'default difficulty should remain Normal');
for (let index = 1; index < DIFFICULTY_PRESETS.length; index++) {
  const previous = getChartSettingsForDifficulty(DIFFICULTY_PRESETS[index - 1].value);
  const current = getChartSettingsForDifficulty(DIFFICULTY_PRESETS[index].value);
  assert(current.density > previous.density, 'difficulty presets must increase note density');
  assert(current.laneVariety > previous.laneVariety, 'difficulty presets must increase lane movement');
  assert(current.stamina > previous.stamina, 'difficulty presets must increase stamina demand');
}

// Long songs at tempos that are not on the coarse 0.5 BPM grid, with a slow tempo drift:
// the snapped grid must stay locked to the music all the way to the end.
const createLongTrack = (startBpm: number, endBpm: number, duration: number, breakdown?: [number, number]) => {
  const data = new Float32Array(Math.floor(sampleRate * duration));
  for (let index = 0; index < data.length; index++) {
    const time = index / sampleRate;
    data[index] = Math.sin(2 * Math.PI * 110 * time) * 0.03 + Math.sin(2 * Math.PI * 220 * time) * 0.012;
  }
  const pulses: Array<{ time: number; main: boolean }> = [];
  let time = 0.37;
  let half = 0;
  while (time < duration - 0.5) {
    pulses.push({ time, main: half % 2 === 0 });
    const bpm = startBpm + (endBpm - startBpm) * (time / duration);
    time += 60 / bpm / 2;
    half += 1;
  }
  pulses.forEach((pulse) => {
    if (breakdown && pulse.time > breakdown[0] && pulse.time < breakdown[1]) return;
    const length = Math.floor(sampleRate * (pulse.main ? 0.09 : 0.05));
    for (let offset = 0; offset < length; offset++) {
      const sampleIndex = Math.floor(pulse.time * sampleRate) + offset;
      if (sampleIndex >= data.length) break;
      const age = offset / sampleRate;
      const envelope = Math.exp(-age * (pulse.main ? 28 : 50));
      data[sampleIndex] += (Math.sin(2 * Math.PI * 74 * age) * 0.5 + Math.sin((offset + 1) * 1.9) * 0.16) * envelope * (pulse.main ? 1 : 0.5);
    }
  });
  const buffer = { length: data.length, duration, sampleRate, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer;
  return { buffer, pulseTimes: pulses.map((pulse) => pulse.time) };
};

const nearestPulseDistance = (time: number, pulseTimes: number[]) => {
  let low = 0;
  let high = pulseTimes.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (pulseTimes[middle] < time) low = middle + 1;
    else high = middle;
  }
  return Math.min(Math.abs(pulseTimes[low] - time), Math.abs((pulseTimes[low - 1] ?? -Infinity) - time));
};

for (const [startBpm, endBpm] of [[127.3, 127.3], [143.7, 143.7], [118, 121.5]]) {
  const { buffer, pulseTimes } = createLongTrack(startBpm, endBpm, 150);
  const counts: number[] = [];
  for (const preset of DIFFICULTY_PRESETS) {
    const notes = await generateNotesFromAudio(buffer, { ...getChartSettingsForDifficulty(preset.value), allowMovingSliders: false });
    counts.push(notes.length);
    const lateNotes = notes.filter((note) => note.time > 110);
    const locked = lateNotes.filter((note) => nearestPulseDistance(note.time, pulseTimes) <= 0.03).length;
    assert(lateNotes.length > 0 && locked / lateNotes.length >= 0.88, `${startBpm}->${endBpm} BPM ${preset.id} chart drifted off the beat late in the song`);
  }
  for (let index = 1; index < counts.length; index++) {
    assert(counts[index] > counts[index - 1], `${startBpm}->${endBpm} BPM: ${DIFFICULTY_PRESETS[index].id} must be denser than ${DIFFICULTY_PRESETS[index - 1].id} (${counts.join(' / ')})`);
  }
}

// A drumless breakdown should become a few sustained holds, not a stream of ghost notes.
{
  const { buffer } = createLongTrack(120, 120, 100, [40, 70]);
  const notes = await generateNotesFromAudio(buffer, getChartSettingsForDifficulty(DEFAULT_DIFFICULTY));
  const breakdownNotes = notes.filter((note) => note.time > 41 && note.time < 69);
  assert(breakdownNotes.length > 0, 'breakdowns should still give the player something to hold');
  assert(breakdownNotes.length <= 16 && breakdownNotes.every((note) => note.duration), 'breakdowns must not be filled with ghost taps');
}

// Musical placement: bass hits lean to the left lanes, bright hits to the right, and a
// repeated chorus reuses the lanes it was charted with the first time.
{
  let noiseSeed = 7;
  const noise = () => ((noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const addKick = (data: Float32Array, time: number, gain = 1) => {
    for (let offset = 0; offset < sampleRate * 0.12; offset++) {
      const index = Math.floor(time * sampleRate) + offset;
      if (index >= data.length) break;
      const age = offset / sampleRate;
      data[index] += Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-age * 30)) * age) * Math.exp(-age * 22) * 0.8 * gain;
    }
  };
  let previousNoise = 0;
  const addHat = (data: Float32Array, time: number, gain = 1) => {
    for (let offset = 0; offset < sampleRate * 0.05; offset++) {
      const index = Math.floor(time * sampleRate) + offset;
      if (index >= data.length) break;
      const value = noise();
      data[index] += (value - previousNoise) * Math.exp(-(offset / sampleRate) * 70) * 0.35 * gain;
      previousNoise = value;
    }
  };
  const asBuffer = (data: Float32Array) => ({ length: data.length, duration: data.length / sampleRate, sampleRate, numberOfChannels: 1, getChannelData: () => data }) as unknown as AudioBuffer;
  const hardChart = { ...getChartSettingsForDifficulty(DIFFICULTY_PRESETS[2].value), allowMovingSliders: false };

  const pitchTrack = new Float32Array(sampleRate * 40);
  const kicks: number[] = [];
  const hats: number[] = [];
  for (let time = 0.4; time < 39; time += 0.5) {
    addKick(pitchTrack, time);
    addHat(pitchTrack, time + 0.25);
    kicks.push(time);
    hats.push(time + 0.25);
  }
  const pitchNotes = await generateNotesFromAudio(asBuffer(pitchTrack), hardChart);
  const near = (times: number[], time: number) => times.some((entry) => Math.abs(entry - time) < 0.03);
  const kickNotes = pitchNotes.filter((note) => near(kicks, note.time));
  const hatNotes = pitchNotes.filter((note) => near(hats, note.time));
  const kickLeft = kickNotes.filter((note) => note.lane <= 1).length / kickNotes.length;
  const hatRight = hatNotes.filter((note) => note.lane >= 2).length / hatNotes.length;
  assert(kickLeft >= 0.58 && hatRight >= 0.55, `bass should lean left and bright hits right (left ${kickLeft.toFixed(2)}, right ${hatRight.toFixed(2)})`);

  let motifSeed = 99;
  const motif = Array.from({ length: 128 }, (_, index) => index % 4 === 0 ? 1 : ((motifSeed = (motifSeed * 1103515245 + 12345) >>> 0) % 3));
  const songTrack = new Float32Array(sampleRate * 128);
  for (let time = 0.4, step = 0; time < 127; time += 0.25, step++) {
    const chorus = (time >= 32 && time < 64) || (time >= 96 && time < 128);
    if (chorus) {
      if (motif[step % 128] === 1) addKick(songTrack, time, 1.2);
      if (motif[step % 128] === 2) addHat(songTrack, time, 1.3);
    } else if (step % 2 === 0) {
      addKick(songTrack, time, 0.45);
    }
  }
  for (let index = 0; index < songTrack.length; index++) {
    const time = index / sampleRate;
    songTrack[index] += Math.sin(2 * Math.PI * 220 * time) * ((time >= 32 && time < 64) || time >= 96 ? 0.08 : 0.02);
  }
  const songNotes = await generateNotesFromAudio(asBuffer(songTrack), hardChart);
  const firstChorus = songNotes.filter((note) => note.time >= 38 && note.time < 58);
  const secondChorus = songNotes.filter((note) => note.time >= 102 && note.time < 118);
  let matched = 0;
  let sameLane = 0;
  for (const note of secondChorus) {
    const original = firstChorus.find((entry) => Math.abs(entry.time + 64 - note.time) < 0.03);
    if (!original) continue;
    matched += 1;
    if (original.lane === note.lane) sameLane += 1;
  }
  assert(matched >= 5 && sameLane / matched >= 0.6, `a repeated chorus should reuse its lanes (${sameLane}/${matched})`);
}

console.table(results.map(({ chart: _chart, ...summary }) => summary));
console.log('Chart generation checks passed.');
