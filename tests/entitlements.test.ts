import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createConsoleTransport } from '../src/service/forge/console';
import { EntitlementWorkspace } from '../src/service/forge/entitlements';
import type { SessionView } from '../src/runtime/console-session';

const id = '019944ca-0000-7000-8000-000000000001';
const otherId = '019944ca-0000-7000-8000-000000000002';
const key = '019944ca-0000-7000-8000-000000000003';
const operationId = '019944ca-0000-7000-8000-000000000004';
const timestamp = '2026-09-27T01:00:00Z';
const definition = { id: otherId, code: 'max_users', status: 'ACTIVE', createdAt: timestamp, updatedAt: timestamp };
const plan = {
  id,
  code: 'example',
  displayName: 'Example',
  status: 'DRAFT',
  quotaLimits: [{ quotaDefinitionId: otherId, limit: 2147483647 }],
  createdAt: timestamp,
  updatedAt: timestamp
};
const record = {
  id: operationId,
  operation: 'CREATE',
  code: 'example',
  state: 'NOT_COMMITTED',
  canReplay: true,
  createdAt: timestamp,
  replayUntil: '2099-09-28T01:00:00Z',
  idempotencyKey: key
};
const page = (items: unknown[]) => ({ items, hasMore: false, nextCursor: null });
function setup(kind: 'plan' | 'quota' = 'plan') {
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
  const workspace = new EntitlementWorkspace(kind, transport.entitlements, {
    session: {
      get state() {
        return view;
      },
      subscribe(fn) {
        listeners.add(fn);
        fn(view);
        return () => listeners.delete(fn);
      }
    },
    key: () => key
  });
  return {
    workspace,
    change(next: SessionView) {
      view = next;
      listeners.forEach(fn => fn(view));
    },
    current: () => view
  };
}

test('complete operation pagination blocks only the matching logical object', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string) =>
    Response.json(
      url.includes('cursor=next')
        ? page([{ ...record, operation: 'ACTIVATE', planId: id, code: undefined, id: otherId }])
        : { ...page([record]), hasMore: true, nextCursor: 'next' }
    )
  );
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(workspace.state.checked, true);
    assert.equal(workspace.canStart('CREATE', 'example'), false);
    assert.equal(workspace.canStart('CREATE', 'another'), true);
    assert.equal(workspace.canStart('ACTIVATE', id), false);
    assert.equal(workspace.canStart('ACTIVATE', otherId), true);
    assert.equal('idempotencyKey' in workspace.state.operations[0], false);
    assert.equal(request.mock.callCount(), 2);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('lost create response keeps the original key and recovery rechecks server authorization', async () => {
  let attempted = false;
  let posts = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('X-SF-CSRF'), '1');
    assert.equal(headers.get('Authorization'), 'Bearer test-memory-token');
    assert.equal(init.credentials, 'omit');
    for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(headers.get(name), null);
    if (url.includes('/quota-definitions')) return Response.json(page([definition]));
    if (url.includes('/plan-operations') && init.method === 'GET')
      return Response.json(url.endsWith(operationId) ? record : page(attempted ? [record] : []));
    posts += 1;
    assert.equal(headers.get('Idempotency-Key'), key);
    if (url.endsWith('/recovery')) {
      assert.deepEqual(JSON.parse(String(init.body)), {});
      return Response.json({ ...record, state: 'COMMITTED', planId: id, result: plan, canReplay: false });
    }
    assert.equal(attempted, false);
    assert.deepEqual(JSON.parse(String(init.body)), {
      code: 'example',
      displayName: 'Example',
      quotaLimits: [{ quotaDefinitionId: otherId, limit: 2147483647 }]
    });
    attempted = true;
    throw new TypeError('Lost response');
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    await workspace.createPlan('example', 'Example', '2147483647');
    await workspace.createPlan('example', 'Example', '2147483647');
    await workspace.checkOperations();
    assert.equal(workspace.canStart('CREATE', 'example'), false);
    assert.equal(workspace.canStart('CREATE', 'another'), true);
    assert.equal(await workspace.continueOperation(operationId), id);
    assert.equal(workspace.state.unknown, false);
    assert.equal(posts, 2);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

for (const broken of [
  { ...page([record]), hasMore: true, nextCursor: null },
  { ...page([record]), hasMore: true, nextCursor: 'loop' },
  page([{ ...record, idempotencyKey: undefined }]),
  page([{ ...record, operation: 'ACTIVATE', planId: undefined }]),
  page([record, record]),
  page([{ ...record, state: 'COMMITTED', planId: undefined }])
])
  test('incomplete operation pages fail closed for both new and recovery writes', async () => {
    const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      assert.equal(init.method, 'GET');
      return Response.json(broken);
    });
    const { workspace } = setup();
    try {
      await workspace.checkOperations();
      assert.equal(workspace.state.checked, false);
      assert.equal(workspace.state.operations.length, 0);
      assert.equal(workspace.canStart('CREATE', 'another'), false);
      await workspace.continueOperation(operationId);
      await workspace.createPlan('example', 'Example', '1');
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });

