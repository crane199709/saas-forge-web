import { computed, onUnmounted, shallowRef } from 'vue';
import type { EntitlementKind } from '@/service/forge/entitlements';
import { useAppStore } from '@/store/modules/app';
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
  const instant = (value: Date) =>
    new Intl.DateTimeFormat(app.locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    }).format(value);
  const integer = (value: number) => new Intl.NumberFormat(app.locale, { maximumFractionDigits: 0 }).format(value);
  return { workspace, state, enabled, base, instant, integer };
}
