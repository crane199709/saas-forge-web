import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createPasswordSetup } from '../src/service/forge/password-setup';

test('Challenge exchange uses the formal anonymous operation and keeps its key after an unknown result', async () => {
  const keys: string[] = [];
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.example.test/api/v1/auth/password-setups');
    assert.equal(init.credentials, 'omit');
    const headers = new Headers(init.headers);
    for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site', 'Authorization']) assert.equal(headers.get(name), null);
    assert.equal(headers.get('X-SF-CSRF'), '1');
    keys.push(headers.get('Idempotency-Key')!);
    assert.deepEqual(JSON.parse(String(init.body)), { token: 'A'.repeat(43), newPassword: 'a-valid-password' });
    if (keys.length === 1) throw new TypeError('lost response');
    return new Response(null, { status: 204 });
  });
  try {
    const setup = createPasswordSetup('https://api.example.test', 'A'.repeat(43));
    assert.equal(await setup.submit('a-valid-password'), 'unknown');
    assert.equal(await setup.submit('a-valid-password'), 'complete');
    assert.equal(keys[0], keys[1]);
    assert.equal(await setup.submit('a-valid-password'), 'complete');
    assert.equal(keys.length, 2);
  } finally {
    request.mock.restore();
  }
});

test('invalid, expired and consumed Challenges stop further submissions', async () => {
  let calls = 0;
  const request = mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return Response.json({ code: 'PASSWORD_SETUP_TOKEN_INVALID' }, { status: 400 });
  });
  try {
    const setup = createPasswordSetup('https://api.example.test', 'A'.repeat(43));
    assert.equal(await setup.submit('a-valid-password'), 'invalid');
    assert.equal(await setup.submit('a-valid-password'), 'invalid');
    assert.equal(calls, 1);
    assert.equal(await createPasswordSetup('https://api.example.test', '').submit('a-valid-password'), 'invalid');
    assert.equal(calls, 1);
  } finally {
    request.mock.restore();
  }
});

test('leaving the page aborts its request and cannot accept a late success', async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  let started!: () => void;
  const entered = new Promise<void>(resolve => {
    started = resolve;
  });
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    signal = init.signal!;
    started();
    return new Promise<Response>(resolve => {
      finish = resolve;
    });
  });
  try {
    const setup = createPasswordSetup('https://api.example.test', 'A'.repeat(43));
    const pending = setup.submit('a-valid-password');
    await entered;
    setup.dispose();
    assert.equal(signal?.aborted, true);
    finish(new Response(null, { status: 204 }));
    assert.equal(await pending, 'invalid');
    assert.equal(setup.state, 'invalid');
  } finally {
    request.mock.restore();
  }
});

test('unknown completion cannot report a different retry password as established', async () => {
  let calls = 0;
  const request = mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('committed response lost');
    return new Response(null, { status: 204 });
  });
  try {
    const setup = createPasswordSetup('https://api.example.test', 'A'.repeat(43));
    assert.equal(await setup.submit('the-first-password'), 'unknown');
    assert.equal(await setup.submit('a-different-password'), 'unknown');
    assert.equal(calls, 1);
    assert.equal(await setup.submit('the-first-password'), 'complete');
  } finally {
    request.mock.restore();
  }
});
