<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ResponseError } from '@crane199709/saas-forge-api-client';
import type { Member } from '@crane199709/saas-forge-api-client';
import { consoleMembers, consoleState } from '@/runtime/console';
import { $t } from '@/locales';
import { operationKey } from '@/runtime/browser-coordination';

const items = ref<Member[]>([]);
const status = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
const busy = ref<string | null>(null);
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

async function disable(item: Member) {
  if (busy.value || item.status !== 'ENABLED' || item.disableStatus !== 'NONE') return;
  try {
    await ElMessageBox.confirm($t('members.confirmDisable'), $t('members.disable'));
  } catch {
    return;
  }
  busy.value = item.membershipId;
  try {
    const progress = await consoleMembers().disableMembership(
      { membershipId: item.membershipId, idempotencyKey: operationKey() },
      { signal: AbortSignal.timeout(12000), redirect: 'error' }
    );
    ElMessage.info($t(progress.pending ? 'members.disablePending' : 'members.disableCompleted'));
  } catch (error) {
    ElMessage.error(
      error instanceof ResponseError && error.response.status === 409
        ? $t('members.disableConflict')
        : $t('members.disableFailed')
    );
  } finally {
    busy.value = null;
    await load();
  }
}

async function recover(item: Member) {
  if (busy.value || item.disableStatus !== 'RECOVERY_REQUIRED') return;
  busy.value = item.membershipId;
  try {
    await consoleMembers().recoverMembershipDisable(
      { membershipId: item.membershipId },
      { signal: AbortSignal.timeout(12000), redirect: 'error' }
    );
    ElMessage.info($t('members.disablePending'));
  } catch {
    ElMessage.error($t('members.disableFailed'));
  } finally {
    busy.value = null;
    await load();
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
      <ElTableColumn :label="$t('members.operation')" min-width="200">
        <template #default="{ row }">
          <span v-if="row.disableStatus === 'REVOKING'" role="status">{{ $t('members.revoking') }}</span>
          <span v-else-if="row.disableStatus === 'RELEASE_PENDING'" role="status">{{ $t('members.releasePending') }}</span>
          <span v-else-if="row.disableStatus === 'RECOVERY_REQUIRED'" role="status">{{ $t('members.recoveryRequired') }}</span>
          <span v-else>{{ $t('members.noPendingOperation') }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn :label="$t('members.actions')" min-width="190">
        <template #default="{ row }">
          <ElButton
            v-if="row.status === 'ENABLED' && row.disableStatus === 'NONE'"
            type="danger"
            :loading="busy === row.membershipId"
            :aria-label="`${$t('members.disable')} ${row.invitedEmail || row.identityId}`"
            @click="disable(row)"
          >
            {{ $t('members.disable') }}
          </ElButton>
          <ElButton
            v-else-if="row.disableStatus === 'RECOVERY_REQUIRED'"
            :loading="busy === row.membershipId"
            :aria-label="`${$t('members.recover')} ${row.invitedEmail || row.identityId}`"
            @click="recover(row)"
          >
            {{ $t('members.recover') }}
          </ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
  </section>
</template>
