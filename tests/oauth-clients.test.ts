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
    key: () => key,
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
