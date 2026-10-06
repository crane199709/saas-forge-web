import assert from 'node:assert/strict';
import test from 'node:test';
import { createConsoleTransport } from '../src/service/forge/console';
import { createProjectHost } from '../src/service/forge/projects';
import type { SessionView } from '../src/runtime/console-session';

const id = '019944ca-0000-7000-8000-000000000001';
const project = {
  id,
  tenantId: '019944ca-0000-7000-8000-000000000002',
  name: 'Original',
  description: null,
  version: 3,
  createdAt: '2026-10-02T01:00:00Z',
  updatedAt: '2026-10-02T01:00:00Z'
};
function setup() {
  const view = {
    status: 'authenticated',
    snapshot: {
      sessionId: 'session-a',
      revision: '1',
      state: 'AUTHENTICATED',
      identity: { identityId: 'actor-a', email: 'actor@example.test' },
      activeContext: { type: 'TENANT', tenantId: project.tenantId, membershipId: 'membership-a' },
      availableContexts: { platform: false, companies: [] }
    }
  } as SessionView;
  let listener: (value: SessionView) => void = () => {};
  let keys = 0;
  const transport = createConsoleTransport('https://api.saas.forge.test');
  transport.useToken('test-token');
  const bridge = createProjectHost(
    transport.projects,
    {
      subscribe(fn) {
        listener = fn;
        fn(view);
        return () => {
          listener = () => {};
          return true;
        };
      }
    },
    () => {
      keys += 1;
      return `019944ca-0000-7000-8000-${String(keys).padStart(12, '0')}`;
    }
  );
  return { ...bridge, view, change: (value: SessionView) => listener(value) };
}

test('unknown writes retain the original body, version and key while blocking replacement', async t => {
  const writes: { headers: Headers; body: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(project);
    writes.push({ headers: new Headers(init.headers), body: String(init.body) });
    if (writes.length === 1) throw new TypeError('lost response');
    return Response.json({ ...project, name: 'Updated', version: 4 });
  });
  const f = setup();
  t.after(f.dispose);
  const returned = await f.host.getProject(id);
  Object.assign(returned, { version: 900 });
  const body = { name: 'Updated' };
  await assert.rejects(f.host.updateProject(id, body), { code: 'NETWORK_UNAVAILABLE' });
  body.name = 'Replacement';
  await assert.rejects(f.host.createProject(body), { code: 'WRITE_RECOVERY_REQUIRED' });
  f.change({ ...f.view, status: 'checking' });
  await assert.rejects(f.host.retryPending(), { code: 'TENANT_CONTEXT_REQUIRED' });
  f.change(f.view);
  await f.host.retryPending();
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body, writes[1].body);
  assert.equal(JSON.parse(writes[1].body).name, 'Updated');
  for (const request of writes) {
    assert.equal(request.headers.get('If-Match'), '"3"');
    assert.equal(request.headers.get('Idempotency-Key'), writes[0].headers.get('Idempotency-Key'));
    assert.equal(request.headers.get('X-SF-CSRF'), '1');
    for (const header of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(request.headers.has(header), false);
  }
  assert.equal(f.host.pending(), false);
});

test('leaving and returning to the same context rejects late writes and discards their versions', async t => {
  let release!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return Response.json(project);
    return new Promise<Response>(resolve => {
      release = resolve;
    });
  });
  const f = setup();
  t.after(f.dispose);
  await f.host.getProject(id);
  const write = f.host.updateProject(id, { name: 'Old context' });
  await new Promise<void>(resolve => {
    setImmediate(resolve);
  });
  f.change({ status: 'anonymous' });
  f.change(f.view);
  release(Response.json({ ...project, version: 4 }));
  await assert.rejects(write, { code: 'CONTEXT_CHANGED' });
  assert.equal(f.host.pending(), false);
  await assert.rejects(f.host.deleteProject(id), { code: 'RESOURCE_RELOAD_REQUIRED' });
  f.dispose();
  await assert.rejects(f.host.listProjects(), { code: 'TENANT_CONTEXT_REQUIRED' });
});

test('in-progress idempotency stays recoverable, while a definitive version conflict releases the attempt', async t => {
  let code = 'IDEMPOTENCY_REQUEST_IN_PROGRESS';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code }, { status: 409 }));
  const f = setup();
  t.after(f.dispose);
  await assert.rejects(f.host.createProject({ name: 'Project' }), { code });
  assert.equal(f.host.pending(), true);
  code = 'VERSION_CONFLICT';
  await assert.rejects(f.host.retryPending(), { code });
  assert.equal(f.host.pending(), false);
});
