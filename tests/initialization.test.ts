import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createConsoleTransport } from '../src/service/forge/console';
import { InitializationWorkspace } from '../src/service/forge/initialization';
import type { SessionView } from '../src/runtime/console-session';
const tenantId = '019944ca-0000-7000-8000-000000000001';
const initializationId = '019944ca-0000-7000-8000-000000000002';
const key = '019944ca-0000-7000-8000-000000000003';
const membershipId = '019944ca-0000-7000-8000-000000000004';
const at = '2026-09-28T01:00:00Z';
const initial = {
  tenantId,
  state: 'NOT_STARTED',
  canStart: true,
  canContinue: false,
  initialAdministratorMembershipId: null
};
const subscription = {
  observedAt: at,
  effective: true,
  maxUsersLimit: 10,
  maxUsersUsed: 0,
  subscription: { id: key, tenantId, planId: key, status: 'ACTIVE', endsAt: null, createdAt: at }
};
const notification = { tenantId, state: 'PENDING', operationState: 'NONE', canResend: false, canContinue: false };
function setup(storage = new Map<string, string>()) {
  let state = {
    status: 'authenticated',
    snapshot: {
      sessionId: 's',
      revision: '1',
      identity: { identityId: 'actor-a' },
      activeContext: { type: 'PLATFORM' }
    }
  } as SessionView;
  const listeners = new Set<(s: SessionView) => void>();
  const transport = createConsoleTransport('https://api.example.test');
  transport.useToken('memory-token');
  const workspace = new InitializationWorkspace(transport.tenants, transport.entitlements, {
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
    storage: {
      getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => {
        storage.set(k, v);
      },
      removeItem: k => {
        storage.delete(k);
      }
    },
    exclusive: async (_id, operation) => operation()
  });
  return {
    workspace,
    current: () => state,
    change(next: SessionView) {
      state = next;
      listeners.forEach(fn => fn(state));
    }
  };
}
function response(url: string, progress: object = initial, snapshot: object = subscription) {
  if (url.endsWith('/subscription')) return Response.json(snapshot);
  if (url.endsWith('/administrator-initialization')) return Response.json(progress);
  if (url.endsWith('/administrator-password-setup')) return Response.json(notification);
  throw new Error(`Unexpected request ${url}`);
}
test('authoritative initialization and effective subscription jointly authorize start; failed refresh closes writes', async () => {
  let offline = false;
  const request = mock.method(globalThis, 'fetch', async (url: string) => {
    if (offline) throw new TypeError('offline');
    return response(url);
  });
  const { workspace } = setup();
  try {
    assert.equal(workspace.canStart(), false);
    await workspace.check(tenantId);
    assert.equal(workspace.canStart(), true);
    offline = true;
    await workspace.check(tenantId);
    assert.equal(workspace.canStart(), false);
    assert.equal(workspace.canContinue(), false);
    assert.equal(workspace.state.checked, false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
test('lost start survives reload, never replaces the attempt, and continues only the original server handle', async () => {
  let progress: object = initial;
  const writes: { url: string; body: unknown; key: string | null }[] = [];
  const storage = new Map<string, string>();
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'GET') return response(url, progress);
    writes.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get('Idempotency-Key') });
    if (url.endsWith('/recovery')) {
      progress = {
        ...initial,
        initializationId,
        state: 'SUCCEEDED',
        canStart: false,
        initialAdministratorMembershipId: membershipId
      };
      return Response.json({ id: tenantId, status: 'ACTIVE' });
    }
    throw new TypeError('lost');
  });
  const first = setup(storage);
  const second = setup(storage);
  try {
    await first.workspace.check(tenantId);
    await first.workspace.start({ administratorEmail: 'admin@example.test', administratorDisplayName: 'Admin' });
    await second.workspace.check(tenantId);
    assert.equal(second.workspace.canStart(), false);
    await second.workspace.start({ administratorEmail: 'replacement@example.test' });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, key);
    assert.equal(JSON.stringify([...storage]).includes('admin@example.test'), false);
    progress = { ...initial, initializationId, state: 'RECOVERY_REQUIRED', canStart: false, canContinue: true };
    await second.workspace.check(tenantId);
    assert.equal(second.workspace.canContinue(), true);
    await second.workspace.continueOperation();
    assert.equal(writes.length, 2);
    assert.equal(writes[1].url.endsWith(`/administrator-initializations/${initializationId}/recovery`), true);
    assert.deepEqual(writes[1].body, {});
    assert.equal(writes[1].key, null);
    assert.equal(second.workspace.state.progress?.initialAdministratorMembershipId, membershipId);
    assert.equal(second.workspace.state.notification, 'PENDING');
    assert.equal(second.workspace.canStart(), false);
  } finally {
    first.workspace.dispose();
    second.workspace.dispose();
    request.mock.restore();
  }
});
test('a concurrent pending marker during a read cannot authorize replacement', async () => {
  const storage = new Map<string, string>();
  let hold = false;
  const request = mock.method(globalThis, 'fetch', async (url: string) => {
    if (hold && url.endsWith('/administrator-initialization'))
      storage.set(`sf:tenant-initialization:${tenantId}`, JSON.stringify({ action: 'start' }));
    return response(url, { ...initial, initializationId, state: 'RETRY_REQUIRED' });
  });
  const { workspace } = setup(storage);
  try {
    await workspace.check(tenantId);
    hold = true;
    await workspace.check(tenantId);
    assert.equal(workspace.canStart(), false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
for (const progress of [
  { ...initial, state: 'PROCESSING', initializationId, canStart: false },
  { ...initial, state: 'COMPENSATING', initializationId, canStart: false },
  { ...initial, state: 'RECOVERY_REQUIRED', initializationId, canStart: false },
  { ...initial, state: 'FAILED', initializationId, canStart: false },
  { ...initial, state: 'PROCESSING', initializationId },
  { ...initial, state: 'RECOVERY_REQUIRED', canStart: false, canContinue: true },
  { ...initial, tenantId: key },
  { ...initial, canStart: 'true' }
])
  test(`state ${progress.state} cannot authorize an invalid or forbidden start`, async () => {
    const request = mock.method(globalThis, 'fetch', async (url: string) => response(url, progress));
    const { workspace } = setup();
    try {
      await workspace.check(tenantId);
      assert.equal(workspace.canStart(), false);
      assert.equal(workspace.canContinue(), false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });
for (const snapshot of [
  { ...subscription, effective: false },
  { ...subscription, maxUsersLimit: 0 },
  { ...subscription, maxUsersLimit: undefined },
  { ...subscription, observedAt: 'invalid' },
  { ...subscription, subscription: { ...subscription.subscription, tenantId: key } },
  { ...subscription, subscription: { ...subscription.subscription, endsAt: '2020-01-01T00:00:00Z' } }
])
  test('ineligible or invalid subscriptions close both initialization actions', async () => {
    const request = mock.method(globalThis, 'fetch', async (url: string) => response(url, initial, snapshot));
    const { workspace } = setup();
    try {
      await workspace.check(tenantId);
      assert.equal(workspace.canStart(), false);
      assert.equal(workspace.canContinue(), false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });
test('recovery rechecks original handle and actor permission immediately before mutation', async () => {
  let progress = { ...initial, initializationId, state: 'RECOVERY_REQUIRED', canStart: false, canContinue: true };
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') writes += 1;
    return response(url, progress);
  });
  const { workspace } = setup();
  try {
    await workspace.check(tenantId);
    progress = { ...progress, canContinue: false };
    await workspace.continueOperation();
    assert.equal(writes, 0);
    progress = { ...progress, canContinue: true };
    await workspace.check(tenantId);
    progress = { ...progress, initializationId: key };
    await workspace.continueOperation();
    assert.equal(writes, 0);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
test('server explicitly permits a new attempt only after completed compensation', async () => {
  let progress = { ...initial, initializationId, state: 'COMPENSATING', canStart: false };
  const request = mock.method(globalThis, 'fetch', async (url: string) => response(url, progress));
  const { workspace } = setup();
  try {
    await workspace.check(tenantId);
    assert.equal(workspace.canStart(), false);
    progress = { ...progress, state: 'RETRY_REQUIRED', canStart: true };
    await workspace.check(tenantId);
    assert.equal(workspace.canStart(), true);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
test('account changes discard late responses and sensitive diagnostics never enter observable state', async () => {
  let release: (() => void) | undefined;
  let held = false;
  const request = mock.method(globalThis, 'fetch', async (url: string) => {
    if (held && url.endsWith('/administrator-initialization'))
      await new Promise<void>(resolve => {
        release = resolve;
      });
    return response(url, {
      ...initial,
      recoveryKey: 'private',
      failureCode: 'raw diagnostic',
      administratorEmail: 'private@example.test'
    });
  });
  const context = setup();
  try {
    await context.workspace.check(tenantId);
    assert.equal(JSON.stringify(context.workspace.state).includes('private'), false);
    assert.equal(JSON.stringify(context.workspace.state).includes('raw diagnostic'), false);
    held = true;
    const pending = context.workspace.check(tenantId);
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    context.change({ status: 'anonymous' });
    release!();
    await pending;
    assert.equal(context.workspace.state.progress, undefined);
    assert.equal(context.workspace.canStart(), false);
  } finally {
    context.workspace.dispose();
    request.mock.restore();
  }
});
test('storage failure prevents all writes', async () => {
  const storage = new Map<string, string>();
  const context = setup(storage);
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') writes += 1;
    return response(url);
  });
  try {
    await context.workspace.check(tenantId);
    const broken = mock.method(storage, 'set', () => {
      throw new Error('full');
    });
    try {
      await context.workspace.start({ administratorEmail: 'admin@example.test' });
      assert.equal(writes, 0);
    } finally {
      broken.mock.restore();
    }
  } finally {
    context.workspace.dispose();
    request.mock.restore();
  }
});
for (const [status, code, canRetry] of [
  [401, 'ACCESS_TOKEN_INVALID', true],
  [403, 'PLATFORM_AUTHORIZATION_DENIED', true],
  [403, 'UNRECOGNIZED', false],
  [409, 'IDEMPOTENCY_KEY_REUSED', false]
] as const)
  test(`only proven pre-acceptance rejection ${code} permits a new start after authoritative recheck`, async () => {
    const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) =>
      init.method === 'POST' ? Response.json({ code, detail: 'private diagnostics' }, { status }) : response(url)
    );
    const { workspace } = setup();
    try {
      await workspace.check(tenantId);
      await workspace.start({ administratorEmail: 'admin@example.test' });
      assert.equal(workspace.canStart(), false);
      await workspace.check(tenantId);
      assert.equal(workspace.canStart(), canRetry);
      assert.equal(JSON.stringify(workspace.state).includes('private diagnostics'), false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });
