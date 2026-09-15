import { Configuration, DiscoveryApi, FetchError, ResponseError } from '@crane199709/saas-forge-api-client';
import { requireHttpsOrigin } from './config';

export { GatewayConfigurationError } from './config';

export type GatewayReadFailure = 'sourceRejected' | 'networkUnavailable' | 'serviceUnavailable';

export class GatewayReadError extends Error {
  constructor(readonly code: GatewayReadFailure) {
    super(code);
  }
}

/** All SaaS Forge operations share the configured Gateway; callers cannot override browser security headers. */
export function createGatewayClient(apiOrigin: unknown) {
  const basePath = requireHttpsOrigin(apiOrigin);
  const discovery = new DiscoveryApi(new Configuration({ basePath, credentials: 'omit' }));
  return {
    async readPublicKeys(signal: AbortSignal): Promise<number> {
      try {
        const result = await discovery.getJwks({ signal, redirect: 'error', credentials: 'omit' });
        return result.keys.length;
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof ResponseError) {
          throw new GatewayReadError(error.response.status === 403 ? 'sourceRejected' : 'serviceUnavailable');
        }
        throw new GatewayReadError(error instanceof FetchError ? 'networkUnavailable' : 'serviceUnavailable');
      }
    }
  };
}
