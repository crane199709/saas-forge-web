<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { GatewayConfigurationError, GatewayReadError, createGatewayClient } from '@/service/forge/client';
import { useAppStore } from '@/store/modules/app';
import { $t } from '@/locales';

const t = (key: keyof App.I18n.Schema['gateway']) => $t(`gateway.${key}`);
const appStore = useAppStore();
const status = ref<keyof App.I18n.Schema['gateway']>('idle');
const loading = ref(false);
let pending: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

async function checkConnection() {
  if (loading.value) return;
  if (window.location.protocol !== 'https:' || !window.isSecureContext) {
    status.value = 'insecure';
    return;
  }
  const controller = new AbortController();
  pending = controller;
  loading.value = true;
  status.value = 'loading';
  timer = setTimeout(() => controller.abort('timeout'), 10000);
  try {
    const client = createGatewayClient(import.meta.env.VITE_API_ORIGIN);
    await client.readPublicKeys(controller.signal);
    if (pending === controller) status.value = 'ready';
  } catch (error) {
    if (pending !== controller) return;
    if (controller.signal.aborted) status.value = 'timeout';
    else if (error instanceof GatewayConfigurationError) status.value = 'configuration';
    else status.value = error instanceof GatewayReadError ? error.code : 'serviceUnavailable';
  } finally {
    if (pending === controller) {
      clearTimeout(timer);
      pending = undefined;
      loading.value = false;
    }
  }
}

onBeforeUnmount(() => {
  pending?.abort();
  pending = undefined;
  clearTimeout(timer);
});
</script>

<template>
  <main class="min-h-full flex-center p-24px">
    <ElCard class="max-w-640px w-full">
      <div class="flex-y-center justify-between gap-16px">
        <h1 class="text-24px font-semibold">{{ t('title') }}</h1>
        <ElButton @click="appStore.changeLocale(appStore.locale === 'zh-CN' ? 'en' : 'zh-CN')">
          {{ t('language') }}
        </ElButton>
      </div>
      <p class="my-24px">{{ t('description') }}</p>
      <p class="my-24px" role="status" aria-live="polite">{{ t(status) }}</p>
      <ElButton type="primary" :loading="loading" @click="checkConnection">{{ t('check') }}</ElButton>
    </ElCard>
  </main>
</template>
