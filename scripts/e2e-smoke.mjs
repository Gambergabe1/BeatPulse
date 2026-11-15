/**
 * Browser smoke test for the core loop against a running BeatPulse server:
 * upload → auto-chart → publish to the community library (4 official charts) →
 * play a stored chart on Hard → ranked results → retry with the personal-best ghost,
 * plus the daily challenge card, the social hub and the admin chart tools.
 *
 * Usage (with `npm run dev` running on a fresh data directory):
 *   npm run test:e2e              # BASE_URL defaults to http://localhost:3000
 * Requires Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
 * Set PLAYWRIGHT_CHROMIUM to use an existing Chromium binary instead.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

/** A 30s, 128 BPM click track with a musical name, written as a 16-bit WAV. */
const writeTestTrack = () => {
  const sampleRate = 44100;
  const seconds = 30;
  const bpm = 128;
  const count = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + count * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
  const half = 60 / bpm / 2;
  for (let i = 0; i < count; i++) {
    const time = i / sampleRate;
    let value = Math.sin(2 * Math.PI * 110 * time) * 0.05;
    if (time > 0.5) {
      const phase = ((time - 0.5) % half + half) % half;
      const main = Math.round((time - 0.5 - phase) / half) % 2 === 0;
      value += Math.sin(2 * Math.PI * 70 * phase) * Math.exp(-phase * (main ? 28 : 50)) * (main ? 0.6 : 0.3);
    }
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 32767))), 44 + i * 2);
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'beatpulse-e2e-')), 'Smoke Artist - Smoke Test.wav');
  fs.writeFileSync(file, buffer);
  return file;
};

const step = (name) => console.log(`• ${name}`);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failedRequests = [];
page.on('response', (response) => {
  if (response.url().includes('/api/') && response.status() >= 400 && response.status() !== 409) {
    failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  }
});
page.on('pageerror', (error) => failedRequests.push(`page error: ${error.message}`));
page.on('dialog', (dialog) => dialog.accept());
const shot = async (name) => { if (SCREENSHOT_DIR) await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true }); };
const bodyText = () => page.evaluate(() => document.body.innerText);

const playUntilResults = async () => {
  const keys = ['d', 'f', 'j', 'k'];
  const deadline = Date.now() + 45_000;
  for (let i = 0; Date.now() < deadline; i++) {
    if (await page.locator('text=Run complete').count()) return;
    await page.keyboard.press(keys[i % 4]);
    await page.waitForTimeout(80);
  }
  throw new Error('The run never reached the results screen.');
};

try {
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenTutorial', '1');
    localStorage.setItem('username', 'smoke');
  });
  await page.goto(BASE_URL);
  await page.waitForTimeout(1500);
  await page.mouse.click(640, 450);
  await page.waitForTimeout(2500);

  step('upload and auto-chart a song');
  await page.locator('input[type=file][accept*="audio"]').first().setInputFiles(writeTestTrack());
  await page.waitForFunction(() => /\b\d+ notes\b/i.test(document.body.innerText), null, { timeout: 30_000 });
  const workerLoaded = await page.evaluate(() => performance.getEntriesByType('resource').some((entry) => /chartWorker/.test(entry.name)));
  assert(workerLoaded, 'charting should run in the Web Worker');

  step('publish it with official charts for every difficulty');
  await page.locator('button:has-text("Save to Community")').click();
  let song = null;
  for (let attempt = 0; attempt < 60 && !song; attempt++) {
    const songs = await page.evaluate(async () => (await (await fetch('/api/songs')).json()).data);
    song = songs.find((entry) => entry.name === 'Smoke Test') ?? null;
    if (!song) await page.waitForTimeout(1000);
  }
  assert(song, 'the song should be in the community library');
  const bundle = await page.evaluate(async (url) => (await fetch(url)).json(), song.notesUrl);
  assert.equal(bundle.format, 'beatpulse-charts');
  for (const id of ['easy', 'normal', 'hard', 'expert']) assert(bundle.charts[id]?.length > 0, `missing ${id} chart`);
  assert(bundle.charts.easy.length < bundle.charts.expert.length, 'Expert should be denser than Easy');

  step('daily challenge card shows the library song');
  await page.reload();
  await page.waitForTimeout(1500);
  await page.mouse.click(640, 450);
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => /Daily challenge/i.test(document.body.innerText), null, { timeout: 15_000 });

  step('load the community song on Hard and confirm the run is ranked');
  await page.locator('nav button:has-text("Library")').first().click();
  await page.locator('button[aria-label="Play Smoke Test"]').first().click();
  await page.waitForFunction(() => /\b\d+ notes\b/i.test(document.body.innerText), null, { timeout: 30_000 });
  await page.locator('[role=radio]:has-text("Hard")').click();
  await page.waitForFunction(() => /Ranked chart/i.test(document.body.innerText), null, { timeout: 10_000 });
  const hardNotes = Number((await bodyText()).match(/(\d+) notes\b/i)?.[1]);
  assert.equal(hardNotes, bundle.charts.hard.length, 'the stored Hard chart should be played, not a regenerated one');
  await shot('ready-hard');

  step('play to the results screen and submit a verified score');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await playUntilResults();
  await page.waitForFunction(() => /leaderboards updated|leaderboard update failed/i.test(document.body.innerText), null, { timeout: 15_000 });
  let text = await bodyText();
  assert.match(text, /Song \+ global leaderboards updated/i, 'the ranked score should be accepted by the server');
  assert.match(text, /Song Top Scores · hard/i, 'the leaderboard should be the Hard board');
  assert.match(text, /Attempt #1/i);
  await shot('results');

  step('retry with R and see the personal-best ghost');
  await page.waitForTimeout(1000);
  await page.keyboard.press('r');
  await page.waitForTimeout(6000);
  assert.match(await bodyText(), /vs PB/i, 'the ghost delta should show on a retry');
  await page.keyboard.press('Escape');
  await page.locator('button:has-text("Quit to menu")').click();

  step('social hub loads without API errors');
  await page.waitForTimeout(1500);
  await page.locator('nav button:has-text("Social")').first().click();
  await page.waitForFunction(() => /public player profile/i.test(document.body.innerText), null, { timeout: 15_000 });

  step('admin login and chart tools');
  await page.locator('aside button:has-text("Admin")').first().click();
  await page.locator('input[type=password]').first().fill(ADMIN_PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Rebuild Charts \(\d+\)/i.test(document.body.innerText), null, { timeout: 15_000 });
  assert.match(await bodyText(), /Rebuild Charts \(0\)/i, 'a freshly published song should not need a chart rebuild');

  assert.deepEqual(failedRequests, [], `unexpected API failures:\n${failedRequests.join('\n')}`);
  console.log('Smoke test passed.');
} catch (error) {
  await shot('failure');
  console.error(error);
  if (failedRequests.length) console.error(`API failures:\n${failedRequests.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
