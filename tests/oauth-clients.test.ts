import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createConsoleTransport } from '../src/service/forge/console';
import { OAuthWorkspace } from '../src/service/forge/oauth-clients';
import type { SessionView } from '../src/runtime/console-session';

const id = '019944ca-0000-7000-8000-000000000001';
const key = '019944ca-0000-7000-8000-000000000002';
const timestamp = '2026-09-27T01:00:00Z';
const client = {
  clientId: id,
  displayName: 'Receiver',
  allowedScopes: ['runtime:read'],
  status: 'ACTIVE',
  clientType: 'RUNTIME_SERVICE',
  createdAt: timestamp,
  updatedAt: timestamp
};
const page = (items: unknown[]) => ({ items, hasMore: false, nextCursor: null });
function setup(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  let state = {
    status: 'authenticated',
    snapshot: { sessionId: 'a', revision: '1', identity: { identityId: 'actor' }, activeContext: { type: 'PLATFORM' } }
  } as SessionView;
  const listeners = new Set<(value: SessionView) => void>();
  let keyCount = 0;
  const transport = createConsoleTransport('https://api.example.test');
  transport.useToken('test-token');
  const workspace = new OAuthWorkspace(transport.oauth, {
    session: {
      get state() {
        return state;
      },
      subscribe(fn) {
        listeners.add(fn);
        fn(state);
        return () => listeners.delete(fn);
      }
    },
    key: () => {
      keyCount += 1;
      return keyCount === 1 ? key : `019944ca-0000-7000-8000-${String(keyCount + 10).padStart(12, '0')}`;
    },
    storage
  });
  return {
    workspace,
    change(value: SessionView) {
      state = value;
      listeners.forEach(fn => fn(state));
    },
    current: () => state
  };
}
test('lost create response blocks replacement even when the name changes and the journal is empty', async () => {
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(page([]));
    writes += 1;
    assert.equal(new Headers(init.headers).get('Idempotency-Key'), key);
    throw new TypeError('Lost response');
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    await workspace.create('Receiver', ['runtime:read']);
    await workspace.checkOperations();
    await workspace.create('Replacement', ['runtime:read']);
    assert.equal(writes, 1);
    assert.equal(workspace.state.pending[0].displayName, 'Receiver');
    assert.equal(workspace.state.secret, undefined);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('Secret is shown only for a valid successful issuance and cleared on close or session change', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-token');
    assert.equal(headers.get('X-SF-CSRF'), '1');
    assert.equal(init.credentials, 'omit');
    for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(headers.has(name), false);
    if (url.includes('operations')) return Response.json(page([]));
    return Response.json({ ...client, clientSecret: 'test-only-secret' }, { status: 201 });
  });
  const { workspace, change } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(await workspace.create('Receiver', ['runtime:read']), true);
    assert.equal(workspace.state.secret?.value, 'test-only-secret');
    workspace.clearSecret();
    assert.equal(workspace.state.secret, undefined);
    await workspace.checkOperations();
    await workspace.create('Receiver', ['runtime:read']);
    change({ status: 'anonymous' });
    assert.equal(workspace.state.secret, undefined);
    assert.deepEqual(workspace.state.pending, []);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('an unexpected successful HTTP status cannot reveal a Secret', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string) =>
    url.includes('operations')
      ? Response.json(page([]))
      : Response.json({ ...client, clientSecret: 'test-only-secret' }, { status: 202 })
  );
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(await workspace.create('Receiver', ['runtime:read']), false);
    assert.equal(workspace.state.secret, undefined);
    assert.equal(workspace.state.pending.length, 1);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

