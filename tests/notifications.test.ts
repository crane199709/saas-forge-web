import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createConsoleTransport } from '../src/service/forge/console';
import { NotificationWorkspace } from '../src/service/forge/notifications';
import type { SessionView } from '../src/runtime/console-session';
const tenantId = '019944ca-0000-7000-8000-000000000001';
const resendId = '019944ca-0000-7000-8000-000000000002';
const key = '019944ca-0000-7000-8000-000000000003';
const available = { tenantId, state: 'ACTION_REQUIRED', operationState: 'NONE', canResend: true, canContinue: false };
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
  let keyCalls = 0;
  const transport = createConsoleTransport('https://api.example.test');
  transport.useToken('memory-token');
  const workspace = new NotificationWorkspace(transport.tenants, {
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
      keyCalls += 1;
      return keyCalls === 1 ? key : '019944ca-0000-7000-8000-000000000005';
    },
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
test('authoritative notification allows independent resend; failed refresh closes writes', async () => {
  let offline = false;
  const request = mock.method(globalThis, 'fetch', async () => {
    if (offline) throw new TypeError('offline');
    return Response.json(available);
  });
  const { workspace } = setup();
  try {
    assert.equal(workspace.canResend(), false);
    await workspace.check(tenantId);
    assert.equal(workspace.canResend(), true);
    offline = true;
    await workspace.check(tenantId);
    assert.equal(workspace.canResend(), false);
    assert.equal(workspace.canContinue(), false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
test('lost resend survives reload and recovers only its original notification without initialization or quota writes', async () => {
  let progress: object = available;
  const writes: { url: string; key: string | null; body: unknown }[] = [];
  const storage = new Map<string, string>();
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(progress);
    writes.push({ url, key: new Headers(init.headers).get('Idempotency-Key'), body: init.body });
    if (url.endsWith('/recovery')) {
      progress = { ...available, resendId, state: 'MAIL_SERVICE_ACCEPTED', operationState: 'COMPLETED' };
      return new Response(null, { status: 204 });
    }
    throw new TypeError('lost');
  });
  const first = setup(storage);
  const second = setup(storage);
  try {
    await first.workspace.check(tenantId);
    await first.workspace.resend();
    await second.workspace.check(tenantId);
    assert.equal(second.workspace.canResend(), false);
    await second.workspace.resend();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, key);
    assert.equal(JSON.stringify([...storage]).includes(key), false);
    progress = { ...available, resendId, operationState: 'PENDING', canResend: false, canContinue: true };
    await second.workspace.check(tenantId);
    assert.equal(second.workspace.canContinue(), true);
    await second.workspace.continueOperation();
    assert.equal(writes.length, 2);
    assert.equal(writes[0].url.endsWith('/administrator-password-setups'), true);
    assert.equal(writes[1].url.endsWith(`/administrator-password-setups/${resendId}/recovery`), true);
    assert.equal(writes[1].key, null);
    assert.deepEqual(JSON.parse(String(writes[1].body)), {});
    assert.equal(second.workspace.state.progress?.operationState, 'COMPLETED');
    assert.equal(second.workspace.state.unknown, false);
  } finally {
    first.workspace.dispose();
    second.workspace.dispose();
    request.mock.restore();
  }
});
for (const progress of [
  { ...available, operationState: 'UNKNOWN' },
  { ...available, operationState: 'PENDING', resendId },
  { ...available, state: 'PASSWORD_READY' },
  { ...available, state: 'NOT_APPLICABLE' },
  { ...available, operationState: 'MISSING' },
  { ...available, canContinue: true },
  { ...available, canResend: 'true' },
  { ...available, resendId: 'invalid' },
  { ...available, tenantId: key }
])
  test(`invalid authority ${JSON.stringify(progress)} fails closed`, async () => {
    const request = mock.method(globalThis, 'fetch', async () => Response.json(progress));
    const { workspace } = setup();
    try {
      await workspace.check(tenantId);
      assert.equal(workspace.canResend(), false);
      assert.equal(workspace.canContinue(), false);
    } finally {
      workspace.dispose();
      request.mock.restore();
    }
  });
test('an old completed operation never resolves a lost new resend after reload', async () => {
  const storage = new Map<string, string>();
  const previous = { ...available, resendId, operationState: 'COMPLETED', state: 'MAIL_SERVICE_ACCEPTED' };
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') throw new TypeError('lost');
    return Response.json(previous);
  });
  const first = setup(storage);
  const second = setup(storage);
  try {
    await first.workspace.check(tenantId);
    await first.workspace.resend();
    await second.workspace.check(tenantId);
    assert.equal(second.workspace.state.unknown, true);
    assert.equal(second.workspace.canResend(), false);
    assert.equal(second.workspace.canContinue(), false);
  } finally {
    first.workspace.dispose();
    second.workspace.dispose();
    request.mock.restore();
  }
});
test('another actor cannot take over a locally pending notification', async () => {
  const storage = new Map<string, string>();
  let progress: object = available;
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      writes += 1;
      throw new TypeError('lost');
    }
    return Response.json(progress);
  });
  const context = setup(storage);
  try {
    await context.workspace.check(tenantId);
    await context.workspace.resend();
    const state = context.current();
    context.change({
      ...state,
      snapshot: { ...state.snapshot!, identity: { ...state.snapshot!.identity!, identityId: 'actor-b' } }
    });
    progress = { ...available, resendId, operationState: 'PENDING', canResend: false, canContinue: true };
    await context.workspace.check(tenantId);
    await context.workspace.continueOperation();
    assert.equal(context.workspace.canContinue(), false);
    assert.equal(writes, 1);
  } finally {
    context.workspace.dispose();
    request.mock.restore();
  }
});
test('recovery rechecks both actor permission and original handle before writing', async () => {
  let progress = { ...available, resendId, operationState: 'PENDING', canResend: false, canContinue: true };
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') writes += 1;
    return Response.json(progress);
  });
  const { workspace } = setup();
  try {
    await workspace.check(tenantId);
    progress = { ...progress, canContinue: false };
    await workspace.continueOperation();
    assert.equal(writes, 0);
    progress = { ...progress, canContinue: true };
    await workspace.check(tenantId);
    progress = { ...progress, resendId: key };
    await workspace.continueOperation();
    assert.equal(writes, 0);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
test('identity changes discard late notification responses and private fields are never published', async () => {
  let release: (() => void) | undefined;
  let held = false;
  const request = mock.method(globalThis, 'fetch', async () => {
    if (held)
      await new Promise<void>(resolve => {
        release = resolve;
      });
    return Response.json({ ...available, passwordSetupLink: 'private', recoveryKey: 'private' });
  });
  const context = setup();
  try {
    await context.workspace.check(tenantId);
    assert.equal(JSON.stringify(context.workspace.state).includes('private'), false);
    held = true;
    const read = context.workspace.check(tenantId);
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    context.change({ status: 'anonymous' });
    release!();
    await read;
    assert.equal(context.workspace.state.progress, undefined);
    assert.equal(context.workspace.canResend(), false);
  } finally {
    context.workspace.dispose();
    request.mock.restore();
  }
});
test('storage failure prevents resend and a concurrent pending marker invalidates a read', async () => {
  const storage = new Map<string, string>();
  let hold = false;
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') writes += 1;
    if (hold) storage.set(`sf:tenant-notification:${tenantId}`, JSON.stringify({ actor: 'actor-a' }));
    return Response.json(available);
  });
  const { workspace } = setup(storage);
  try {
    await workspace.check(tenantId);
    const broken = mock.method(storage, 'set', () => {
      throw new Error('full');
    });
    try {
      await workspace.resend();
      assert.equal(writes, 0);
    } finally {
      broken.mock.restore();
    }
    hold = true;
    await workspace.check(tenantId);
    assert.equal(workspace.canResend(), false);
    assert.equal(workspace.state.checked, false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
test('a lost write resolves by its in-memory original key before reload; default reads expose no completed handle', async () => {
  let completed = false;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      completed = true;
      throw new TypeError('lost');
    }
    const selector = new URL(url).searchParams.get('idempotencyKey');
    if (completed && selector === key)
      return Response.json({ ...available, resendId, state: 'MAIL_SERVICE_ACCEPTED', operationState: 'COMPLETED' });
    return Response.json({ ...available, state: completed ? 'MAIL_SERVICE_ACCEPTED' : 'ACTION_REQUIRED' });
  });
  const { workspace } = setup();
  try {
    await workspace.check(tenantId);
    await workspace.resend();
    assert.equal(workspace.state.checked, true);
    assert.equal(workspace.state.progress?.operationState, 'COMPLETED');
    assert.equal(workspace.state.unknown, false);
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
test('completed resend permits another independently authorized resend without an extra refresh', async () => {
  let writes = 0;
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      writes += 1;
      return new Response(null, { status: 204 });
    }
    if (new URL(url).searchParams.has('idempotencyKey'))
      return Response.json({
        ...available,
        resendId: writes === 1 ? resendId : key,
        operationState: 'COMPLETED',
        state: 'MAIL_SERVICE_ACCEPTED'
      });
    return Response.json(available);
  });
  const { workspace } = setup();
  try {
    await workspace.check(tenantId);
    await workspace.resend();
    assert.equal(workspace.canResend(), true);
    await workspace.resend();
    assert.equal(writes, 2);
    assert.equal(workspace.state.progress?.operationState, 'COMPLETED');
  } finally {
    workspace.dispose();
    request.mock.restore();
  }
});
