import { ResponseError } from '@crane199709/saas-forge-api-client';
import type { PlatformTenantsApi, TenantLifecycle } from '@crane199709/saas-forge-api-client';
import type { SessionView } from '../../runtime/console-session';
import { TenantFailure, failureCode } from './tenants';

export type LifecycleAction = 'suspend' | 'resume' | 'recover' | 'continue';
type Pending = { action: LifecycleAction; operationId?: string; state: TenantLifecycle['state'] };
type Session = { readonly state: SessionView; subscribe(listener: (state: SessionView) => void): () => void };
export interface LifecycleState {
  tenantId?: string;
  snapshot?: TenantLifecycle;
  busy: boolean;
  unknown: boolean;
  problem?: TenantFailure['code'];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validate(value: TenantLifecycle, tenantId: string) {
  if (
    !value ||
    value.tenantId !== tenantId ||
    !['NONE', 'PENDING', 'COMPLETED', 'RETRY_REQUIRED', 'RECOVERY_REQUIRED'].includes(value.state) ||
    ![value.canSuspend, value.canResume, value.canContinue, value.canRecoverSuspension].every(
      flag => typeof flag === 'boolean'
    ) ||
    (value.state !== 'NONE' &&
      (!value.operationId || !uuid.test(value.operationId) || !['SUSPEND', 'RESUME'].includes(value.action!))) ||
    (['PENDING', 'RECOVERY_REQUIRED'].includes(value.state) && (value.canSuspend || value.canResume)) ||
    (value.canContinue && value.state !== 'PENDING') ||
    (value.canRecoverSuspension && (value.state !== 'RECOVERY_REQUIRED' || value.action !== 'SUSPEND')) ||
    (value.canSuspend && value.canResume)
  )
    throw new TenantFailure('invalid');
  return value;
}
/** 生命周期以权威快照授权；页面不持有 Token 或幂等键。 */
export class LifecycleWorkspace {
  private view: LifecycleState = { busy: false, unknown: false };
  private listeners = new Set<(state: LifecycleState) => void>();
  private generation = 0;
  private owner?: string;
  private actor?: string;
  private recoveryKeys = new Map<string, { operationId: string; key: string }>();
  private controller = new AbortController();
  private unsubscribe: () => void;
  constructor(
    private readonly api: PlatformTenantsApi,
    private readonly context: {
      session: Session;
      key: () => string;
      storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
      exclusive: <T>(tenantId: string, operation: () => Promise<T>) => Promise<T>;
    }
  ) {
    this.unsubscribe = context.session.subscribe(state => {
      const snapshot = state.snapshot;
      const actor = snapshot?.identity?.identityId;
      if (!['loading', 'blocked', 'checking'].includes(state.status)) {
        if (actor !== this.actor) this.recoveryKeys.clear();
        this.actor = actor;
      }
      const owner =
        ['authenticated', 'checking'].includes(state.status) && snapshot?.activeContext?.type === 'PLATFORM'
          ? `${snapshot.identity?.identityId}:${snapshot.sessionId}:${snapshot.revision}`
          : undefined;
      if (owner !== this.owner) {
        this.owner = owner;
        this.reset();
      }
    });
  }
  get state() {
    return this.view;
  }
  subscribe(listener: (state: LifecycleState) => void) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  private publish(update: Partial<LifecycleState>) {
    this.view = { ...this.view, ...update };
    this.listeners.forEach(listener => listener(this.view));
  }
  private reset(tenantId?: string) {
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
    this.view = { tenantId, busy: false, unknown: false };
    this.publish({});
  }
  private async call<T>(operation: (options: RequestInit) => Promise<T>) {
    if (!this.owner || this.context.session.state.status !== 'authenticated') throw new TenantFailure('forbidden');
    const generation = this.generation;
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]);
    const result = await operation({ signal, redirect: 'error' });
    if (generation !== this.generation || signal.aborted) throw new TenantFailure('stale');
    return result;
  }
  private static storageKey(tenantId: string) {
    return `sf:tenant-lifecycle:${tenantId}`;
  }
  private pending(tenantId: string): Pending | undefined {
    const value = this.context.storage.getItem(LifecycleWorkspace.storageKey(tenantId));
    if (!value) return undefined;
    const pending = JSON.parse(value) as Pending;
    if (
      !pending ||
      !['suspend', 'resume', 'recover', 'continue'].includes(pending.action) ||
      !['NONE', 'PENDING', 'COMPLETED', 'RETRY_REQUIRED', 'RECOVERY_REQUIRED'].includes(pending.state) ||
      (pending.operationId !== undefined && !uuid.test(pending.operationId))
    )
      throw new TenantFailure('invalid');
    return pending;
  }
  private async read(tenantId: string) {
    const before = this.context.storage.getItem(LifecycleWorkspace.storageKey(tenantId));
    const snapshot = validate(await this.call(options => this.api.getTenantLifecycle({ tenantId }, options)), tenantId);
    if (before !== this.context.storage.getItem(LifecycleWorkspace.storageKey(tenantId)))
      throw new TenantFailure('stale');
    const pending = this.pending(tenantId);
    if (pending) {
      // 只有权威新操作或原操作进展才能解除未知锁；原快照和缺失记录不能证明未提交。
      const newOperation =
        snapshot.operationId &&
        snapshot.operationId !== pending.operationId &&
        snapshot.action === (pending.action === 'resume' ? 'RESUME' : 'SUSPEND');
      const progressed =
        ['continue', 'recover'].includes(pending.action) &&
        snapshot.operationId === pending.operationId &&
        snapshot.state !== pending.state;
      if (newOperation || progressed) this.context.storage.removeItem(LifecycleWorkspace.storageKey(tenantId));
    }
    this.publish({ unknown: Boolean(this.pending(tenantId)) });
    return snapshot;
  }
  async check(tenantId: string): Promise<void> {
    if (tenantId !== this.view.tenantId) this.reset(tenantId);
    if (this.view.busy) return;
    const generation = this.generation;
    this.publish({ busy: true, snapshot: undefined, problem: undefined });
    try {
      if (!uuid.test(tenantId)) throw new TenantFailure('invalid');
      this.publish({ snapshot: await this.read(tenantId) });
    } catch (error) {
      if (generation === this.generation) this.publish({ problem: failureCode(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  can(action: LifecycleAction) {
    if (!this.owner || this.context.session.state.status !== 'authenticated' || this.view.busy || !this.view.snapshot)
      return false;
    try {
      return this.pendingAllows(action, this.view.snapshot) && LifecycleWorkspace.allowed(action, this.view.snapshot);
    } catch {
      return false;
    }
  }
  private pendingAllows(action: LifecycleAction, snapshot: TenantLifecycle) {
    const pending = this.pending(snapshot.tenantId);
    return (
      !pending ||
      (pending.action === action &&
        ['continue', 'recover'].includes(action) &&
        pending.operationId === snapshot.operationId)
    );
  }
  private static allowed(action: LifecycleAction, snapshot?: TenantLifecycle) {
    if (!snapshot) return false;
    return {
      suspend: snapshot.canSuspend,
      resume: snapshot.canResume,
      recover: snapshot.canRecoverSuspension,
      continue: snapshot.canContinue
    }[action];
  }
  async run(action: LifecycleAction): Promise<void> {
    if (!this.can(action)) return;
    const tenantId = this.view.tenantId!;
    const expected = this.view.snapshot?.operationId;
    const generation = this.generation;
    this.publish({ busy: true, problem: undefined });
    try {
      await this.context.exclusive(tenantId, async () => {
        if (generation !== this.generation) return;
        const snapshot = await this.read(tenantId);
        if (
          !this.pendingAllows(action, snapshot) ||
          !LifecycleWorkspace.allowed(action, snapshot) ||
          snapshot.operationId !== expected
        )
          throw new TenantFailure('stale');
        const previousKey = this.recoveryKeys.get(tenantId);
        const idempotencyKey =
          action === 'recover' && previousKey && previousKey.operationId === snapshot.operationId
            ? previousKey.key
            : this.context.key();
        if (action === 'recover')
          this.recoveryKeys.set(tenantId, { operationId: snapshot.operationId!, key: idempotencyKey });
        // 跨标签只保留无凭据的未决标记，写入失败时禁止发出变更；幂等键不落盘。
        this.context.storage.setItem(
          LifecycleWorkspace.storageKey(tenantId),
          JSON.stringify({ action, operationId: snapshot.operationId, state: snapshot.state })
        );
        this.publish({ unknown: true });
        const result = await this.call(options => {
          if (action === 'continue')
            return this.api.continueTenantLifecycle({ tenantId, operationId: snapshot.operationId! }, options);
          if (action === 'recover') return this.api.recoverTenantSuspension({ tenantId, idempotencyKey }, options);
          if (action === 'resume') return this.api.resumeTenant({ tenantId, idempotencyKey }, options);
          return this.api.suspendTenant({ tenantId, idempotencyKey }, options);
        });
        if (result.id !== tenantId) throw new TenantFailure('invalid');
        this.recoveryKeys.delete(tenantId);
        this.context.storage.removeItem(LifecycleWorkspace.storageKey(tenantId));
        this.publish({ snapshot: await this.read(tenantId) });
      });
    } catch (error) {
      if (action === 'recover' && error instanceof ResponseError) {
        const body = await error.response.json().catch(() => undefined);
        // 后端明确声明本次恢复已耗尽时，旧键只会重放该结果；下一次恢复仍针对原 workflow。
        if (generation === this.generation && body?.code === 'TENANT_SUSPENSION_RECOVERY_REQUIRED')
          this.recoveryKeys.delete(tenantId);
      }
      if (generation === this.generation) this.publish({ snapshot: undefined, problem: failureCode(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  dispose() {
    this.unsubscribe();
    this.reset();
    this.listeners.clear();
  }
}
