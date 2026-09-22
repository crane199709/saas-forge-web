import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConsoleSessionRuntime, SessionFailure } from '../src/runtime/console-session';
import type {
  ConsoleTransport,
  CoordinationMessage,
  LogoutIntent,
  SessionCoordination
} from '../src/runtime/console-session';

function fixture() {
  let token: string | undefined;
  let intent: LogoutIntent | undefined;
  let listener: (kind: CoordinationMessage) => void = () => {};
  let queue = Promise.resolve();
  const snapshot: Awaited<ReturnType<ConsoleTransport['session']>> = {
    sessionId: '019944ca-0000-7000-8000-000000000001',
    revision: '1',
    state: 'AUTHENTICATED',
    identity: {
      identityId: '019944ca-0000-7000-8000-000000000002',
      email: 'admin@example.test'
    },
    activeContext: { type: 'PLATFORM' },
    availableContexts: { platform: true, companies: [] }
  };
  const api: ConsoleTransport = {
    async bootstrap() {
      return { revision: '1', sessionPresent: true, transition: 'NONE' };
    },
    async session() {
      return structuredClone(snapshot);
    },
    async login() {
      return {
        ...structuredClone(snapshot),
        accessToken: 'token',
        tokenType: 'Bearer',
        expiresIn: 900
      };
    },
    async refresh() {
      return api.login('', '', '');
    },
    async logout() {},
    async changePassword() {},
    async select() {
      return '2';
    },
    useToken(value) {
      token = value;
    }
  };
  const coordination: SessionCoordination = {
    exclusive(operation) {
      const result = queue.then(operation);
      queue = result.then(
        () => {},
        () => {}
      );
      return result;
    },
    pending: () => intent,
    savePending(value) {
      intent = value;
    },
    publish() {},
    subscribe(value) {
      listener = value;
      return () => {};
    },
    dispose() {}
  };
  const runtime = new ConsoleSessionRuntime(api, coordination, {
    key: () => '019944ca-0000-7000-8000-000000000003'
  });
  return {
    api,
    coordination,
    runtime,
    token: () => token,
    receive: (kind: CoordinationMessage) => listener(kind)
  };
}

test('read-only verification keeps the current token without rotating', async () => {
  const f = fixture();
  await f.runtime.recover();
  f.api.refresh = async () => {
    throw new Error('must not refresh');
  };
  const verifying = f.runtime.verify();
  assert.equal(f.runtime.state.status, 'checking');
  assert.equal(f.runtime.state.snapshot?.identity?.email, 'admin@example.test');
  assert.equal(f.token(), undefined);
  await verifying;
  assert.equal(f.runtime.state.status, 'authenticated');
  assert.equal(f.token(), 'token');
});

test('logout intent immediately hides the session and survives failed revocation', async () => {
  const f = fixture();
  await f.runtime.recover();
  f.api.logout = async () => {
    throw new SessionFailure('SESSION_SECURITY_UNAVAILABLE');
  };
  await f.runtime.logout();
  assert.equal(f.token(), undefined);
  assert.equal(f.runtime.state.status, 'logoutPending');
  assert.ok(f.coordination.pending());
  f.api.logout = async () => {};
  await f.runtime.recover();
  assert.equal(f.runtime.state.status, 'anonymous');
  assert.equal(f.coordination.pending(), undefined);
});

test('a late refresh cannot restore a session after another tab logs out', async () => {
  const f = fixture();
  let finish!: () => void;
  const ready = new Promise<void>(resolve => {
    finish = resolve;
  });
  const response = await f.api.login('', '', '');
  f.api.refresh = async () => {
    await ready;
    return response;
  };
  const work = f.runtime.recover();
  await new Promise(resolve => {
    setImmediate(resolve);
  });
  f.coordination.savePending({ key: 'logout' });
  f.receive('logout');
  finish();
  await work;
  assert.equal(f.runtime.state.status, 'logoutPending');
  assert.equal(f.token(), undefined);
});

test('refresh retries retain their original idempotency key after an unknown response', async () => {
  const f = fixture();
  const keys: string[] = [];
  const response = await f.api.login('', '', '');
  f.api.refresh = async (_revision, key) => {
    keys.push(key);
    if (keys.length === 1) throw new SessionFailure('NETWORK_UNAVAILABLE');
    return response;
  };
  await f.runtime.recover();
  await f.runtime.recover();
  assert.equal(f.runtime.state.status, 'authenticated');
  assert.deepEqual(keys, [keys[0], keys[0]]);
});

