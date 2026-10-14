import assert from 'node:assert/strict';
import test from 'node:test';
import { createTenantRoleApi } from '../src/service/forge/tenant-roles';

test('role management uses formal operations without browser security header parameters', async t => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (init.method === 'POST')
      return Response.json(
        {
          id: '0199a4c1-0000-7000-8000-000000000001',
          roleKey: 'REPORT_READER',
          systemManaged: false,
          permissions: ['example:project:list'],
          assignedMembers: 0
        },
        { status: 201 }
      );
    return Response.json({ items: [] });
  });
  const api = createTenantRoleApi('https://api.saas.forge.test', () => 'current-token');
  assert.deepEqual(await api.list(), []);
  const created = await api.create({ roleKey: 'REPORT_READER', permissions: ['example:project:list'] });
  assert.equal(created.roleKey, 'REPORT_READER');
  assert.equal(calls[1].url, 'https://api.saas.forge.test/api/v1/tenant-roles');
  assert.equal(new Headers(calls[1].init.headers).get('Authorization'), 'Bearer current-token');
  for (const header of ['Cookie', 'Origin', 'Sec-Fetch-Site']) {
    assert.equal(new Headers(calls[1].init.headers).has(header), false);
  }
});
