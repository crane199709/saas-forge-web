import { Configuration, ResponseError, TenantRolesApi } from '@crane199709/saas-forge-api-client';
import type { TenantRole, TenantRoleChange } from '@crane199709/saas-forge-api-client';
import { requireHttpsOrigin } from './config';

export type { TenantRole, TenantRoleChange };

export class TenantRoleFailure extends Error {
  constructor(readonly code: 'forbidden' | 'conflict' | 'invalid' | 'unavailable') {
    super(code);
  }
}

export interface TenantRoleApi {
  list(signal?: AbortSignal): Promise<TenantRole[]>;
  create(change: TenantRoleChange): Promise<TenantRole>;
  update(id: string, change: TenantRoleChange): Promise<TenantRole>;
  delete(id: string): Promise<void>;
}

/** 正式 Tenant Roles operations 的统一浏览器 HTTP 边界。 */
export function createTenantRoleApi(apiOrigin: unknown, accessToken: () => string): TenantRoleApi {
  const basePath = requireHttpsOrigin(apiOrigin);
  const api = new TenantRolesApi(
    new Configuration({
      basePath,
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
        if (status === 401 || status === 403) throw new TenantRoleFailure('forbidden');
        if (status === 409) throw new TenantRoleFailure('conflict');
        if (status === 400 || status === 422) throw new TenantRoleFailure('invalid');
      }
      throw new TenantRoleFailure('unavailable');
    }
  }
  return {
    list: signal => call(async () => (await api.listTenantRoles(options(signal))).items),
    create: change => call(() => api.createTenantRole({ tenantRoleChange: change }, options())),
    update: (id, change) => call(() => api.updateTenantRole({ roleId: id, tenantRoleChange: change }, options())),
    delete: id => call(() => api.deleteTenantRole({ roleId: id }, options()))
  };
}
