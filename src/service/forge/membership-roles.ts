import { Configuration, MembersApi, ResponseError } from '@crane199709/saas-forge-api-client';
import type { MemberRoleAssignment } from '@crane199709/saas-forge-api-client';
import { requireHttpsOrigin } from './config';

export type { MemberRoleAssignment };

export class MembershipRoleFailure extends Error {
  constructor(readonly code: 'forbidden' | 'last-administrator' | 'missing' | 'unavailable') {
    super(code);
  }
}

export interface MembershipRoleApi {
  list(membershipId: string, signal?: AbortSignal): Promise<MemberRoleAssignment[]>;
  assign(membershipId: string, roleId: string): Promise<MemberRoleAssignment[]>;
  revoke(membershipId: string, roleId: string): Promise<MemberRoleAssignment[]>;
}

/** 正式 Membership-Role operations 的浏览器 HTTP 边界。 */
export function createMembershipRoleApi(apiOrigin: unknown, accessToken: () => string): MembershipRoleApi {
  const api = new MembersApi(
    new Configuration({
      basePath: requireHttpsOrigin(apiOrigin),
      credentials: 'omit',
      accessToken,
      headers: { 'X-SF-CSRF': '1', 'Content-Type': 'application/json' }
    })
  );
  const options = (signal = AbortSignal.timeout(8000)) => ({
    signal,
    redirect: 'error' as const
  });
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ResponseError) {
        const status = error.response.status;
        if (status === 401 || status === 403) throw new MembershipRoleFailure('forbidden');
        if (status === 404) throw new MembershipRoleFailure('missing');
        if (status === 409) throw new MembershipRoleFailure('last-administrator');
      }
      throw new MembershipRoleFailure('unavailable');
    }
  }
  return {
    list: (membershipId, signal) =>
      call(async () => (await api.listMembershipRoles({ membershipId }, options(signal))).items),
    assign: (membershipId, roleId) =>
      call(async () => (await api.assignMembershipRole({ membershipId, roleId }, options())).items),
    revoke: (membershipId, roleId) =>
      call(async () => (await api.revokeMembershipRole({ membershipId, roleId }, options())).items)
  };
}
