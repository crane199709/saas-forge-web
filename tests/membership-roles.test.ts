import assert from 'node:assert/strict';
import test from 'node:test';
import { createMembershipRoleApi } from '../src/service/forge/membership-roles';

const member = '019535d9-0001-7000-8000-000000000021';
const role = '019535d9-0001-7000-8000-000000000022';

test('member role changes use formal operations and only the current bearer token', async t => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({
      items: [{ roleId: role, roleKey: 'READER', systemManaged: false }]
    });
  });
  const api = createMembershipRoleApi('https://api.saas.forge.test', () => 'current-token');
  assert.equal((await api.list(member))[0]?.roleKey, 'READER');
  await api.assign(member, role);
  await api.revoke(member, role);
  assert.deepEqual(
    calls.map(call => call.init.method),
    ['GET', 'PUT', 'DELETE']
  );
  assert(
    calls.every(call =>
      call.url.endsWith(`/api/v1/members/${member}/roles${call.init.method === 'GET' ? '' : `/${role}`}`)
    )
  );
  for (const call of calls) {
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer current-token');
    assert.equal(headers.has('Cookie'), false);
    assert.equal(headers.has('Origin'), false);
    assert.equal(headers.has('Sec-Fetch-Site'), false);
  }
});
