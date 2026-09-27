import { computed } from 'vue';
import type { TenantStatus } from '@crane199709/saas-forge-api-client';
import type { CreationView } from '@/service/forge/tenants';
import { useAppStore } from '@/store/modules/app';
import { $t } from '@/locales';
import { consoleState } from '@/runtime/console';

export function useTenantDisplay() {
  const app = useAppStore();
  const enabled = computed(
    () =>
      consoleState.value.status === 'authenticated' && consoleState.value.snapshot?.activeContext?.type === 'PLATFORM'
  );
  function instant(value: Date | null) {
    if (!value) return $t('tenants.noExpiry');
    return new Intl.DateTimeFormat(app.locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    }).format(value);
  }
  const stateText = (value: TenantStatus | CreationView['state']) => $t(`tenants.states.${value}`);
  return { enabled, instant, stateText };
}
