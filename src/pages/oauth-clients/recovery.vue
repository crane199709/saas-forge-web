<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue';
import type { OAuthClientOperation } from '@crane199709/saas-forge-api-client';
import { consoleState } from '@/runtime/console';
import { $t } from '@/locales';
import { useOAuth } from './shared';
defineOptions({ name: 'OAuthRecovery' });
const { workspace, state, enabled, instant } = useOAuth();
const selected = ref<OAuthClientOperation>();
const heading = useTemplateRef<HTMLElement>('heading');
let trigger: HTMLElement | undefined;
function confirm(row: OAuthClientOperation, event: MouseEvent) {
  if (!workspace.canRecover(row.operationId)) return;
  trigger = event.currentTarget as HTMLElement;
  selected.value = row;
}
function focus() {
  if (state.value.secret) return;
  if (trigger?.isConnected && !trigger.hasAttribute('disabled')) trigger.focus();
  else heading.value?.focus();
}
async function recover() {
  const row = selected.value;
  selected.value = undefined;
  if (!row || !enabled.value) return;
  const recovered = await workspace.recover(row.operationId);
  if (recovered) await workspace.checkOperations();
  if (!recovered) {
    await nextTick();
    focus();
  }
}
// 确认不能跨会话或身份变化继续使用；恢复仍会在工作区重新读取后端许可。
watch(
  () => consoleState.value.snapshot,
  () => {
    selected.value = undefined;
  }
);
watch(enabled, value => {
  if (!value) selected.value = undefined;
});
</script>

<template>
  <section :aria-label="$t('oauth.recovery')" class="space-y-12px">
    <h2 id="oauth-recovery-heading" ref="heading" tabindex="-1" class="text-18px font-semibold">
      {{ $t('oauth.recovery') }}
    </h2>
    <p>{{ $t('oauth.recoveryHint') }}</p>
    <ElAlert v-if="state.problem" :title="$t(`oauth.errors.${state.problem}`)" type="error" :closable="false" />
    <ElAlert v-if="state.pending.length" :title="$t('oauth.unknown')" type="warning" :closable="false" />
    <ElAlert
      v-if="state.recoveryPending.length"
      :title="$t('oauth.recoveryUnknown')"
      type="warning"
      :closable="false"
    />
    <p v-if="!state.checked" role="status">{{ $t('oauth.unchecked') }}</p>
    <ul v-if="state.pending.length" class="list-disc pl-20px">
      <li v-for="row in state.pending" :key="`${row.action}:${row.clientId || row.displayName}`">
        {{ $t(`oauth.actions.${row.action}`) }} · {{ row.displayName }} · {{ row.clientId }} ·
        {{ instant(row.startedAt) }}
      </li>
    </ul>
    <ElButton :disabled="!enabled || state.busy" :loading="state.busy" @click="workspace.checkOperations()">
      {{ $t('common.refresh') }}
    </ElButton>
    <ElTable
      :data="state.operations"
      row-key="operationId"
      :empty-text="$t('oauth.noOperations')"
      :aria-label="$t('oauth.recovery')"
    >
      <ElTableColumn prop="displayName" :label="$t('oauth.name')" min-width="140" />
      <ElTableColumn :label="$t('common.action')" min-width="100">
        <template #default="{ row }">{{ row.action ? $t(`oauth.actions.${row.action as 'CREATE'}`) : '' }}</template>
      </ElTableColumn>
      <ElTableColumn prop="operationId" :label="$t('oauth.operationId')" min-width="300" />
      <ElTableColumn prop="clientId" :label="$t('oauth.id')" min-width="300" />
      <ElTableColumn :label="$t('oauth.completedAt')" min-width="210">
        <template #default="{ row }">{{ row.completedAt ? instant(row.completedAt) : '' }}</template>
      </ElTableColumn>
      <ElTableColumn :label="$t('oauth.recoveryUntil')" min-width="210">
        <template #default="{ row }">{{ row.recoveryUntil ? instant(row.recoveryUntil) : '—' }}</template>
      </ElTableColumn>
      <ElTableColumn :label="$t('oauth.recoverable')" min-width="120">
        <template #default="{ row }">
          {{ row.canRecover === undefined ? '' : $t(row.canRecover ? 'oauth.yes' : 'oauth.no') }}
        </template>
      </ElTableColumn>
      <ElTableColumn :label="$t('common.action')" min-width="180" fixed="right">
        <template #default="{ row }">
          <span v-if="state.recoveryPending.includes(row.operationId)" role="status">{{ $t('oauth.unknown') }}</span>
          <ElButton :disabled="!enabled || !workspace.canRecover(row.operationId)" @click="confirm(row, $event)">
            {{ $t('oauth.actions.RECOVER') }}
          </ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
    <ElDialog
      :model-value="Boolean(selected)"
      :title="$t('oauth.actions.RECOVER')"
      width="min(640px, 90vw)"
      :close-on-click-modal="false"
      @close="selected = undefined"
      @closed="focus"
    >
      <template v-if="selected">
        <p>{{ $t('oauth.recoveryWarning') }}</p>
        <p class="mt-12px">{{ $t('oauth.recoveryOriginalHint') }}</p>
        <p class="mt-12px break-all">{{ selected.displayName }} · {{ selected.clientId }}</p>
        <p class="break-all">{{ $t('oauth.operationId') }}: {{ selected.operationId }}</p>
      </template>
      <template #footer>
        <ElButton @click="selected = undefined">{{ $t('common.cancel') }}</ElButton>
        <ElButton type="primary" :disabled="!selected || !workspace.canRecover(selected.operationId)" @click="recover">
          {{ $t('oauth.actions.RECOVER') }}
        </ElButton>
      </template>
    </ElDialog>
  </section>
</template>