for (const latest of [
  { ...record, canReplay: false },
  { ...record, state: 'PROCESSING', canReplay: false },
  { ...record, state: 'UNKNOWN', canReplay: false },
  { ...record, replayUntil: timestamp },
  { ...record, idempotencyKey: otherId },
  { ...record, code: 'other-code' },
  { status: 403 }
])
  test('recovery cannot use stale permissions, another original key or another logical object', async () => {
    const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      assert.equal(init.method, 'GET');
      if (!url.endsWith(operationId)) return Response.json(page([record]));
      return 'status' in latest ? new Response(null, latest) : Response.json(latest);
    });
    const { workspace } = setup();
    try {
      await workspace.checkOperations();
      assert.equal(await workspace.continueOperation(operationId), undefined);
      assert.equal(workspace.state.checked, false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });

for (const quota of [undefined, { ...definition, status: 'DRAFT' }, { ...definition, code: 'max_users_extra' }])
  test('a missing, inactive or substring-only definition cannot create a plan', async () => {
    const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      assert.equal(init.method, 'GET');
      return Response.json(page(url.includes('/quota-definitions') && quota ? [quota] : []));
    });
    const { workspace } = setup();
    try {
      await workspace.checkOperations();
      assert.equal(await workspace.createPlan('example', 'Example', '1'), undefined);
      assert.equal(workspace.state.problem, 'definitionRequired');
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });

for (const value of ['0', '-1', '1.5', '1e3', '2147483648', '9007199254740993', ''])
  test(`plan limit ${JSON.stringify(value)} cannot send a request`, async () => {
    const request = mock.method(globalThis, 'fetch', async () => {
      throw new Error('must not fetch');
    });
    const { workspace } = setup();
    try {
      await workspace.createPlan('example', 'Example', value);
      assert.equal(request.mock.callCount(), 0);
      assert.equal(workspace.state.problem, 'input');
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });

test('quota preparation reuses exact max_users even on a later page', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET');
    if (url.includes('/quota-definition-operations')) return Response.json(page([]));
    return Response.json(
      url.includes('cursor=next')
        ? page([definition])
        : { ...page([{ ...definition, id, code: 'max_users_extra' }]), hasMore: true, nextCursor: 'next' }
    );
  });
  const { workspace } = setup('quota');
  try {
    await workspace.checkOperations();
    assert.equal(await workspace.createQuota(), otherId);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

for (const limits of [[], [{ quotaDefinitionId: otherId, limit: 0 }], [{ quotaDefinitionId: id, limit: 100 }]])
  test('missing or historical zero max_users remains readable but cannot activate', async () => {
    const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      assert.equal(init.method, 'GET');
      if (url.includes('/plan-operations')) return Response.json(page([]));
      if (url.includes('/quota-definitions')) return Response.json(page([definition]));
      return Response.json({ ...plan, quotaLimits: limits });
    });
    const { workspace } = setup();
    try {
      assert.equal((await workspace.detail(id)).id, id);
      await workspace.checkOperations();
      assert.equal(await workspace.activate(id), undefined);
      assert.equal(workspace.state.problem, 'definitionRequired');
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });

