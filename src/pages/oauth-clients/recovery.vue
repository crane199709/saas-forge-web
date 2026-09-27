<script setup lang="ts">
import { $t } from '@/locales';
import { useOAuth } from './shared';
defineOptions({ name: 'OAuthRecovery' });
const { workspace, state, enabled, instant } = useOAuth();
</script>

<template>
  <section :aria-label="$t('oauth.recovery')" class="space-y-12px">
    <h2 class="text-18px font-semibold">{{ $t('oauth.recovery') }}</h2>
    <p>{{ $t('oauth.recoveryHint') }}</p>
    <ElAlert v-if="state.problem" :title="$t(`oauth.errors.${state.problem}`)" type="error" :closable="false" />
    <ElAlert v-if="state.pending.length" :title="$t('oauth.unknown')" type="warning" :closable="false" />
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
    </ElTable>
  </section>
</template>