test('logout during login binds its revision after the in-flight login leaves the shared lock', async () => {
  const f = fixture();
  let present = false;
  let revision = '0';
  f.api.bootstrap = async () => ({
    revision,
    sessionPresent: present,
    transition: 'NONE'
  });
  await f.runtime.recover();
  let finish!: () => void;
  const ready = new Promise<void>(resolve => {
    finish = resolve;
  });
  const response = await f.api.login('', '', '');
  f.api.login = async () => {
    await ready;
    present = true;
    revision = '1';
    return response;
  };
  const login = f.runtime.login('admin@example.test', 'password');
  await new Promise(resolve => {
    setImmediate(resolve);
  });
  f.api.logout = async received => {
    assert.equal(received, revision);
    present = false;
  };
  const logout = f.runtime.logout();
  finish();
  await Promise.all([login, logout]);
  assert.equal(present, false);
  assert.equal(f.runtime.state.status, 'anonymous');
});

test('a coordinated account change discards an unknown refresh attempt from the previous revision', async () => {
  const f = fixture();
  f.api.refresh = async () => {
    throw new SessionFailure('NETWORK_UNAVAILABLE');
  };
  await f.runtime.recover();
  const response = await f.api.login('', '', '');
  f.api.bootstrap = async () => ({
    revision: '2',
    sessionPresent: true,
    transition: 'NONE'
  });
  let observed: string | undefined;
  f.api.refresh = async revision => {
    observed = revision;
    return { ...response, revision: '2' };
  };
  f.receive('changed');
  await new Promise(resolve => {
    setImmediate(resolve);
  });
  assert.equal(observed, '2');
  assert.equal(f.runtime.state.status, 'authenticated');
});

const tenantTarget = {
  type: 'TENANT' as const,
  membershipId: '019944ca-0000-7000-8000-000000000099'
};
const flush = () =>
  new Promise<void>(resolve => {
    setImmediate(resolve);
  });

test('cancelling the discard confirmation preserves the current workspace and sends no selection', async () => {
  const f = fixture();
  await f.runtime.recover();
  f.api.select = async () => {
    assert.fail('selection must wait for confirmation');
  };
  await f.runtime.select(tenantTarget, async () => false);
  assert.equal(f.runtime.state.status, 'authenticated');
  assert.equal(f.token(), 'token');
});

test('selection hides credentials before submission and applies only the refreshed workspace', async () => {
  const f = fixture();
  await f.runtime.recover();
  const messages: string[] = [];
  f.coordination.publish = kind => messages.push(kind);
  f.api.select = async (target, revision) => {
    assert.deepEqual(target, tenantTarget);
    assert.equal(revision, '1');
    assert.equal(f.token(), undefined);
    assert.equal(f.runtime.state.snapshot, undefined);
    return '3';
  };
  const response = await f.api.login('', '', '');
  f.api.refresh = async revision => {
    assert.equal(revision, '3');
    return {
      ...response,
      revision: '3',
      activeContext: {
        type: 'TENANT',
        membershipId: tenantTarget.membershipId,
        tenantId: '019944ca-0000-7000-8000-000000000098'
      },
      accessToken: 'tenant-token'
    };
  };
  await f.runtime.select(tenantTarget, async () => true);
  assert.deepEqual(messages, ['switching', 'changed']);
  assert.equal(f.runtime.state.snapshot?.activeContext?.type, 'TENANT');
  assert.equal(f.token(), 'tenant-token');
});

test('unknown selection results retry the original target and key without restoring the old workspace', async () => {
  const f = fixture();
  await f.runtime.recover();
  const keys: string[] = [];
  f.api.select = async (target, revision, key) => {
    assert.deepEqual(target, tenantTarget);
    assert.equal(revision, '1');
    keys.push(key);
    if (keys.length === 1) throw new SessionFailure('NETWORK_UNAVAILABLE');
    return '3';
  };
  await f.runtime.select(tenantTarget, async () => true);
  assert.equal(f.runtime.state.status, 'blocked');
  assert.equal(f.runtime.state.snapshot, undefined);
  assert.equal(f.token(), undefined);
  await f.runtime.select({ type: 'PLATFORM' }, async () => true);
  assert.equal(keys.length, 1);
  const response = await f.api.login('', '', '');
  f.api.bootstrap = async () => ({
    revision: '3',
    sessionPresent: true,
    transition: 'CONTEXT_REFRESH_REQUIRED'
  });
  f.api.refresh = async () => ({ ...response, revision: '3' });
  await f.runtime.recover();
  assert.deepEqual(keys, [keys[0], keys[0]]);
  assert.equal(f.runtime.state.status, 'authenticated');
});

