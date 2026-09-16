import { Console } from '@crane199709/saas-forge-api-client';
import { SessionFailure } from '../../runtime/console-session';
import type { ConsoleTransport } from '../../runtime/console-session';
import { requireHttpsOrigin } from './config';

/** The sole HTTP boundary owns CSRF/revision headers; browser-managed credentials are never page arguments. */
export function createConsoleTransport(apiOrigin: unknown): ConsoleTransport {
  const basePath = requireHttpsOrigin(apiOrigin);
  let token: string | undefined;
  const api = new Console.ConsoleAuthenticationApi(
    new Console.Configuration({ basePath, credentials: 'include', accessToken: () => token ?? '' })
  );
  const options = () => ({ redirect: 'error' as const, signal: AbortSignal.timeout(8000) });
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Console.ResponseError) {
        const problem: unknown = await error.response.json().catch(() => undefined);
        if (problem && typeof problem === 'object' && 'code' in problem && typeof problem.code === 'string') {
          throw new SessionFailure(problem.code);
        }
        throw new SessionFailure('SERVICE_UNAVAILABLE');
      }
      throw new SessionFailure('NETWORK_UNAVAILABLE');
    }
  }
  return {
    bootstrap: () => call(() => api.bootstrapConsoleSession({ xSFCSRF: '1', body: {} }, options())),
    session: () => call(() => api.getConsoleSession(options())),
    login: (email, password, revision) =>
      call(() =>
        api.loginConsoleSession(
          {
            xSFCSRF: '1',
            ifMatch: `"${revision}"`,
            consoleLoginRequest: { email, password }
          },
          options()
        )
      ),
    refresh: (revision, key) =>
      call(() =>
        api.refreshConsoleSession(
          {
            xSFCSRF: '1',
            ifMatch: `"${revision}"`,
            idempotencyKey: key,
            body: {}
          },
          options()
        )
      ),
    logout: (revision, key) =>
      call(() =>
        api.logoutConsoleSession(
          {
            xSFCSRF: '1',
            ifMatch: `"${revision}"`,
            idempotencyKey: key,
            body: {}
          },
          options()
        )
      ),
    useToken(value) {
      token = value;
    }
  };
}
