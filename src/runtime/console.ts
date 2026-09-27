import { shallowRef } from 'vue';
import { SubscriptionWorkspace } from '@/service/forge/subscriptions';
import { OAuthWorkspace } from '@/service/forge/oauth-clients';
import { EntitlementWorkspace } from '@/service/forge/entitlements';
import type { EntitlementKind } from '@/service/forge/entitlements';
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
let subscriptions: SubscriptionWorkspace | undefined;
let oauth: OAuthWorkspace | undefined;
let entitlements: Record<EntitlementKind, EntitlementWorkspace> | undefined;
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
    entitlements = {
      plan: new EntitlementWorkspace('plan', transport.entitlements, { session: runtime, key: operationKey }),
      quota: new EntitlementWorkspace('quota', transport.entitlements, { session: runtime, key: operationKey })
    };
    oauth = new OAuthWorkspace(transport.oauth, { session: runtime, key: operationKey, storage: sessionStorage });
    tenants = new TenantWorkspace(transport.tenants, runtime, operationKey);
    subscriptions = new SubscriptionWorkspace(transport.entitlements, {
      session: runtime,
      key: operationKey,
      tenants,
      plans: entitlements.plan
    });
    runtime.subscribe(value => {
      consoleState.value = value;
    });
  }
  return runtime;
}

export function oauthWorkspace(): OAuthWorkspace {
  consoleRuntime();
  return oauth!;
}

export function subscriptionWorkspace(): SubscriptionWorkspace {
  consoleRuntime();
  return subscriptions!;
}

export function tenantWorkspace(): TenantWorkspace {
  consoleRuntime();
  return tenants!;
}

export function entitlementWorkspace(kind: EntitlementKind): EntitlementWorkspace {
  consoleRuntime();
  return entitlements![kind];
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
    oauth?.dispose();
    tenants?.dispose();
    subscriptions?.dispose();
    entitlements?.plan.dispose();
    entitlements?.quota.dispose();
    runtime?.dispose();
  });
