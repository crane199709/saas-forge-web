import type { SessionView } from './console-session';

export interface ConsoleActionContext {
  sessionId: string;
  ownerId: string;
  type: 'TENANT' | 'PLATFORM';
  tenantId?: string;
  membershipId?: string;
}

/** 确认弹窗之前固定当前操作主体；确认后需重新与实时会话比较。 */
export function captureConsoleActionContext(view: SessionView, requiredType: ConsoleActionContext['type']) {
  const snapshot = view.snapshot;
  const context = snapshot?.activeContext;
  if (view.status !== 'authenticated' || !snapshot?.identity?.identityId || context?.type !== requiredType)
    return undefined;
  return {
    sessionId: snapshot.sessionId,
    ownerId: snapshot.identity.identityId,
    type: context.type,
    tenantId: context.tenantId,
    membershipId: context.membershipId
  } satisfies ConsoleActionContext;
}

export function sameConsoleActionContext(expected: ConsoleActionContext, view: SessionView) {
  const actual = captureConsoleActionContext(view, expected.type);
  return Boolean(
    actual &&
    actual.sessionId === expected.sessionId &&
    actual.ownerId === expected.ownerId &&
    actual.type === expected.type &&
    actual.tenantId === expected.tenantId &&
    actual.membershipId === expected.membershipId
  );
}
