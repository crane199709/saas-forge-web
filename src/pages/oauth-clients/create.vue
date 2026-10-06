<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import type { RuntimeScope } from '@crane199709/saas-forge-api-client';
import { managedScopes, runtimeScopes } from '@/service/forge/oauth-clients';
import { $t } from '@/locales';
import { useOAuth } from './shared';
import Recovery from './recovery.vue';
defineOptions({ name: 'OAuthCreate' });
const emit = defineEmits<{ close: []; created: [] }>();
const { workspace, state, enabled } = useOAuth();
const name = ref('');
const scopes = ref<RuntimeScope[]>([]);
const attempted = ref(false);
const complete = ref(false);
const controller = new AbortController();
const input = useTemplateRef<{ focus(): void }>('input');
const invalidName = computed(() => attempted.value && (!name.value.trim() || name.value.length > 200));
const invalidScopes = computed(() => attempted.value && !scopes.value.length);
const locked = computed(() => state.value.busy || state.value.pending.some(row => row.action === 'CREATE'));
const dirty = computed(() => !complete.value && Boolean(name.value || scopes.value.length || locked.value));
const allowed = computed(
  () => enabled.value && state.value.checked && !locked.value && workspace.canStart('CREATE', name.value)
);
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
async function submit() {
  attempted.value = true;
  if (invalidName.value) {
    input.value?.focus();
    return;
  }
  if (invalidScopes.value || !allowed.value) return;
  if (await workspace.create(name.value, scopes.value, controller.signal)) {
    complete.value = true;
    emit('created');
    emit('close');
  }
}
function unload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
window.addEventListener('beforeunload', unload);
onBeforeRouteLeave(canLeave);
onMounted(() => workspace.checkOperations());
onUnmounted(() => {
  controller.abort();
  window.removeEventListener('beforeunload', unload);
});
</script>

<template>
  <ElDrawer
    :model-value="true"
    :title="$t('oauth.create')"
    size="min(720px, 90vw)"
    :show-close="false"
    :before-close="close"
    destroy-on-close
  >
    <template #header="{ titleId, titleClass }">
      <h2 :id="titleId" :class="titleClass">{{ $t('oauth.create') }}</h2>
      <ElButton @click="close">{{ $t('common.close') }}</ElButton>
    </template>
    <ElForm label-position="top" :aria-label="$t('oauth.create')" @submit.prevent="submit">
      <ElFormItem :label="$t('oauth.name')">
        <ElInput
          ref="input"
          v-model="name"
          :aria-label="$t('oauth.name')"
          :aria-invalid="invalidName"
          :aria-describedby="invalidName ? 'oauth-name-error' : undefined"
          maxlength="200"
          :disabled="!enabled || locked"
        />
        <p v-if="invalidName" id="oauth-name-error" role="alert" class="text-error">{{ $t('oauth.nameInvalid') }}</p>
      </ElFormItem>
      <ElFormItem :label="$t('oauth.scopes')">
        <ElCheckboxGroup
          v-model="scopes"
          :aria-label="$t('oauth.scopes')"
          :aria-invalid="invalidScopes"
          :aria-describedby="invalidScopes ? 'oauth-scopes-error' : undefined"
          :disabled="!enabled || locked"
        >
          <ElCheckbox
            v-for="scope in managedScopes"
            :key="scope"
            :value="scope"
            :disabled="scopes.length > 0 && runtimeScopes.includes(scope) !== runtimeScopes.includes(scopes[0])"
          >
            {{ scope }}
          </ElCheckbox>
        </ElCheckboxGroup>
        <p v-if="invalidScopes" id="oauth-scopes-error" role="alert" class="text-error">
          {{ $t('oauth.scopesInvalid') }}
        </p>
      </ElFormItem>
      <ElButton native-type="submit" type="primary" :disabled="!allowed" :loading="state.busy">
        {{ $t('oauth.create') }}
      </ElButton>
    </ElForm>
    <div class="mt-24px"><Recovery /></div>
  </ElDrawer>
</template>
