import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createConsoleTransport } from '../src/service/forge/console';
import { TenantWorkspace } from '../src/service/forge/tenants';
import type { SessionView } from '../src/runtime/console-session';

const key = '019944ca-0000-7000-8000-000000000003';
const tenantId = '019944ca-0000-7000-8000-000000000004';
const creationId = '019944ca-0000-7000-8000-000000000005';
const tenant = {
  id: tenantId,
  displayName: 'Example',
  status: 'PENDING',
  expiresAt: null,
  createdAt: '2026-09-27T01:00:00Z',
  updatedAt: '2026-09-27T01:00:00Z'
};
const record = {
  id: creationId,
  displayName: 'Example',
  state: 'NOT_COMMITTED',
  canReplay: true,
  createdAt: '2026-09-27T01:00:00Z',
  replayUntil: '2099-09-28T01:00:00Z',
  idempotencyKey: key
};
function setup() {
  let view = {
    status: 'authenticated',
    snapshot: {
      sessionId: 'session-a',
      revision: '1',
      state: 'AUTHENTICATED',
      identity: { identityId: 'actor-a', email: 'actor@example.test' },
      activeContext: { type: 'PLATFORM' }
    }
  } as SessionView;
  const listeners = new Set<(state: SessionView) => void>();
  const transport = createConsoleTransport('https://api.example.test');
  transport.useToken('test-memory-token');
  const workspace = new TenantWorkspace(
    transport.tenants,
    {
      get state() {
        return view;
      },
      subscribe(fn) {
        listeners.add(fn);
        fn(view);
        return () => listeners.delete(fn);
      }
    },
    () => key
  );
  return {
    workspace,
    change(next: SessionView) {
      view = next;
      listeners.forEach(fn => fn(view));
    }
  };
}

