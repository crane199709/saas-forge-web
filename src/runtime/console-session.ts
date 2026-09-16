import type { Console } from '@crane199709/saas-forge-api-client';

type Snapshot = Console.ConsoleSessionSnapshot;
type Authentication = Console.ConsoleAuthenticationResult;
export interface ConsoleTransport {
  bootstrap(): Promise<Console.ConsoleBootstrapResult>;
  session(): Promise<Snapshot>;
  login(email: string, password: string, revision: string): Promise<Authentication>;
  refresh(revision: string, key: string): Promise<Authentication>;
  logout(revision: string, key: string): Promise<void>;
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
  publish(kind: 'changed' | 'logout'): void;
  subscribe(listener: (kind: 'changed' | 'logout') => void): () => void;
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
}

/** A Realm owns one instance; only the transport holds credentials and page state never exposes them. */
export class ConsoleSessionRuntime {
  private view: SessionView = { status: 'loading' };
  private readonly listeners = new Set<(view: SessionView) => void>();
  private generation = 0;
  private revision?: string;
  private credential?: { value: string; expiresAt: number };
  private refreshAttempt?: { key: string; revision: string; started: number };
  private readonly unsubscribe: () => void;
  private disposed = false;
  private readonly key: () => string;
  private readonly now: () => number;

  constructor(
    private readonly api: ConsoleTransport,
    private readonly coordination: SessionCoordination,
    options: { key: () => string; now?: () => number }
  ) {
    this.key = options.key;
    this.now = options.now ?? Date.now;
    this.unsubscribe = coordination.subscribe(kind => {
      this.refreshAttempt = undefined;
      this.invalidate(kind === 'logout' ? 'logoutPending' : 'loading');
      this.recover();
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
      const bootstrap = await this.api.bootstrap();
      this.revision = bootstrap.revision;
      if (!bootstrap.sessionPresent) {
        this.refreshAttempt = undefined;
        this.apply({ status: 'anonymous' }, generation);
        return;
      }
      if (bootstrap.transition === 'ENDING') {
        this.coordination.savePending({ key: this.key(), revision: bootstrap.revision });
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
        this.coordination.savePending({ key: this.key(), revision: bootstrap.revision });
        await this.completeLogout();
        return;
      }
      this.refreshAttempt ??= { key: this.key(), revision: bootstrap.revision, started: this.now() };
      const result = await this.api.refresh(this.refreshAttempt.revision, this.refreshAttempt.key);
      this.refreshAttempt = undefined;
      this.accept(result, generation);
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
      this.accept(result, generation);
      if (generation === this.generation && !this.coordination.pending()) this.coordination.publish('changed');
    }, true);
  }

  async logout(): Promise<void> {
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
        if (generation !== this.generation || this.coordination.pending()) return;
        if (snapshot.state === 'AUTHENTICATED') {
          if (!credential || credential.expiresAt <= this.now()) throw new SessionFailure('SESSION_EXPIRED');
          this.credential = credential;
          this.api.useToken(credential.value);
        }
        this.apply(
          { status: snapshot.state === 'AUTHENTICATED' ? 'authenticated' : 'restricted', snapshot },
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

  private accept(result: Authentication, generation: number) {
    if (generation !== this.generation || this.coordination.pending() || this.disposed) return;
    this.revision = result.revision;
    const { accessToken, expiresIn, tokenType, ...snapshot } = result;
    if (result.state === 'AUTHENTICATED' && (!accessToken || !expiresIn || tokenType !== 'Bearer')) {
      throw new SessionFailure('SESSION_RESPONSE_INVALID');
    }
    if (result.state !== 'AUTHENTICATED' && accessToken) throw new SessionFailure('SESSION_RESPONSE_INVALID');
    this.credential =
      accessToken && expiresIn ? { value: accessToken, expiresAt: this.now() + expiresIn * 1000 } : undefined;
    this.api.useToken(accessToken);
    this.update({ status: result.state === 'AUTHENTICATED' ? 'authenticated' : 'restricted', snapshot });
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
  }

  private invalidate(status: SessionView['status'], snapshot?: Snapshot) {
    this.generation += 1;
    this.credential = undefined;
    this.api.useToken(undefined);
    this.update({ status, snapshot });
    return this.generation;
  }

  private update(view: SessionView) {
    this.view = view;
    this.listeners.forEach(listener => listener(view));
  }
}
