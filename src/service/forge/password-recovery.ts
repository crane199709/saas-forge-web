import { Console } from '@crane199709/saas-forge-api-client';
import { requireHttpsOrigin } from './config';

export type PasswordRecoveryState =
  | 'ready'
  | 'requesting'
  | 'requested'
  | 'submitting'
  | 'pending'
  | 'complete'
  | 'invalid'
  | 'policy'
  | 'unknown'
  | 'unavailable';

/** 恢复链接只在内存中使用，所有请求均走正式匿名 Client operation。 */
export function createPasswordRecovery(apiOrigin: unknown, challenge: string) {
  const api = new Console.PasswordRecoveryApi(
    new Console.Configuration({ basePath: requireHttpsOrigin(apiOrigin), credentials: 'omit' })
  );
  let token = challenge;
  let disposed = false;
  let passwordFingerprint: string | undefined;
  let state: PasswordRecoveryState = token && !/^[A-Za-z0-9_-]{43}$/.test(token) ? 'invalid' : 'ready';
  const controller = new AbortController();
  const options = () => ({
    credentials: 'omit' as RequestCredentials,
    redirect: 'error' as RequestRedirect,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
  });
  return {
    get state() {
      return state;
    },
    async request(email: string): Promise<PasswordRecoveryState> {
      if (disposed || state === 'requesting') return state;
      state = 'requesting';
      try {
        await api.requestPasswordRecovery({ xSFCSRF: '1', passwordRecoveryRequest: { email } }, options());
        if (!disposed) state = 'requested';
      } catch {
        if (!disposed) state = 'unavailable';
      }
      return state;
    },
    async redeem(newPassword: string): Promise<PasswordRecoveryState> {
      if (disposed || !token || ['submitting', 'complete', 'invalid'].includes(state)) return state;
      state = 'submitting';
      try {
        const digest = new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token + newPassword.normalize('NFC')))
        );
        if (disposed) return state;
        const fingerprint = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
        if (passwordFingerprint && passwordFingerprint !== fingerprint) {
          state = 'unknown';
          return state;
        }
        passwordFingerprint = fingerprint;
        const result = await api.redeemPasswordRecovery(
          { xSFCSRF: '1', passwordRecoveryRedeemRequest: { token, newPassword } },
          options()
        );
        if (!disposed) {
          state = result.status === 'COMPLETED' ? 'complete' : 'pending';
          if (state === 'complete') {
            token = '';
            passwordFingerprint = undefined;
          }
        }
      } catch (error) {
        if (disposed) return state;
        state = 'unknown';
        if (error instanceof Console.ResponseError) {
          const problem = await error.response.json().catch(() => undefined);
          if (disposed) return state;
          if (problem?.code === 'PASSWORD_RECOVERY_TOKEN_INVALID') {
            state = 'invalid';
            token = '';
            passwordFingerprint = undefined;
          } else if (
            [
              'PASSWORD_TOO_SHORT',
              'PASSWORD_TOO_LONG',
              'PASSWORD_WHITESPACE_NOT_ALLOWED',
              'PASSWORD_COMPROMISED',
              'VALIDATION_FAILED'
            ].includes(problem?.code)
          ) {
            state = 'policy';
            passwordFingerprint = undefined;
          }
        }
      }
      return state;
    },
    dispose() {
      disposed = true;
      token = '';
      passwordFingerprint = undefined;
      state = 'invalid';
      controller.abort();
    }
  };
}
