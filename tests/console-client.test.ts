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

test('formal context selection resolves its authoritative revision without exposing browser headers', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.example.test/api/v2/auth/context-selections');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('If-Match'), '"7"');
    assert.equal(headers.get('Idempotency-Key'), '019944ca-0000-7000-8000-000000000003');
    for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site', 'Authorization']) assert.equal(headers.get(name), null);
    assert.deepEqual(JSON.parse(String(init.body)), { type: 'PLATFORM' });
    return new Response(null, { status: 204, headers: { ETag: '"9007199254740993"' } });
  });
  try {
    assert.equal(
      await createConsoleTransport('https://api.example.test').select(
        { type: 'PLATFORM' },
        '7',
        '019944ca-0000-7000-8000-000000000003'
      ),
      '9007199254740993'
    );
  } finally {
    request.mock.restore();
  }
});

test('a missing selection ETag is an unknown result and cannot be treated as the previous revision', async () => {
  const request = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  try {
    await assert.rejects(
      createConsoleTransport('https://api.example.test').select(
        { type: 'PLATFORM' },
        '7',
        '019944ca-0000-7000-8000-000000000003'
      ),
      (error: unknown) => error instanceof SessionFailure && error.code === 'SESSION_RESPONSE_INVALID'
    );
  } finally {
    request.mock.restore();
  }
});

test('initial password change uses the published v2 operation without business credentials', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.example.test/api/v2/auth/password-changes');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('If-Match'), '"1"');
    assert.equal(headers.get('X-SF-CSRF'), '1');
    assert.equal(headers.get('Idempotency-Key'), '019944ca-0000-7000-8000-000000000003');
    for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site', 'Authorization']) assert.equal(headers.get(name), null);
    assert.deepEqual(JSON.parse(String(init.body)), { newPassword: 'New-password!' });
    return new Response(null, { status: 204 });
  });
  try {
    await createConsoleTransport('https://api.example.test').changePassword(
      'New-password!',
      '1',
      '019944ca-0000-7000-8000-000000000003'
    );
  } finally {
    request.mock.restore();
  }
});
