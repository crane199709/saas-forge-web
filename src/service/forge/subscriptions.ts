import { ResponseError } from '@crane199709/saas-forge-api-client';
import type {
  Plan,
  PlatformEntitlementBootstrapApi,
  SubscriptionOperationRecovery,
  TenantSubscription
} from '@crane199709/saas-forge-api-client';
import type { SessionView } from '../../runtime/console-session';
import type { EntitlementWorkspace } from './entitlements';
import { maxUsersLimit } from './entitlements';
import type { TenantWorkspace } from './tenants';

type Session = { readonly state: SessionView; subscribe(listener: (state: SessionView) => void): () => void };
export type SubscriptionOperationView = Omit<SubscriptionOperationRecovery, 'idempotencyKey'>;
export class SubscriptionFailure extends Error {
  constructor(readonly code: 'invalid' | 'unavailable' | 'forbidden' | 'stale' | 'input' | 'pending') {
    super(code);
  }
}
export const subscriptionFailure = (error: unknown): SubscriptionFailure['code'] =>
  error instanceof SubscriptionFailure ? error.code : 'unavailable';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
function valid(value: unknown): asserts value {
  if (!value) throw new SubscriptionFailure('invalid');
}
function sameExpiry(actual: Date | null, expected: Date | null) {
  return expected === null ? actual === null : date(actual) && actual.getTime() === expected.getTime();
}
/** 输入必须携带时区，拒绝 Date 自动滚动无效日历日期和无时区本地时间。 */
export function parseSubscriptionExpiry(input: string): Date | null | undefined {
  if (!input.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/.exec(input);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    !date(calendar) ||
    calendar.getUTCFullYear() !== Number(year) ||
    calendar.getUTCMonth() + 1 !== Number(month) ||
    calendar.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    return undefined;
  const result = new Date(input);
  return date(result) && result.getTime() > Date.now() ? result : undefined;
}
async function collect<T extends { id: string }>(
  read: (cursor?: string) => Promise<{ items: T[]; hasMore: boolean; nextCursor: string | null }>
) {
  const records = new Map<string, T>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    // 授权必须基于完整分页，不发布部分记录。
    // eslint-disable-next-line no-await-in-loop
    const page = await read(cursor);
    valid(page && Array.isArray(page.items) && typeof page.hasMore === 'boolean');
    valid(
      page.hasMore
        ? typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.items.length > 0
        : page.nextCursor === null
    );
    for (const row of page.items) {
      valid(row && uuid.test(row.id) && !records.has(row.id));
      records.set(row.id, row);
    }
    cursor = page.hasMore ? page.nextCursor! : undefined;
    valid(!cursor || !cursors.has(cursor));
    if (cursor) cursors.add(cursor);
    valid(cursors.size <= 1000);
  } while (cursor);
  return [...records.values()];
}
function validateOperation(row: SubscriptionOperationRecovery, tenantId: string) {
  valid(
    row &&
      uuid.test(row.id) &&
      row.tenantId === tenantId &&
      ['COMMITTED', 'PROCESSING', 'NOT_COMMITTED', 'UNKNOWN'].includes(row.state) &&
      typeof row.canReplay === 'boolean' &&
      date(row.createdAt) &&
      date(row.replayUntil)
  );
  valid(row.idempotencyKey === undefined || uuid.test(row.idempotencyKey));
  valid(row.subscriptionId === undefined || uuid.test(row.subscriptionId));
  valid(row.state !== 'COMMITTED' || row.subscriptionId);
  valid(!row.canReplay || (['NOT_COMMITTED', 'COMMITTED'].includes(row.state) && row.idempotencyKey));
  return row;
}

