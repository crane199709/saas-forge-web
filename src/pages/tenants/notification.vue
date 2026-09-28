<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { notificationWorkspace } from '@/runtime/console';
import { $t } from '@/locales';
import { useTenantDisplay } from './shared';
defineOptions({ name: 'TenantNotification' });
const props = defineProps<{ tenantId: string; initializationState?: string }>();
const workspace = notificationWorkspace();
const state = shallowRef(workspace.state);
const stop = workspace.subscribe(value => {
  state.value = value;
});
const { enabled } = useTenantDisplay();
const heading = useTemplateRef<HTMLElement>('heading');
const confirming = ref(false);
let alive = true;
const progress = computed(() => (state.value.tenantId === props.tenantId ? state.value.progress : undefined));
const canResend = computed(
  () => enabled.value && state.value.checked && !state.value.busy && Boolean(progress.value) && workspace.canResend()
);
const canContinue = computed(
  () => enabled.value && state.value.checked && !state.value.busy && Boolean(progress.value) && workspace.canContinue()
);
async function refresh() {
  await workspace.check(props.tenantId);
}
async function act(action: 'resend' | 'continue') {
  if (confirming.value || !(action === 'resend' ? canResend.value : canContinue.value)) return;
  confirming.value = true;
  const tenantId = props.tenantId;
  const original = progress.value?.resendId;
  try {
    if (action === 'resend') {
      await window.$messageBox?.confirm($t('notification.confirm'), $t('notification.resend'), {
        confirmButtonText: $t('common.confirm'),
        cancelButtonText: $t('common.cancel'),
        type: 'warning',
        closeOnClickModal: false
      });
      if (!window.$messageBox) return;
    }
    if (!alive || !enabled.value || tenantId !== props.tenantId || original !== progress.value?.resendId) return;
    if (action === 'resend') await workspace.resend();
    else await workspace.continueOperation();
    await nextTick();
    if (alive) heading.value?.focus();
  } catch {
    // 取消确认不发送重发请求。
  } finally {
    confirming.value = false;
  }
}
watch(() => [props.tenantId, props.initializationState], refresh, { immediate: true });
onUnmounted(() => {
  alive = false;
  stop();
});
</script>

<template>
  <section :aria-label="$t('notification.title')" :aria-busy="state.busy" class="mt-24px space-y-16px">
    <div class="flex flex-wrap items-center justify-between gap-16px">
      <h3 ref="heading" tabindex="-1" class="text-18px font-semibold">{{ $t('notification.title') }}</h3>
      <div class="flex flex-wrap gap-8px">
        <ElButton :disabled="!enabled || state.busy || confirming" @click="refresh">
          {{ $t('notification.refresh') }}
        </ElButton>
        <ElButton type="primary" :disabled="!canResend || confirming" @click="act('resend')">
          {{ $t('notification.resend') }}
        </ElButton>
        <ElButton v-if="progress?.canContinue" :disabled="!canContinue || confirming" @click="act('continue')">
          {{ $t('notification.continue') }}
        </ElButton>
      </div>
    </div>
    <p>{{ $t('notification.hint') }}</p>
    <p v-if="state.busy" role="status">{{ $t('tenants.loading') }}</p>
    <ElAlert v-if="state.problem" :title="$t(`tenants.errors.${state.problem}`)" type="error" :closable="false" />
    <ElAlert v-if="!state.checked && progress" :title="$t('initialization.stale')" type="warning" :closable="false" />
    <ElAlert v-if="state.unknown" :title="$t('notification.unknown')" type="warning" :closable="false" />
    <p v-if="!progress" role="status">{{ $t('initialization.unchecked') }}</p>
    <ElDescriptions v-else :column="1" border>
      <ElDescriptionsItem :label="$t('initialization.notification')">
        <span role="status">{{ $t(`initialization.notifications.${progress.state}`) }}</span>
      </ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('notification.operation')">
        <span role="status">{{ $t(`notification.operations.${progress.operationState}`) }}</span>
      </ElDescriptionsItem>
    </ElDescriptions>
    <p v-if="progress?.operationState === 'PENDING' && !progress.canContinue" role="status">
      {{ $t('notification.pending') }}
    </p>
    <p>{{ $t('initialization.notificationHint') }}</p>
  </section>
</template>
