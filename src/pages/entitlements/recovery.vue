<script setup lang="ts">
import type { EntitlementKind, OperationView } from '@/service/forge/entitlements';
import { $t } from '@/locales';
import { useEntitlements } from './shared';
defineOptions({ name: 'EntitlementRecovery' });
const props = defineProps<{ kind: EntitlementKind }>();
const emit = defineEmits<{ view: [id: string] }>();
const { workspace, state, enabled, instant } = useEntitlements(props.kind);
const resourceId = (row: OperationView) => (props.kind === 'plan' ? row.planId : row.quotaDefinitionId);
async function resume(id: string) {
  const result = await workspace.continueOperation(id);
  if (result && enabled.value) emit('view', result);
}
</script>

<template>
  <section :aria-label="$t('entitlements.recovery')" class="mt-24px space-y-16px">
    <div class="flex items-center justify-between gap-16px">
      <h2 class="text-18px font-semibold">{{ $t('entitlements.recovery') }}</h2>
      <ElButton :disabled="!enabled || state.busy" @click="workspace.checkOperations()">
        {{ $t('tenants.check') }}
      </ElButton>
    </div>
    <p>{{ $t('entitlements.recoveryHint') }}</p>
    <ElAlert v-if="state.unknown" :title="$t('entitlements.unknown')" type="warning" :closable="false" show-icon />
    <ElAlert
      v-if="state.problem"
      :title="$t(`entitlements.errors.${state.problem}`)"
      type="error"
      :closable="false"
      show-icon
    />
    <p v-if="state.busy" role="status">{{ $t('tenants.loading') }}</p>
    <p v-else-if="!state.checked" role="status">{{ $t('entitlements.unchecked') }}</p>
    <p v-else-if="!state.operations.length" role="status">{{ $t('entitlements.noOperations') }}</p>
    <ElTable
      v-if="state.operations.length"
      :data="state.operations"
      row-key="id"
      :aria-label="$t('entitlements.recovery')"
    >
      <ElTableColumn :label="$t('entitlements.operation')" min-width="130">
        <template #default="{ row }">
          <template v-if="row.operation">
            {{ $t(`entitlements.actions.${row.operation as 'CREATE' | 'ACTIVATE'}`) }}
          </template>
        </template>
      </ElTableColumn>
      <ElTableColumn :label="$t('entitlements.target')" min-width="180">
        <template #default="{ row }">{{ row.code || resourceId(row) || 'max_users' }}</template>
      </ElTableColumn>
      <ElTableColumn :label="$t('tenants.createdAt')" min-width="210">
        <template #default="{ row }">{{ row.createdAt ? instant(row.createdAt) : '' }}</template>
      </ElTableColumn>
      <ElTableColumn :label="$t('tenants.status')" min-width="120">
        <template #default="{ row }">
          <template v-if="row.state">{{ $t(`tenants.states.${row.state as OperationView['state']}`) }}</template>
        </template>
      </ElTableColumn>
      <ElTableColumn :label="$t('common.action')" align="right" fixed="right" width="160">
        <template #default="{ row }">
          <ElButton
            v-if="row.state === 'COMMITTED'"
            :disabled="!enabled || state.busy"
            @click="emit('view', resourceId(row)!)"
          >
            {{ $t('tenants.view') }}
          </ElButton>
          <ElButton
            v-else-if="row.canReplay"
            :disabled="!enabled || state.busy || !state.checked"
            @click="resume(row.id)"
          >
            {{ $t('tenants.continue') }}
          </ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
  </section>
</template>
