import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../api/index.ts';
import { isAllowedAssetUrl } from '../serverless/routes/audio-proxy.ts';

const call = async (url: string, query: Record<string, string> = {}, method = 'GET') => {
  const req: any = { url, method, headers: {} };
  Object.defineProperty(req, 'query', { configurable: true, enumerable: true, get: () => query });
  const result: { status: number; body: unknown; query?: unknown } = { status: 0, body: null };
  const res: any = {
    status(code: number) { result.status = code; return this; },
    json(body: unknown) { result.body = body; result.query = req.query; return this; },
    send(body: unknown) { result.body = body; result.query = req.query; return this; },
    setHeader() {},
  };
  await handler(req, res);
  return result;
};

test('the single API function routes rewritten and direct paths', async () => {
  assert.equal((await call('/api?__route=health', { __route: 'health' })).status, 200);
  assert.equal((await call('/api/health')).status, 200);
  assert.equal((await call('/api?__route=nope', { __route: 'nope' })).status, 404);
});

test('/api/songs/:id/scores is served by global-scores with the song id', async () => {
  const result = await call('/api?__route=songs/abc%20d/scores', { __route: 'songs/abc d/scores' }, 'PUT');
  assert.equal(result.status, 405);
  assert.deepEqual(result.query, { songId: 'abc d' });
});

test('the router strips its internal __route parameter', async () => {
  const result = await call('/api?__route=admin/login&x=1', { __route: 'admin/login', x: '1' }, 'GET');
  assert.equal(result.status, 405);
  assert.deepEqual(result.query, { x: '1' });
});

test('the audio proxy only fetches Vercel Blob URLs', async () => {
  assert.equal(isAllowedAssetUrl('https://abc.public.blob.vercel-storage.com/songs/x/a.mp3'), true);
  assert.equal(isAllowedAssetUrl('http://abc.public.blob.vercel-storage.com/songs/x/a.mp3'), false);
  assert.equal(isAllowedAssetUrl('https://169.254.169.254/latest/meta-data'), false);
  assert.equal(isAllowedAssetUrl('https://evil.example/blob.vercel-storage.com'), false);
  assert.equal((await call('/api/audio-proxy', { url: 'https://example.com/x' })).status, 400);
});
