import { shallowRef } from 'vue';
import { TenantWorkspace } from '@/service/forge/tenants';
import { createConsoleTransport } from '@/service/forge/console';
import { GatewayConfigurationError, requireHttpsOrigin } from '@/service/forge/config';
import { clearAuthStorage } from '@/store/modules/auth/shared';
import { resolveConsoleBrand } from './console-brand';
import { ConsoleSessionRuntime } from './console-session';
import type { SessionView } from './console-session';
import { createBrowserCoordination, operationKey } from './browser-coordination';

export const consoleState = shallowRef<SessionView>({ status: 'loading' });
let runtime: ConsoleSessionRuntime | undefined;
let tenants: TenantWorkspace | undefined;
let startup: Promise<void> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

export function consoleRuntime(): ConsoleSessionRuntime {
  if (!runtime) {
    const origin = requireHttpsOrigin(import.meta.env.VITE_API_ORIGIN);
    const transport = createConsoleTransport(origin);
    runtime = new ConsoleSessionRuntime(transport, createBrowserCoordination(origin), {
      key: operationKey,
      resolveBrand: resolveConsoleBrand
    });
    tenants = new TenantWorkspace(transport.tenants, runtime, operationKey);
    runtime.subscribe(value => {
      consoleState.value = value;
    });
  }
  return runtime;
}

export function tenantWorkspace(): TenantWorkspace {
  consoleRuntime();
  return tenants!;
}

const verify = () => {
  if (document.visibilityState === 'visible') runtime?.verify();
};

export function startConsole(): Promise<void> {
  startup ??= (async () => {
    try {
      clearAuthStorage();
      await consoleRuntime().recover();
      window.addEventListener('focus', verify);
      document.addEventListener('visibilitychange', verify);
      timer = setInterval(verify, 30_000);
    } catch (error) {
      consoleState.value = {
        status: 'blocked',
        problem:
          error instanceof GatewayConfigurationError
            ? 'GATEWAY_CONFIGURATION_INVALID'
            : 'SESSION_COORDINATION_UNAVAILABLE'
      };
    }
  })();
  return startup;
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    window.removeEventListener('focus', verify);
    document.removeEventListener('visibilitychange', verify);
    clearInterval(timer);
    tenants?.dispose();
    runtime?.dispose();
  });
