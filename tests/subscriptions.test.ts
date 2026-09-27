import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createConsoleTransport } from '../src/service/forge/console';
import { SubscriptionWorkspace } from '../src/service/forge/subscriptions';
import { EntitlementWorkspace } from '../src/service/forge/entitlements';
import { TenantWorkspace } from '../src/service/forge/tenants';
import type { SessionView } from '../src/runtime/console-session';

const tenantId = '019944ca-0000-7000-8000-000000000001';
const planId = '019944ca-0000-7000-8000-000000000002';
const quotaId = '019944ca-0000-7000-8000-000000000003';
const key = '019944ca-0000-7000-8000-000000000004';
const operationId = '019944ca-0000-7000-8000-000000000005';
const subscriptionId = '019944ca-0000-7000-8000-000000000006';
const at = '2026-09-27T01:00:00Z';
const tenant = {
  id: tenantId,
  displayName: 'Example',
  status: 'PENDING',
  expiresAt: null,
  createdAt: at,
  updatedAt: at
};
const definition = { id: quotaId, code: 'max_users', status: 'ACTIVE', createdAt: at, updatedAt: at };
const plan = {
  id: planId,
  code: 'example',
  displayName: 'Example plan',
  status: 'ACTIVE',
  quotaLimits: [{ quotaDefinitionId: quotaId, limit: 2147483647 }],
  createdAt: at,
  updatedAt: at
};
const absent = { observedAt: at, subscription: null, effective: false, maxUsersLimit: null, maxUsersUsed: null };
const subscription = { id: subscriptionId, tenantId, planId, status: 'ACTIVE', endsAt: null, createdAt: at };
const present = { ...absent, subscription, effective: true, maxUsersLimit: 2147483647, maxUsersUsed: 0 };
const record = {
  id: operationId,
  tenantId,
  state: 'NOT_COMMITTED',
  canReplay: true,
  idempotencyKey: key,
  createdAt: at,
  replayUntil: '2099-01-01T00:00:00Z'
};
const page = (items: unknown[]) => ({ items, hasMore: false, nextCursor: null });
function setup() {
  let view = {
    status: 'authenticated',
    snapshot: {
      sessionId: 'session-a',
      revision: '1',
      identity: { identityId: 'actor-a' },
      activeContext: { type: 'PLATFORM' }
    }
  } as SessionView;
  const listeners = new Set<(state: SessionView) => void>();
  const session = {
    get state() {
      return view;
    },
    subscribe(fn: (state: SessionView) => void) {
      listeners.add(fn);
      fn(view);
      return () => listeners.delete(fn);
    }
  };
  const transport = createConsoleTransport('https://api.example.test');
  transport.useToken('memory-only');
  const tenants = new TenantWorkspace(transport.tenants, session, () => key);
  const plans = new EntitlementWorkspace('plan', transport.entitlements, { session, key: () => key });
  const workspace = new SubscriptionWorkspace(transport.entitlements, { session, key: () => key, tenants, plans });
  return {
    workspace,
    current: () => view,
    change(next: SessionView) {
      view = next;
      listeners.forEach(fn => fn(view));
    },
    dispose() {
      workspace.dispose();
      plans.dispose();
      tenants.dispose();
    }
  };
}
function base(url: string) {
  if (url.includes('/subscription-operations')) return page([]);
  if (url.endsWith('/subscription')) return absent;
  if (url.includes('/quota-definitions')) return page([definition]);
  if (url.endsWith(`/plans/${planId}`)) return plan;
  if (url.includes('/plans')) return page([plan]);
  if (url.endsWith(`/tenants/${tenantId}`)) return tenant;
  throw new Error(`Unexpected URL ${url}`);
}
test('reads authoritative absence and only offers active positive max_users plans', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string) => Response.json(base(url)));
  const context = setup();
  try {
    await context.workspace.read(tenantId);
    const initialSubscription = context.workspace.state.snapshot?.subscription;
    assert.equal(initialSubscription, null);
    assert.deepEqual(
      context.workspace.state.plans.map(row => row.id),
      [planId]
    );
    assert.equal(context.workspace.canCreate(tenantId), true);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});

test('unknown submission locks new writes and resumes only the original authorized operation', async () => {
  let attempted = false;
  let committed = false;
  let posts = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      posts += 1;
      assert.equal(new Headers(init.headers).get('Idempotency-Key'), key);
      if (url.endsWith('/recovery')) {
        committed = true;
        return Response.json({ ...record, state: 'COMMITTED', subscriptionId, canReplay: false });
      }
      attempted = true;
      assert.deepEqual(JSON.parse(String(init.body)), { planId, endsAt: null });
      throw new TypeError('Lost response');
    }
    if (url.includes('/subscription-operations')) {
      const value = committed ? { ...record, state: 'COMMITTED', subscriptionId, canReplay: false } : record;
      return Response.json(url.endsWith(operationId) ? value : page(attempted ? [value] : []));
    }
    return Response.json(url.endsWith('/subscription') && committed ? present : base(url));
  });
  const context = setup();
  try {
    const { workspace } = context;
    await workspace.read(tenantId);
    await workspace.create(tenantId, planId, null);
    await workspace.create(tenantId, planId, null);
    assert.equal(workspace.state.unknown, true);
    await workspace.read(tenantId);
    assert.equal(workspace.canCreate(tenantId), false);
    assert.equal('idempotencyKey' in workspace.state.operations[0], false);
    await workspace.continueOperation(operationId);
    assert.equal(workspace.state.snapshot?.subscription?.id, subscriptionId);
    assert.equal(workspace.state.unknown, false);
    assert.equal(posts, 2);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});