test('refresh failure after selection never returns to the old view and retries the original refresh key', async () => {
  const f = fixture();
  await f.runtime.recover();
  let selections = 0;
  f.api.select = async () => {
    selections += 1;
    return '3';
  };
  const keys: string[] = [];
  const response = await f.api.login('', '', '');
  f.api.refresh = async (revision, key) => {
    assert.equal(revision, '3');
    keys.push(key);
    if (keys.length === 1) throw new SessionFailure('NETWORK_UNAVAILABLE');
    return { ...response, revision: '3' };
  };
  await f.runtime.select(tenantTarget, async () => true);
  assert.equal(f.runtime.state.status, 'blocked');
  assert.equal(f.runtime.state.snapshot, undefined);
  f.api.bootstrap = async () => ({
    revision: '3',
    sessionPresent: true,
    transition: 'NONE'
  });
  await f.runtime.recover();
  assert.equal(selections, 1);
  assert.deepEqual(keys, [keys[0], keys[0]]);
  assert.equal(f.runtime.state.status, 'authenticated');
});

test('switching in another tab hides private state immediately and rejects a late real response', async () => {
  const f = fixture();
  await f.runtime.recover();
  let finish!: () => void;
  const wait = new Promise<void>(resolve => {
    finish = resolve;
  });
  const response = await f.api.login('', '', '');
  f.api.refresh = async () => {
    await wait;
    return response;
  };
  const recovering = f.runtime.recover();
  await flush();
  f.receive('switching');
  assert.equal(f.token(), undefined);
  assert.equal(f.runtime.state.snapshot, undefined);
  finish();
  await recovering;
  assert.equal(f.runtime.state.status, 'blocked');
  assert.equal(f.token(), undefined);
});

test('authority loss broadcasts invalidation and cannot silently fall back to another workspace', async () => {
  const f = fixture();
  await f.runtime.recover();
  const messages: string[] = [];
  f.coordination.publish = kind => messages.push(kind);
  f.api.session = async () => {
    throw new SessionFailure('CURRENT_CONTEXT_REVOKED');
  };
  await f.runtime.verify();
  assert.equal(f.runtime.state.status, 'blocked');
  assert.equal(f.runtime.state.snapshot, undefined);
  assert.equal(f.token(), undefined);
  assert.deepEqual(messages, ['changed']);
});

test('brand preparation cannot resurrect a workspace after a newer cross-tab transition', async () => {
  const f = fixture();
  let finish!: () => void;
  const ready = new Promise<void>(resolve => {
    finish = resolve;
  });
  const runtime = new ConsoleSessionRuntime(f.api, f.coordination, {
    key: () => '019944ca-0000-7000-8000-000000000003',
    resolveBrand: async () => {
      await ready;
      return undefined;
    }
  });
  const recovering = runtime.recover();
  await flush();
  f.receive('switching');
  finish();
  await recovering;
  assert.equal(runtime.state.status, 'blocked');
  assert.equal(runtime.state.snapshot, undefined);
  assert.equal(f.token(), undefined);
});

test('a sole newly available membership still requires authoritative selection before entering', async () => {
  const f = fixture();
  const response = await f.api.login('', '', '');
  let selected = false;
  f.api.refresh = async revision => {
    if (!selected)
      return {
        sessionId: response.sessionId,
        revision: '2',
        state: 'CONTEXT_SELECTION_REQUIRED',
        availableContexts: {
          platform: false,
          companies: [
            {
              membershipId: tenantTarget.membershipId,
              tenantId: '019944ca-0000-7000-8000-000000000098',
              tenantDisplayName: 'Company A'
            }
          ]
        }
      };
    assert.equal(revision, '3');
    return {
      ...response,
      revision: '3',
      activeContext: {
        ...tenantTarget,
        tenantId: '019944ca-0000-7000-8000-000000000098'
      }
    };
  };
  f.api.select = async (target, revision) => {
    assert.deepEqual(target, tenantTarget);
    assert.equal(revision, '2');
    assert.equal(f.token(), undefined);
    selected = true;
    return '3';
  };
  await f.runtime.recover();
  assert.equal(selected, true);
  assert.equal(f.runtime.state.snapshot?.activeContext?.membershipId, tenantTarget.membershipId);
});

