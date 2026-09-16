import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConsoleSessionRuntime, SessionFailure } from '../src/runtime/console-session';
import type { ConsoleTransport, LogoutIntent, SessionCoordination } from '../src/runtime/console-session';

function fixture() {
  let token: string | undefined;
  let intent: LogoutIntent | undefined;
  let listener: (kind: 'changed' | 'logout') => void = () => {};
  let queue = Promise.resolve();
  const snapshot: Awaited<ReturnType<ConsoleTransport['session']>> = {
    sessionId: '019944ca-0000-7000-8000-000000000001',
    revision: '1',
    state: 'AUTHENTICATED',
    identity: { identityId: '019944ca-0000-7000-8000-000000000002', email: 'admin@example.test' },
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
      return { ...structuredClone(snapshot), accessToken: 'token', tokenType: 'Bearer', expiresIn: 900 };
    },
    async refresh() {
      return api.login('', '', '');
    },
    async logout() {},
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
  const runtime = new ConsoleSessionRuntime(api, coordination, { key: () => '019944ca-0000-7000-8000-000000000003' });
  return { api, coordination, runtime, token: () => token, receive: (kind: 'changed' | 'logout') => listener(kind) };
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
  f.api.bootstrap = async () => ({ revision, sessionPresent: present, transition: 'NONE' });
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
  f.api.bootstrap = async () => ({ revision: '2', sessionPresent: true, transition: 'NONE' });
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
