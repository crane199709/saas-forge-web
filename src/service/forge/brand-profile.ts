import { BrandProfilesApi, Configuration, ResponseError } from '@crane199709/saas-forge-api-client';
import type { BrandProfileChange, BrandProfileRevision } from '@crane199709/saas-forge-api-client';
import { requireHttpsOrigin } from './config';

export type { BrandProfileChange, BrandProfileRevision };

export class BrandProfileFailure extends Error {
  constructor(readonly code: 'forbidden' | 'stale' | 'asset' | 'invalid' | 'unavailable') {
    super(code);
  }
}

/** 品牌页只通过正式 Brand profiles operations 访问 Tenant 数据。 */
export function createBrandProfileApi(apiOrigin: unknown, accessToken: () => string) {
  const api = new BrandProfilesApi(
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
        if (status === 401 || status === 403) throw new BrandProfileFailure('forbidden');
        if (status === 412) throw new BrandProfileFailure('stale');
        if (status === 409) throw new BrandProfileFailure('asset');
        if (status === 400 || status === 428) throw new BrandProfileFailure('invalid');
      }
      throw new BrandProfileFailure('unavailable');
    }
  }
  return {
    read: (signal?: AbortSignal): Promise<BrandProfileRevision> =>
      call(() => api.getTenantBrandProfile(options(signal))),
    save: (revision: number, change: BrandProfileChange): Promise<BrandProfileRevision> =>
      call(() => api.saveTenantBrandProfile({ ifMatch: `"${revision}"`, brandProfileChange: change }, options()))
  };
}

export type BrandProfileApi = ReturnType<typeof createBrandProfileApi>;
