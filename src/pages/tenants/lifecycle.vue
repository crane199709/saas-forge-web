<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import type { LifecycleAction } from '@/service/forge/lifecycle';
import { lifecycleWorkspace } from '@/runtime/console';
import { $t } from '@/locales';
import { useTenantDisplay } from './shared';
defineOptions({ name: 'TenantLifecycle' });
const props = defineProps<{ tenantId: string }>();
const emit = defineEmits<{ changed: [] }>();
const workspace = lifecycleWorkspace();
const state = shallowRef(workspace.state);
const { enabled } = useTenantDisplay();
const unsubscribe = workspace.subscribe(value => {
  state.value = value;
});
const actions: LifecycleAction[] = ['suspend', 'resume', 'recover', 'continue'];
let disposed = false;
let confirming = false;
let cancelConfirmation: (() => void) | undefined;
function closeConfirmation() {
  if (!cancelConfirmation) return;
  cancelConfirmation();
  ElMessageBox.close();
}
async function check() {
  await workspace.check(props.tenantId);
}
async function run(action: LifecycleAction, event: MouseEvent) {
  if (confirming || !workspace.can(action)) return;
  confirming = true;
  const snapshot = state.value.snapshot;
  const trigger = event.currentTarget as HTMLElement;
  try {
    const confirmed = await Promise.race([
      ElMessageBox.confirm($t(`lifecycle.confirm.${action}`), $t(`lifecycle.actions.${action}`), {
        type: 'warning',
        confirmButtonText: $t('common.confirm'),
        cancelButtonText: $t('common.cancel'),
        closeOnClickModal: false
      }).then(
        () => true,
        () => false
      ),
      new Promise<boolean>(resolve => {
        cancelConfirmation = () => resolve(false);
      })
    ]);
    cancelConfirmation = undefined;
    if (!confirmed) return;
    if (!disposed && snapshot === state.value.snapshot && enabled.value) {
      await workspace.run(action);
      if (!disposed) emit('changed');
    }
  } catch {
    /* 取消确认不发出请求。 */
  } finally {
    confirming = false;
    await nextTick();
    if (!disposed && trigger.isConnected && !trigger.hasAttribute('disabled')) trigger.focus();
    else if (!disposed) document.getElementById('lifecycle-heading')?.focus();
  }
}
function externalChange(event: StorageEvent) {
  if (event.key === `sf:tenant-lifecycle:${props.tenantId}` || event.key === null) check();
}
watch(enabled, value => {
  if (!value) closeConfirmation();
  if (value && !state.value.snapshot && !state.value.busy) check();
});
onMounted(() => {
  check();
  window.addEventListener('storage', externalChange);
});
onUnmounted(() => {
  disposed = true;
  closeConfirmation();
  unsubscribe();
  window.removeEventListener('storage', externalChange);
});
</script>

<template>
  <section aria-labelledby="lifecycle-heading" :aria-busy="state.busy" class="mt-24px">
    <div class="mb-16px flex items-center justify-between gap-16px">
      <h2 id="lifecycle-heading" tabindex="-1" class="text-18px font-semibold">{{ $t('lifecycle.title') }}</h2>
      <ElButton :disabled="!enabled || state.busy" @click="check">{{ $t('lifecycle.check') }}</ElButton>
    </div>
    <p class="mb-16px">{{ $t('lifecycle.hint') }}</p>
    <p v-if="state.busy" role="status">{{ $t('tenants.loading') }}</p>
    <ElAlert
      v-if="state.unknown"
      :title="$t('lifecycle.unknown')"
      type="warning"
      :closable="false"
      show-icon
      class="mb-16px"
    />
    <ElAlert
      v-if="state.problem"
      :title="$t(`tenants.errors.${state.problem}`)"
      type="error"
      :closable="false"
      show-icon
      class="mb-16px"
    />
    <ElDescriptions v-if="state.snapshot" :column="1" border class="mb-16px">
      <ElDescriptionsItem :label="$t('lifecycle.progress')">
        {{ $t(`lifecycle.states.${state.snapshot.state}`) }}
      </ElDescriptionsItem>
      <ElDescriptionsItem v-if="state.snapshot.operationId" :label="$t('lifecycle.operation')">
        {{ state.snapshot.operationId }}
      </ElDescriptionsItem>
    </ElDescriptions>
    <div class="flex flex-wrap justify-end gap-12px">
      <ElButton
        v-for="action in actions"
        :key="action"
        :type="action === 'suspend' ? 'danger' : 'primary'"
        :disabled="!enabled || !workspace.can(action)"
        @click="run(action, $event)"
      >
        {{ $t(`lifecycle.actions.${action}`) }}
      </ElButton>
    </div>
  </section>
</template>
