<script setup lang="ts">
import { onUnmounted, shallowRef } from 'vue';
import { tenantWorkspace } from '@/runtime/console';
import { $t } from '@/locales';
import { useTenantDisplay } from './shared';
defineOptions({ name: 'TenantRecovery' });
const emit = defineEmits<{ view: [id: string] }>();
const workspace = tenantWorkspace();
const state = shallowRef(workspace.state);
const stop = workspace.subscribe(value => {
  state.value = value;
});
onUnmounted(stop);
const { enabled, instant, stateText } = useTenantDisplay();
async function resume(id: string) {
  const tenantId = await workspace.continueCreation(id);
  if (tenantId && enabled.value) emit('view', tenantId);
}
</script>

<template>
  <section :aria-label="$t('tenants.recovery')" class="mt-24px space-y-16px">
    <div class="flex items-center justify-between gap-16px">
      <h2 class="text-18px font-semibold">{{ $t('tenants.recovery') }}</h2>
      <ElButton :disabled="!enabled || state.busy" @click="workspace.checkCreations()">
        {{ $t('tenants.check') }}
      </ElButton>
    </div>
    <p>{{ $t('tenants.recoveryHint') }}</p>
    <ElAlert v-if="state.unknown" :title="$t('tenants.unknown')" type="warning" :closable="false" show-icon />
    <ElAlert
      v-if="state.problem"
      :title="$t(`tenants.errors.${state.problem}`)"
      type="error"
      :closable="false"
      show-icon
    />
    <p v-if="state.busy" role="status">{{ $t('tenants.loading') }}</p>
    <p v-else-if="!state.checked" role="status">{{ $t('tenants.unchecked') }}</p>
    <p v-else-if="!state.creations.length" role="status">{{ $t('tenants.noCreations') }}</p>
    <ElTable v-if="state.creations.length" :data="state.creations" row-key="id" :aria-label="$t('tenants.recovery')">
      <ElTableColumn prop="displayName" :label="$t('tenants.name')" min-width="120" />
      <ElTableColumn :label="$t('tenants.createdAt')" min-width="190">
        <template #default="{ row }">{{ instant(row.createdAt) }}</template>
      </ElTableColumn>
      <ElTableColumn :label="$t('tenants.status')" min-width="120">
        <template #default="{ row }">{{ stateText(row.state) }}</template>
      </ElTableColumn>
      <ElTableColumn :label="$t('common.action')" align="right" fixed="right" width="190">
        <template #default="{ row }">
          <ElButton
            v-if="row.state === 'COMMITTED'"
            :disabled="!enabled || state.busy"
            @click="emit('view', row.tenantId)"
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
