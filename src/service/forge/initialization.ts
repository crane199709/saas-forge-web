import { ResponseError } from '@crane199709/saas-forge-api-client';
import type {
  AdministratorInitializationRequest,
  PlatformEntitlementBootstrapApi,
  PlatformTenantsApi,
  TenantAdministratorInitialization,
  TenantAdministratorPasswordSetup,
  TenantSubscription
} from '@crane199709/saas-forge-api-client';
import type { SessionView } from '../../runtime/console-session';
import { TenantFailure, failureCode } from './tenants';

type Session = { readonly state: SessionView; subscribe(listener: (state: SessionView) => void): () => void };
type Pending = { action: 'start' | 'continue'; initializationId?: string };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface InitializationState {
  tenantId?: string;
  progress?: TenantAdministratorInitialization;
  subscription?: TenantSubscription;
  notification?: TenantAdministratorPasswordSetup['state'];
  busy: boolean;
  checked: boolean;
  unknown: boolean;
  problem?: TenantFailure['code'];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
function valid(value: unknown): asserts value {
  if (!value) throw new TenantFailure('invalid');
}
function progressView(value: TenantAdministratorInitialization, tenantId: string) {
  valid(
    value &&
      value.tenantId === tenantId &&
      [
        'NOT_STARTED',
        'PROCESSING',
        'RECOVERY_REQUIRED',
        'COMPENSATING',
        'RETRY_REQUIRED',
        'SUCCEEDED',
        'FAILED'
      ].includes(value.state) &&
      typeof value.canStart === 'boolean' &&
      typeof value.canContinue === 'boolean'
  );
  valid(value.initializationId === undefined || uuid.test(value.initializationId));
  valid(['NOT_STARTED', 'SUCCEEDED'].includes(value.state) || value.initializationId);
  valid(!value.canStart || ['NOT_STARTED', 'RETRY_REQUIRED'].includes(value.state));
  valid(!value.canContinue || (value.state === 'RECOVERY_REQUIRED' && value.initializationId));
  valid(value.initialAdministratorMembershipId === null || uuid.test(value.initialAdministratorMembershipId));
  valid(
    value.state === 'SUCCEEDED'
      ? value.initialAdministratorMembershipId
      : value.initialAdministratorMembershipId === null
  );
  // 仅向页面发布公开业务字段，服务端附加诊断不得进入产品状态。
  return {
    tenantId,
    initializationId: value.initializationId,
    state: value.state,
    canStart: value.canStart,
    canContinue: value.canContinue,
    initialAdministratorMembershipId: value.initialAdministratorMembershipId
  };
}
function subscriptionView(value: TenantSubscription, tenantId: string) {
  valid(value && date(value.observedAt) && typeof value.effective === 'boolean');
  const row = value.subscription;
  if (row === null) valid(!value.effective && value.maxUsersLimit === null && value.maxUsersUsed === null);
  else {
    valid(
      row &&
        uuid.test(row.id) &&
        row.tenantId === tenantId &&
        row.status === 'ACTIVE' &&
        date(row.createdAt) &&
        (row.endsAt === null || date(row.endsAt))
    );
    valid(
      Number.isSafeInteger(value.maxUsersLimit) &&
        value.maxUsersLimit! >= 0 &&
        value.maxUsersLimit! <= 2147483647 &&
        Number.isSafeInteger(value.maxUsersUsed) &&
        value.maxUsersUsed! >= 0
    );
  }
  return value;
}
/** 初始化进度以服务端持久工作流为准；表单和私有恢复材料不进入可观察状态。 */
export class InitializationWorkspace {
  private view: InitializationState = { busy: false, checked: false, unknown: false };
  private listeners = new Set<(state: InitializationState) => void>();
  private owner?: string;
  private generation = 0;
  private controller = new AbortController();
  private unsubscribe: () => void;
  constructor(
    private readonly api: PlatformTenantsApi,
    private readonly entitlements: PlatformEntitlementBootstrapApi,
    private readonly context: {
      session: Session;
      key(): string;
      storage: Storage;
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
  subscribe(listener: (state: InitializationState) => void) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  private publish(update: Partial<InitializationState>) {
    this.view = { ...this.view, ...update };
    this.listeners.forEach(listener => listener(this.view));
  }
  private reset(tenantId?: string) {
    this.generation += 1;
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
  private async read(tenantId: string) {
    const before = this.context.storage.getItem(InitializationWorkspace.storageKey(tenantId));
    const [progress, subscription] = await Promise.all([
      this.call(options => this.api.getTenantAdministratorInitialization({ tenantId }, options)),
      this.call(options => this.entitlements.getTenantSubscription({ tenantId }, options))
    ]);
    const result = {
      progress: progressView(progress, tenantId),
      subscription: subscriptionView(subscription, tenantId)
    };
    if (before !== this.context.storage.getItem(InitializationWorkspace.storageKey(tenantId)))
      throw new TenantFailure('stale');
    const pending = this.pending(tenantId);
    if (
      pending &&
      result.progress.initializationId &&
      (result.progress.initializationId !== pending.initializationId ||
        (pending.action === 'continue' && ['SUCCEEDED', 'FAILED', 'RETRY_REQUIRED'].includes(result.progress.state)))
    )
      this.context.storage.removeItem(InitializationWorkspace.storageKey(tenantId));
    return { ...result, unknown: Boolean(this.pending(tenantId)) };
  }
  private static storageKey(tenantId: string) {
    return `sf:tenant-initialization:${tenantId}`;
  }
  private pending(tenantId: string): Pending | undefined {
    const text = this.context.storage.getItem(InitializationWorkspace.storageKey(tenantId));
    if (!text) return undefined;
    const value = JSON.parse(text) as Pending;
    valid(
      value &&
        ['start', 'continue'].includes(value.action) &&
        (value.initializationId === undefined || uuid.test(value.initializationId))
    );
    return value;
  }
  private async notification(tenantId: string) {
    try {
      const result = await this.call(options => this.api.getTenantAdministratorPasswordSetup({ tenantId }, options));
      valid(
        result &&
          result.tenantId === tenantId &&
          ['NOT_APPLICABLE', 'PENDING', 'MAIL_SERVICE_ACCEPTED', 'PASSWORD_READY', 'ACTION_REQUIRED'].includes(
            result.state
          )
      );
      return result.state;
    } catch {
      return undefined;
    }
  }
  async check(tenantId: string) {
    if (tenantId !== this.view.tenantId) this.reset(tenantId);
    if (this.view.busy) return;
    const generation = this.generation;
    this.publish({ busy: true, checked: false, problem: undefined });
    try {
      valid(uuid.test(tenantId));
      const result = await this.read(tenantId);
      const notification = await this.notification(tenantId);
      if (generation === this.generation) this.publish({ ...result, notification, checked: true });
    } catch (error) {
      if (generation === this.generation) this.publish({ problem: failureCode(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  private eligible() {
    const snapshot = this.view.subscription;
    return Boolean(
      snapshot?.effective &&
      snapshot.subscription &&
      snapshot.maxUsersLimit! > 0 &&
      (snapshot.subscription.endsAt === null || snapshot.subscription.endsAt.getTime() > Date.now())
    );
  }
  private ready() {
    return Boolean(
      this.owner &&
      this.context.session.state.status === 'authenticated' &&
      this.view.checked &&
      !this.view.busy &&
      this.eligible()
    );
  }
  canStart() {
    try {
      return this.ready() && this.view.progress?.canStart === true && !this.pending(this.view.tenantId!);
    } catch {
      return false;
    }
  }
  canContinue() {
    return this.ready() && this.view.progress?.canContinue === true;
  }
  start(input: AdministratorInitializationRequest) {
    return this.run('start', input);
  }
  continueOperation() {
    return this.run('continue');
  }
  private async run(action: Pending['action'], input?: AdministratorInitializationRequest) {
    if (!(action === 'start' ? this.canStart() : this.canContinue())) return false;
    const tenantId = this.view.tenantId!;
    const expected = this.view.progress?.initializationId;
    const generation = this.generation;
    this.publish({ busy: true, checked: false, problem: undefined });
    try {
      await this.context.exclusive(tenantId, async () => {
        if (generation !== this.generation) throw new TenantFailure('stale');
        const result = await this.read(tenantId);
        this.publish(result);
        const progress = result.progress;
        if (
          !this.eligible() ||
          progress.initializationId !== expected ||
          (action === 'start' ? !progress.canStart || this.pending(tenantId) : !progress.canContinue)
        )
          throw new TenantFailure('stale');
        if (action === 'start') valid(input && validAdministratorInput(input));
        const idempotencyKey = action === 'start' ? this.context.key() : undefined;
        if (idempotencyKey) valid(uuid.test(idempotencyKey));
        // 跨标签仅保留无敏感字段的未决标记；持久化失败不得发送写请求。
        this.context.storage.setItem(
          InitializationWorkspace.storageKey(tenantId),
          JSON.stringify({ action, initializationId: expected })
        );
        this.publish({ unknown: true });
        try {
          await this.call(options =>
            action === 'start'
              ? this.api.initializeTenantAdministrator(
                  { tenantId, idempotencyKey: idempotencyKey!, administratorInitializationRequest: input! },
                  options
                )
              : this.api.recoverTenantAdministratorInitialization(
                  { tenantId, initializationId: expected!, body: {} },
                  options
                )
          );
        } catch (error) {
          // 仅这两个正式鉴权错误证明请求在工作流受理前被拒绝；其余错误保留未知锁。
          if (action === 'start' && (await rejectedBeforeAcceptance(error)) && generation === this.generation) {
            this.context.storage.removeItem(InitializationWorkspace.storageKey(tenantId));
            this.publish({ unknown: false });
          }
          throw error;
        }
        // 写响应不代替权威业务快照；恢复时服务端从原句柄还原原请求和原 Key。
        const latest = await this.read(tenantId);
        const notification = await this.notification(tenantId);
        if (generation !== this.generation) throw new TenantFailure('stale');
        this.publish({ ...latest, notification, checked: true });
      });
      return this.view.progress?.state === 'SUCCEEDED';
    } catch (error) {
      if (generation === this.generation) this.publish({ checked: false, problem: failureCode(error) });
      return false;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
}

export function validAdministratorInput(input: AdministratorInitializationRequest) {
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.administratorEmail) &&
    input.administratorEmail.length <= 320 &&
    (input.administratorDisplayName === undefined ||
      (input.administratorDisplayName.trim().length > 0 && input.administratorDisplayName.length <= 200))
  );
}

async function rejectedBeforeAcceptance(error: unknown) {
  if (!(error instanceof ResponseError)) return false;
  const problem: unknown = await error.response.json().catch(() => undefined);
  if (!problem || typeof problem !== 'object' || !('code' in problem)) return false;
  return (
    (error.response.status === 401 && problem.code === 'ACCESS_TOKEN_INVALID') ||
    (error.response.status === 403 && problem.code === 'PLATFORM_AUTHORIZATION_DENIED')
  );
}
