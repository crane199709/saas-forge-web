import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createConsoleTransport } from '../src/service/forge/console';
import { LifecycleWorkspace } from '../src/service/forge/lifecycle';
import type { SessionView } from '../src/runtime/console-session';
const tenantId = '019944ca-0000-7000-8000-000000000004';
const operationId = '019944ca-0000-7000-8000-000000000005';
const initial = {
  tenantId,
  state: 'NONE',
  canSuspend: true,
  canResume: false,
  canRecoverSuspension: false,
  canContinue: false
};
function setup(storage = new Map<string, string>()) {
  let state = {
    status: 'authenticated',
    snapshot: { sessionId: 's', revision: '1', identity: { identityId: 'a' }, activeContext: { type: 'PLATFORM' } }
  } as SessionView;
  const listeners = new Set<(s: SessionView) => void>();
  const transport = createConsoleTransport('https://api.example.test');
  transport.useToken('test-token');
  let keyNumber = 6;
  const workspace = new LifecycleWorkspace(transport.tenants, {
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
      keyNumber += 1;
      return `019944ca-0000-7000-8000-${String(keyNumber).padStart(12, '0')}`;
    },
    storage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
      removeItem: key => {
        storage.delete(key);
      }
    },
    exclusive: async (_id, operation) => operation()
  });
  return {
    workspace,
    change(next: SessionView) {
      state = next;
      listeners.forEach(fn => fn(state));
    }
  };
}
test('pending suspension cannot authorize resume and continuation uses the original operation', async () => {
  const pending = {
    ...initial,
    operationId,
    action: 'SUSPEND',
    state: 'PENDING',
    canSuspend: false,
    canContinue: true
  };
  const requests = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
    assert.equal(new Headers(init.headers).get('X-SF-CSRF'), '1');
    if (init.method === 'GET') return Response.json(pending);
    assert.equal(url.endsWith(`/lifecycle-operations/${operationId}/continuations`), true);
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
    return Response.json({ id: tenantId });
  });
  const { workspace } = setup();
  try {
    await workspace.check(tenantId);
    assert.equal(workspace.can('resume'), false);
    assert.equal(workspace.can('continue'), true);
    await workspace.run('resume');
    await workspace.run('continue');
    assert.equal(requests.mock.calls.filter(call => call.arguments[1]?.method !== 'GET').length, 1);
  } finally {
    workspace.dispose();
    requests.mock.restore();
  }
});

test('a lost mutation stays locked across page reload and tabs until a new authoritative operation is found', async () => {
  let latest = initial;
  let writes = 0;
  const requests = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(latest);
    writes += 1;
    throw new TypeError('lost response');
  });
  const storage = new Map<string, string>();
  const first = setup(storage).workspace;
  const second = setup(storage).workspace;
  try {
    await first.check(tenantId);
    await second.check(tenantId);
    await first.run('suspend');
    await first.check(tenantId);
    assert.equal(first.state.unknown, true);
    assert.equal(first.can('suspend'), false);
    await second.run('suspend');
    assert.equal(writes, 1);
    await second.check(tenantId);
    assert.equal(second.can('suspend'), false);
    latest = {
      ...initial,
      operationId,
      action: 'SUSPEND',
      state: 'COMPLETED',
      canSuspend: false,
      canResume: true
    } as typeof initial;
    await second.check(tenantId);
    assert.equal(second.state.unknown, false);
    assert.equal(second.can('resume'), true);
  } finally {
    first.dispose();
    second.dispose();
    requests.mock.restore();
  }
});

