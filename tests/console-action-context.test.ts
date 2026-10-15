import assert from 'node:assert/strict';
import test from 'node:test';
import { captureConsoleActionContext, sameConsoleActionContext } from '../src/runtime/console-action-context';
import type { SessionView } from '../src/runtime/console-session';

const tenantView: SessionView = {
  status: 'authenticated',
  snapshot: {
    sessionId: '019944ca-0000-7000-8000-000000000001',
    revision: '1',
    state: 'AUTHENTICATED',
    identity: { identityId: '019944ca-0000-7000-8000-000000000002', email: 'owner@example.test' },
    activeContext: {
      type: 'TENANT',
      tenantId: '019944ca-0000-7000-8000-000000000004',
      membershipId: '019944ca-0000-7000-8000-000000000006'
    },
    availableContexts: { platform: false, companies: [] }
  }
};

test('a confirmed Tenant action is invalid after the session, owner, or Tenant changes', () => {
  const captured = captureConsoleActionContext(tenantView, 'TENANT');
  assert.ok(captured);
  assert.equal(sameConsoleActionContext(captured, tenantView), true);
  assert.equal(sameConsoleActionContext(captured, { ...tenantView, status: 'blocked' }), false);
  assert.equal(
    sameConsoleActionContext(captured, {
      ...tenantView,
      snapshot: {
        ...tenantView.snapshot!,
        sessionId: '019944ca-0000-7000-8000-000000000011'
      }
    }),
    false
  );
  assert.equal(
    sameConsoleActionContext(captured, {
      ...tenantView,
      snapshot: {
        ...tenantView.snapshot!,
        identity: {
          identityId: '019944ca-0000-7000-8000-000000000012',
          email: 'other@example.test'
        }
      }
    }),
    false
  );
  assert.equal(
    sameConsoleActionContext(captured, {
      ...tenantView,
      snapshot: {
        ...tenantView.snapshot!,
        activeContext: {
          type: 'TENANT',
          tenantId: '019944ca-0000-7000-8000-000000000014',
          membershipId: '019944ca-0000-7000-8000-000000000016'
        }
      }
    }),
    false
  );
});

test('a platform revocation confirmation cannot cross owner or Context boundaries', () => {
  assert.equal(captureConsoleActionContext(tenantView, 'PLATFORM'), undefined);
  const platformView: SessionView = {
    ...tenantView,
    snapshot: { ...tenantView.snapshot!, activeContext: { type: 'PLATFORM' } }
  };
  const captured = captureConsoleActionContext(platformView, 'PLATFORM');
  assert.ok(captured);
  assert.equal(sameConsoleActionContext(captured, platformView), true);
  assert.equal(sameConsoleActionContext(captured, tenantView), false);
});
