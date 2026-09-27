import { ResponseError } from '@crane199709/saas-forge-api-client';
import type {
  ListPlansRequest,
  Plan,
  PlanOperationRecovery,
  PlatformEntitlementBootstrapApi,
  QuotaDefinition,
  QuotaDefinitionOperationRecovery
} from '@crane199709/saas-forge-api-client';
import type { SessionView } from '../../runtime/console-session';

export type EntitlementKind = 'plan' | 'quota';
type Operation = PlanOperationRecovery & QuotaDefinitionOperationRecovery;
export type OperationView = Omit<Operation, 'idempotencyKey' | 'result'>;
type Action = Operation['operation'];
type Session = { readonly state: SessionView; subscribe(listener: (state: SessionView) => void): () => void };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const date = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime());
export class EntitlementFailure extends Error {
  constructor(
    readonly code:
      | 'invalid'
      | 'unavailable'
      | 'forbidden'
      | 'notFound'
      | 'stale'
      | 'input'
      | 'definitionRequired'
      | 'pending'
  ) {
    super(code);
  }
}
export function entitlementFailure(error: unknown): EntitlementFailure['code'] {
  return error instanceof EntitlementFailure ? error.code : 'unavailable';
}
function requireValid(value: unknown): asserts value {
  if (!value) throw new EntitlementFailure('invalid');
}
function validatePage<T extends { id: string }>(
  page: { items: T[]; hasMore: boolean; nextCursor: string | null },
  cursor?: string
) {
  requireValid(
    page &&
      Array.isArray(page.items) &&
      typeof page.hasMore === 'boolean' &&
      (page.hasMore
        ? typeof page.nextCursor === 'string' &&
          page.nextCursor.length > 0 &&
          page.nextCursor !== cursor &&
          page.items.length > 0
        : page.nextCursor === null)
  );
  requireValid(new Set(page.items.map(row => row.id)).size === page.items.length);
  return page;
}
export type EntitlementResource = Plan | QuotaDefinition;
function validateResource<T extends EntitlementResource>(row: T): T {
  requireValid(
    row &&
      uuid.test(row.id) &&
      typeof row.code === 'string' &&
      row.code.length > 0 &&
      ['DRAFT', 'ACTIVE', 'RETIRED'].includes(row.status) &&
      date(row.createdAt) &&
      date(row.updatedAt)
  );
  if ('quotaLimits' in row) {
    requireValid(typeof row.displayName === 'string' && row.displayName.trim() && Array.isArray(row.quotaLimits));
    requireValid(new Set(row.quotaLimits.map(limit => limit.quotaDefinitionId)).size === row.quotaLimits.length);
    row.quotaLimits.forEach(limit =>
      requireValid(
        uuid.test(limit.quotaDefinitionId) &&
          Number.isInteger(limit.limit) &&
          limit.limit >= 0 &&
          limit.limit <= 2147483647
      )
    );
  }
  return row;
}
/** max_users 通过权威定义 ID 对应，不能把数组首项当成人数额度。 */
export function maxUsersLimit(plan: Plan, definition?: QuotaDefinition): number | undefined {
  if (!definition || definition.code !== 'max_users') return undefined;
  return plan.quotaLimits.find(row => row.quotaDefinitionId === definition.id)?.limit;
}
export function positiveLimit(input: string): number | undefined {
  if (!/^[0-9]+$/.test(input)) return undefined;
  const value = Number(input);
  return Number.isSafeInteger(value) && value >= 1 && value <= 2147483647 ? value : undefined;
}
export interface EntitlementState {
  busy: boolean;
  checked: boolean;
  operations: OperationView[];
  unknown: boolean;
  problem?: EntitlementFailure['code'];
}