test('activation uses the matching definition ID, not the first quota in a plan', async () => {
  let posts = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.includes('/plan-operations')) return Response.json(page([]));
    if (url.includes('/quota-definitions')) return Response.json(page([definition]));
    if (init.method === 'POST') {
      posts += 1;
      return Response.json({ ...plan, status: 'ACTIVE' });
    }
    return Response.json({ ...plan, quotaLimits: [{ quotaDefinitionId: id, limit: 0 }, ...plan.quotaLimits] });
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(await workspace.activate(id), id);
    assert.equal(posts, 1);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('later page failure discards all partial recovery records', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string) =>
    url.includes('cursor=next')
      ? new Response(null, { status: 503 })
      : Response.json({ ...page([record]), hasMore: true, nextCursor: 'next' })
  );
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(workspace.state.checked, false);
    assert.deepEqual(workspace.state.operations, []);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('temporary failure and work-context switches retain unknown locks for the original actor', async () => {
  let posts = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      posts += 1;
      throw new TypeError('lost response');
    }
    return Response.json(page(url.includes('/quota-definitions') ? [definition] : []));
  });
  const { workspace, change, current } = setup();
  const authenticated = current();
  try {
    await workspace.checkOperations();
    await workspace.createPlan('example', 'Example', '1');
    change({ status: 'blocked' });
    change(authenticated);
    await workspace.checkOperations();
    await workspace.createPlan('example', 'Example', '1');
    change({
      ...authenticated,
      snapshot: { ...authenticated.snapshot!, activeContext: { type: 'TENANT', tenantId: id } }
    });
    change(authenticated);
    await workspace.checkOperations();
    await workspace.createPlan('example', 'Example', '1');
    assert.equal(posts, 1);
    assert.equal(workspace.state.unknown, true);
    change({ status: 'anonymous' });
    assert.equal(workspace.state.unknown, false);
    assert.deepEqual(workspace.state.operations, []);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('account change ignores late operation responses and clears private handles', async () => {
  let release!: (response: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => {
    started = resolve;
  });
  const request = mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise<Response>(resolve => {
        release = resolve;
        started();
      })
  );
  const { workspace, change } = setup();
  try {
    const reading = workspace.checkOperations();
    await ready;
    change({ status: 'anonymous' });
    release(Response.json(page([record])));
    await reading;
    assert.deepEqual(workspace.state.operations, []);
    assert.equal(workspace.state.checked, false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('quota creation, activation and original operation recovery use the published operations', async () => {
  let created = false;
  let activated = false;
  const quotaRecord = { ...record, code: undefined, operation: 'ACTIVATE', quotaDefinitionId: otherId };
  const paths: string[] = [];
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      paths.push(path);
      assert.equal(new Headers(init.headers).get('Idempotency-Key'), key);
      if (path.endsWith('/recovery')) {
        activated = true;
        return Response.json({ ...quotaRecord, state: 'COMMITTED', canReplay: false });
      }
      if (path.endsWith('/activations')) throw new TypeError('response lost');
      created = true;
      return Response.json({ ...definition, status: 'DRAFT' });
    }
    if (path.includes('/quota-definition-operations'))
      return Response.json(
        path.endsWith(operationId)
          ? quotaRecord
          : page(paths.some(p => p.endsWith('/activations')) ? [quotaRecord] : [])
      );
    if (path.endsWith(otherId)) return Response.json({ ...definition, status: activated ? 'ACTIVE' : 'DRAFT' });
    return Response.json(page(created ? [{ ...definition, status: 'DRAFT' }] : []));
  });
  const { workspace } = setup('quota');
  try {
    await workspace.checkOperations();
    assert.equal(await workspace.createQuota(), otherId);
    await workspace.checkOperations();
    await workspace.activate(otherId);
    await workspace.checkOperations();
    await workspace.activate(otherId);
    assert.equal(workspace.canStart('ACTIVATE', otherId), false);
    assert.equal(await workspace.continueOperation(operationId), otherId);
    assert.equal((await workspace.detail(otherId)).status, 'ACTIVE');
    assert.deepEqual(paths, [
      '/api/v1/platform/quota-definitions',
      `/api/v1/platform/quota-definitions/${otherId}/activations`,
      `/api/v1/platform/quota-definition-operations/${operationId}/recovery`
    ]);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('create preflight rechecks complete operation records immediately before writing', async () => {
  let reads = 0;
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET');
    reads += 1;
    return Response.json(page(reads === 1 ? [] : [record]));
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(workspace.canStart('CREATE', 'example'), true);
    assert.equal(await workspace.createPlan('example', 'Example', '1'), undefined);
    assert.equal(workspace.state.problem, 'pending');
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('retired plans preserve readable history without permitting activation', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET');
    return Response.json(url.includes('/plan-operations') ? page([]) : { ...plan, status: 'RETIRED' });
  });
  const { workspace } = setup();
  try {
    assert.equal((await workspace.detail(id)).status, 'RETIRED');
    await workspace.checkOperations();
    assert.equal(await workspace.activate(id), undefined);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('lost recovery response stays locked even when subsequent records are absent', async () => {
  let recoveryStarted = false;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      assert.equal(url.endsWith('/recovery'), true);
      recoveryStarted = true;
      throw new TypeError('offline');
    }
    return Response.json(url.endsWith(operationId) ? record : page(recoveryStarted ? [] : [record]));
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    await workspace.continueOperation(operationId);
    await workspace.checkOperations();
    assert.equal(workspace.canStart('CREATE', 'example'), false);
    assert.equal(workspace.state.unknown, true);
    assert.equal(workspace.canStart('CREATE', 'another'), true);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
