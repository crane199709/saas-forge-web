import { Configuration, PlatformAdministratorsApi, ResponseError } from '@crane199709/saas-forge-api-client';
import type { PlatformAdminGrantResult, PlatformAdministrator } from '@crane199709/saas-forge-api-client';
import { requireHttpsOrigin } from './config';

export type { PlatformAdminGrantResult, PlatformAdministrator };

export class PlatformAdminFailure extends Error {
  constructor(readonly code: 'forbidden' | 'conflict' | 'invalid' | 'unavailable' | 'last-admin' | 'missing') {
    super(code);
  }
}

export interface PlatformAdminApi {
  list(signal?: AbortSignal): Promise<PlatformAdministrator[]>;
  grant(email: string, key: string): Promise<PlatformAdminGrantResult>;
  revoke(identityId: string, key: string): Promise<void>;
}

/** 固定角色管理只调用正式 API operation；浏览器安全头不进入业务参数。 */
export function createPlatformAdminApi(apiOrigin: unknown, accessToken: () => string): PlatformAdminApi {
  const api = new PlatformAdministratorsApi(
    new Configuration({
      basePath: requireHttpsOrigin(apiOrigin),
      credentials: 'omit',
      accessToken,
      headers: { 'X-SF-CSRF': '1', 'Content-Type': 'application/json' }
    })
  );
  const options = (signal = AbortSignal.timeout(8000)) => ({ signal, redirect: 'error' as const });
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ResponseError) {
        const status = error.response.status;
        if (status === 401 || status === 403) throw new PlatformAdminFailure('forbidden');
        if (status === 404) throw new PlatformAdminFailure('missing');
        if (status === 409) {
          const body: unknown = await error.response
            .clone()
            .json()
            .catch(() => null);
          if (body && typeof body === 'object' && 'code' in body && body.code === 'LAST_PASSWORD_PLATFORM_ADMIN')
            throw new PlatformAdminFailure('last-admin');
          throw new PlatformAdminFailure('conflict');
        }
        if (status === 400 || status === 422) throw new PlatformAdminFailure('invalid');
      }
      throw new PlatformAdminFailure('unavailable');
    }
  }
  return {
    list: signal => call(async () => (await api.listPlatformAdministrators(options(signal))).items),
    grant: (email, key) =>
      call(() =>
        api.grantPlatformAdministrator({ idempotencyKey: key, platformAdminGrantRequest: { email } }, options())
      ),
    revoke: (identityId, key) =>
      call(() => api.revokePlatformAdministrator({ identityId, idempotencyKey: key }, options()))
  };
}