for (const broken of [
  { ...page([record]), hasMore: true, nextCursor: null },
  { ...page([record]), hasMore: true, nextCursor: 'loop' },
  page([record, record]),
  page([{ ...record, tenantId: planId }]),
  page([{ ...record, idempotencyKey: undefined }]),
  page([{ ...record, state: 'COMMITTED', subscriptionId: undefined }])
])
  test('incomplete or invalid operation records never authorize a write', async () => {
    const request = mock.method(globalThis, 'fetch', async (url: string) =>
      Response.json(url.includes('/subscription-operations') ? broken : base(url))
    );
    const context = setup();
    try {
      await context.workspace.read(tenantId);
      assert.equal(context.workspace.state.checked, false);
      assert.equal(context.workspace.canCreate(tenantId), false);
    } finally {
      context.dispose();
      request.mock.restore();
    }
  });

test('read failure preserves the successful snapshot and disables dependent writes', async () => {
  let failed = false;
  const request = mock.method(globalThis, 'fetch', async (url: string) => {
    if (failed && url.endsWith('/subscription')) throw new TypeError('offline');
    return Response.json(base(url));
  });
  const context = setup();
  try {
    await context.workspace.read(tenantId);
    const snapshot = context.workspace.state.snapshot;
    failed = true;
    await context.workspace.read(tenantId);
    assert.equal(context.workspace.state.snapshot, snapshot);
    assert.equal(context.workspace.canCreate(tenantId), false);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});

for (const invalidPlan of [
  { ...plan, status: 'DRAFT' },
  { ...plan, quotaLimits: [{ quotaDefinitionId: quotaId, limit: 0 }] },
  { ...plan, quotaLimits: [{ quotaDefinitionId: planId, limit: 10 }] }
])
  test('ineligible plans cannot be selected or submitted', async () => {
    const request = mock.method(globalThis, 'fetch', async (url: string) =>
      Response.json(url.includes('/plans') ? page([invalidPlan]) : base(url))
    );
    const context = setup();
    try {
      await context.workspace.read(tenantId);
      assert.deepEqual(context.workspace.state.plans, []);
      assert.equal(context.workspace.canCreate(tenantId), false);
    } finally {
      context.dispose();
      request.mock.restore();
    }
  });

for (const endsAt of [new Date('2020-01-01T00:00:00Z'), new Date('invalid')])
  test('past or invalid expiry is rejected before mutation', async () => {
    let posts = 0;
    const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      if (init.method === 'POST') posts += 1;
      return Response.json(base(url));
    });
    const context = setup();
    try {
      await context.workspace.read(tenantId);
      assert.equal(await context.workspace.create(tenantId, planId, endsAt), false);
      assert.equal(posts, 0);
    } finally {
      context.dispose();
      request.mock.restore();
    }
  });

for (const changed of [
  { ...record, canReplay: false },
  { ...record, idempotencyKey: planId },
  { ...record, replayUntil: '2020-01-01T00:00:00Z' },
  { ...record, tenantId: planId }
])
  test('recovery rechecks original key, actor authorization, tenant and expiry', async () => {
    let checking = false;
    let posts = 0;
    const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      if (init.method === 'POST') posts += 1;
      if (url.includes('/subscription-operations'))
        return Response.json(url.endsWith(operationId) ? changed : page([checking ? changed : record]));
      return Response.json(base(url));
    });
    const context = setup();
    try {
      await context.workspace.read(tenantId);
      checking = true;
      await context.workspace.continueOperation(operationId);
      assert.equal(posts, 0);
      assert.equal(context.workspace.state.checked, false);
    } finally {
      context.dispose();
      request.mock.restore();
    }
  });

test('changing actor clears private materials and prevents old recovery', async () => {
  let posts = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') posts += 1;
    return Response.json(url.includes('/subscription-operations') ? page([record]) : base(url));
  });
  const context = setup();
  try {
    await context.workspace.read(tenantId);
    context.change({
      ...context.current(),
      snapshot: { ...context.current().snapshot!, identity: { identityId: 'actor-b', email: 'b@example.test' } }
    });
    assert.equal(context.workspace.state.snapshot, undefined);
    assert.deepEqual(context.workspace.state.operations, []);
    await context.workspace.continueOperation(operationId);
    assert.equal(posts, 0);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});

test('expiry input requires an explicit timezone and a real future calendar date', async () => {
  const { parseSubscriptionExpiry } = await import('../src/service/forge/subscriptions');
  assert.equal(parseSubscriptionExpiry(''), null);
  assert.equal(parseSubscriptionExpiry('2099-01-01T08:00:00+08:00')?.toISOString(), '2099-01-01T00:00:00.000Z');
  for (const value of ['2099-01-01T08:00', '2099-02-30T08:00:00Z', '2020-01-01T00:00:00Z', 'invalid'])
    assert.equal(parseSubscriptionExpiry(value), undefined);
});

