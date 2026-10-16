import { computed, onUnmounted, shallowRef } from 'vue';
import type { EntitlementKind } from '@/service/forge/entitlements';
import { useAppStore } from '@/store/modules/app';
import { formatInstant } from '@/locales/format';
import { consoleState, entitlementWorkspace } from '@/runtime/console';

export function useEntitlements(kind: EntitlementKind) {
  const workspace = entitlementWorkspace(kind);
  const state = shallowRef(workspace.state);
  onUnmounted(
    workspace.subscribe(value => {
      state.value = value;
    })
  );
  const app = useAppStore();
  const enabled = computed(
    () =>
      consoleState.value.status === 'authenticated' && consoleState.value.snapshot?.activeContext?.type === 'PLATFORM'
  );
  const base = kind === 'plan' ? '/plans' : '/quota-definitions';
  const instant = (value: Date) => formatInstant({ value: value.toISOString(), locale: app.locale });
  const integer = (value: number) => new Intl.NumberFormat(app.locale, { maximumFractionDigits: 0 }).format(value);
  return { workspace, state, enabled, base, instant, integer };
}
