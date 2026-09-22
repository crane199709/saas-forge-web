import { AuthenticationApi, Configuration, ResponseError } from '@crane199709/saas-forge-api-client';
import { operationKey } from '../../runtime/browser-coordination';
import { requireHttpsOrigin } from './config';

export type PasswordSetupState = 'ready' | 'submitting' | 'complete' | 'invalid' | 'policy' | 'unknown' | 'unavailable';

/** Challenge 与原操作键仅活在本页面；未知结果重试不能创建第二次消费。 */
export function createPasswordSetup(apiOrigin: unknown, challenge: string) {
  const api = new AuthenticationApi(
    new Configuration({ basePath: requireHttpsOrigin(apiOrigin), credentials: 'omit' })
  );
  let token = challenge;
  const key = operationKey();
  let state: PasswordSetupState = /^[A-Za-z0-9_-]{43}$/.test(token) ? 'ready' : 'invalid';
  let disposed = false;
  let passwordDigest: string | undefined;
  const controller = new AbortController();
  return {
    get state() {
      return state;
    },
    async submit(newPassword: string): Promise<PasswordSetupState> {
      if (disposed || ['submitting', 'complete', 'invalid'].includes(state)) return state;
      state = 'submitting';
      try {
        // 只保留本次操作的内存摘要，防止同键重放成功被误认为另一密码已生效。
        const digest = new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key + newPassword.normalize('NFC')))
        );
        if (disposed) return state;
        const fingerprint = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
        if (passwordDigest && passwordDigest !== fingerprint) {
          state = 'unknown';
          return state;
        }
        passwordDigest = fingerprint;
        await api.establishPassword(
          { idempotencyKey: key, xSFCSRF: '1', passwordSetupRequest: { token, newPassword } },
          {
            credentials: 'omit',
            redirect: 'error',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
          }
        );
        if (!disposed) {
          state = 'complete';
          token = '';
          passwordDigest = undefined;
        }
      } catch (error) {
        if (disposed) return state;
        state = 'unknown';
        if (error instanceof ResponseError) {
          const problem = await error.response.json().catch(() => undefined);
          if (disposed) return state;
          if (problem?.code === 'PASSWORD_SETUP_TOKEN_INVALID') {
            state = 'invalid';
            token = '';
            passwordDigest = undefined;
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
            passwordDigest = undefined;
          }
        }
      }
      return state;
    },
    dispose() {
      disposed = true;
      state = 'invalid';
      passwordDigest = undefined;
      token = '';
      controller.abort();
    }
  };
}
