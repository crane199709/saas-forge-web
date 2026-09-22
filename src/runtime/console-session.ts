import type { Console } from '@crane199709/saas-forge-api-client';
import { releaseConsoleBrand } from './console-brand';
import type { ConsoleBrand } from './console-brand';

type Snapshot = Console.ConsoleSessionSnapshot;
type Authentication = Console.ConsoleAuthenticationResult;
export type WorkContextTarget = Console.ConsoleContextSelectionRequest;
function soleAvailableContext(result: Authentication): WorkContextTarget | undefined {
  const contexts = result.availableContexts;
  if (
    result.state !== 'CONTEXT_SELECTION_REQUIRED' ||
    !contexts ||
    contexts.companies.length + Number(contexts.platform) !== 1
  )
    return undefined;
  return contexts.platform
    ? { type: 'PLATFORM' }
    : { type: 'TENANT', membershipId: contexts.companies[0].membershipId };
}
export type CoordinationMessage = 'changed' | 'logout' | 'switching' | 'edited';
export interface ConsoleTransport {
  bootstrap(): Promise<Console.ConsoleBootstrapResult>;
  session(): Promise<Snapshot>;
  login(email: string, password: string, revision: string): Promise<Authentication>;
  refresh(revision: string, key: string): Promise<Authentication>;
  logout(revision: string, key: string): Promise<void>;
  select(target: WorkContextTarget, revision: string, key: string): Promise<string>;
  changePassword(password: string, revision: string, key: string): Promise<void>;
  useToken(value: string | undefined): void;
}
export interface LogoutIntent {
  key: string;
  revision?: string;
}
export interface SessionCoordination {
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
  pending(): LogoutIntent | undefined;
  savePending(value: LogoutIntent | undefined): void;
  publish(kind: CoordinationMessage): void;
  subscribe(listener: (kind: CoordinationMessage) => void): () => void;
  dispose(): void;
}
export class SessionFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export interface SessionView {
  status: 'loading' | 'checking' | 'anonymous' | 'authenticated' | 'restricted' | 'blocked' | 'logoutPending';
  snapshot?: Snapshot;
  problem?: string;
  brand?: ConsoleBrand;
}

/** A Realm owns one instance; only the transport holds credentials and page state never exposes them. */
export class ConsoleSessionRuntime {
  private view: SessionView = { status: 'loading' };
  private readonly listeners = new Set<(view: SessionView) => void>();
  private generation = 0;
  private revision?: string;
  private credential?: { value: string; expiresAt: number };
  private refreshAttempt?: { key: string; revision: string; started: number };
  private selectionAttempt?: {
    target: WorkContextTarget;
    revision: string;
    key: string;
  };
  private passwordAttempt?: {
    key: string;
    revision: string;
    sessionId: string;
  };
  private selecting = false;
  private editVersion = 0;
  private selectionNeedsSync = false;
  private readonly unsubscribe: () => void;
  private disposed = false;
  private readonly key: () => string;
  private readonly now: () => number;

  constructor(
    private readonly api: ConsoleTransport,
    private readonly coordination: SessionCoordination,
    private readonly options: {
      key: () => string;
      now?: () => number;
      resolveBrand?: (snapshot: Snapshot) => Promise<ConsoleBrand | undefined>;
    }
  ) {
    this.key = options.key;
    this.now = options.now ?? Date.now;
    this.unsubscribe = coordination.subscribe(kind => {
      if (kind === 'edited') {
        this.editVersion += 1;
        return;
      }
      this.refreshAttempt = undefined;
      this.selectionAttempt = undefined;
      this.invalidate(kind === 'logout' ? 'logoutPending' : 'blocked');
      if (kind !== 'switching') this.recover();
    });
  }

