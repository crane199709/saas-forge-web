import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createConsoleTransport } from '../src/service/forge/console';
import { SessionFailure } from '../src/runtime/console-session';

test('formal login operation owns CSRF and revision but leaves browser credentials to the browser', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.example.test/api/v2/auth/login');
    assert.equal(init.credentials, 'include');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('X-SF-CSRF'), '1');
    assert.equal(headers.get('If-Match'), '"0"');
    for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site', 'Authorization']) assert.equal(headers.get(name), null);
    assert.deepEqual(JSON.parse(String(init.body)), { email: 'admin@example.test', password: 'password' });
    return Response.json({
      sessionId: '019944ca-0000-7000-8000-000000000001',
      revision: '1',
      state: 'PASSWORD_CHANGE_REQUIRED'
    });
  });
  try {
    const result = await createConsoleTransport('https://api.example.test').login(
      'admin@example.test',
      'password',
      '0'
    );
    assert.equal(result.state, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal(result.identity, undefined);
    assert.equal(result.accessToken, undefined);
  } finally {
    request.mock.restore();
  }
});

test('refresh retains the operation key and exposes only a typed Problem code on rejection', async () => {
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Idempotency-Key'), '019944ca-0000-7000-8000-000000000003');
    assert.equal(headers.get('If-Match'), '"12"');
    return Response.json({ code: 'SESSION_COOKIE_MISMATCH' }, { status: 409 });
  });
  try {
    await assert.rejects(
      createConsoleTransport('https://api.example.test').refresh('12', '019944ca-0000-7000-8000-000000000003'),
      (error: unknown) => error instanceof SessionFailure && error.code === 'SESSION_COOKIE_MISMATCH'
    );
  } finally {
    request.mock.restore();
  }
});
