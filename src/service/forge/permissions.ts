import { Configuration, PermissionsApi, ResponseError } from '@crane199709/saas-forge-api-client';
import { requireHttpsOrigin } from './config';

export interface PermissionEntry {
  code: string;
  enabled: boolean;
}

export class PermissionCatalogFailure extends Error {
  constructor(readonly code: 'forbidden' | 'unavailable') {
    super(code);
  }
}

export interface PermissionCatalogApi {
  list(signal?: AbortSignal): Promise<PermissionEntry[]>;
}

const permissionCode = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/** 正式 listPermissions operation 的类型化浏览器入口；仅共享 HTTP 边界接触 Access Token。 */
export function createPermissionApi(apiOrigin: unknown, accessToken: () => string): PermissionCatalogApi {
  const basePath = requireHttpsOrigin(apiOrigin);
  const api = new PermissionsApi(new Configuration({ basePath, credentials: 'omit', accessToken }));
  return {
    async list(signal = AbortSignal.timeout(8000)) {
      try {
        const body: unknown = await api.listPermissions({ signal, redirect: 'error' });
        if (
          !body ||
          typeof body !== 'object' ||
          !('items' in body) ||
          !Array.isArray(body.items) ||
          !body.items.every(
            (item: unknown) =>
              item &&
              typeof item === 'object' &&
              'code' in item &&
              typeof item.code === 'string' &&
              permissionCode.test(item.code) &&
              'enabled' in item &&
              typeof item.enabled === 'boolean'
          )
        )
          throw new PermissionCatalogFailure('unavailable');
        return body.items.map(item => ({ code: item.code as string, enabled: item.enabled as boolean }));
      } catch (error) {
        if (error instanceof PermissionCatalogFailure) throw error;
        if (error instanceof ResponseError && [401, 403].includes(error.response.status))
          throw new PermissionCatalogFailure('forbidden');
        throw new PermissionCatalogFailure('unavailable');
      }
    }
  };
}