test('unknown creation stays locked and continues only the authoritative original operation', async () => {
  let attempted = false;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-memory-token');
    assert.equal(init.credentials, 'omit');
    for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(headers.get(name), null);
    if (url.includes('/tenant-creations') && init.method === 'GET') {
      return Response.json(
        url.endsWith(creationId) ? record : { items: attempted ? [record] : [], hasMore: false, nextCursor: null }
      );
    }
    if (url.endsWith('/recovery')) {
      assert.equal(headers.get('Idempotency-Key'), key);
      assert.deepEqual(JSON.parse(String(init.body)), {});
      return Response.json({ ...record, state: 'COMMITTED', canReplay: false, tenantId });
    }
    assert.equal(url, 'https://api.example.test/api/v1/platform/tenants');
    assert.equal(attempted, false, 'a second create must never reach the server');
    assert.equal(headers.get('Idempotency-Key'), key);
    attempted = true;
    throw new TypeError('Lost response');
  });
  const { workspace } = setup();
  try {
    await workspace.checkCreations();
    assert.equal(workspace.state.canCreate, true);
    await workspace.create('Example');
    assert.equal(workspace.state.unknown, true);
    await workspace.create('Example');
    await workspace.checkCreations();
    assert.equal(workspace.state.canCreate, false);
    assert.equal('idempotencyKey' in workspace.state.creations[0], false);
    assert.equal(await workspace.continueCreation(creationId), tenantId);
    assert.equal(workspace.state.unknown, false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

for (const broken of [
  { items: [record], hasMore: true, nextCursor: null },
  { items: [{ ...record, idempotencyKey: undefined }], hasMore: false, nextCursor: null },
  { items: [{ ...record, state: 'COMMITTED', tenantId: undefined }], hasMore: false, nextCursor: null },
  { items: [record], hasMore: true, nextCursor: 'repeated' }
])
  test('incomplete creation pages never authorize a create or recovery', async () => {
    const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      assert.equal(init.method, 'GET', 'invalid records must never produce a write');
      return Response.json(broken);
    });
    const { workspace } = setup();
    try {
      await workspace.checkCreations();
      assert.equal(workspace.state.checked, false);
      assert.equal(workspace.state.canCreate, false);
      await workspace.continueCreation(creationId);
      await workspace.create('Example');
      assert.equal(workspace.state.creations.length, 0);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });

test('a later page failure discards earlier recovery permission', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET');
    return url.includes('cursor=next')
      ? new Response(null, { status: 503 })
      : Response.json({ items: [record], hasMore: true, nextCursor: 'next' });
  });
  const { workspace } = setup();
  try {
    await workspace.checkCreations();
    assert.equal(workspace.state.checked, false);
    assert.equal(workspace.state.creations.length, 0);
    await workspace.continueCreation(creationId);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('account changes discard private handles and ignore a late response', async () => {
  let release!: (response: Response) => void;
  let pending = false;
  let started!: () => void;
  const fetched = new Promise<void>(resolve => {
    started = resolve;
  });
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET');
    if (pending)
      return new Promise<Response>(resolve => {
        release = resolve;
        started();
      });
    return Response.json({ items: [record], hasMore: false, nextCursor: null });
  });
  const { workspace, change } = setup();
  try {
    await workspace.checkCreations();
    pending = true;
    const reading = workspace.checkCreations();
    await fetched;
    change({ status: 'anonymous' });
    release(Response.json({ items: [record], hasMore: false, nextCursor: null }));
    await reading;
    assert.deepEqual(workspace.state.creations, []);
    assert.equal(workspace.state.canCreate, false);
    await workspace.continueCreation(creationId);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('a missing authoritative record does not unlock an unknown creation', async () => {
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') throw new TypeError('offline');
    return Response.json({ items: [], hasMore: false, nextCursor: null });
  });
  const { workspace } = setup();
  try {
    await workspace.checkCreations();
    await workspace.create('Example');
    await workspace.checkCreations();
    assert.equal(workspace.state.canCreate, false);
    assert.equal(workspace.state.unknown, true);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('tenant filters and detail preserve IDs and instants through the published client', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.includes('?')) {
      const query = new URL(url).searchParams;
      assert.equal(query.get('name'), '百分%_');
      assert.equal(query.get('status'), 'PENDING');
      assert.equal(query.get('cursor'), 'cursor-2');
      return Response.json({ items: [tenant], hasMore: false, nextCursor: null });
    }
    return Response.json(tenant);
  });
  const { workspace } = setup();
  try {
    const page = await workspace.list({ name: '百分%_', status: 'PENDING', cursor: 'cursor-2', limit: 20 });
    assert.equal(page.items[0].id, tenantId);
    assert.equal((await workspace.detail(tenantId)).createdAt.toISOString(), '2026-09-27T01:00:00.000Z');
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('committed records remain readable when the server still permits replay within retention', async () => {
  const request = mock.method(globalThis, 'fetch', async () =>
    Response.json({
      items: [{ ...record, state: 'COMMITTED', tenantId }],
      hasMore: false,
      nextCursor: null
    })
  );
  const { workspace } = setup();
  try {
    await workspace.checkCreations();
    assert.equal(workspace.state.checked, true);
    assert.equal(workspace.state.canCreate, true);
    assert.equal(workspace.state.creations[0].tenantId, tenantId);
    assert.equal(workspace.state.creations[0].canReplay, false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

for (const latest of [
  { ...record, state: 'PROCESSING', canReplay: false },
  { ...record, state: 'UNKNOWN', canReplay: false },
  { ...record, replayUntil: '2000-01-01T00:00:00Z' },
  { ...record, idempotencyKey: '019944ca-0000-7000-8000-000000000099' }
])
  test('recovery rechecks permission and original identity before sending a write', async () => {
    const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      assert.equal(init.method, 'GET', 'stale permission cannot authorize a recovery write');
      return Response.json(url.endsWith(creationId) ? latest : { items: [record], hasMore: false, nextCursor: null });
    });
    const { workspace } = setup();
    try {
      await workspace.checkCreations();
      assert.equal(await workspace.continueCreation(creationId), undefined);
      assert.equal(workspace.state.canCreate, false);
      assert.equal(workspace.state.checked, false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });

test('incomplete tenant records cannot be rendered as authoritative details', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ ...tenant, status: undefined }));
  const { workspace } = setup();
  try {
    await assert.rejects(workspace.detail(tenantId), { code: 'invalid' });
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('temporary session failure cannot unlock an unknown create for the same actor', async () => {
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      writes += 1;
      throw new TypeError('lost response');
    }
    return Response.json({ items: [], hasMore: false, nextCursor: null });
  });
  const { workspace, change } = setup();
  try {
    await workspace.checkCreations();
    await workspace.create('Example');
    change({ status: 'blocked' });
    change({
      status: 'authenticated',
      snapshot: {
        sessionId: 'session-a',
        revision: '2',
        state: 'AUTHENTICATED',
        identity: { identityId: 'actor-a', email: 'actor@example.test' },
        activeContext: { type: 'PLATFORM' }
      }
    });
    await workspace.checkCreations();
    await workspace.create('Example');
    assert.equal(writes, 1);
    assert.equal(workspace.state.canCreate, false);
    assert.equal(workspace.state.unknown, true);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
