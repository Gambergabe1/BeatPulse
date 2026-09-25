import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

// Minimal localStorage for the browser-side record keeping.
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
} as Storage;

const { getChartKey, getGhostTimeline, getNextGoal, getRank, getSongRecords, recordRun, saveGhostTimeline } = await import('../src/utils/chartRecords.ts');

const chart = { songId: 'song-1', name: 'Song', artist: 'Artist', duration: 120, difficulty: 0.4 };

beforeEach(() => store.clear());

test('records are kept per song and difficulty', () => {
  assert.notEqual(getChartKey(chart), getChartKey({ ...chart, difficulty: 0.92 }));
  assert.equal(getChartKey({ ...chart, songId: undefined }), 'local:song|artist|120@normal');
});

test('the first run is a new best, a worse run is not, and attempts count up', () => {
  const first = recordRun(chart, { score: 1000, accuracy: 80, maxCombo: 50, fullCombo: false });
  assert.equal(first.isNewBest, true);
  assert.equal(first.previous, null);
  assert.equal(first.firstClear, true);
  const second = recordRun(chart, { score: 900, accuracy: 90, maxCombo: 60, fullCombo: true });
  assert.equal(second.isNewBest, false);
  assert.equal(second.attempt, 2);
  assert.equal(second.firstFullCombo, true);
  assert.equal(second.record.bestScore, 1000);
  assert.equal(second.record.bestAccuracy, 90);
  assert.equal(second.record.bestRank, 'A');
  assert.equal(second.record.fullCombo, true);
});

test('failed runs do not count as clears', () => {
  const update = recordRun(chart, { score: 100, accuracy: 30, maxCombo: 4, fullCombo: false });
  assert.equal(update.firstClear, false);
  assert.equal(update.record.clears, 0);
  assert.equal(getNextGoal(update.record, chart.difficulty).title, 'Clear the chart');
});

test('the next goal climbs ranks, then full combo, then the next difficulty', () => {
  const b = recordRun(chart, { score: 100, accuracy: 76, maxCombo: 4, fullCombo: false });
  assert.equal(getNextGoal(b.record, chart.difficulty).title, 'Reach A rank');
  const s = recordRun(chart, { score: 200, accuracy: 97, maxCombo: 4, fullCombo: false });
  assert.equal(getNextGoal(s.record, chart.difficulty).title, 'Full combo it');
  const fc = recordRun(chart, { score: 300, accuracy: 99, maxCombo: 4, fullCombo: true });
  assert.equal(getNextGoal(fc.record, chart.difficulty).stepUp?.id, 'hard');
  const expert = recordRun({ ...chart, difficulty: 0.92 }, { score: 300, accuracy: 99, maxCombo: 4, fullCombo: true });
  assert.equal(getNextGoal(expert.record, 0.92).stepUp, undefined);
});

test('song records list every difficulty played', () => {
  recordRun(chart, { score: 100, accuracy: 70, maxCombo: 4, fullCombo: false });
  recordRun({ ...chart, difficulty: 0.92 }, { score: 50, accuracy: 60, maxCombo: 2, fullCombo: false });
  assert.deepEqual(getSongRecords(chart).map((entry) => entry.preset.id).sort(), ['expert', 'normal']);
});

test('ghost timelines round-trip per chart', () => {
  saveGhostTimeline(getChartKey(chart), [0, 100.4, 250.6]);
  assert.deepEqual(getGhostTimeline(chart), [0, 100, 251]);
  assert.equal(getGhostTimeline({ ...chart, difficulty: 0.92 }), undefined);
});

test('ranks follow accuracy thresholds', () => {
  assert.equal(getRank(95).label, 'S');
  assert.equal(getRank(84.9).label, 'B');
  assert.equal(getRank(10).label, 'F');
});
