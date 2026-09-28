<script setup lang="ts">
import { onDeactivated, onUnmounted, ref, useTemplateRef } from 'vue';
import { useAppStore } from '@/store/modules/app';
import { consoleState } from '@/runtime/console';
import { mountStaticRemote } from '@/runtime/remote-loader';
import type { RemoteMount, RemoteVersion } from '@/runtime/remote-loader';
import { $t } from '@/locales';
import { formatDate, formatInstant, formatMoney, formatNumber } from '@/locales/format';
import Remote from '@/remotes/admin-consumer-fixture/Remote.vue';
import type { RemoteDisplayHost } from '@/remotes/host';

const props = defineProps<{ enabled: boolean }>();
const app = useAppStore();
const host: RemoteDisplayHost = {
  text: (key, values) => $t(`remote.${key}`, values ?? {}),
  get brandName() {
    return consoleState.value.brand?.displayName ?? 'SaaS Forge';
  },
  number: value => formatNumber({ value, locale: app.locale }),
  money: (value, currency) => formatMoney({ value, currency, locale: app.locale }),
  date: value => formatDate({ value, locale: app.locale }),
  instant: value => formatInstant({ value, locale: app.locale })
};
const container = useTemplateRef<HTMLElement>('container');
const status = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle');
const version = ref<RemoteVersion>();
let current: RemoteMount | undefined;
function unload() {
  current?.dispose();
  current = undefined;
  status.value = 'idle';
  version.value = undefined;
}
async function load(selected: RemoteVersion) {
  if (!props.enabled) return;
  unload();
  version.value = selected;
  status.value = 'loading';
  let mounted: RemoteMount | undefined;
  try {
    mounted = mountStaticRemote(container.value!, window.location.origin, selected);
    current = mounted;
    await mounted.ready;
    if (current !== mounted) return;
    status.value = 'ready';
  } catch {
    if (current === mounted) status.value = 'failed';
  }
}
onDeactivated(unload);
onUnmounted(unload);
</script>

<template>
  <section :aria-label="$t('remote.acceptance')" class="remote-acceptance mt-24px space-y-16px">
    <h2 class="text-20px font-semibold">{{ $t('remote.acceptance') }}</h2>
    <fieldset :disabled="!enabled" class="min-w-0 border-0 p-0 space-y-16px">
      <Remote :host="host" />
      <div class="flex flex-wrap gap-8px">
        <ElButton v-for="item in ['v1', 'v2'] as const" :key="item" @click="load(item)">
          {{ $t('remote.load', { version: item }) }}
        </ElButton>
        <ElButton :disabled="status === 'idle'" @click="unload">{{ $t('remote.unload') }}</ElButton>
      </div>
      <p role="status">{{ $t(`remote.${status}`, { version: version ?? '' }) }}</p>
    </fieldset>
    <div ref="container" :aria-busy="status === 'loading'" />
  </section>
</template>

<style scoped>
.remote-acceptance {
  color: var(--el-text-color-primary);
}
.remote-acceptance :deep(.el-button:focus-visible) {
  outline: 2px solid var(--el-text-color-primary);
  outline-offset: 3px;
}
</style>
