<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { PermissionCatalogFailure } from '@/service/forge/permissions';
import type { PermissionEntry } from '@/service/forge/permissions';
import { consolePermissionCatalog, consoleState } from '@/runtime/console';
import { $t } from '@/locales';

const api = consolePermissionCatalog();
const items = ref<PermissionEntry[]>([]);
const status = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
let generation = 0;
let controller = new AbortController();

async function load() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  items.value = [];
  const context = consoleState.value.snapshot?.activeContext;
  if (consoleState.value.status !== 'authenticated' || context?.type !== 'TENANT') return;
  status.value = 'loading';
  const started = generation;
  try {
    const result = await api.list(controller.signal);
    if (started !== generation) return;
    items.value = result;
    status.value = 'ready';
  } catch (error) {
    if (started !== generation) return;
    status.value =
      error instanceof PermissionCatalogFailure && error.code === 'forbidden' ? 'forbidden' : 'unavailable';
  }
}

watch(
  () => [
    consoleState.value.status,
    consoleState.value.snapshot?.sessionId,
    consoleState.value.snapshot?.activeContext?.membershipId
  ],
  load,
  { immediate: true }
);
onBeforeUnmount(() => {
  generation += 1;
  controller.abort();
});
</script>

<template>
  <section :aria-label="$t('permissionCatalog.title')" :aria-busy="status === 'loading'">
    <div class="mb-16px flex items-center justify-between gap-12px">
      <h2 class="text-18px font-semibold">{{ $t('permissionCatalog.title') }}</h2>
      <ElButton :disabled="status === 'loading'" @click="load">{{ $t('permissionCatalog.reload') }}</ElButton>
    </div>
    <p v-if="status === 'loading'" role="status">{{ $t('permissionCatalog.loading') }}</p>
    <ElAlert
      v-else-if="status === 'forbidden'"
      type="warning"
      role="status"
      :closable="false"
      :title="$t('permissionCatalog.forbidden')"
    />
    <ElAlert
      v-else-if="status === 'unavailable'"
      type="error"
      role="alert"
      :closable="false"
      :title="$t('permissionCatalog.unavailable')"
    />
    <p v-else-if="!items.length" role="status">{{ $t('permissionCatalog.empty') }}</p>
    <ElTable v-else :data="items" :aria-label="$t('permissionCatalog.title')">
      <ElTableColumn prop="code" :label="$t('permissionCatalog.code')" min-width="260" />
      <ElTableColumn :label="$t('permissionCatalog.status')" min-width="120">
        <template #default="scope">
          <ElTag :type="scope.row.enabled ? 'success' : 'info'">
            {{ $t(scope.row.enabled ? 'permissionCatalog.enabled' : 'permissionCatalog.disabled') }}
          </ElTag>
        </template>
      </ElTableColumn>
    </ElTable>
  </section>
</template>