  get state(): SessionView {
    return this.view;
  }
  subscribe(listener: (view: SessionView) => void) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }

  async recover(): Promise<void> {
    await this.execute(async generation => {
      if (this.coordination.pending()) {
        await this.completeLogout();
        return;
      }
      if (this.selectionAttempt) await this.completeSelection();
      const bootstrap = await this.api.bootstrap();
      if (generation !== this.generation) return;
      this.revision = bootstrap.revision;
      if (!bootstrap.sessionPresent) {
        const changed = Boolean(this.passwordAttempt);
        this.passwordAttempt = undefined;
        this.refreshAttempt = undefined;
        this.apply(
          {
            status: 'anonymous',
            problem: changed ? 'PASSWORD_CHANGE_RESULT_UNKNOWN' : undefined
          },
          generation
        );
        return;
      }
      if (bootstrap.transition === 'ENDING') {
        this.coordination.savePending({
          key: this.key(),
          revision: bootstrap.revision
        });
        await this.completeLogout();
        return;
      }
      if (bootstrap.transition !== 'NONE' && bootstrap.transition !== 'CONTEXT_REFRESH_REQUIRED') {
        throw new SessionFailure('SESSION_TRANSITION_PENDING');
      }
      if (!this.refreshAttempt && bootstrap.transition === 'NONE') {
        const snapshot = await this.api.session();
        if (snapshot.state === 'PASSWORD_CHANGE_REQUIRED') {
          this.apply({ status: 'restricted', snapshot }, generation);
          return;
        }
      }
      if (this.refreshAttempt && this.now() - this.refreshAttempt.started > 10_000) {
        this.coordination.savePending({
          key: this.key(),
          revision: bootstrap.revision
        });
        await this.completeLogout();
        return;
      }
      this.refreshAttempt ??= {
        key: this.key(),
        revision: bootstrap.revision,
        started: this.now()
      };
      const result = await this.api.refresh(this.refreshAttempt.revision, this.refreshAttempt.key);
      this.refreshAttempt = undefined;
      if (generation !== this.generation) return;
      const target = soleAvailableContext(result);
      if (target) {
        // 等待页重新获得唯一候选仍须经过正式选择，不能从候选列表自行取得权限。
        this.selectionAttempt = {
          target,
          revision: result.revision,
          key: this.key()
        };
        this.selectionNeedsSync = true;
        this.coordination.publish('switching');
        await this.refreshSelection(generation);
        return;
      }
      await this.accept(result, generation);
      if (
        generation === this.generation &&
        (this.selectionNeedsSync || bootstrap.transition === 'CONTEXT_REFRESH_REQUIRED')
      ) {
        this.selectionNeedsSync = false;
        this.coordination.publish('changed');
      }
    });
  }

  /** 密码只用于本次请求；未知结果先恢复 Slot，重输时仍使用原操作键。 */
  async changePassword(password: string): Promise<void> {
    const snapshot = this.view.snapshot;
    if (this.view.status !== 'restricted' || snapshot?.state !== 'PASSWORD_CHANGE_REQUIRED') return;
    await this.execute(async generation => {
      if (this.coordination.pending()) throw new SessionFailure('LOGOUT_PENDING');
      if (this.passwordAttempt?.sessionId !== snapshot.sessionId) this.passwordAttempt = undefined;
      this.passwordAttempt ??= {
        key: this.key(),
        revision: snapshot.revision,
        sessionId: snapshot.sessionId
      };
      this.coordination.publish('switching');
      try {
        await this.api.changePassword(password, this.passwordAttempt.revision, this.passwordAttempt.key);
      } catch (error) {
        if (
          error instanceof SessionFailure &&
          [
            'PASSWORD_TOO_SHORT',
            'PASSWORD_TOO_LONG',
            'PASSWORD_WHITESPACE_NOT_ALLOWED',
            'PASSWORD_COMPROMISED',
            'VALIDATION_FAILED'
          ].includes(error.code)
        ) {
          this.passwordAttempt = undefined;
          this.apply({ status: 'restricted', snapshot, problem: error.code }, generation);
          this.coordination.publish('changed');
          return;
        }
        this.coordination.publish('changed');
        throw error;
      }
      this.passwordAttempt = undefined;
      this.refreshAttempt = undefined;
      this.revision = undefined;
      this.apply({ status: 'anonymous', problem: 'PASSWORD_CHANGED' }, generation);
      this.coordination.publish('changed');
    });
  }

  async login(email: string, password: string): Promise<void> {
    await this.execute(async generation => {
      if (this.coordination.pending()) throw new SessionFailure('LOGOUT_PENDING');
      const bootstrap = await this.api.bootstrap();
      this.revision = bootstrap.revision;
      if (bootstrap.sessionPresent) throw new SessionFailure('SESSION_ALREADY_ACTIVE');
      // Never retry a password request: an unknown result must be recovered through bootstrap.
      const result = await this.api.login(email, password, bootstrap.revision);
      await this.accept(result, generation);
      if (generation === this.generation && !this.coordination.pending()) this.coordination.publish('changed');
    }, true);
  }

  /** 确认只作用于当前代次；结果未知时保留原键，禁止另建切换操作。 */
  async select(target: WorkContextTarget, confirm: () => Promise<boolean>): Promise<void> {
    if (this.selecting || this.selectionAttempt || !['authenticated', 'restricted'].includes(this.view.status)) return;
    const snapshot = this.view.snapshot;
    if (!snapshot || snapshot.state === 'PASSWORD_CHANGE_REQUIRED') return;
    const generation = this.generation;
    const editVersion = this.editVersion;
    this.selecting = true;
    try {
      if (!(await confirm()) || generation !== this.generation || editVersion !== this.editVersion) return;
      await this.execute(async current => {
        if (this.coordination.pending()) throw new SessionFailure('LOGOUT_PENDING');
        const bootstrap = await this.api.bootstrap();
        if (current !== this.generation) return;
        if (editVersion !== this.editVersion) throw new SessionFailure('CONTEXT_CONFIRMATION_STALE');
        if (bootstrap.revision !== snapshot.revision) throw new SessionFailure('SESSION_REVISION_CHANGED');
        this.refreshAttempt = undefined;
        this.selectionAttempt = {
          target: { ...target },
          revision: snapshot.revision,
          key: this.key()
        };
        this.selectionNeedsSync = true;
        this.coordination.publish('switching');
        await this.refreshSelection(current);
      });
    } finally {
      this.selecting = false;
    }
  }

  private async refreshSelection(generation: number) {
    await this.completeSelection();
    if (generation !== this.generation) return;
    this.refreshAttempt = {
      key: this.key(),
      revision: this.revision!,
      started: this.now()
    };
    const result = await this.api.refresh(this.refreshAttempt.revision, this.refreshAttempt.key);
    this.refreshAttempt = undefined;
    await this.accept(result, generation);
    if (generation === this.generation && !this.coordination.pending()) {
      this.selectionNeedsSync = false;
      this.coordination.publish('changed');
    }
  }

  private async completeSelection() {
    const attempt = this.selectionAttempt;
    if (!attempt) return;
    try {
      this.revision = await this.api.select(attempt.target, attempt.revision, attempt.key);
      this.selectionAttempt = undefined;
    } catch (error) {
      // 明确拒绝没有未知提交；下一次恢复重新读取权威状态，不能恢复旧快照。
      if (
        error instanceof SessionFailure &&
        [
          'TARGET_CONTEXT_UNAVAILABLE',
          'CURRENT_CONTEXT_REVOKED',
          'SESSION_REVISION_CHANGED',
          'SESSION_INVALID',
          'SESSION_COOKIE_MISMATCH',
          'INITIAL_CREDENTIAL_RESTRICTED',
          'VALIDATION_FAILED',
          'IDEMPOTENCY_KEY_REUSED'
        ].includes(error.code)
      ) {
        this.selectionAttempt = undefined;
        this.coordination.publish('changed');
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    this.selectionAttempt = undefined;
    this.invalidate('logoutPending');
    try {
      this.coordination.savePending(this.coordination.pending() ?? { key: this.key() });
      this.coordination.publish('logout');
      await this.execute(async () => this.completeLogout());
    } catch (error) {
      this.failure(error, true);
    }
  }

  /** Focus/idle checks do not refresh and therefore cannot extend the session lifetime. */
  async verify(): Promise<void> {
    if (this.view.status !== 'authenticated' && this.view.status !== 'restricted') return;
    const previous = this.view.snapshot;
    const credential = this.credential;
    await this.execute(
      async generation => {
        if (this.coordination.pending()) {
          await this.completeLogout();
          return;
        }
        const snapshot = await this.api.session();
        if (snapshot.sessionId !== previous?.sessionId || snapshot.revision !== previous.revision) {
          this.apply({ status: 'blocked', problem: 'SESSION_REVISION_CHANGED' }, generation);
          return;
        }
        const brand = await this.options.resolveBrand?.(snapshot);
        if (generation !== this.generation || this.coordination.pending()) {
          releaseConsoleBrand(brand);
          return;
        }
        if (snapshot.state === 'AUTHENTICATED') {
          if (!credential || credential.expiresAt <= this.now()) {
            releaseConsoleBrand(brand);
            throw new SessionFailure('SESSION_EXPIRED');
          }
          this.credential = credential;
          this.api.useToken(credential.value);
        }
        this.apply(
          {
            status: snapshot.state === 'AUTHENTICATED' ? 'authenticated' : 'restricted',
            snapshot,
            brand
          },
          generation
        );
      },
      false,
      previous
    );
  }

  dispose() {
    this.disposed = true;
    this.invalidate('blocked');
    this.unsubscribe();
    this.coordination.dispose();
    this.listeners.clear();
  }

  private async completeLogout() {
    let intent = this.coordination.pending();
    if (!intent) return;
    this.update({ status: 'logoutPending' });
    if (!intent.revision) {
      const bootstrap = await this.api.bootstrap();
      intent = { ...intent, revision: bootstrap.revision };
      this.coordination.savePending(intent);
    }
    await this.api.logout(intent.revision!, intent.key);
    this.coordination.savePending(undefined);
    this.refreshAttempt = undefined;
    this.revision = undefined;
    this.update({ status: 'anonymous' });
    this.coordination.publish('changed');
  }

  private async execute(operation: (generation: number) => Promise<void>, login = false, checking?: Snapshot) {
    const generation = this.invalidate(checking ? 'checking' : 'loading', checking);
    try {
      await this.coordination.exclusive(async () => {
        if (this.disposed || generation !== this.generation) return;
        if (this.coordination.pending()) this.update({ status: 'logoutPending' });
        await operation(generation);
      });
    } catch (error) {
      if (generation === this.generation)
        this.failure(
          error,
          this.view.status === 'logoutPending' || (error instanceof SessionFailure && error.code === 'LOGOUT_PENDING'),
          login
        );
    }
  }

  private async accept(result: Authentication, generation: number) {
    if (generation !== this.generation || this.coordination.pending() || this.disposed) return;
    this.revision = result.revision;
    const { accessToken, expiresIn, tokenType, ...snapshot } = result;
    if (result.state === 'AUTHENTICATED' && (!accessToken || !expiresIn || tokenType !== 'Bearer')) {
      throw new SessionFailure('SESSION_RESPONSE_INVALID');
    }
    if (result.state !== 'AUTHENTICATED' && accessToken) throw new SessionFailure('SESSION_RESPONSE_INVALID');
    const brand = await this.options.resolveBrand?.(snapshot);
    if (generation !== this.generation || this.coordination.pending() || this.disposed) {
      releaseConsoleBrand(brand);
      return;
    }
    this.credential =
      accessToken && expiresIn ? { value: accessToken, expiresAt: this.now() + expiresIn * 1000 } : undefined;
    this.api.useToken(accessToken);
    this.update({
      status: result.state === 'AUTHENTICATED' ? 'authenticated' : 'restricted',
      snapshot,
      brand
    });
  }

  private apply(view: SessionView, generation: number) {
    if (generation === this.generation && !this.coordination.pending() && !this.disposed) this.update(view);
  }

  private failure(error: unknown, pending: boolean, login = false) {
    if (this.disposed) return;
    const code = error instanceof SessionFailure ? error.code : 'NETWORK_UNAVAILABLE';
    this.credential = undefined;
    this.api.useToken(undefined);
    const anonymous = login && code === 'AUTHENTICATION_FAILED';
    let status: SessionView['status'] = anonymous ? 'anonymous' : 'blocked';
    if (pending) status = 'logoutPending';
    this.update({ status, problem: code });
    if (code === 'CURRENT_CONTEXT_REVOKED') this.coordination.publish('changed');
  }

  private invalidate(status: SessionView['status'], snapshot?: Snapshot) {
    this.generation += 1;
    this.credential = undefined;
    this.api.useToken(undefined);
    this.update({
      status,
      snapshot,
      brand: status === 'checking' ? this.view.brand : undefined
    });
    return this.generation;
  }

  private update(view: SessionView) {
    if (this.view.brand !== view.brand) releaseConsoleBrand(this.view.brand);
    this.view = view;
    this.listeners.forEach(listener => listener(view));
  }
}
