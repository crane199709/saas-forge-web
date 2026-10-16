<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, watch } from 'vue';
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
const dangerActions: LifecycleAction[] = ['suspend', 'close'];
// 202610162300：恢复类操作只在权威快照允许时渲染，不展示一排无法点击的按钮（#13）。
const recoveryActions = computed(() => {
  const snapshot = state.value.snapshot;
  if (!snapshot) return [];
  const allowed: Record<'recover' | 'recoverClosure' | 'continue', boolean> = {
    recover: snapshot.canRecoverSuspension,
    recoverClosure: snapshot.canRecoverClosure,
    continue: snapshot.canContinue
  };
  return (['recover', 'recoverClosure', 'continue'] as const).filter(action => allowed[action]);
});
// 202610162300：权威读取不足时主操作保持禁用，并复用已有状态/错误文案就近说明原因（#13）。
const blockedReason = computed(() => {
  if (!enabled.value) return undefined;
  if (state.value.busy) return $t('tenants.loading');
  if (state.value.unknown) return $t('lifecycle.unknown');
  if (state.value.problem) return $t(`tenants.errors.${state.value.problem}`);
  if (!state.value.snapshot) return $t('initialization.unchecked');
  return undefined;
});
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
  <ElCard class="card-wrapper">
    <section aria-labelledby="lifecycle-heading" :aria-busy="state.busy" class="space-y-16px">
      <div class="flex flex-wrap items-center justify-between gap-16px">
        <h2 id="lifecycle-heading" tabindex="-1" class="text-18px font-semibold">{{ $t('lifecycle.title') }}</h2>
        <ElButton :disabled="!enabled || state.busy" @click="check">{{ $t('lifecycle.check') }}</ElButton>
      </div>
      <p v-if="state.busy" role="status">{{ $t('tenants.loading') }}</p>
      <ElAlert v-if="state.unknown" :title="$t('lifecycle.unknown')" type="warning" :closable="false" show-icon />
      <ElAlert
        v-if="state.problem"
        :title="$t(`tenants.errors.${state.problem}`)"
        type="error"
        :closable="false"
        show-icon
      />
      <ElDescriptions v-if="state.snapshot" :column="1" border label-width="180px">
        <ElDescriptionsItem :label="$t('lifecycle.progress')">
          {{ $t(`lifecycle.states.${state.snapshot.state}`) }}
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="state.snapshot.operationId" :label="$t('lifecycle.operation')">
          {{ state.snapshot.operationId }}
        </ElDescriptionsItem>
      </ElDescriptions>
      <ElAlert
        v-if="state.snapshot?.action === 'CLOSE' && state.snapshot.state === 'COMPLETED'"
        :title="$t('lifecycle.closed')"
        type="error"
        :closable="false"
        show-icon
        class="closure-alert"
      />
      <div class="flex flex-wrap items-center justify-end gap-12px">
        <ElButton type="primary" :disabled="!enabled || !workspace.can('resume')" @click="run('resume', $event)">
          {{ $t('lifecycle.actions.resume') }}
        </ElButton>
        <ElButton
          v-for="action in recoveryActions"
          :key="action"
          type="success"
          plain
          :disabled="!enabled || !workspace.can(action)"
          @click="run(action, $event)"
        >
          {{ $t(`lifecycle.actions.${action}`) }}
        </ElButton>
      </div>
    </section>
  </ElCard>
  <ElCard class="danger-zone card-wrapper">
    <section aria-labelledby="lifecycle-danger-heading" class="space-y-16px">
      <h2 id="lifecycle-danger-heading" class="text-18px font-semibold">{{ $t('lifecycle.dangerZone') }}</h2>
      <div class="flex flex-wrap items-center justify-end gap-12px">
        <p v-if="blockedReason" id="lifecycle-blocked-reason" class="text-sm text-[var(--el-text-color-secondary)]">
          {{ blockedReason }}
        </p>
        <ElButton
          v-for="action in dangerActions"
          :key="action"
          type="danger"
          plain
          :disabled="!enabled || !workspace.can(action)"
          :aria-describedby="blockedReason ? 'lifecycle-blocked-reason' : undefined"
          @click="run(action, $event)"
        >
          {{ $t(`lifecycle.actions.${action}`) }}
        </ElButton>
      </div>
    </section>
  </ElCard>
</template>

<style scoped>
.closure-alert :deep(.el-alert__title) {
  color: var(--el-text-color-primary);
}

/* 202610162300：危险操作卡片用危险色边框与常规分区区分，按钮保持 plain 以免实心红块抢占注意力（#13）。 */
.danger-zone {
  border-color: var(--el-color-danger);
}
</style>
