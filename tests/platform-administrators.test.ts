import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlatformAdminApi } from '../src/service/forge/platform-administrators';

test('platform administrator grant uses the formal operation and browser owned security headers', async t => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (init.method === 'POST')
      return Response.json({
        identityId: '0198c9d5-0f25-7b21-8d67-31c8652d4c91',
        roleAssignmentId: '0198c9d5-0f25-7b21-8d67-31c8652d4c92',
        newlyGranted: true,
        setupState: 'DELIVERED'
      });
    return Response.json({ items: [] });
  });
  const api = createPlatformAdminApi('https://api.saas.forge.test', () => 'current-token');
  assert.deepEqual(await api.list(), []);
  const result = await api.grant('admin@example.test', '0198c9d5-0f25-7b21-8d67-31c8652d4c90');
  assert.equal(result.setupState, 'DELIVERED');
  assert.equal(calls[1].url, 'https://api.saas.forge.test/api/v1/platform/administrators');
  const headers = new Headers(calls[1].init.headers);
  assert.equal(headers.get('Authorization'), 'Bearer current-token');
  assert.equal(headers.get('Idempotency-Key'), '0198c9d5-0f25-7b21-8d67-31c8652d4c90');
  for (const header of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(headers.has(header), false);
});

test('platform administrator revocation uses exact identity and idempotency key', async t => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  });
  const api = createPlatformAdminApi('https://api.saas.forge.test', () => 'current-token');
  await api.revoke('0198c9d5-0f25-7b21-8d67-31c8652d4c91', '0198c9d5-0f25-7b21-8d67-31c8652d4c90');
  assert.equal(calls[0].url, 'https://api.saas.forge.test/api/v1/platform/administrators/0198c9d5-0f25-7b21-8d67-31c8652d4c91');
  assert.equal(calls[0].init.method, 'DELETE');
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('Idempotency-Key'), '0198c9d5-0f25-7b21-8d67-31c8652d4c90');
  for (const header of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(headers.has(header), false);
});
