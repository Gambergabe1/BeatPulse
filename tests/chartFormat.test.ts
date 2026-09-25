import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChartBundle, difficultyIdForValue, findImplausibleScore, maxScoreForChart, parseChartBundle } from '../shared/chartFormat.ts';

const taps = Array.from({ length: 100 }, (_, index) => ({ time: 1 + index * 0.5, lane: index % 4 }));

test('legacy note arrays are read as the chart for the upload difficulty', () => {
  const bundle = parseChartBundle(taps, 'hard');
  assert.equal(bundle.version, 1);
  assert.equal(bundle.charts.hard?.length, 100);
  assert.equal(bundle.charts.normal, undefined);
});

test('bundles round-trip and drop runtime note state', () => {
  const bundle = createChartBundle({ easy: taps.map((note) => ({ ...note, hit: true, missed: false })) as never });
  const parsed = parseChartBundle(JSON.parse(JSON.stringify(bundle)), 'normal');
  assert.equal(parsed.charts.easy?.length, 100);
  assert.equal('hit' in parsed.charts.easy![0], false);
});

test('unknown data parses to an empty bundle', () => {
  assert.deepEqual(parseChartBundle({ nope: true }, 'normal').charts, {});
  assert.deepEqual(parseChartBundle(null, 'normal').charts, {});
});

test('maximum score counts taps, hold tails and sustain ticks', () => {
  assert.equal(maxScoreForChart(taps), 100 * 200);
  const hold = [{ time: 1, lane: 0, duration: 1, tickInterval: 0.25 }];
  assert.equal(maxScoreForChart(hold), 400 + 5 * 50);
});

test('plausible results pass and impossible ones are rejected', () => {
  const max = maxScoreForChart(taps);
  assert.equal(findImplausibleScore({ score: max * 0.9, accuracy: 96, fullCombo: true }, taps), null);
  assert.match(findImplausibleScore({ score: max * 2, accuracy: 100, fullCombo: true }, taps) ?? '', /higher than this chart/);
  assert.match(findImplausibleScore({ score: max * 0.9, accuracy: 20, fullCombo: false }, taps) ?? '', /reported accuracy/);
  assert.match(findImplausibleScore({ score: 100, accuracy: 10, fullCombo: true }, taps) ?? '', /full combo/);
  assert.match(findImplausibleScore({ score: -1, accuracy: 50, fullCombo: false }, taps) ?? '', /positive/);
});

test('slider values map to the nearest difficulty preset', () => {
  assert.equal(difficultyIdForValue(0), 'easy');
  assert.equal(difficultyIdForValue(0.4), 'normal');
  assert.equal(difficultyIdForValue(0.7), 'hard');
  assert.equal(difficultyIdForValue(1), 'expert');
  assert.equal(difficultyIdForValue(Number.NaN), 'normal');
});

import { pickDailyChallenge } from '../shared/dailyChallenge.ts';

test('the daily challenge is the same for everyone on a day and changes between days', () => {
  const songs = Array.from({ length: 12 }, (_, index) => ({ id: `song-${index}`, difficulty: 0.4, chartVersion: 2 }));
  const today = pickDailyChallenge(songs, '2026-09-25');
  assert.deepEqual(pickDailyChallenge([...songs].reverse(), '2026-09-25'), today);
  const week = new Set(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'].map((day) => pickDailyChallenge(songs, day)?.songId));
  assert(week.size >= 3, 'challenges should vary across days');
  assert.equal(pickDailyChallenge([], '2026-09-25'), null);
});

test('legacy single-chart songs are challenged at their upload difficulty', () => {
  const challenge = pickDailyChallenge([{ id: 'old', difficulty: 0.12 }], '2026-09-25');
  assert.equal(challenge?.difficulty, 'easy');
});
