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
  return {
    async list(signal = AbortSignal.timeout(8000)) {
      try {
        const response = await fetch(`${basePath}/api/v1/permissions`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken()}` },
          credentials: 'omit',
          redirect: 'error',
          signal
        });
        if (response.status === 401 || response.status === 403) throw new PermissionCatalogFailure('forbidden');
        if (!response.ok) throw new PermissionCatalogFailure('unavailable');
        const body: unknown = await response.json();
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
        throw new PermissionCatalogFailure('unavailable');
      }
    }
  };
}