/** 权益操作与私有恢复键由同一会话实例持有；页面只使用记录 ID。 */
export class EntitlementWorkspace {
  private materials = new Map<string, Operation>();
  private attempts = new Map<string, string>();
  private view: EntitlementState = { busy: false, checked: false, operations: [], unknown: false };
  private listeners = new Set<(state: EntitlementState) => void>();
  private controller = new AbortController();
  private owner?: string;
  private actor?: string;
  private generation = 0;
  private unsubscribe: () => void;
  private readonly session: Session;
  private readonly key: () => string;
  constructor(
    readonly kind: EntitlementKind,
    private readonly api: PlatformEntitlementBootstrapApi,
    context: { session: Session; key: () => string }
  ) {
    this.session = context.session;
    this.key = context.key;
    this.unsubscribe = this.session.subscribe(state => {
      const snapshot = state.snapshot;
      const actor = snapshot?.identity?.identityId;
      const platform =
        ['authenticated', 'checking'].includes(state.status) && snapshot?.activeContext?.type === 'PLATFORM';
      const owner = platform ? `${actor}:${snapshot.sessionId}:${snapshot.revision}` : undefined;
      const interrupted = state.status === 'loading' || state.status === 'blocked';
      const retain = interrupted || (actor !== undefined && actor === this.actor);
      if (owner !== this.owner || (!retain && this.attempts.size)) {
        this.owner = owner;
        this.clear(retain);
      }
      if (!interrupted) this.actor = actor;
    });
  }
  get state() {
    return this.view;
  }
  subscribe(listener: (state: EntitlementState) => void) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  private publish(update: Partial<EntitlementState>) {
    this.view = { ...this.view, ...update, unknown: this.attempts.size > 0 };
    this.listeners.forEach(listener => listener(this.view));
  }
  private clear(retain = false) {
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
    this.materials.clear();
    if (!retain) this.attempts.clear();
    this.publish({ busy: false, checked: false, operations: [], problem: undefined });
  }
  dispose() {
    this.unsubscribe();
    this.clear();
    this.listeners.clear();
  }
  private async call<T>(operation: (options: RequestInit) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!this.owner || this.session.state.status !== 'authenticated') throw new EntitlementFailure('forbidden');
    const generation = this.generation;
    const combined = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
    try {
      const result = await operation({ signal: combined, redirect: 'error' });
      if (generation !== this.generation || combined.aborted) throw new EntitlementFailure('stale');
      return result;
    } catch (error) {
      if (generation !== this.generation || signal?.aborted) throw new EntitlementFailure('stale');
      if (error instanceof EntitlementFailure) throw error;
      if (error instanceof ResponseError) {
        if ([401, 403].includes(error.response.status)) throw new EntitlementFailure('forbidden');
        if (error.response.status === 404) throw new EntitlementFailure('notFound');
      }
      throw new EntitlementFailure('unavailable');
    }
  }
  private validateOperation(row: Operation) {
    requireValid(
      row &&
        uuid.test(row.id) &&
        ['CREATE', 'ACTIVATE'].includes(row.operation) &&
        ['COMMITTED', 'PROCESSING', 'NOT_COMMITTED', 'UNKNOWN'].includes(row.state) &&
        typeof row.canReplay === 'boolean' &&
        date(row.createdAt) &&
        date(row.replayUntil)
    );
    const resourceId = this.kind === 'plan' ? row.planId : row.quotaDefinitionId;
    requireValid(resourceId === undefined || uuid.test(resourceId));
    requireValid((row.operation !== 'ACTIVATE' && row.state !== 'COMMITTED') || resourceId);
    requireValid(
      !row.canReplay ||
        (['COMMITTED', 'NOT_COMMITTED'].includes(row.state) && row.idempotencyKey && uuid.test(row.idempotencyKey))
    );
    requireValid(row.code === undefined || (typeof row.code === 'string' && row.code.length > 0));
    return row;
  }
  private scope(action: Action, target: string) {
    return `${this.kind}:${action}:${target}`;
  }
  private blocked(action: Action, target: string) {
    return (
      this.attempts.has(this.scope(action, target)) ||
      [...this.materials.values()].some(row => {
        if (row.state === 'COMMITTED' || row.operation !== action) return false;
        if (action === 'CREATE') return this.kind === 'quota' || row.code === undefined || row.code === target;
        return (this.kind === 'plan' ? row.planId : row.quotaDefinitionId) === target;
      })
    );
  }
  hasUnknown(action: Action, target: string) {
    return this.attempts.has(this.scope(action, target));
  }
  canStart(action: Action, target: string) {
    return (
      Boolean(this.owner) &&
      this.session.state.status === 'authenticated' &&
      this.view.checked &&
      !this.view.busy &&
      !this.blocked(action, target)
    );
  }
  private publishRecords() {
    for (const [scope, key] of this.attempts) {
      if ([...this.materials.values()].some(row => row.idempotencyKey === key && row.state === 'COMMITTED'))
        this.attempts.delete(scope);
    }
    this.publish({
      checked: true,
      operations: [...this.materials.values()].map(({ idempotencyKey: _key, result: _result, ...row }) => ({
        ...row,
        canReplay: row.state === 'NOT_COMMITTED' && row.canReplay && row.replayUntil.getTime() > Date.now()
      }))
    });
  }
  private async loadOperations() {
    this.materials.clear();
    this.publish({ checked: false, operations: [] });
    const records = new Map<string, Operation>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const query = { cursor, limit: 100 };
      // 授权依赖完整记录，分页必须按游标顺序读取。
      const page = validatePage(
        // eslint-disable-next-line no-await-in-loop
        await this.call(options =>
          this.kind === 'plan'
            ? this.api.listPlanOperations(query, options)
            : this.api.listQuotaDefinitionOperations(query, options)
        ),
        cursor
      );
      for (const row of page.items) {
        this.validateOperation(row);
        requireValid(!records.has(row.id));
        records.set(row.id, row);
      }
      cursor = page.hasMore ? page.nextCursor! : undefined;
      requireValid(!cursor || !cursors.has(cursor));
      if (cursor) cursors.add(cursor);
      requireValid(cursors.size <= 1000);
    } while (cursor);
    this.materials = records;
    this.publishRecords();
  }
  async checkOperations() {
    if (this.view.busy) return;
    const generation = this.generation;
    this.publish({ busy: true, problem: undefined });
    try {
      await this.loadOperations();
    } catch (error) {
      if (generation === this.generation) this.publish({ problem: entitlementFailure(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  async list(query: ListPlansRequest, signal?: AbortSignal) {
    const result = validatePage(
      await this.call<{ items: EntitlementResource[]; hasMore: boolean; nextCursor: string | null }>(
        options =>
          this.kind === 'plan' ? this.api.listPlans(query, options) : this.api.listQuotaDefinitions(query, options),
        signal
      ),
      query.cursor
    );
    result.items.forEach(row => this.resource(row));
    return result;
  }
  private resource(row: EntitlementResource) {
    validateResource(row);
    requireValid(this.kind === 'plan' ? 'quotaLimits' in row : !('quotaLimits' in row));
    return row;
  }
  async detail(id: string, signal?: AbortSignal) {
    requireValid(uuid.test(id));
    const row = this.resource(
      await this.call<EntitlementResource>(
        options =>
          this.kind === 'plan'
            ? this.api.getPlan({ planId: id }, options)
            : this.api.getQuotaDefinition({ quotaDefinitionId: id }, options),
        signal
      )
    );
    requireValid(row.id === id);
    return row;
  }
  async maxUsers(signal?: AbortSignal): Promise<QuotaDefinition | undefined> {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const ids = new Set<string>();
    let found: QuotaDefinition | undefined;
    do {
      const query = { code: 'max_users', cursor, limit: 100 };
      // 服务端 code 是子串查询，完整读取后再精确匹配。
      const result = validatePage(
        // eslint-disable-next-line no-await-in-loop
        await this.call(options => this.api.listQuotaDefinitions(query, options), signal),
        cursor
      );
      for (const row of result.items) {
        validateResource(row);
        requireValid(!ids.has(row.id));
        ids.add(row.id);
        if (row.code === 'max_users') {
          requireValid(!found);
          found = row;
        }
      }
      cursor = result.hasMore ? result.nextCursor! : undefined;
      requireValid(!cursor || !cursors.has(cursor));
      if (cursor) cursors.add(cursor);
      requireValid(cursors.size <= 1000);
    } while (cursor);
    return found;
  }
  private async mutate(
    action: Action,
    target: string,
    operation: (key: string) => Promise<EntitlementResource | undefined>
  ) {
    if (!this.canStart(action, target)) return undefined;
    const generation = this.generation;
    this.publish({ busy: true, problem: undefined });
    try {
      await this.loadOperations();
      if (this.blocked(action, target)) throw new EntitlementFailure('pending');
      const result = await operation(this.scope(action, target));
      if (generation !== this.generation) return undefined;
      this.publish({ checked: false });
      return result?.id;
    } catch (error) {
      if (generation === this.generation) this.publish({ checked: false, problem: entitlementFailure(error) });
      return undefined;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  private async write(
    scope: string,
    operation: (key: string, options: RequestInit) => Promise<EntitlementResource>,
    expected: (row: EntitlementResource) => boolean
  ) {
    const key = this.key();
    this.attempts.set(scope, key);
    const row = this.resource(await this.call(options => operation(key, options)));
    requireValid(expected(row));
    this.attempts.delete(scope);
    return row;
  }
  createPlan(code: string, displayName: string, limitText: string) {
    const limit = positiveLimit(limitText);
    if (
      this.kind !== 'plan' ||
      !/^[a-z][a-z0-9-]{1,62}$/.test(code) ||
      !displayName.trim() ||
      displayName.length > 200 ||
      limit === undefined
    ) {
      this.publish({ problem: 'input' });
      return Promise.resolve(undefined);
    }
    return this.mutate('CREATE', code, async scope => {
      const definition = await this.maxUsers();
      if (definition?.status !== 'ACTIVE') throw new EntitlementFailure('definitionRequired');
      return this.write(
        scope,
        (idempotencyKey, options) =>
          this.api.createPlan(
            {
              idempotencyKey,
              createPlanRequest: { code, displayName, quotaLimits: [{ quotaDefinitionId: definition.id, limit }] }
            },
            options
          ),
        row =>
          'quotaLimits' in row &&
          row.code === code &&
          row.displayName === displayName &&
          row.status === 'DRAFT' &&
          maxUsersLimit(row, definition) === limit
      );
    });
  }
  createQuota() {
    if (this.kind !== 'quota') return Promise.resolve(undefined);
    return this.mutate('CREATE', 'max_users', async scope => {
      const existing = await this.maxUsers();
      if (existing) return existing;
      return this.write(
        scope,
        (idempotencyKey, options) =>
          this.api.createQuotaDefinition(
            { idempotencyKey, createQuotaDefinitionRequest: { code: 'max_users' } },
            options
          ),
        row => row.code === 'max_users' && row.status === 'DRAFT'
      );
    });
  }
  activate(id: string) {
    return this.mutate('ACTIVATE', id, async scope => {
      const current = await this.detail(id);
      if (current.status !== 'DRAFT') throw new EntitlementFailure('invalid');
      if ('quotaLimits' in current) {
        const definition = await this.maxUsers();
        const limit = maxUsersLimit(current, definition);
        if (definition?.status !== 'ACTIVE' || limit === undefined || limit < 1)
          throw new EntitlementFailure('definitionRequired');
      } else {
        requireValid(current.code === 'max_users');
      }
      return this.write(
        scope,
        (idempotencyKey, options) =>
          this.kind === 'plan'
            ? this.api.activatePlan({ planId: id, idempotencyKey, body: {} }, options)
            : this.api.activateQuotaDefinition({ quotaDefinitionId: id, idempotencyKey, requestBody: {} }, options),
        row => row.id === id && row.status === 'ACTIVE'
      );
    });
  }
  private resourceId(row: Operation) {
    return this.kind === 'plan' ? row.planId : row.quotaDefinitionId;
  }
  private validateSameOperation(current: Operation, original: Operation) {
    requireValid(
      current.id === original.id && current.operation === original.operation && current.code === original.code
    );
    const target = this.resourceId(original);
    requireValid(target === undefined || this.resourceId(current) === target);
    requireValid(current.idempotencyKey === undefined || current.idempotencyKey === original.idempotencyKey);
  }
  private async replay(current: Operation, original: Operation) {
    requireValid(
      current.state === 'NOT_COMMITTED' &&
        current.canReplay &&
        current.replayUntil.getTime() > Date.now() &&
        current.idempotencyKey === original.idempotencyKey
    );
    let target = this.resourceId(current);
    if (current.operation === 'CREATE') target = this.kind === 'plan' ? current.code : 'max_users';
    // 缺少逻辑对象时无法安全保留未知恢复锁，不发送写请求。
    requireValid(target);
    this.attempts.set(this.scope(current.operation, target), current.idempotencyKey!);
    const query = { operationId: current.id, idempotencyKey: current.idempotencyKey!, body: {} };
    const result = this.validateOperation(
      await this.call(options =>
        this.kind === 'plan'
          ? this.api.recoverPlanOperation(query, options)
          : this.api.recoverQuotaDefinitionOperation(query, options)
      )
    );
    this.validateSameOperation(result, current);
    return result;
  }
  async continueOperation(id: string): Promise<string | undefined> {
    const material = this.materials.get(id);
    if (this.view.busy || !this.view.checked || !material || !material.canReplay || material.state !== 'NOT_COMMITTED')
      return undefined;
    const generation = this.generation;
    this.publish({ busy: true, problem: undefined });
    try {
      const current = this.validateOperation(
        await this.call(options =>
          this.kind === 'plan'
            ? this.api.getPlanOperation({ operationId: id }, options)
            : this.api.getQuotaDefinitionOperation({ operationId: id }, options)
        )
      );
      this.validateSameOperation(current, material);
      const result = current.state === 'COMMITTED' ? current : await this.replay(current, material);
      this.materials.set(id, result);
      if (result.state === 'COMMITTED') {
        for (const [scope, key] of this.attempts) if (key === material.idempotencyKey) this.attempts.delete(scope);
      }
      this.publishRecords();
      return result.state === 'COMMITTED' ? this.resourceId(result) : undefined;
    } catch (error) {
      if (generation === this.generation) {
        this.materials.clear();
        this.publish({ checked: false, operations: [], problem: entitlementFailure(error) });
      }
      return undefined;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
}
