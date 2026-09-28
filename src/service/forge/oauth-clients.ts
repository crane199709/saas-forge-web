import { ResponseError, RuntimeScope } from '@crane199709/saas-forge-api-client';
import type {
  ListOAuthClientsRequest,
  OAuthClientDetail,
  OAuthClientOperation,
  OAuthClientSecretResult,
  OAuthClientsApi
} from '@crane199709/saas-forge-api-client';
import type { SessionView } from '../../runtime/console-session';

type Session = { readonly state: SessionView; subscribe(listener: (state: SessionView) => void): () => void };
type Action = 'CREATE' | 'ROTATE' | 'REVOKE';
type Pending = { action: Action; displayName: string; clientId?: string; startedAt: Date };
export type OAuthProblem = 'invalid' | 'unavailable' | 'forbidden' | 'notFound' | 'stale' | 'pending' | 'input';
export class OAuthFailure extends Error {
  constructor(readonly code: OAuthProblem) {
    super(code);
  }
}
export const oauthFailure = (error: unknown): OAuthProblem =>
  error instanceof OAuthFailure ? error.code : 'unavailable';
export const runtimeScopes: RuntimeScope[] = [RuntimeScope.RuntimeRead, RuntimeScope.RuntimeQuotaWrite];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const date = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime());
function valid(value: unknown): asserts value {
  if (!value) throw new OAuthFailure('invalid');
}
function page<T>(value: { items: T[]; nextCursor: string | null; hasMore: boolean }, cursor?: string) {
  valid(
    value &&
      Array.isArray(value.items) &&
      typeof value.hasMore === 'boolean' &&
      (value.hasMore
        ? typeof value.nextCursor === 'string' && value.nextCursor && value.nextCursor !== cursor && value.items.length
        : value.nextCursor === null)
  );
  return value;
}
function resource<T extends OAuthClientSecretResult | OAuthClientDetail>(value: T) {
  valid(
    value &&
      uuid.test(value.clientId) &&
      typeof value.displayName === 'string' &&
      value.displayName.trim() &&
      ['ACTIVE', 'REVOKED'].includes(value.status) &&
      date(value.createdAt) &&
      date(value.updatedAt) &&
      value.allowedScopes instanceof Set &&
      value.allowedScopes.size &&
      [...value.allowedScopes].every(scope => Object.values(RuntimeScope).includes(scope))
  );
  return value;
}
export interface OAuthState {
  busy: boolean;
  checked: boolean;
  operations: OAuthClientOperation[];
  pending: Pending[];
  recoveryPending: string[];
  secret?: { clientId: string; value: string; source?: 'recovery' };
  problem?: OAuthProblem;
}
/** Secret 只存在于当前展示状态；原操作键独立保留，不能用新签发替代未知结果。 */
export class OAuthWorkspace {
  private view: OAuthState = { busy: false, checked: false, operations: [], pending: [], recoveryPending: [] };
  private attempts = new Map<string, Pending & { key: string }>();
  private acknowledged = new Set<string>();
  private recoveries = new Map<string, { clientId: string; delivered: boolean }>();
  private listeners = new Set<(state: OAuthState) => void>();
  private controller = new AbortController();
  private generation = 0;
  private displayGeneration = 0;
  private storageFailed = false;
  private owner?: string;
  private actor?: string;
  private unsubscribe: () => void;
  constructor(
    private readonly api: OAuthClientsApi,
    private readonly context: {
      session: Session;
      key: () => string;
      storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    }
  ) {
    this.unsubscribe = context.session.subscribe(state => {
      const actor = state.snapshot?.identity?.identityId;
      const platform =
        ['authenticated', 'checking'].includes(state.status) && state.snapshot?.activeContext?.type === 'PLATFORM';
      const owner = platform ? `${actor}:${state.snapshot?.sessionId}:${state.snapshot?.revision}` : undefined;
      const interrupted = ['loading', 'blocked'].includes(state.status);
      const retain = interrupted || (actor !== undefined && actor === this.actor);
      if (owner !== this.owner || (!retain && (this.attempts.size || this.recoveries.size))) {
        this.owner = owner;
        this.generation += 1;
        this.controller.abort();
        this.controller = new AbortController();
        this.clearSecret();
        if (!retain) {
          this.attempts.clear();
          this.acknowledged.clear();
          this.recoveries.clear();
        }
        this.publish({ busy: false, checked: false, operations: [], problem: undefined });
      }
      if (!interrupted) {
        if (actor !== this.actor) {
          this.actor = actor;
          this.restoreAttempts();
        }
      }
    });
  }
  /** 仅存原请求标识和非敏感输入，按身份隔离；绝不序列化响应或 Secret。 */
  private saveAttempts() {
    if (!this.context.storage || !this.actor) return;
    try {
      if (this.actor && (this.attempts.size || this.recoveries.size))
        this.context.storage.setItem(
          `sf.oauth.pending.${this.actor}`,
          JSON.stringify({ actor: this.actor, attempts: [...this.attempts], recoveries: [...this.recoveries] })
        );
      else this.context.storage.removeItem(`sf.oauth.pending.${this.actor}`);
    } catch {
      this.storageFailed = true;
      throw new OAuthFailure('pending');
    }
  }
  private restoreAttempts() {
    if (!this.context.storage || !this.actor) return;
    try {
      const saved = this.context.storage.getItem(`sf.oauth.pending.${this.actor}`);
      if (!saved) return;
      const value = JSON.parse(saved);
      valid(value.actor === this.actor);
      valid(Array.isArray(value.attempts));
      for (const [scope, row] of value.attempts) {
        valid(
          typeof scope === 'string' &&
            uuid.test(row.key) &&
            ['CREATE', 'ROTATE', 'REVOKE'].includes(row.action) &&
            typeof row.displayName === 'string' &&
            (row.clientId === undefined || uuid.test(row.clientId))
        );
        const startedAt = new Date(row.startedAt);
        valid(date(startedAt));
        this.attempts.set(scope, {
          key: row.key,
          action: row.action,
          displayName: row.displayName,
          clientId: row.clientId,
          startedAt
        });
      }
      valid(value.recoveries === undefined || Array.isArray(value.recoveries));
      for (const [operationId, row] of value.recoveries ?? []) {
        valid(uuid.test(operationId) && uuid.test(row.clientId) && typeof row.delivered === 'boolean');
        this.recoveries.set(operationId, { clientId: row.clientId, delivered: row.delivered });
      }
      this.publish({});
    } catch {
      this.storageFailed = true;
      this.publish({ problem: 'pending' });
    }
  }
  get state() {
    return this.view;
  }
  subscribe(listener: (state: OAuthState) => void) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  private publish(update: Partial<OAuthState>) {
    this.view = {
      ...this.view,
      ...update,
      pending: [...this.attempts.values()].map(({ key: _key, ...record }) => record),
      recoveryPending: [...this.recoveries].filter(([, row]) => !row.delivered).map(([id]) => id)
    };
    this.listeners.forEach(listener => listener(this.view));
  }
  clearSecret() {
    this.displayGeneration += 1;
    this.publish({ secret: undefined });
  }
  dispose() {
    this.unsubscribe();
    this.controller.abort();
    this.generation += 1;
    this.attempts.clear();
    this.acknowledged.clear();
    this.recoveries.clear();
    this.clearSecret();
    this.listeners.clear();
  }
  private async call<T>(operation: (options: RequestInit) => Promise<T>, signal?: AbortSignal) {
    if (!this.owner || this.context.session.state.status !== 'authenticated') throw new OAuthFailure('forbidden');
    const generation = this.generation;
    const combined = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
    try {
      const result = await operation({ signal: combined, redirect: 'error' });
      if (generation !== this.generation || combined.aborted) throw new OAuthFailure('stale');
      return result;
    } catch (error) {
      if (generation !== this.generation || signal?.aborted) throw new OAuthFailure('stale');
      if (error instanceof OAuthFailure) throw error;
      if (error instanceof ResponseError) {
        if ([401, 403].includes(error.response.status)) throw new OAuthFailure('forbidden');
        if (error.response.status === 404) throw new OAuthFailure('notFound');
      }
      throw new OAuthFailure('unavailable');
    }
  }
  async list(query: ListOAuthClientsRequest, signal?: AbortSignal) {
    const result = page(await this.call(options => this.api.listOAuthClients(query, options), signal), query.cursor);
    result.items.forEach(resource);
    valid(new Set(result.items.map(row => row.clientId)).size === result.items.length);
    return result;
  }
  async detail(id: string, signal?: AbortSignal) {
    valid(uuid.test(id));
    const row = resource(await this.call(options => this.api.getOAuthClient({ clientId: id }, options), signal));
    valid(row.clientId === id && ['RUNTIME_SERVICE', 'RESERVED_SERVICE'].includes(row.clientType));
    const status = await this.call(
      options => this.api.getOAuthClientCredentialStatus({ clientId: id }, options),
      signal
    );
    valid(
      status.clientId === id &&
        typeof status.canRotate === 'boolean' &&
        typeof status.canRevoke === 'boolean' &&
        (status.overlapEndsAt === undefined || date(status.overlapEndsAt))
    );
    return { client: row, credentials: status };
  }
  private async loadOperations() {
    this.publish({ checked: false, operations: [] });
    const records = new Map<string, OAuthClientOperation>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      // 完整分页是放行条件，中途失败或循环游标不能当作没有待恢复记录。
      const query = { cursor, limit: 100 };
      const result = page(
        // eslint-disable-next-line no-await-in-loop
        await this.call(options => this.api.listOAuthClientOperations(query, options)),
        cursor
      );
      for (const row of result.items) {
        valid(
          uuid.test(row.operationId) &&
            uuid.test(row.clientId) &&
            typeof row.displayName === 'string' &&
            ['CREATE', 'ROTATE', 'RECOVER', 'REVOKE'].includes(row.action) &&
            date(row.completedAt) &&
            typeof row.canRecover === 'boolean' &&
            (row.recoveryUntil === undefined || date(row.recoveryUntil)) &&
            !records.has(row.operationId)
        );
        records.set(row.operationId, row);
      }
      cursor = result.hasMore ? result.nextCursor! : undefined;
      valid(!cursor || !cursors.has(cursor));
      if (cursor) cursors.add(cursor);
      valid(cursors.size <= 1000);
    } while (cursor);
    this.publish({ operations: [...records.values()], checked: true });
  }
  canRecover(operationId: string) {
    return Boolean(
      !this.storageFailed &&
      this.owner &&
      this.context.session.state.status === 'authenticated' &&
      this.view.checked &&
      !this.view.busy &&
      !this.view.secret &&
      !this.recoveries.has(operationId) &&
      this.view.operations.some(
        row =>
          row.operationId === operationId &&
          row.canRecover &&
          ['CREATE', 'ROTATE'].includes(row.action) &&
          ![...this.recoveries.values()].some(attempt => !attempt.delivered && attempt.clientId === row.clientId)
      )
    );
  }
  /** 仅显式替代原操作者的签发，不读取或重放旧 Secret。 */
  async recover(operationId: string) {
    if (!this.canRecover(operationId)) return false;
    const generation = this.generation;
    const displayGeneration = this.displayGeneration;
    this.publish({ busy: true, problem: undefined });
    try {
      await this.loadOperations();
      const original = this.view.operations.find(row => row.operationId === operationId);
      if (!original?.canRecover || !['CREATE', 'ROTATE'].includes(original.action)) throw new OAuthFailure('forbidden');
      if (generation !== this.generation || displayGeneration !== this.displayGeneration)
        throw new OAuthFailure('stale');
      const attempt = [...this.attempts].find(
        ([, row]) =>
          row.action === original.action &&
          (row.action === 'CREATE' ? row.displayName === original.displayName : row.clientId === original.clientId)
      );
      // 候选记录不证明本地请求关联；原键接口成功后才解除对应锁，拒绝时不回退为另一笔恢复。
      // 新恢复标记只有原操作 ID、Client ID 与交付状态；恢复请求键始终留在内存。
      this.recoveries.set(operationId, { clientId: original.clientId, delivered: false });
      this.saveAttempts();
      this.publish({});
      const result = resource(
        await this.call(async options => {
          const idempotencyKey = this.context.key();
          const response = await (
            attempt
              ? this.api.recoverOAuthClientSecretRaw(
                  {
                    clientId: original.clientId,
                    idempotencyKey,
                    secretIssuanceRecoveryRequest: { originalIdempotencyKey: attempt[1].key }
                  },
                  options
                )
              : this.api.recoverOAuthClientOperationRaw({ operationId, idempotencyKey }, options)
          ).catch(async (error: unknown) => {
            if (error instanceof ResponseError && error.response.status === 409) {
              const problem: unknown = await error.response.json().catch(() => undefined);
              if (
                generation === this.generation &&
                problem &&
                typeof problem === 'object' &&
                'code' in problem &&
                problem.code === 'CLIENT_SECRET_RECOVERY_NOT_ALLOWED'
              ) {
                // 后端明确拒绝本次替代时，仅撤回此次恢复标记；原请求仍待核查。
                this.recoveries.delete(operationId);
                this.saveAttempts();
                throw new OAuthFailure('forbidden');
              }
            }
            throw error;
          });
          valid(response.raw.status === 200);
          return response.value();
        })
      );
      valid(
        result.clientId === original.clientId &&
          result.status === 'ACTIVE' &&
          typeof result.clientSecret === 'string' &&
          result.clientSecret.length > 0
      );
      if (displayGeneration !== this.displayGeneration) return false;
      if (attempt) this.attempts.delete(attempt[0]);
      this.recoveries.set(operationId, { clientId: original.clientId, delivered: true });
      this.saveAttempts();
      this.publish({
        secret: { clientId: result.clientId, value: result.clientSecret, source: 'recovery' },
        checked: false
      });
      return true;
    } catch (error) {
      if (generation === this.generation) this.publish({ problem: oauthFailure(error), checked: false });
      return false;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  async checkOperations() {
    if (this.view.busy) return;
    const generation = this.generation;
    this.publish({ busy: true, problem: undefined });
    try {
      await this.loadOperations();
    } catch (error) {
      if (generation === this.generation) this.publish({ problem: oauthFailure(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  private blocked(action: Action, target: string) {
    return (
      [...this.recoveries.values()].some(row => !row.delivered && (action === 'CREATE' || row.clientId === target)) ||
      [...this.attempts.values()].some(row =>
        action === 'CREATE' ? row.action === 'CREATE' : row.clientId === target
      ) ||
      this.view.operations.some(
        row =>
          row.canRecover &&
          !this.acknowledged.has(`${row.action}:${row.clientId}:${row.completedAt.toISOString()}`) &&
          (action === 'CREATE'
            ? row.action === 'CREATE' && row.displayName === target
            : action === 'ROTATE' && ['ROTATE', 'RECOVER'].includes(row.action) && row.clientId === target)
      )
    );
  }
  canStart(action: Action, target: string) {
    return (
      !this.storageFailed &&
      Boolean(this.owner) &&
      this.context.session.state.status === 'authenticated' &&
      this.view.checked &&
      !this.view.busy &&
      !this.view.secret &&
      !this.blocked(action, target)
    );
  }
  private async mutate(
    request: { action: Action; target: string; displayName: string; scopes?: RuntimeScope[] },
    signal?: AbortSignal
  ) {
    const { action, target, displayName, scopes } = request;
    if (!this.canStart(action, target)) return false;
    const generation = this.generation;
    const displayGeneration = this.displayGeneration;
    this.publish({ busy: true, problem: undefined });
    try {
      await this.loadOperations();
      if (this.blocked(action, target)) throw new OAuthFailure('pending');
      if (action !== 'CREATE') {
        const current = await this.detail(target, signal);
        if (action === 'ROTATE' ? !current.credentials.canRotate : !current.credentials.canRevoke)
          throw new OAuthFailure('forbidden');
      }
      if (signal?.aborted) throw new OAuthFailure('stale');
      const key = this.context.key();
      const scope = `${action}:${target}`;
      this.attempts.set(scope, {
        key,
        action,
        displayName,
        clientId: action === 'CREATE' ? undefined : target,
        startedAt: new Date()
      });
      this.saveAttempts();
      this.publish({});
      if (action === 'REVOKE') {
        await this.call(
          options => this.api.revokeOAuthClient({ clientId: target, idempotencyKey: key }, options),
          signal
        );
        this.attempts.delete(scope);
      } else {
        const result = resource(
          await this.call(async options => {
            const response = await (action === 'CREATE'
              ? this.api.createOAuthClientRaw(
                  { idempotencyKey: key, createOAuthClientRequest: { displayName, allowedScopes: new Set(scopes) } },
                  options
                )
              : this.api.rotateOAuthClientSecretRaw({ clientId: target, idempotencyKey: key }, options));
            valid(response.raw.status === (action === 'CREATE' ? 201 : 200));
            return response.value();
          }, signal)
        );
        valid(
          result.status === 'ACTIVE' &&
            typeof result.clientSecret === 'string' &&
            result.clientSecret.length > 0 &&
            (action === 'CREATE'
              ? result.displayName === displayName &&
                result.allowedScopes.size === scopes!.length &&
                scopes!.every(value => result.allowedScopes.has(value))
              : result.clientId === target)
        );
        // 离开后即使请求成功，也不重新显示 Secret；未知锁保留供原操作核查。
        if (displayGeneration !== this.displayGeneration) return false;
        this.attempts.delete(scope);
        this.acknowledged.add(`${action}:${result.clientId}:${result.updatedAt.toISOString()}`);
        this.publish({ secret: { clientId: result.clientId, value: result.clientSecret } });
      }
      this.saveAttempts();
      this.publish({ checked: false });
      return true;
    } catch (error) {
      if (generation === this.generation) this.publish({ problem: oauthFailure(error), checked: false });
      return false;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  create(name: string, scopes: RuntimeScope[], signal?: AbortSignal) {
    if (
      !name.trim() ||
      name.length > 200 ||
      !scopes.length ||
      new Set(scopes).size !== scopes.length ||
      scopes.some(value => !runtimeScopes.includes(value))
    ) {
      this.publish({ problem: 'input' });
      return Promise.resolve(false);
    }
    return this.mutate({ action: 'CREATE', target: name, displayName: name, scopes }, signal);
  }
  rotate(id: string, name: string, signal?: AbortSignal) {
    return this.mutate({ action: 'ROTATE', target: id, displayName: name }, signal);
  }
  revoke(id: string, name: string, signal?: AbortSignal) {
    return this.mutate({ action: 'REVOKE', target: id, displayName: name }, signal);
  }
}
