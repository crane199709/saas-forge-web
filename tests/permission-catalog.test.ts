import assert from 'node:assert/strict';
import test from 'node:test';
import { createPermissionApi } from '../src/service/forge/permissions';

test('catalog reads the formal Gateway operation and preserves disabled entries', async t => {
  let sent: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent = init;
    return Response.json({ items: [{ code: 'example:project:list', enabled: false }] });
  });
  const api = createPermissionApi('https://api.saas.forge.test', () => 'current-token');
  assert.deepEqual(await api.list(), [{ code: 'example:project:list', enabled: false }]);
  assert.equal(new Headers(sent?.headers).get('Authorization'), 'Bearer current-token');
  assert.equal(sent?.credentials, 'omit');
  for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(new Headers(sent?.headers).has(name), false);
});

test('catalog returns a clear forbidden result and does not reuse stale successful data', async t => {
  let allowed = true;
  t.mock.method(globalThis, 'fetch', async () =>
    allowed
      ? Response.json({ items: [{ code: 'example:project:list', enabled: true }] })
      : Response.json({ code: 'PERMISSION_DENIED' }, { status: 403 })
  );
  const api = createPermissionApi('https://api.saas.forge.test', () => 'current-token');
  assert.equal((await api.list()).length, 1);
  allowed = false;
  await assert.rejects(api.list(), { code: 'forbidden' });
});
