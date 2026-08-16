import assert from 'node:assert/strict';
import { generateNotesFromAudio } from '../src/utils/audio';
import { DEFAULT_DIFFICULTY, DIFFICULTY_PRESETS, getChartSettingsForDifficulty, getDifficultyPreset } from '../src/utils/chartSettings';
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

assert.equal(getDifficultyPreset(DEFAULT_DIFFICULTY).id, 'normal', 'default difficulty should remain Normal');
for (let index = 1; index < DIFFICULTY_PRESETS.length; index++) {
  const previous = getChartSettingsForDifficulty(DIFFICULTY_PRESETS[index - 1].value);
  const current = getChartSettingsForDifficulty(DIFFICULTY_PRESETS[index].value);
  assert(current.density > previous.density, 'difficulty presets must increase note density');
  assert(current.laneVariety > previous.laneVariety, 'difficulty presets must increase lane movement');
  assert(current.stamina > previous.stamina, 'difficulty presets must increase stamina demand');
}

console.table(results.map(({ chart: _chart, ...summary }) => summary));
console.log('Chart generation checks passed.');
