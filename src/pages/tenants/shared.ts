import { computed } from 'vue';
import type { TenantStatus } from '@crane199709/saas-forge-api-client';
import type { CreationView } from '@/service/forge/tenants';
import { useAppStore } from '@/store/modules/app';
import { $t } from '@/locales';
import { formatInstant } from '@/locales/format';
import { consoleState } from '@/runtime/console';

export function useTenantDisplay() {
  const app = useAppStore();
  const enabled = computed(
    () =>
      consoleState.value.status === 'authenticated' && consoleState.value.snapshot?.activeContext?.type === 'PLATFORM'
  );
  function instant(value: Date | null) {
    if (!value) return $t('tenants.noExpiry');
    return formatInstant({ value: value.toISOString(), locale: app.locale });
  }
  const stateText = (value: TenantStatus | CreationView['state']) => $t(`tenants.states.${value}`);
  return { enabled, instant, stateText };
}