test('a confirmation from an older session generation cannot submit a selection', async () => {
  const f = fixture();
  await f.runtime.recover();
  let confirm!: (value: boolean) => void;
  const confirmation = new Promise<boolean>(resolve => {
    confirm = resolve;
  });
  f.api.select = async () => {
    assert.fail('stale confirmation must not submit');
  };
  const selection = f.runtime.select(tenantTarget, () => confirmation);
  f.receive('switching');
  confirm(true);
  await selection;
  assert.equal(f.runtime.state.status, 'blocked');
});

test('an edit in another tab invalidates an outstanding discard confirmation without clearing its workspace', async () => {
  const f = fixture();
  await f.runtime.recover();
  let confirm!: (value: boolean) => void;
  const confirmation = new Promise<boolean>(resolve => {
    confirm = resolve;
  });
  f.api.select = async () => {
    assert.fail('new edits require another confirmation');
  };
  const selection = f.runtime.select(tenantTarget, () => confirmation);
  f.receive('edited');
  confirm(true);
  await selection;
  assert.equal(f.runtime.state.status, 'authenticated');
  assert.equal(f.token(), 'token');
});

test('initial password change ends the session without issuing a token', async () => {
  const f = fixture();
  f.api.session = async () => ({
    sessionId: 'initial',
    revision: '1',
    state: 'PASSWORD_CHANGE_REQUIRED'
  });
  await f.runtime.recover();
  let calls = 0;
  f.api.changePassword = async (_password, revision) => {
    calls += 1;
    assert.equal(revision, '1');
  };
  await Promise.all([f.runtime.changePassword('New-password!'), f.runtime.changePassword('duplicate')]);
  assert.equal(calls, 1);
  assert.equal(f.runtime.state.status, 'anonymous');
  assert.equal(f.runtime.state.problem, 'PASSWORD_CHANGED');
  assert.equal(f.token(), undefined);
});

test('password validation failure keeps only the restricted session available', async () => {
  const f = fixture();
  f.api.session = async () => ({
    sessionId: 'initial',
    revision: '1',
    state: 'PASSWORD_CHANGE_REQUIRED'
  });
  await f.runtime.recover();
  f.api.changePassword = async () => {
    throw new SessionFailure('PASSWORD_COMPROMISED');
  };
  await f.runtime.changePassword('New-password!');
  assert.equal(f.runtime.state.status, 'restricted');
  assert.equal(f.runtime.state.problem, 'PASSWORD_COMPROMISED');
  assert.equal(f.token(), undefined);
});

test('unknown password change is recovered without retaining or resending the password', async () => {
  const f = fixture();
  f.api.session = async () => ({
    sessionId: 'initial',
    revision: '1',
    state: 'PASSWORD_CHANGE_REQUIRED'
  });
  await f.runtime.recover();
  let calls = 0;
  f.api.changePassword = async () => {
    calls += 1;
    throw new SessionFailure('NETWORK_UNAVAILABLE');
  };
  await f.runtime.changePassword('New-password!');
  f.api.bootstrap = async () => ({
    revision: '2',
    sessionPresent: false,
    transition: 'NONE'
  });
  await f.runtime.recover();
  assert.equal(calls, 1);
  assert.equal(f.runtime.state.status, 'anonymous');
  assert.equal(f.runtime.state.problem, 'PASSWORD_CHANGE_RESULT_UNKNOWN');
});

test('a password retry after an uncommitted unknown result retains its original operation key', async () => {
  const f = fixture();
  f.api.session = async () => ({ sessionId: 'initial', revision: '1', state: 'PASSWORD_CHANGE_REQUIRED' });
  await f.runtime.recover();
  let firstKey = '';
  f.api.changePassword = async (_password, _revision, key) => {
    firstKey = key;
    throw new SessionFailure('NETWORK_UNAVAILABLE');
  };
  await f.runtime.changePassword('New-password!');
  assert.equal(f.runtime.state.status, 'blocked');
  await f.runtime.recover();
  assert.equal(f.runtime.state.status, 'restricted');
  f.api.changePassword = async (_password, revision, key) => {
    assert.equal(key, firstKey);
    assert.equal(revision, '1');
  };
  await f.runtime.changePassword('New-password!');
  assert.equal(f.runtime.state.status, 'anonymous');
});
