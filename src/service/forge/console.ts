import {
  Configuration,
  Console,
  OAuthClientsApi,
  PlatformEntitlementBootstrapApi,
  PlatformTenantsApi
} from '@crane199709/saas-forge-api-client';
import { SessionFailure } from '../../runtime/console-session';
import type { ConsoleTransport } from '../../runtime/console-session';
import { requireHttpsOrigin } from './config';

/** The sole HTTP boundary owns CSRF/revision headers; browser-managed credentials are never page arguments. */
export function createConsoleTransport(apiOrigin: unknown): ConsoleTransport & {
  tenants: PlatformTenantsApi;
  entitlements: PlatformEntitlementBootstrapApi;
  oauth: OAuthClientsApi;
} {
  const basePath = requireHttpsOrigin(apiOrigin);
  let token: string | undefined;
  const api = new Console.ConsoleAuthenticationApi(
    new Console.Configuration({
      basePath,
      credentials: 'include',
      accessToken: () => token ?? ''
    })
  );
  const options = () => ({
    redirect: 'error' as const,
    signal: AbortSignal.timeout(8000)
  });
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
      if (error instanceof SessionFailure) throw error;
      throw new SessionFailure('NETWORK_UNAVAILABLE');
    }
  }
  const businessOptions = {
    basePath,
    credentials: 'omit' as const,
    accessToken: () => token ?? '',
    headers: { 'X-SF-CSRF': '1' }
  };
  const businessConfiguration = new Configuration(businessOptions);
  // Gateway 对无请求体的浏览器写操作也要求 JSON Content-Type。
  const jsonConfiguration = new Configuration({
    ...businessOptions,
    headers: { ...businessOptions.headers, 'Content-Type': 'application/json' }
  });
  return {
    oauth: new OAuthClientsApi(jsonConfiguration),
    entitlements: new PlatformEntitlementBootstrapApi(businessConfiguration),
    tenants: new PlatformTenantsApi(jsonConfiguration),
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
    select: (target, revision, key) =>
      call(async () => {
        const response = await api.selectConsoleContextRaw(
          {
            xSFCSRF: '1',
            ifMatch: `"${revision}"`,
            idempotencyKey: key,
            consoleContextSelectionRequest: target
          },
          options()
        );
        const etag = response.raw.headers.get('ETag');
        if (!etag || !/^"(0|[1-9][0-9]*)"$/.test(etag)) throw new SessionFailure('SESSION_RESPONSE_INVALID');
        return etag.slice(1, -1);
      }),
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
    changePassword: (password, revision, key) =>
      call(() =>
        api.changeConsoleInitialPassword(
          {
            xSFCSRF: '1',
            ifMatch: `"${revision}"`,
            idempotencyKey: key,
            consolePasswordChangeRequest: { newPassword: password }
          },
          options()
        )
      ),
    useToken(value) {
      token = value;
    }
  };
}
