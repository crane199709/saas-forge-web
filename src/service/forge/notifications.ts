import type { PlatformTenantsApi, TenantAdministratorPasswordSetup } from '@crane199709/saas-forge-api-client';
import type { SessionView } from '../../runtime/console-session';
import { TenantFailure, failureCode } from './tenants';
type Session = { readonly state: SessionView; subscribe(listener: (state: SessionView) => void): () => void };
type Pending = { actor: string; beforeId?: string; resendId?: string };
export interface NotificationState {
  tenantId?: string;
  progress?: TenantAdministratorPasswordSetup;
  busy: boolean;
  checked: boolean;
  unknown: boolean;
  problem?: TenantFailure['code'];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function valid(value: unknown): asserts value {
  if (!value) throw new TenantFailure('invalid');
}
function progressView(value: TenantAdministratorPasswordSetup, tenantId: string) {
  valid(
    value &&
      value.tenantId === tenantId &&
      ['NOT_APPLICABLE', 'PENDING', 'MAIL_SERVICE_ACCEPTED', 'PASSWORD_READY', 'ACTION_REQUIRED'].includes(
        value.state
      ) &&
      ['NONE', 'PENDING', 'COMPLETED', 'UNKNOWN'].includes(value.operationState) &&
      typeof value.canResend === 'boolean' &&
      typeof value.canContinue === 'boolean'
  );
  valid(value.resendId === undefined || uuid.test(value.resendId));
  valid(
    !value.canResend ||
      (['NONE', 'COMPLETED'].includes(value.operationState) &&
        !['NOT_APPLICABLE', 'PASSWORD_READY'].includes(value.state))
  );
  valid(!value.canContinue || (value.operationState === 'PENDING' && value.resendId));
  valid(!['PENDING', 'COMPLETED'].includes(value.operationState) || value.resendId);
  return {
    tenantId: value.tenantId,
    state: value.state,
    operationState: value.operationState,
    canResend: value.canResend,
    canContinue: value.canContinue,
    resendId: value.resendId
  };
}
/** 通知与初始化独立；仅发布允许展示的权威业务字段。 */
export class NotificationWorkspace {
  private view: NotificationState = { busy: false, checked: false, unknown: false };
  private listeners = new Set<(state: NotificationState) => void>();
  private owner?: string;
  private originalKey?: string;
  private generation = 0;
  private controller = new AbortController();
  private unsubscribe: () => void;
  constructor(
    private readonly api: PlatformTenantsApi,
    private readonly context: {
      session: Session;
      key(): string;
      storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
      exclusive<T>(tenantId: string, operation: () => Promise<T>): Promise<T>;
    }
  ) {
    this.unsubscribe = context.session.subscribe(state => {
      const snapshot = state.snapshot;
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
  subscribe(listener: (state: NotificationState) => void) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  private publish(update: Partial<NotificationState>) {
    this.view = { ...this.view, ...update };
    this.listeners.forEach(listener => listener(this.view));
  }
  private reset(tenantId?: string) {
    this.generation += 1;
    this.originalKey = undefined;
    this.controller.abort();
    this.controller = new AbortController();
    this.view = { tenantId, busy: false, checked: false, unknown: false };
    this.publish({});
  }
  dispose() {
    this.unsubscribe();
    this.reset();
    this.listeners.clear();
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
    return `sf:tenant-notification:${tenantId}`;
  }
  private actor() {
    return this.context.session.state.snapshot?.identity?.identityId;
  }
  private pending(tenantId: string): Pending | undefined {
    const text = this.context.storage.getItem(NotificationWorkspace.storageKey(tenantId));
    if (!text) return undefined;
    const value = JSON.parse(text) as Pending;
    valid(
      value &&
        typeof value.actor === 'string' &&
        value.actor.length > 0 &&
        (value.beforeId === undefined || uuid.test(value.beforeId)) &&
        (value.resendId === undefined || uuid.test(value.resendId))
    );
    return value;
  }
  private async read(tenantId: string) {
    const storageKey = NotificationWorkspace.storageKey(tenantId);
    const before = this.context.storage.getItem(storageKey);
    const pending = this.pending(tenantId);
    const own = pending?.actor === this.actor();
    const selector: { resendId?: string; idempotencyKey?: string } = {};
    if (own && pending?.resendId) selector.resendId = pending.resendId;
    else if (own && this.originalKey) selector.idempotencyKey = this.originalKey;
    const value = await this.call(options =>
      this.api.getTenantAdministratorPasswordSetup({ tenantId, ...selector }, options)
    );
    const progress = progressView(value, tenantId);
    valid(!selector.resendId || value.resendId === selector.resendId || value.operationState === 'UNKNOWN');
    if (before !== this.context.storage.getItem(storageKey)) throw new TenantFailure('stale');
    // 未获得句柄时，仅同一操作者的新权威记录可关联本次重发；旧完成记录不能解除未知锁。
    if (
      pending &&
      own &&
      progress.resendId &&
      (pending.resendId === progress.resendId || (!pending.resendId && pending.beforeId !== progress.resendId))
    ) {
      if (progress.operationState === 'COMPLETED') {
        this.context.storage.removeItem(storageKey);
        this.originalKey = undefined;
      } else if (progress.operationState === 'PENDING') {
        this.context.storage.setItem(storageKey, JSON.stringify({ ...pending, resendId: progress.resendId }));
        this.originalKey = undefined;
      }
    }
    return { progress, unknown: Boolean(this.pending(tenantId)) || progress.operationState === 'UNKNOWN' };
  }
  async check(tenantId: string) {
    if (tenantId !== this.view.tenantId) this.reset(tenantId);
    if (this.view.busy) return;
    const generation = this.generation;
    this.publish({ busy: true, checked: false, problem: undefined });
    try {
      valid(uuid.test(tenantId));
      const result = await this.read(tenantId);
      if (generation === this.generation) this.publish({ ...result, checked: true });
    } catch (error) {
      if (generation === this.generation) this.publish({ problem: failureCode(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  private ready() {
    return Boolean(
      this.owner && this.context.session.state.status === 'authenticated' && this.view.checked && !this.view.busy
    );
  }
  canResend() {
    try {
      return this.ready() && this.view.progress?.canResend === true && !this.pending(this.view.tenantId!);
    } catch {
      return false;
    }
  }
  canContinue() {
    try {
      const pending = this.pending(this.view.tenantId!);
      return (
        this.ready() &&
        this.view.progress?.canContinue === true &&
        (!pending || (pending.actor === this.actor() && pending.resendId === this.view.progress.resendId))
      );
    } catch {
      return false;
    }
  }
  resend() {
    return this.run('resend');
  }
  continueOperation() {
    return this.run('continue');
  }
  private async run(action: 'resend' | 'continue') {
    if (!(action === 'resend' ? this.canResend() : this.canContinue())) return false;
    const tenantId = this.view.tenantId!;
    const expected = this.view.progress?.resendId;
    const generation = this.generation;
    this.publish({ busy: true, checked: false, problem: undefined });
    try {
      await this.context.exclusive(tenantId, async () => {
        if (generation !== this.generation) throw new TenantFailure('stale');
        const result = await this.read(tenantId);
        this.publish(result);
        const pending = this.pending(tenantId);
        if (
          action === 'resend'
            ? !result.progress.canResend || pending
            : result.progress.resendId !== expected ||
              !result.progress.canContinue ||
              !expected ||
              (pending && (pending.actor !== this.actor() || pending.resendId !== expected))
        )
          throw new TenantFailure('stale');
        const key = action === 'resend' ? this.context.key() : undefined;
        if (key) valid(uuid.test(key));
        this.context.storage.setItem(
          NotificationWorkspace.storageKey(tenantId),
          JSON.stringify({
            actor: this.actor(),
            beforeId: expected,
            resendId: action === 'continue' ? expected : undefined
          })
        );
        this.originalKey = key;
        this.publish({ unknown: true });
        // 恢复入口由服务端还原原 Key，永远不调用初始化或订阅接口。
        let writeError: unknown;
        try {
          await this.call(options =>
            action === 'resend'
              ? this.api.resendTenantAdministratorPasswordSetup({ tenantId, idempotencyKey: key! }, options)
              : this.api.recoverTenantAdministratorPasswordSetup({ tenantId, resendId: expected!, body: {} }, options)
          );
        } catch (error) {
          writeError = error;
        }
        if (generation !== this.generation) throw new TenantFailure('stale');
        // 响应丢失后先按内存中的原 Key 核查，尽早取得可跨刷新恢复的非敏感句柄。
        const latest = await this.read(tenantId);
        this.publish({
          ...latest,
          checked: true,
          problem:
            writeError && ['NONE', 'UNKNOWN'].includes(latest.progress.operationState)
              ? failureCode(writeError)
              : undefined
        });
      });
      return this.view.progress?.operationState === 'COMPLETED';
    } catch (error) {
      if (generation === this.generation) this.publish({ checked: false, problem: failureCode(error) });
      return false;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
}
