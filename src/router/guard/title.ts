import { watchEffect } from 'vue';
import type { Router } from 'vue-router';
import { consoleState } from '@/runtime/console';
import { $t } from '@/locales';

export function createDocumentTitleGuard(router: Router) {
  watchEffect(() => {
    const { i18nKey, title } = router.currentRoute.value.meta;
    const brand = consoleState.value.brand;
    document.title = brand ? `${brand.displayName} · ${i18nKey ? $t(i18nKey) : (title ?? '')}` : $t('system.title');
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) favicon.href = brand?.faviconUrl ?? '/favicon.svg';
  });
}
