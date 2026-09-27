<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { validAdministratorInput } from '@/service/forge/initialization';
import { initializationWorkspace } from '@/runtime/console';
import { $t } from '@/locales';
import { useTenantDisplay } from './shared';
defineOptions({ name: 'TenantInitialization' });
const props = defineProps<{ tenantId: string }>();
const emit = defineEmits<{ changed: [] }>();
const workspace = initializationWorkspace();
const state = shallowRef(workspace.state);
const stop = workspace.subscribe(value => {
  state.value = value;
});
const { enabled } = useTenantDisplay();
const open = ref(false);
const email = ref('');
const name = ref('');
const attempted = ref(false);
const heading = useTemplateRef<HTMLElement>('heading');
const startButton = useTemplateRef<{ $el: HTMLButtonElement }>('startButton');
const emailInput = useTemplateRef<{ focus(): void }>('emailInput');
const nameInput = useTemplateRef<{ focus(): void }>('nameInput');
const current = computed(() => state.value.tenantId === props.tenantId);
const progress = computed(() => (current.value ? state.value.progress : undefined));
const canStart = computed(
  () => current.value && enabled.value && state.value.checked && !state.value.busy && workspace.canStart()
);
const canContinue = computed(
  () => current.value && enabled.value && state.value.checked && !state.value.busy && workspace.canContinue()
);
const dirty = computed(() => open.value && Boolean(email.value || name.value));
const emailInvalid = computed(() => !validAdministratorInput({ administratorEmail: email.value.trim() }));
const nameInvalid = computed(() => name.value.trim().length > 200);
function clear() {
  email.value = '';
  name.value = '';
  attempted.value = false;
}
function configure() {
  clear();
  open.value = true;
}
async function canLeave() {
  if (!dirty.value || !enabled.value) return true;
  try {
    await window.$messageBox?.confirm($t('tenants.leaveWarning'), $t('tenants.leaveTitle'), {
      confirmButtonText: $t('tenants.leave'),
      cancelButtonText: $t('common.cancel'),
      type: 'warning',
      closeOnClickModal: false
    });
    return Boolean(window.$messageBox);
  } catch {
    return false;
  }
}
async function close() {
  if (await canLeave()) {
    clear();
    open.value = false;
  }
}
async function focusStart() {
  await nextTick();
  if (startButton.value?.$el.disabled) heading.value?.focus();
  else startButton.value?.$el.focus();
}
async function refresh() {
  await workspace.check(props.tenantId);
  if (workspace.state.progress?.state === 'SUCCEEDED') emit('changed');
}
async function submit() {
  attempted.value = true;
  if (emailInvalid.value) {
    emailInput.value?.focus();
    return;
  }
  if (nameInvalid.value) {
    nameInput.value?.focus();
    return;
  }
  if (!canStart.value) return;
  const operation = workspace.start({
    administratorEmail: email.value.trim(),
    administratorDisplayName: name.value.trim() || undefined
  });
  clear();
  open.value = false;
  if (await operation) emit('changed');
  await focusStart();
}
async function resume() {
  if (await workspace.continueOperation()) emit('changed');
  await focusStart();
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
function pageHide() {
  clear();
  open.value = false;
}
watch(enabled, value => {
  if (!value) pageHide();
});
// 会话身份或工作区变化会清空进度，同时撤销已打开表单中的个人信息。
watch(current, value => {
  if (!value) pageHide();
});
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
onMounted(() => {
  refresh();
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('pagehide', pageHide);
});
onUnmounted(() => {
  clear();
  stop();
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('pagehide', pageHide);
});
</script>

<template>
  <section :aria-label="$t('initialization.title')" :aria-busy="state.busy" class="mt-24px space-y-16px">
    <div class="flex flex-wrap items-center justify-between gap-16px">
      <h3 ref="heading" tabindex="-1" class="text-18px font-semibold">{{ $t('initialization.title') }}</h3>
      <div class="flex flex-wrap gap-8px">
        <ElButton :disabled="!enabled || state.busy" @click="refresh">{{ $t('initialization.refresh') }}</ElButton>
        <ElButton ref="startButton" type="primary" :disabled="!canStart" @click="configure">
          {{ $t('initialization.start') }}
        </ElButton>
        <ElButton v-if="progress?.canContinue" :disabled="!canContinue" @click="resume">
          {{ $t('initialization.continue') }}
        </ElButton>
      </div>
    </div>
    <p>{{ $t('initialization.hint') }}</p>
    <p v-if="state.busy" role="status">{{ $t('tenants.loading') }}</p>
    <ElAlert v-if="state.problem" :title="$t(`tenants.errors.${state.problem}`)" type="error" :closable="false" />
    <ElAlert v-if="!state.checked && progress" :title="$t('initialization.stale')" type="warning" :closable="false" />
    <ElAlert v-if="state.unknown" :title="$t('initialization.unknown')" type="warning" :closable="false" />
    <p v-if="!progress" role="status">{{ $t('initialization.unchecked') }}</p>
    <ElDescriptions v-else :column="1" border>
      <ElDescriptionsItem :label="$t('initialization.result')">
        <span role="status">{{ $t(`initialization.states.${progress.state}`) }}</span>
      </ElDescriptionsItem>
      <ElDescriptionsItem v-if="progress.initialAdministratorMembershipId" :label="$t('initialization.membership')">
        {{ progress.initialAdministratorMembershipId }}
      </ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('initialization.notification')">
        {{
          state.notification ? $t(`initialization.notifications.${state.notification}`) : $t('initialization.unchecked')
        }}
      </ElDescriptionsItem>
    </ElDescriptions>
    <p>{{ $t('initialization.notificationHint') }}</p>
    <ElDrawer
      v-model="open"
      :title="$t('initialization.start')"
      size="min(640px, 90vw)"
      :show-close="false"
      :before-close="close"
      destroy-on-close
      @opened="emailInput?.focus()"
      @closed="focusStart"
    >
      <template #header="{ titleId, titleClass }">
        <h2 :id="titleId" :class="titleClass">{{ $t('initialization.start') }}</h2>
        <ElButton :aria-label="$t('initialization.close')" @click="close">{{ $t('common.close') }}</ElButton>
      </template>
      <p>{{ $t('initialization.formHint') }}</p>
      <ElForm label-position="top" :aria-label="$t('initialization.start')" @submit.prevent="submit">
        <ElFormItem :label="$t('initialization.email')">
          <ElInput
            ref="emailInput"
            v-model="email"
            :aria-label="$t('initialization.email')"
            autocomplete="off"
            :disabled="!canStart"
            :aria-invalid="attempted && emailInvalid"
            :aria-describedby="attempted && emailInvalid ? 'administrator-email-error' : undefined"
          />
          <p v-if="attempted && emailInvalid" id="administrator-email-error" role="alert" class="text-error">
            {{ $t('initialization.emailInvalid') }}
          </p>
        </ElFormItem>
        <ElFormItem :label="$t('initialization.name')">
          <ElInput
            ref="nameInput"
            v-model="name"
            :aria-label="$t('initialization.name')"
            autocomplete="off"
            :disabled="!canStart"
            :aria-invalid="attempted && nameInvalid"
            :aria-describedby="attempted && nameInvalid ? 'administrator-name-error' : undefined"
          />
          <p v-if="attempted && nameInvalid" id="administrator-name-error" role="alert" class="text-error">
            {{ $t('initialization.nameInvalid') }}
          </p>
        </ElFormItem>
        <ElButton native-type="submit" type="primary" :disabled="!canStart">{{ $t('initialization.submit') }}</ElButton>
      </ElForm>
    </ElDrawer>
  </section>
</template>
