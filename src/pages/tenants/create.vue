<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { tenantWorkspace } from '@/runtime/console';
import { $t } from '@/locales';
import { useTenantDisplay } from './shared';
import Recovery from './recovery.vue';
defineOptions({ name: 'TenantCreate' });
const emit = defineEmits<{ close: []; view: [id: string] }>();
const workspace = tenantWorkspace();
const state = shallowRef(workspace.state);
const stop = workspace.subscribe(value => {
  state.value = value;
});
const { enabled } = useTenantDisplay();
const name = ref('');
const invalid = ref(false);
const complete = ref(false);
const submitted = ref(false);
let alive = true;
const dirty = computed(() => !complete.value && (name.value.length > 0 || state.value.unknown || state.value.busy));
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
  if (await canLeave()) emit('close');
}
function view(id: string) {
  complete.value = true;
  emit('view', id);
}
async function submit() {
  invalid.value = !name.value.trim() || name.value.length > 200;
  if (invalid.value || !enabled.value || !state.value.canCreate || submitted.value) return;
  submitted.value = true;
  const id = await workspace.create(name.value);
  if (alive && id && enabled.value) view(id);
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeRouteLeave(canLeave);
onUnmounted(() => {
  alive = false;
  stop();
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <ElDrawer
    :model-value="true"
    :title="$t('tenants.create')"
    size="min(720px, 90vw)"
    :show-close="false"
    :before-close="close"
    destroy-on-close
  >
    <template #header="{ titleId, titleClass }">
      <h2 :id="titleId" :class="titleClass">{{ $t('tenants.create') }}</h2>
      <ElButton :aria-label="$t('tenants.closeCreate')" @click="close">{{ $t('common.close') }}</ElButton>
    </template>
    <ElForm :aria-label="$t('tenants.create')" label-position="top" @submit.prevent="submit">
      <ElFormItem :label="$t('tenants.name')" :error="invalid ? $t('tenants.errors.nameInvalid') : undefined">
        <ElInput
          v-model="name"
          :aria-label="$t('tenants.name')"
          :aria-invalid="invalid"
          :aria-describedby="invalid ? 'tenant-name-error' : undefined"
          maxlength="200"
          :disabled="!enabled || state.busy || state.unknown"
        />
      </ElFormItem>
      <p v-if="invalid" id="tenant-name-error" role="alert">{{ $t('tenants.errors.nameInvalid') }}</p>
      <div class="flex justify-end">
        <ElButton
          type="primary"
          native-type="submit"
          :loading="state.busy"
          :disabled="!enabled || !state.canCreate || submitted"
        >
          {{ $t('tenants.create') }}
        </ElButton>
      </div>
    </ElForm>
    <Recovery class="mt-24px" @view="view" />
  </ElDrawer>
</template>