export interface SubscriptionState {
  tenantId?: string;
  snapshot?: TenantSubscription;
  plans: Plan[];
  limitByPlan: Record<string, number>;
  operations: SubscriptionOperationView[];
  busy: boolean;
  checked: boolean;
  snapshotChecked: boolean;
  operationsChecked: boolean;
  unknown: boolean;
  problem?: SubscriptionFailure['code'];
}
/** 订阅状态和原操作材料由会话实例持有；换页不丢失未知锁，换账号清除私有材料。 */
export class SubscriptionWorkspace {
  private view: SubscriptionState = {
    plans: [],
    limitByPlan: {},
    operations: [],
    busy: false,
    checked: false,
    snapshotChecked: false,
    operationsChecked: false,
    unknown: false
  };
  private listeners = new Set<(state: SubscriptionState) => void>();
  private materials = new Map<string, SubscriptionOperationRecovery>();
  private attempts = new Map<string, string>();
  private controller = new AbortController();
  private generation = 0;
  private owner?: string;
  private actor?: string;
  private unsubscribe: () => void;
  constructor(
    private readonly api: PlatformEntitlementBootstrapApi,
    private readonly context: {
      session: Session;
      key: () => string;
      tenants: TenantWorkspace;
      plans: EntitlementWorkspace;
    }
  ) {
    this.unsubscribe = context.session.subscribe(state => {
      const snapshot = state.snapshot;
      const actor = snapshot?.identity?.identityId;
      const platform =
        ['authenticated', 'checking'].includes(state.status) && snapshot?.activeContext?.type === 'PLATFORM';
      const owner = platform ? `${actor}:${snapshot.sessionId}:${snapshot.revision}` : undefined;
      const interrupted = state.status === 'loading' || state.status === 'blocked';
      const retain = interrupted || (actor !== undefined && actor === this.actor);
      if (owner !== this.owner || (!retain && this.attempts.size)) {
        this.owner = owner;
        this.reset(retain);
      }
      if (!interrupted) this.actor = actor;
    });
  }
  get state() {
    return this.view;
  }
  subscribe(listener: (state: SubscriptionState) => void) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  private publish(update: Partial<SubscriptionState>) {
    this.view = { ...this.view, ...update };
    this.view.unknown = Boolean(this.view.tenantId && this.attempts.has(this.view.tenantId));
    this.listeners.forEach(listener => listener(this.view));
  }
  private reset(retain = false) {
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
    this.materials.clear();
    if (!retain) this.attempts.clear();
    this.publish({
      tenantId: undefined,
      snapshot: undefined,
      plans: [],
      limitByPlan: {},
      operations: [],
      busy: false,
      checked: false,
      snapshotChecked: false,
      operationsChecked: false,
      problem: undefined
    });
  }
  dispose() {
    this.unsubscribe();
    this.reset();
    this.listeners.clear();
  }
  private async call<T>(operation: (options: RequestInit) => Promise<T>) {
    if (!this.owner || this.context.session.state.status !== 'authenticated')
      throw new SubscriptionFailure('forbidden');
    const generation = this.generation;
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]);
    try {
      const result = await operation({ signal, redirect: 'error' });
      if (generation !== this.generation || signal.aborted) throw new SubscriptionFailure('stale');
      return result;
    } catch (error) {
      if (generation !== this.generation) throw new SubscriptionFailure('stale');
      if (error instanceof SubscriptionFailure) throw error;
      if (error instanceof ResponseError && [401, 403].includes(error.response.status))
        throw new SubscriptionFailure('forbidden');
      throw new SubscriptionFailure('unavailable');
    }
  }
  private async loadSnapshot(tenantId: string) {
    await this.call(options => this.context.tenants.detail(tenantId, options.signal!));
    const snapshot = await this.call(options => this.api.getTenantSubscription({ tenantId }, options));
    valid(snapshot && date(snapshot.observedAt) && typeof snapshot.effective === 'boolean');
    const subscription = snapshot.subscription;
    if (subscription === null)
      valid(!snapshot.effective && snapshot.maxUsersLimit === null && snapshot.maxUsersUsed === null);
    else {
      valid(
        subscription &&
          uuid.test(subscription.id) &&
          subscription.tenantId === tenantId &&
          uuid.test(subscription.planId) &&
          subscription.status === 'ACTIVE' &&
          date(subscription.createdAt) &&
          (subscription.endsAt === null || date(subscription.endsAt))
      );
      valid(
        Number.isSafeInteger(snapshot.maxUsersLimit) &&
          snapshot.maxUsersLimit! >= 0 &&
          snapshot.maxUsersLimit! <= 2147483647 &&
          Number.isSafeInteger(snapshot.maxUsersUsed) &&
          snapshot.maxUsersUsed! >= 0
      );
    }
    this.publish({ snapshot, snapshotChecked: true });
    return snapshot;
  }
  private async loadPlans() {
    const definition = await this.call(options => this.context.plans.maxUsers(options.signal!));
    const allPlans = await collect(cursor =>
      this.call(options => this.context.plans.list({ cursor, limit: 100, status: 'ACTIVE' }, options.signal!))
    );
    const plans = allPlans.filter(
      (row): row is Plan =>
        'quotaLimits' in row &&
        row.status === 'ACTIVE' &&
        definition?.status === 'ACTIVE' &&
        (maxUsersLimit(row, definition) ?? 0) >= 1
    );
    this.publish({
      plans,
      limitByPlan: Object.fromEntries(plans.map(row => [row.id, maxUsersLimit(row, definition)!]))
    });
  }
  private async load(tenantId: string) {
    const snapshot = await this.loadSnapshot(tenantId);
    await this.loadPlans();
    return snapshot;
  }
  async read(tenantId: string) {
    if (tenantId !== this.view.tenantId) {
      this.reset(true);
      this.publish({ tenantId });
    }
    if (this.view.busy) return;
    const generation = this.generation;
    this.publish({ busy: true, checked: false, snapshotChecked: false, operationsChecked: false, problem: undefined });
    try {
      valid(uuid.test(tenantId));
      const results = await Promise.allSettled([
        this.loadSnapshot(tenantId),
        this.loadPlans(),
        this.loadOperations(tenantId)
      ]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      this.publish({ checked: true });
    } catch (error) {
      if (generation === this.generation) this.publish({ problem: subscriptionFailure(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  private async loadOperations(tenantId: string) {
    this.materials.clear();
    this.publish({ operationsChecked: false });
    const records = await collect(cursor =>
      this.call(options => this.api.listSubscriptionOperations({ tenantId, cursor, limit: 100 }, options))
    );
    records.forEach(row => validateOperation(row, tenantId));
    this.materials = new Map(records.map(row => [row.id, row]));
    const key = this.attempts.get(tenantId);
    if (key && records.some(row => row.idempotencyKey === key && row.state === 'COMMITTED'))
      this.attempts.delete(tenantId);
    this.publish({
      operationsChecked: true,
      operations: records.map(({ idempotencyKey: _key, ...row }) => ({
        ...row,
        canReplay: row.state === 'NOT_COMMITTED' && row.canReplay && row.replayUntil.getTime() > Date.now()
      }))
    });
  }
  private blocked(tenantId: string) {
    return this.attempts.has(tenantId) || [...this.materials.values()].some(row => row.tenantId === tenantId);
  }
  canCreate(tenantId: string) {
    return (
      Boolean(this.owner) &&
      this.context.session.state.status === 'authenticated' &&
      this.view.tenantId === tenantId &&
      this.view.checked &&
      !this.view.busy &&
      this.view.snapshot?.subscription === null &&
      !this.blocked(tenantId) &&
      this.view.plans.length > 0
    );
  }
  async create(tenantId: string, planId: string, endsAt: Date | null) {
    if (!this.canCreate(tenantId)) return false;
    const generation = this.generation;
    this.publish({ busy: true, checked: false, snapshotChecked: false, operationsChecked: false, problem: undefined });
    try {
      await this.load(tenantId);
      await this.loadOperations(tenantId);
      if (this.blocked(tenantId)) throw new SubscriptionFailure('pending');
      if (
        this.view.snapshot?.subscription !== null ||
        !this.view.plans.some(row => row.id === planId) ||
        (endsAt !== null && (!date(endsAt) || endsAt.getTime() <= Date.now()))
      )
        throw new SubscriptionFailure('input');
      const key = this.context.key();
      valid(uuid.test(key));
      this.attempts.set(tenantId, key);
      this.publish({ snapshotChecked: false });
      const row = await this.call(options =>
        this.api.createInitialSubscription(
          { tenantId, idempotencyKey: key, createInitialSubscriptionRequest: { planId, endsAt } },
          options
        )
      );
      valid(
        row &&
          uuid.test(row.id) &&
          row.tenantId === tenantId &&
          row.planId === planId &&
          row.status === 'ACTIVE' &&
          date(row.createdAt) &&
          sameExpiry(row.endsAt, endsAt)
      );
      // 写响应不替代权威回读；回读失败仍保留原操作锁。
      const authoritative = await this.loadSnapshot(tenantId);
      valid(authoritative.subscription?.id === row.id);
      this.attempts.delete(tenantId);
      await this.loadOperations(tenantId);
      this.publish({ checked: true });
      return true;
    } catch (error) {
      if (generation === this.generation) this.publish({ checked: false, problem: subscriptionFailure(error) });
      return false;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  async continueOperation(id: string) {
    const tenantId = this.view.tenantId;
    const cached = this.materials.get(id);
    if (
      !tenantId ||
      !cached ||
      !this.view.operationsChecked ||
      this.view.busy ||
      !this.owner ||
      this.context.session.state.status !== 'authenticated'
    )
      return false;
    const generation = this.generation;
    this.publish({ busy: true, checked: false, snapshotChecked: false, operationsChecked: false, problem: undefined });
    try {
      await this.loadOperations(tenantId);
      const listed = this.materials.get(id);
      valid(listed && listed.idempotencyKey === cached.idempotencyKey);
      const row = validateOperation(
        await this.call(options => this.api.getSubscriptionOperation({ operationId: id }, options)),
        tenantId
      );
      valid(row.id === id && row.idempotencyKey === cached.idempotencyKey);
      if (row.state !== 'COMMITTED') {
        valid(
          row.state === 'NOT_COMMITTED' && row.canReplay && row.idempotencyKey && row.replayUntil.getTime() > Date.now()
        );
        this.attempts.set(tenantId, row.idempotencyKey);
        this.publish({});
        const result = validateOperation(
          await this.call(options =>
            this.api.recoverSubscriptionOperation(
              { operationId: id, idempotencyKey: row.idempotencyKey!, body: {} },
              options
            )
          ),
          tenantId
        );
        valid(result.id === id && result.idempotencyKey === row.idempotencyKey);
      }
      await this.loadSnapshot(tenantId);
      await this.loadOperations(tenantId);
      return Boolean(this.view.snapshot?.subscription);
    } catch (error) {
      if (generation === this.generation) this.publish({ checked: false, problem: subscriptionFailure(error) });
      return false;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
}