test('successful write is followed by authoritative read, with timezone preserved as an instant', async () => {
  let committed = false;
  const endsAt = new Date('2099-01-01T08:00:00+08:00');
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      assert.equal(init.credentials, 'omit');
      const headers = new Headers(init.headers);
      for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(headers.get(name), null);
      assert.equal(headers.get('Authorization'), 'Bearer memory-only');
      assert.equal(headers.get('X-SF-CSRF'), '1');
      assert.deepEqual(JSON.parse(String(init.body)), { planId, endsAt: '2099-01-01T00:00:00.000Z' });
      committed = true;
      return Response.json({ ...subscription, endsAt });
    }
    if (committed && url.endsWith('/subscription'))
      return Response.json({ ...present, subscription: { ...subscription, endsAt } });
    return Response.json(base(url));
  });
  const context = setup();
  try {
    await context.workspace.read(tenantId);
    assert.equal(await context.workspace.create(tenantId, planId, endsAt), true);
    assert.equal(context.workspace.state.snapshot?.subscription?.endsAt?.toISOString(), '2099-01-01T00:00:00.000Z');
    assert.equal(context.workspace.canCreate(tenantId), false);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});

test('a failed page after a successful first operation page does not release partial recovery materials', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.includes('cursor=next')) throw new TypeError('offline');
    return Response.json(
      url.includes('/subscription-operations') ? { ...page([record]), hasMore: true, nextCursor: 'next' } : base(url)
    );
  });
  const context = setup();
  try {
    await context.workspace.read(tenantId);
    assert.deepEqual(context.workspace.state.operations, []);
    assert.equal(context.workspace.state.checked, false);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});

test('same actor interruption retains unknown lock even if the operation record is missing', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') throw new TypeError('offline');
    return Response.json(base(url));
  });
  const context = setup();
  try {
    const original = context.current();
    await context.workspace.read(tenantId);
    await context.workspace.create(tenantId, planId, null);
    context.change({ status: 'blocked' });
    context.change(original);
    await context.workspace.read(tenantId);
    assert.equal(context.workspace.state.unknown, true);
    assert.equal(context.workspace.canCreate(tenantId), false);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});

test('a late response from another actor cannot publish an old subscription snapshot', async () => {
  let resolve!: (response: Response) => void;
  let entered!: () => void;
  const ready = new Promise<void>(done => {
    entered = done;
  });
  const request = mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/subscription')) {
      entered();
      return new Promise<Response>(done => {
        resolve = done;
      });
    }
    return Response.json(base(url));
  });
  const context = setup();
  try {
    const read = context.workspace.read(tenantId);
    await ready;
    context.change({
      ...context.current(),
      snapshot: { ...context.current().snapshot!, identity: { identityId: 'actor-b', email: 'b@example.test' } }
    });
    resolve(Response.json(present));
    await read;
    assert.equal(context.workspace.state.snapshot, undefined);
    assert.equal(context.workspace.state.checked, false);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});

test('plan outage preserves authoritative subscription and does not prevent original-operation recovery', async () => {
  let committed = false;
  let posts = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.includes('/plans') || url.includes('/quota-definitions')) throw new TypeError('plan service unavailable');
    if (init.method === 'POST') {
      posts += 1;
      committed = true;
      return Response.json({ ...record, state: 'COMMITTED', subscriptionId, canReplay: false });
    }
    if (url.includes('/subscription-operations')) {
      const row = committed ? { ...record, state: 'COMMITTED', subscriptionId, canReplay: false } : record;
      return Response.json(url.endsWith(operationId) ? row : page([row]));
    }
    return Response.json(url.endsWith('/subscription') && committed ? present : base(url));
  });
  const context = setup();
  try {
    await context.workspace.read(tenantId);
    const initialSubscription = context.workspace.state.snapshot?.subscription;
    assert.equal(initialSubscription, null);
    assert.equal(context.workspace.state.operations.length, 1);
    assert.equal(context.workspace.canCreate(tenantId), false);
    assert.equal(await context.workspace.continueOperation(operationId), true);
    assert.equal(context.workspace.state.snapshot?.subscription?.id, subscriptionId);
    assert.equal(posts, 1);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});

test('a confirmed write followed by failed readback marks the old absence snapshot stale', async () => {
  let committed = false;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      committed = true;
      return Response.json(subscription);
    }
    if (committed && url.endsWith('/subscription')) throw new TypeError('readback offline');
    return Response.json(base(url));
  });
  const context = setup();
  try {
    await context.workspace.read(tenantId);
    await context.workspace.create(tenantId, planId, null);
    assert.equal(context.workspace.state.snapshotChecked, false);
    assert.equal(context.workspace.state.unknown, true);
    assert.equal(context.workspace.canCreate(tenantId), false);
  } finally {
    context.dispose();
    request.mock.restore();
  }
});
