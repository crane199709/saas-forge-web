import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createPasswordRecovery } from '../src/service/forge/password-recovery';

test('recovery request uses the anonymous formal operation and returns uniform feedback', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.example.test/api/v2/auth/password-recovery-requests');
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('X-SF-CSRF'), '1');
    assert.deepEqual(JSON.parse(String(init.body)), { email: 'person@example.test' });
    return Response.json({ status: 'ACCEPTED' }, { status: 202 });
  });
  try {
    const recovery = createPasswordRecovery('https://api.example.test', '');
    assert.equal(await recovery.request('person@example.test'), 'requested');
  } finally {
    request.mock.restore();
  }
});

test('one link continues pending revocation without treating it as success', async () => {
  let calls = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.example.test/api/v2/auth/password-recoveries');
    assert.equal(init.credentials, 'omit');
    assert.deepEqual(JSON.parse(String(init.body)), {
      token: 'A'.repeat(43),
      newPassword: 'New-password-2026'
    });
    calls += 1;
    return Response.json({ status: calls === 1 ? 'PENDING' : 'COMPLETED' }, { status: calls === 1 ? 202 : 200 });
  });
  try {
    const recovery = createPasswordRecovery('https://api.example.test', 'A'.repeat(43));
    assert.equal(await recovery.redeem('New-password-2026'), 'pending');
    assert.equal(await recovery.redeem('New-password-2026'), 'complete');
    assert.equal(await recovery.redeem('New-password-2026'), 'complete');
    assert.equal(calls, 2);
  } finally {
    request.mock.restore();
  }
});

test('an unknown first redemption cannot claim that another password was established', async () => {
  let calls = 0;
  const request = mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('response lost');
    return Response.json({ status: 'COMPLETED' });
  });
  try {
    const recovery = createPasswordRecovery('https://api.example.test', 'A'.repeat(43));
    assert.equal(await recovery.redeem('First-password-2026'), 'unknown');
    assert.equal(await recovery.redeem('Other-password-2026'), 'unknown');
    assert.equal(calls, 1);
    assert.equal(await recovery.redeem('First-password-2026'), 'complete');
  } finally {
    request.mock.restore();
  }
});
