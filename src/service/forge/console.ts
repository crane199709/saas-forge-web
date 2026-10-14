import {
  BrandAssetsApi,
  Configuration,
  Console,
  InvitationsApi,
  MembersApi,
  OAuthClientsApi,
  OrganizationApi,
  PermissionsApi,
  PlatformEntitlementBootstrapApi,
  PlatformTenantsApi,
  Project,
  RemoteManifestsApi
} from '@crane199709/saas-forge-api-client';
import { SessionFailure } from '../../runtime/console-session';
import type { ConsoleTransport } from '../../runtime/console-session';
import { requireHttpsOrigin } from './config';
import { createPermissionApi } from './permissions';
import { createTenantRoleApi } from './tenant-roles';
import { createMembershipRoleApi } from './membership-roles';
import { createPlatformAdminApi } from './platform-administrators';
import type { PermissionCatalogApi } from './permissions';
import type { TenantRoleApi } from './tenant-roles';
import type { MembershipRoleApi } from './membership-roles';
import type { PlatformAdminApi } from './platform-administrators';
import { createBrandProfileApi } from './brand-profile';
import type { BrandProfileApi } from './brand-profile';

/** The sole HTTP boundary owns CSRF/revision headers; browser-managed credentials are never page arguments. */
export function createConsoleTransport(apiOrigin: unknown): ConsoleTransport & {
  tenants: PlatformTenantsApi;
  entitlements: PlatformEntitlementBootstrapApi;
  oauth: OAuthClientsApi;
  projects: Project.DefaultApi;
  organization: OrganizationApi;
  brandAssets: BrandAssetsApi;
  brandProfiles: BrandProfileApi;
  permissions: PermissionCatalogApi;
  invitations: InvitationsApi;
  members: MembersApi;
  effectivePermissions: PermissionsApi;
  acceptance: Console.InvitationAcceptanceApi;
  roles: TenantRoleApi;
  membershipRoles: MembershipRoleApi;
  administrators: PlatformAdminApi;
  manifests: RemoteManifestsApi;
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
  const acceptance = new Console.InvitationAcceptanceApi(
    new Console.Configuration({ basePath, credentials: 'include' })
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
    permissions: createPermissionApi(basePath, () => token ?? ''),
    invitations: new InvitationsApi(jsonConfiguration),
    members: new MembersApi(jsonConfiguration),
    effectivePermissions: new PermissionsApi(jsonConfiguration),
    acceptance,
    roles: createTenantRoleApi(basePath, () => token ?? ''),
    membershipRoles: createMembershipRoleApi(basePath, () => token ?? ''),
    administrators: createPlatformAdminApi(basePath, () => token ?? ''),
    organization: new OrganizationApi(jsonConfiguration),
    brandAssets: new BrandAssetsApi(businessConfiguration),
    brandProfiles: createBrandProfileApi(basePath, () => token ?? ''),
    projects: new Project.DefaultApi(
      new Project.Configuration({
        ...businessOptions,
        headers: { ...businessOptions.headers, 'Content-Type': 'application/json' }
      })
    ),
    manifests: new RemoteManifestsApi(jsonConfiguration),
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