for (const broken of [
  { items: [], hasMore: true, nextCursor: null },
  { items: [{}], hasMore: false, nextCursor: null }
]) {
  test('incomplete operation history fails closed', async () => {
    const request = mock.method(globalThis, 'fetch', async () => Response.json(broken));
    const { workspace } = setup();
    try {
      await workspace.checkOperations();
      assert.equal(workspace.state.checked, false);
      assert.equal(workspace.canStart('CREATE', 'Receiver'), false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });
}
test('late issuance after leaving or logout cannot reveal a Secret', async () => {
  let resolve!: (value: Response) => void;
  const request = mock.method(globalThis, 'fetch', async (url: string) =>
    url.includes('operations')
      ? Response.json(page([]))
      : new Promise<Response>(done => {
          resolve = done;
        })
  );
  const { workspace, change } = setup();
  try {
    await workspace.checkOperations();
    const pending = workspace.create('Receiver', ['runtime:read']);
    await new Promise<void>(done => {
      setImmediate(done);
    });
    workspace.clearSecret();
    change({ status: 'anonymous' });
    resolve(Response.json({ ...client, clientSecret: 'test-only-secret' }, { status: 201 }));
    assert.equal(await pending, false);
    assert.equal(workspace.state.secret, undefined);
    assert.deepEqual(workspace.state.pending, []);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
test('rotation uses server permission, preserves overlap time, and never enables from local clock', async () => {
  let rotate = false;
  let writes = 0;
  const overlap = '2020-01-01T00:00:00Z';
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.includes('operations')) return Response.json(page([]));
    if (url.endsWith('credential-status'))
      return Response.json({ clientId: id, canRotate: rotate, canRevoke: true, overlapEndsAt: overlap });
    if (init.method === 'GET') return Response.json(client);
    writes += 1;
    return Response.json({ ...client, clientSecret: 'test-only-secret' });
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    assert.equal((await workspace.detail(id)).credentials.overlapEndsAt?.toISOString(), '2020-01-01T00:00:00.000Z');
    assert.equal(await workspace.rotate(id, 'Receiver'), false);
    assert.equal(writes, 0);
    rotate = true;
    await workspace.checkOperations();
    assert.equal(await workspace.rotate(id, 'Receiver'), true);
    assert.equal(writes, 1);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
test('service denial never reveals response contents and tenant context cannot write', async () => {
  const request = mock.method(globalThis, 'fetch', async () =>
    Response.json({ clientSecret: 'test-only-secret' }, { status: 403 })
  );
  const { workspace, change } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(workspace.state.problem, 'forbidden');
    assert.equal(JSON.stringify(workspace.state).includes('test-only-secret'), false);
    change({ status: 'authenticated', snapshot: { activeContext: { type: 'TENANT' } } } as SessionView);
    assert.equal(await workspace.create('Receiver', ['runtime:read']), false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('unknown request information survives reload and same-identity relogin without storing any Secret', async () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (name: string) => saved.get(name) ?? null,
    setItem: (name: string, value: string) => {
      saved.set(name, value);
    },
    removeItem: (name: string) => {
      saved.delete(name);
    }
  };
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(page([]));
    writes += 1;
    throw new TypeError('lost');
  });
  const first = setup(storage);
  const original = first.current();
  try {
    await first.workspace.checkOperations();
    await first.workspace.create('Receiver', ['runtime:read']);
    first.change({ status: 'anonymous' });
    assert.deepEqual(first.workspace.state.pending, []);
    first.change(original);
    await first.workspace.checkOperations();
    assert.equal(first.workspace.canStart('CREATE', 'New name'), false);
    const second = setup(storage);
    try {
      await second.workspace.checkOperations();
      await second.workspace.create('Replacement', ['runtime:read']);
      assert.equal(writes, 1);
      assert.equal(second.workspace.state.pending[0].displayName, 'Receiver');
      assert.equal(second.workspace.state.secret, undefined);
      assert.equal(
        [...saved.values()].some(value => value.includes('clientSecret')),
        false
      );
    } finally {
      second.workspace.dispose();
    }
  } finally {
    first.workspace.dispose();
    request.mock.restore();
  }
});
test('a later recoverable rotation is not acknowledged by an earlier successful rotation', async () => {
  let records: unknown[] = [];
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.includes('operations')) return Response.json(page(records));
    if (url.endsWith('credential-status')) return Response.json({ clientId: id, canRotate: true, canRevoke: true });
    if (init.method === 'GET') return Response.json(client);
    return Response.json({ ...client, clientSecret: 'test-only-secret' });
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(await workspace.rotate(id, 'Receiver'), true);
    workspace.clearSecret();
    records = [
      {
        operationId: key,
        clientId: id,
        displayName: 'Receiver',
        action: 'ROTATE',
        completedAt: '2026-09-27T02:00:00Z',
        canRecover: true,
        recoveryUntil: '2026-09-28T02:00:00Z'
      }
    ];
    await workspace.checkOperations();
    assert.equal(workspace.canStart('ROTATE', id), false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('bodyless rotation and revocation carry the JSON content type required by the browser Gateway', async () => {
  const writes: string[] = [];
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.includes('operations')) return Response.json(page([]));
    if (url.endsWith('credential-status')) return Response.json({ clientId: id, canRotate: true, canRevoke: true });
    if (init.method === 'GET') return Response.json(client);
    const headers = new Headers(init.headers);
    if (headers.get('Content-Type') !== 'application/json') return new Response(null, { status: 403 });
    assert.equal(headers.get('Authorization'), 'Bearer test-token');
    assert.equal(headers.get('X-SF-CSRF'), '1');
    assert.equal(init.body, undefined);
    writes.push(url.endsWith('/revocations') ? 'REVOKE' : 'ROTATE');
    return url.endsWith('/revocations')
      ? new Response(null, { status: 204 })
      : Response.json({ ...client, clientSecret: 'test-only-secret' });
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(await workspace.rotate(id, 'Receiver'), true);
    workspace.clearSecret();
    await workspace.checkOperations();
    assert.equal(await workspace.revoke(id, 'Receiver'), true);
    assert.deepEqual(writes, ['ROTATE', 'REVOKE']);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

const operationId = '019944ca-0000-7000-8000-000000000003';
const operation = {
  operationId,
  clientId: id,
  displayName: 'Receiver',
  action: 'CREATE',
  completedAt: timestamp,
  recoveryUntil: '2026-09-27T01:10:00Z',
  canRecover: true
};
test('explicit recovery rechecks server authority and displays only the replacement once', async () => {
  let reads = 0;
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'GET') {
      reads += 1;
      return Response.json(page([operation]));
    }
    writes += 1;
    assert.ok(url.endsWith(`/oauth-client-operations/${operationId}/secret-issuance-recoveries`));
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
    assert.equal(new Headers(init.headers).get('X-SF-CSRF'), '1');
    assert.equal(new Headers(init.headers).get('Idempotency-Key'), key);
    return Response.json({ ...client, clientSecret: 'replacement-only' });
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    assert.equal(workspace.canRecover(operationId), true);
    assert.equal(await workspace.recover(operationId), true);
    assert.equal(reads, 2);
    assert.equal(workspace.state.secret?.value, 'replacement-only');
    workspace.clearSecret();
    await workspace.checkOperations();
    assert.equal(await workspace.recover(operationId), false);
    assert.equal(writes, 1);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('unknown recovery survives reload without persisting its key or Secret and cannot be taken over', async () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (name: string) => saved.get(name) ?? null,
    setItem: (name: string, value: string) => {
      saved.set(name, value);
    },
    removeItem: (name: string) => {
      saved.delete(name);
    }
  };
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(page([operation]));
    writes += 1;
    throw new TypeError('lost recovery response');
  });
  const first = setup(storage);
  let second: ReturnType<typeof setup> | undefined;
  try {
    await first.workspace.checkOperations();
    assert.equal(await first.workspace.recover(operationId), false);
    assert.equal(
      [...saved.values()].some(value => value.includes(key)),
      false
    );
    first.workspace.dispose();
    second = setup(storage);
    await second.workspace.checkOperations();
    assert.equal(await second.workspace.recover(operationId), false);
    assert.equal(second.workspace.canStart('ROTATE', id), false);
    assert.equal(writes, 1);
    const current = second.current();
    second.change({ status: 'anonymous' });
    assert.deepEqual(second.workspace.state.recoveryPending, []);
    second.change({ ...current, snapshot: { ...current.snapshot!, identity: { identityId: 'other' } } } as SessionView);
    assert.deepEqual(second.workspace.state.recoveryPending, []);
    second.change(current);
    await second.workspace.checkOperations();
    assert.deepEqual(second.workspace.state.recoveryPending, [operationId]);
    assert.equal(second.workspace.canRecover(operationId), false);
  } finally {
    first.workspace.dispose();
    second?.workspace.dispose();
    request.mock.restore();
  }
});

test('an unknown recovery blocks another operation for the same Client', async () => {
  const otherId = '019944ca-0000-7000-8000-000000000004';
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'GET')
      return Response.json(page([operation, { ...operation, operationId: otherId, action: 'ROTATE' }]));
    throw new TypeError('lost');
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    await workspace.recover(operationId);
    await workspace.checkOperations();
    assert.equal(workspace.canRecover(otherId), false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

for (const changed of [
  [],
  [{ ...operation, canRecover: false }],
  [{ ...operation, action: 'RECOVER' }],
  [{ ...operation, recoveryUntil: 'not-a-date' }]
]) {
  test('changed or malformed authority cannot permit recovery', async () => {
    let reads = 0;
    let writes = 0;
    const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      if (init.method !== 'GET') {
        writes += 1;
        return Response.json({ ...client, clientSecret: 'hidden' });
      }
      reads += 1;
      return Response.json(page(reads === 1 ? [operation] : changed));
    });
    const { workspace } = setup();
    try {
      await workspace.checkOperations();
      assert.equal(await workspace.recover(operationId), false);
      assert.equal(writes, 0);
      assert.equal(workspace.state.secret, undefined);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });
}

for (const status of [201, 202, 403, 404, 409, 410, 500]) {
  test(`recovery HTTP ${status} cannot reveal any Secret or permit a retry`, async () => {
    const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
      init.method === 'GET'
        ? Response.json(page([operation]))
        : Response.json({ ...client, clientSecret: 'must-not-show' }, { status })
    );
    const { workspace } = setup();
    try {
      await workspace.checkOperations();
      assert.equal(await workspace.recover(operationId), false);
      assert.equal(JSON.stringify(workspace.state).includes('must-not-show'), false);
      await workspace.checkOperations();
      assert.equal(workspace.canRecover(operationId), false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });
}

for (const leave of ['page', 'logout', 'account'] as const) {
  test(`a late recovery after ${leave} cannot display replacement material`, async () => {
    let resolve!: (value: Response) => void;
    const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
      init.method === 'GET'
        ? Response.json(page([{ ...operation, action: 'ROTATE' }]))
        : new Promise<Response>(done => {
            resolve = done;
          })
    );
    const { workspace, change, current } = setup();
    try {
      await workspace.checkOperations();
      const pending = workspace.recover(operationId);
      await new Promise<void>(done => {
        setImmediate(done);
      });
      if (leave === 'page') workspace.clearSecret();
      else if (leave === 'logout') change({ status: 'anonymous' });
      else
        change({
          ...current(),
          snapshot: { ...current().snapshot!, identity: { identityId: 'other' } }
        } as SessionView);
      resolve(Response.json({ ...client, clientSecret: 'late-replacement' }));
      assert.equal(await pending, false);
      assert.equal(JSON.stringify(workspace.state).includes('late-replacement'), false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });
}

test('recovery fails closed before sending when its pending marker cannot be saved', async () => {
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method !== 'GET') writes += 1;
    return Response.json(page([operation]));
  });
  const { workspace } = setup({
    getItem: () => null,
    setItem: () => {
      throw new Error('full');
    },
    removeItem: () => {}
  });
  try {
    await workspace.checkOperations();
    assert.equal(await workspace.recover(operationId), false);
    assert.equal(writes, 0);
    assert.equal(workspace.state.problem, 'pending');
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

for (const action of ['CREATE', 'ROTATE'] as const) {
  test(`lost ${action} followed by successful recovery releases only its original pending attempt`, async () => {
    let lost = false;
    let recovered = false;
    const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/oauth-client-operations'))
        return Response.json(page(lost ? [{ ...operation, action, canRecover: !recovered }] : []));
      if (path.endsWith('/credential-status')) return Response.json({ clientId: id, canRotate: true, canRevoke: true });
      if (init.method === 'GET') return Response.json(client);
      if (path.endsWith('/secret-issuance-recoveries')) {
        assert.ok(path.endsWith(`/oauth-clients/${id}/secret-issuance-recoveries`));
        assert.equal(JSON.parse(String(init.body)).originalIdempotencyKey, key);
        recovered = true;
        return Response.json({ ...client, clientSecret: 'replacement' });
      }
      lost = true;
      throw new TypeError('original response lost');
    });
    const { workspace } = setup();
    try {
      await workspace.checkOperations();
      if (action === 'CREATE') await workspace.create('Receiver', ['runtime:read']);
      else await workspace.rotate(id, 'Receiver');
      assert.equal(workspace.state.pending.length, 1);
      await workspace.checkOperations();
      assert.equal(await workspace.recover(operationId), true);
      assert.equal(workspace.state.pending.length, 0);
      workspace.clearSecret();
      await workspace.checkOperations();
      assert.equal(workspace.canStart(action, action === 'CREATE' ? 'Next Client' : id), true);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });
}

test('a same-name candidate never clears an unrelated original request or falls back after rejection', async () => {
  let lost = false;
  let recoveryWrites = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(page(lost ? [operation] : []));
    if (url.includes('secret-issuance-recoveries')) {
      recoveryWrites += 1;
      assert.equal(JSON.parse(String(init.body)).originalIdempotencyKey, key);
      assert.notEqual(new Headers(init.headers).get('Idempotency-Key'), key);
      return Response.json({ code: 'CLIENT_SECRET_RECOVERY_NOT_ALLOWED' }, { status: 409 });
    }
    lost = true;
    throw new TypeError('lost');
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    await workspace.create('Receiver', ['runtime:read']);
    await workspace.checkOperations();
    assert.equal(await workspace.recover(operationId), false);
    assert.equal(recoveryWrites, 1);
    assert.equal(workspace.state.pending.length, 1);
    assert.equal(workspace.state.secret, undefined);
    await workspace.checkOperations();
    assert.equal(workspace.canStart('CREATE', 'Unrelated'), false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('a definitively rejected candidate does not strand a successful original recovery', async () => {
  const correctId = '019944ca-0000-7000-8000-000000000004';
  const correctOp = '019944ca-0000-7000-8000-000000000005';
  let lost = false;
  let recovered = false;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'GET')
      return Response.json(
        page(
          lost ? [operation, { ...operation, operationId: correctOp, clientId: correctId, canRecover: !recovered }] : []
        )
      );
    if (url.includes('secret-issuance-recoveries')) {
      if (url.includes(id)) return Response.json({ code: 'CLIENT_SECRET_RECOVERY_NOT_ALLOWED' }, { status: 409 });
      recovered = true;
      return Response.json({ ...client, clientId: correctId, clientSecret: 'replacement' });
    }
    lost = true;
    throw new TypeError('lost');
  });
  const { workspace } = setup();
  try {
    await workspace.checkOperations();
    await workspace.create('Receiver', ['runtime:read']);
    await workspace.checkOperations();
    assert.equal(await workspace.recover(operationId), false);
    await workspace.checkOperations();
    assert.equal(await workspace.recover(correctOp), true);
    workspace.clearSecret();
    await workspace.checkOperations();
    assert.deepEqual(workspace.state.recoveryPending, []);
    assert.equal(workspace.canStart('CREATE', 'Next Client'), true);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('CI registration clients use the dedicated scope and reject mixed Runtime grants before writing', async t => {
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.includes('operations')) return Response.json(page([]));
    if (init.method === 'POST') {
      writes += 1;
      assert.deepEqual(JSON.parse(String(init.body)).allowedScopes, ['remote-delivery:manifest:register']);
      return Response.json(
        {
          ...client,
          displayName: 'CI',
          clientType: 'CI_CLIENT',
          allowedScopes: ['remote-delivery:manifest:register'],
          clientSecret: 'test-only-secret'
        },
        { status: 201 }
      );
    }
    return Response.json({ ...client, clientType: 'CI_CLIENT', allowedScopes: ['remote-delivery:manifest:register'] });
  });
  const { workspace } = setup();
  t.after(() => workspace.dispose());
  await workspace.checkOperations();
  assert.equal(await workspace.create('CI', ['runtime:read', 'remote-delivery:manifest:register']), false);
  assert.equal(writes, 0);
  assert.equal(await workspace.create('CI', ['remote-delivery:manifest:register']), true);
  assert.equal(writes, 1);
  assert.equal(workspace.state.secret?.value, 'test-only-secret');
});
