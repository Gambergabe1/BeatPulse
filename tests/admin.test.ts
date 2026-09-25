import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminToken, createPasswordHash, resolveAdminState, verifyAdminToken, verifyPassword } from '../serverless/lib/admin.ts';

test('a stored hash of the old public default password is discarded and the secret rotated', () => {
  const { state, repaired } = resolveAdminState({ row_ref: '(0,1)', password_hash: createPasswordHash('admin1234'), token_secret: 'old-secret' }, null);
  assert.equal(repaired, true);
  assert.equal(verifyPassword('admin1234', state.passwordHash), false);
  assert.notEqual(state.tokenSecret, 'old-secret');
});

test('without ADMIN_PASSWORD a missing hash becomes an unguessable lock', () => {
  const { state } = resolveAdminState({ row_ref: '(0,1)', password_hash: null, token_secret: 'secret' }, null);
  for (const guess of ['', 'admin', 'admin1234', 'password']) assert.equal(verifyPassword(guess, state.passwordHash), false);
});

test('a password set from the admin panel is kept', () => {
  const hash = createPasswordHash('correct horse battery');
  const { state, repaired } = resolveAdminState({ row_ref: '(0,1)', password_hash: hash, token_secret: 'secret' }, null);
  assert.equal(repaired, false);
  assert.equal(state.passwordHash, hash);
  assert.equal(state.tokenSecret, 'secret');
});

test('ADMIN_PASSWORD overrides the stored hash so operators can recover access', () => {
  const { state, repaired } = resolveAdminState({ row_ref: '(0,1)', password_hash: createPasswordHash('forgotten-pass'), token_secret: 'secret' }, 'recovery-pass');
  assert.equal(repaired, true);
  assert.equal(verifyPassword('recovery-pass', state.passwordHash), true);
});

test('admin tokens verify only with their own secret', () => {
  const token = createAdminToken('secret-a');
  assert.equal(verifyAdminToken(token, 'secret-a'), true);
  assert.equal(verifyAdminToken(token, 'secret-b'), false);
  assert.equal(verifyAdminToken('garbage', 'secret-a'), false);
});