test('an unknown continuation can retry only the same server-allowed original operation', async () => {
  const pending = {
    ...initial,
    operationId,
    action: 'SUSPEND',
    state: 'PENDING',
    canSuspend: false,
    canContinue: true
  };
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(pending);
    assert(url.endsWith(`/lifecycle-operations/${operationId}/continuations`));
    writes += 1;
    throw new TypeError('response lost');
  });
  const { workspace } = setup();
  try {
    await workspace.check(tenantId);
    await workspace.run('continue');
    await workspace.check(tenantId);
    assert.equal(workspace.can('resume'), false);
    assert.equal(workspace.can('continue'), true);
    await workspace.run('continue');
    assert.equal(writes, 2);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

for (const latest of [
  { ...initial, canSuspend: false },
  { ...initial, operationId, action: 'SUSPEND', state: 'PENDING', canSuspend: false, canContinue: true },
  { ...initial, canResume: true },
  { ...initial, canContinue: true }
])
  test('changed or contradictory authority cannot authorize a stale new action', async () => {
    let changed = false;
    const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      assert.equal(init.method, 'GET');
      return Response.json(changed ? latest : initial);
    });
    const { workspace } = setup();
    try {
      await workspace.check(tenantId);
      changed = true;
      await workspace.run('suspend');
      assert.equal(workspace.can('suspend'), false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });

test('late lifecycle response cannot populate a new Identity or Tenant', async () => {
  let release!: (r: Response) => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => {
    started = resolve;
  });
  const request = mock.method(
    globalThis,
    'fetch',
    async () =>
      new Promise<Response>(resolve => {
        release = resolve;
        started();
      })
  );
  const { workspace, change } = setup();
  try {
    const reading = workspace.check(tenantId);
    await waiting;
    change({ status: 'anonymous' });
    release(Response.json(initial));
    await reading;
    assert.equal(workspace.state.snapshot, undefined);
    assert.equal(workspace.can('suspend'), false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('unavailable shared storage fails closed before a lifecycle mutation', async () => {
  const storage = new Map<string, string>();
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET');
    return Response.json(initial);
  });
  const { workspace } = setup(storage);
  try {
    await workspace.check(tenantId);
    storage.set = () => {
      throw new Error('storage blocked');
    };
    await workspace.run('suspend');
    assert.equal(workspace.can('suspend'), false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('unknown recovery can recover the same server-allowed suspension again using its original key', async () => {
  const snapshot = {
    ...initial,
    operationId,
    action: 'SUSPEND',
    state: 'RECOVERY_REQUIRED',
    canSuspend: false,
    canRecoverSuspension: true
  };
  const keys: (string | null)[] = [];
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(snapshot);
    assert(url.endsWith('/suspension-recoveries'));
    keys.push(new Headers(init.headers).get('Idempotency-Key'));
    throw new TypeError('lost recovery result');
  });
  const { workspace } = setup();
  try {
    await workspace.check(tenantId);
    await workspace.run('recover');
    await workspace.check(tenantId);
    assert.equal(workspace.can('recover'), true);
    assert.equal(workspace.can('resume'), false);
    await workspace.run('recover');
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});

test('an authoritative exhausted recovery releases only its recovery key, keeping the original workflow', async () => {
  const snapshot = {
    ...initial,
    operationId,
    action: 'SUSPEND',
    state: 'RECOVERY_REQUIRED',
    canSuspend: false,
    canRecoverSuspension: true
  };
  const keys: (string | null)[] = [];
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(snapshot);
    assert(url.endsWith('/suspension-recoveries'));
    keys.push(new Headers(init.headers).get('Idempotency-Key'));
    if (keys.length === 1) throw new TypeError('lost response');
    if (keys.length === 2) return Response.json({ code: 'TENANT_SUSPENSION_RECOVERY_REQUIRED' }, { status: 409 });
    return Response.json({ id: tenantId });
  });
  const { workspace } = setup();
  try {
    await workspace.check(tenantId);
    await workspace.run('recover');
    await workspace.check(tenantId);
    await workspace.run('recover');
    await workspace.check(tenantId);
    await workspace.run('recover');
    assert.equal(keys.length, 3);
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[1], keys[2]);
    assert.equal(workspace.state.snapshot?.operationId, operationId);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
