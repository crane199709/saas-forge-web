import { ResponseError } from '@crane199709/saas-forge-api-client';
import type {
  ListPlatformTenantsRequest,
  PlatformTenantsApi,
  Tenant,
  TenantCreationRecovery,
  TenantPage
} from '@crane199709/saas-forge-api-client';
import type { SessionView } from '../../runtime/console-session';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const tenantStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
export class TenantFailure extends Error {
  constructor(readonly code: 'unavailable' | 'invalid' | 'forbidden' | 'notFound' | 'nameInvalid' | 'stale') {
    super(code);
  }
}
function requireValid(value: unknown): asserts value {
  if (!value) throw new TenantFailure('invalid');
}
function validateTenant(value: Tenant) {
  requireValid(
    value &&
      uuid.test(value.id) &&
      typeof value.displayName === 'string' &&
      value.displayName.trim() &&
      tenantStatuses.includes(value.status) &&
      (value.expiresAt === null || validDate(value.expiresAt)) &&
      validDate(value.createdAt) &&
      validDate(value.updatedAt)
  );
  return value;
}
function validatePage<T>(page: { items: T[]; hasMore: boolean; nextCursor: string | null }, cursor?: string) {
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
}
function validateCreation(value: TenantCreationRecovery) {
  requireValid(
    value &&
      uuid.test(value.id) &&
      typeof value.displayName === 'string' &&
      value.displayName.trim() &&
      ['COMMITTED', 'PROCESSING', 'NOT_COMMITTED', 'UNKNOWN'].includes(value.state) &&
      typeof value.canReplay === 'boolean' &&
      validDate(value.createdAt) &&
      validDate(value.replayUntil) &&
      (value.state !== 'COMMITTED' || (value.tenantId && uuid.test(value.tenantId))) &&
      (!value.canReplay ||
        (['NOT_COMMITTED', 'COMMITTED'].includes(value.state) &&
          value.idempotencyKey &&
          uuid.test(value.idempotencyKey)))
  );
  return value;
}
export type CreationView = Omit<TenantCreationRecovery, 'idempotencyKey'>;
export interface TenantWorkspaceState {
  busy: boolean;
  checked: boolean;
  canCreate: boolean;
  unknown: boolean;
  creations: CreationView[];
  problem?: TenantFailure['code'];
}
type Session = { readonly state: SessionView; subscribe(listener: (state: SessionView) => void): () => void };

