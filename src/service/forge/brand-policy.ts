import { Configuration, PlatformBrandPolicyApi, ResponseError } from '@crane199709/saas-forge-api-client';
import type { BrandAssetDisableResult } from '@crane199709/saas-forge-api-client';
import { requireHttpsOrigin } from './config';

export type { BrandAssetDisableResult };

export class BrandPolicyFailure extends Error {
  constructor(readonly code: 'forbidden' | 'missing' | 'invalid' | 'unavailable') {
    super(code);
  }
}

/** 平台政策操作只使用正式 API；Origin 与 Cookie 保持浏览器管理。 */
export function createBrandPolicyApi(apiOrigin: unknown, accessToken: () => string) {
  const api = new PlatformBrandPolicyApi(
    new Configuration({
      basePath: requireHttpsOrigin(apiOrigin),
      credentials: 'omit',
      accessToken,
      headers: { 'X-SF-CSRF': '1', 'Content-Type': 'application/json' }
    })
  );
  return {
    async disable(assetId: string): Promise<BrandAssetDisableResult> {
      try {
        return await api.disableBrandAsset({ assetId }, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      } catch (error) {
        if (error instanceof ResponseError) {
          if (error.response.status === 401 || error.response.status === 403) throw new BrandPolicyFailure('forbidden');
          if (error.response.status === 404) throw new BrandPolicyFailure('missing');
          if (error.response.status === 400) throw new BrandPolicyFailure('invalid');
        }
        throw new BrandPolicyFailure('unavailable');
      }
    }
  };
}

export type BrandPolicyApi = ReturnType<typeof createBrandPolicyApi>;
