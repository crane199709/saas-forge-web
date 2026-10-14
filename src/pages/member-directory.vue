<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ResponseError } from '@crane199709/saas-forge-api-client';
import type { Member } from '@crane199709/saas-forge-api-client';
import { consoleMembers, consoleState } from '@/runtime/console';
import { $t } from '@/locales';

const items = ref<Member[]>([]);
const status = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
let generation = 0;
let controller = new AbortController();
async function load() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  items.value = [];
  if (consoleState.value.status !== 'authenticated' || consoleState.value.snapshot?.activeContext?.type !== 'TENANT')
    return;
  status.value = 'loading';
  const started = generation;
  try {
    const result = await consoleMembers().listMembers({ signal: controller.signal, redirect: 'error' });
    if (started !== generation) return;
    items.value = result.items;
    status.value = 'ready';
  } catch (error) {
    if (started !== generation) return;
    status.value = error instanceof ResponseError && error.response.status === 403 ? 'forbidden' : 'unavailable';
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
  <section :aria-label="$t('members.title')" :aria-busy="status === 'loading'">
    <div class="mb-16px flex flex-wrap items-center gap-12px">
      <h2 class="text-18px font-semibold">{{ $t('members.title') }}</h2>
      <ElButton :loading="status === 'loading'" @click="load">{{ $t('members.refresh') }}</ElButton>
    </div>
    <p v-if="status === 'loading'" role="status">{{ $t('members.loading') }}</p>
    <p v-else-if="status === 'forbidden'" role="status">{{ $t('members.forbidden') }}</p>
    <ElAlert v-else-if="status === 'unavailable'" :title="$t('members.unavailable')" type="error" :closable="false" />
    <p v-else-if="items.length === 0" role="status">{{ $t('members.empty') }}</p>
    <ElTable v-else :data="items" :aria-label="$t('members.title')">
      <ElTableColumn :label="$t('members.identity')" min-width="220">
        <template #default="{ row }">{{ row.invitedEmail || row.identityId }}</template>
      </ElTableColumn>
      <ElTableColumn :label="$t('members.status')" min-width="120">
        <template #default="{ row }">
          {{ $t(row.status === 'ENABLED' ? 'members.enabled' : 'members.disabled') }}
        </template>
      </ElTableColumn>
    </ElTable>
  </section>
</template>