/** 恢复材料只属于当前会话的内存实例；页面只传记录 ID，不接触 Token 或幂等键。 */
export class TenantWorkspace {
  private materials = new Map<string, TenantCreationRecovery>();
  private attempt?: { key: string; displayName: string };
  private view: TenantWorkspaceState = { busy: false, checked: false, canCreate: false, unknown: false, creations: [] };
  private listeners = new Set<(state: TenantWorkspaceState) => void>();
  private controller = new AbortController();
  private owner?: string;
  private actor?: string;
  private generation = 0;
  private unsubscribe: () => void;
  constructor(
    private readonly api: PlatformTenantsApi,
    private readonly session: Session,
    private readonly key: () => string
  ) {
    this.unsubscribe = session.subscribe(state => {
      const snapshot = state.snapshot;
      const actor = snapshot?.identity?.identityId;
      const platform =
        ['authenticated', 'checking'].includes(state.status) && snapshot?.activeContext?.type === 'PLATFORM';
      const owner = platform ? `${actor}:${snapshot.sessionId}:${snapshot.revision}` : undefined;
      const interrupted = state.status === 'loading' || state.status === 'blocked';
      const sameActor = platform && actor === this.actor;
      // 暂时失联不能解除未知提交锁；重新确认主体后才允许查原操作。换账号或退出立即丢弃材料。
      const retainAttempt = interrupted || sameActor;
      if (owner !== this.owner || (!retainAttempt && this.attempt)) {
        this.owner = owner;
        this.clear(retainAttempt);
      }
      if (!interrupted) this.actor = platform ? actor : undefined;
    });
  }
  get state() {
    return this.view;
  }
  subscribe(listener: (state: TenantWorkspaceState) => void) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  private publish(update: Partial<TenantWorkspaceState>) {
    this.view = { ...this.view, ...update };
    this.view.canCreate =
      this.view.checked &&
      !this.view.busy &&
      !this.attempt &&
      this.view.creations.every(row => row.state === 'COMMITTED');
    this.listeners.forEach(listener => listener(this.view));
  }
  private clear(retainAttempt = false) {
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
    this.materials.clear();
    if (!retainAttempt) this.attempt = undefined;
    this.publish({ busy: false, checked: false, unknown: Boolean(this.attempt), creations: [], problem: undefined });
  }
  dispose() {
    this.unsubscribe();
    this.clear();
    this.listeners.clear();
  }
  private async call<T>(operation: (options: RequestInit) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!this.owner || this.session.state.status !== 'authenticated') throw new TenantFailure('forbidden');
    const generation = this.generation;
    const combined = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
    try {
      const result = await operation({ signal: combined, redirect: 'error' });
      if (generation !== this.generation || combined.aborted) throw new TenantFailure('stale');
      return result;
    } catch (error) {
      if (generation !== this.generation || signal?.aborted) throw new TenantFailure('stale');
      if (error instanceof TenantFailure) throw error;
      if (error instanceof ResponseError) {
        if ([401, 403].includes(error.response.status)) throw new TenantFailure('forbidden');
        if (error.response.status === 404) throw new TenantFailure('notFound');
      }
      throw new TenantFailure('unavailable');
    }
  }
  async list(query: ListPlatformTenantsRequest, signal?: AbortSignal): Promise<TenantPage> {
    const page = await this.call(options => this.api.listPlatformTenants(query, options), signal);
    validatePage(page, query.cursor);
    page.items.forEach(validateTenant);
    requireValid(new Set(page.items.map(row => row.id)).size === page.items.length);
    return page;
  }
  async detail(id: string, signal?: AbortSignal): Promise<Tenant> {
    requireValid(uuid.test(id));
    const tenant = validateTenant(
      await this.call(options => this.api.getPlatformTenant({ tenantId: id }, options), signal)
    );
    requireValid(tenant.id === id);
    return tenant;
  }
  /** 整次分页完成前不发布可恢复句柄；缺失、重复游标和中途失败均保持关闭。 */
  async checkCreations(): Promise<void> {
    if (this.view.busy) return;
    const generation = this.generation;
    this.materials.clear();
    this.publish({ busy: true, checked: false, creations: [], problem: undefined });
    try {
      const records = new Map<string, TenantCreationRecovery>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const pageCursor = cursor;
        // 下一页游标来自上一页，必须顺序读取并检查完整性。
        // eslint-disable-next-line no-await-in-loop
        const page = await this.call(options =>
          this.api.listTenantCreations({ cursor: pageCursor, limit: 100 }, options)
        );
        validatePage(page, cursor);
        for (const item of page.items) {
          validateCreation(item);
          requireValid(!records.has(item.id));
          records.set(item.id, item);
        }
        cursor = page.hasMore ? page.nextCursor! : undefined;
        requireValid(!cursor || !cursors.has(cursor));
        if (cursor) cursors.add(cursor);
        requireValid(cursors.size <= 1000);
      } while (cursor);
      if (generation !== this.generation) return;
      this.materials = records;
      const match = [...records.values()].find(row => row.idempotencyKey === this.attempt?.key);
      if (match?.state === 'COMMITTED') this.attempt = undefined;
      this.publishRecords();
    } catch (error) {
      if (generation === this.generation) this.publish({ problem: failureCode(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  private publishRecords() {
    this.publish({
      checked: true,
      unknown: Boolean(this.attempt),
      creations: [...this.materials.values()].map(({ idempotencyKey: _key, ...row }) => ({
        ...row,
        canReplay: row.state === 'NOT_COMMITTED' && row.canReplay && row.replayUntil.getTime() > Date.now()
      }))
    });
  }
  async create(displayName: string): Promise<string | undefined> {
    if (!this.view.canCreate || this.session.state.status !== 'authenticated') return undefined;
    if (!displayName.trim() || displayName.length > 200) {
      this.publish({ problem: 'nameInvalid' });
      return undefined;
    }
    const generation = this.generation;
    this.attempt = { key: this.key(), displayName };
    this.publish({ busy: true, problem: undefined });
    try {
      const result = validateTenant(
        await this.call(options =>
          this.api.createPlatformTenant(
            {
              idempotencyKey: this.attempt!.key,
              createTenantRequest: { displayName }
            },
            options
          )
        )
      );
      this.attempt = undefined;
      this.publish({ unknown: false, checked: false });
      return result.id;
    } catch (error) {
      if (generation === this.generation) this.publish({ unknown: true, checked: false, problem: failureCode(error) });
      return undefined;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  async continueCreation(id: string): Promise<string | undefined> {
    const material = this.materials.get(id);
    if (this.view.busy || !this.view.checked || !material || !material.canReplay || material.state !== 'NOT_COMMITTED')
      return undefined;
    const generation = this.generation;
    this.publish({ busy: true, problem: undefined });
    try {
      // 点击时重新读取权威允许动作，不用列表中的旧 canReplay 直接提交。
      const current = validateCreation(
        await this.call(options => this.api.getTenantCreation({ creationId: id }, options))
      );
      requireValid(current.id === id);
      if (current.state === 'COMMITTED') {
        this.materials.set(id, current);
      } else {
        requireValid(
          current.state === 'NOT_COMMITTED' &&
            current.canReplay &&
            current.replayUntil.getTime() > Date.now() &&
            current.idempotencyKey === material.idempotencyKey
        );
        const result = validateCreation(
          await this.call(options =>
            this.api.recoverTenantCreation(
              {
                creationId: id,
                idempotencyKey: current.idempotencyKey!,
                requestBody: {}
              },
              options
            )
          )
        );
        requireValid(result.id === id);
        this.materials.set(id, result);
      }
      const result = this.materials.get(id)!;
      if (result.state === 'COMMITTED' && material.idempotencyKey === this.attempt?.key) this.attempt = undefined;
      this.publishRecords();
      return result.state === 'COMMITTED' ? result.tenantId : undefined;
    } catch (error) {
      if (generation === this.generation) {
        this.materials.clear();
        this.publish({ checked: false, creations: [], problem: failureCode(error) });
      }
      return undefined;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
}
export function failureCode(error: unknown): TenantFailure['code'] {
  return error instanceof TenantFailure ? error.code : 'unavailable';
}
