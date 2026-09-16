<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { GatewayConfigurationError, GatewayReadError, createGatewayClient } from '@/service/forge/client';
import { useAppStore } from '@/store/modules/app';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'zh-CN': {
      title: 'SaaS Forge',
      description: '检查与服务的公开连接。此页面不验证登录状态。',
      check: '检查连接',
      idle: '尚未检查连接。',
      loading: '正在连接服务…',
      ready: '连接成功，已读取公开验证密钥。此结果不代表已登录。',
      insecure: '请通过受信 HTTPS Console 地址访问此页面。内部 HTTP 监听地址不是浏览器入口。',
      configuration: '缺少或错误的 Gateway 配置。请检查个人配置中的 VITE_API_ORIGIN，使用受信 HTTPS 地址。',
      sourceRejected: '服务拒绝当前页面来源，请检查 Gateway 的受控 Origin 配置。',
      networkUnavailable: '无法读取服务响应。请检查网络、HTTPS 证书以及 Gateway 是否允许当前页面来源（CORS）。',
      serviceUnavailable: '服务暂时无法完成公开读取，请检查 Gateway 和后端服务状态。',
      timeout: '连接超时，请检查网络及服务状态。',
      language: 'English'
    },
    'en-US': {
      title: 'SaaS Forge',
      description: 'Check the public service connection. This page does not verify your session.',
      check: 'Check connection',
      idle: 'Connection has not been checked.',
      loading: 'Connecting to the service…',
      ready: 'Connected and read public verification keys. This does not mean you are signed in.',
      insecure: 'Open the trusted HTTPS Console address. The internal HTTP listener is not a browser entry point.',
      configuration:
        'Gateway configuration is missing or invalid. Set VITE_API_ORIGIN to a trusted HTTPS origin in your personal configuration.',
      sourceRejected: 'The service rejected this page origin. Check the controlled Gateway origins.',
      networkUnavailable:
        'Cannot read the service response. Check the network, HTTPS certificate and allowed Gateway origins (CORS).',
      serviceUnavailable: 'Public reading is unavailable. Check the Gateway and backend services.',
      timeout: 'Connection timed out. Check the network and service status.',
      language: '中文'
    }
  }
});
const appStore = useAppStore();
const status = ref('idle');
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
        <ElButton @click="appStore.changeLocale(appStore.locale === 'zh-CN' ? 'en-US' : 'zh-CN')">
          {{ t('language') }}
        </ElButton>
      </div>
      <p class="my-24px">{{ t('description') }}</p>
      <p class="my-24px" role="status" aria-live="polite">{{ t(status) }}</p>
      <ElButton type="primary" :loading="loading" @click="checkConnection">{{ t('check') }}</ElButton>
    </ElCard>
  </main>
</template>
