<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import LoginShell from '@/views/_builtin/login/index.vue';
import { consoleRuntime, consoleState } from '@/runtime/console';
import { $t } from '@/locales';
import WorkContexts from './work-contexts.vue';
import InitialPassword from './initial-password.vue';

const email = ref('');
const password = ref('');
const invalid = ref(false);
function clearPassword() {
  password.value = '';
}
onMounted(() => window.addEventListener('pagehide', clearPassword));
onUnmounted(() => {
  clearPassword();
  window.removeEventListener('pagehide', clearPassword);
});
const unavailable = computed(() =>
  ['GATEWAY_CONFIGURATION_INVALID', 'SESSION_COORDINATION_UNAVAILABLE'].includes(consoleState.value.problem ?? '')
);
function retry() {
  if (unavailable.value) window.location.reload();
  else consoleRuntime().recover();
}
const busy = computed(() => consoleState.value.status === 'loading');
const message = computed(() => {
  const state = consoleState.value;
  if (state.problem === 'PASSWORD_CHANGED') return $t('console.passwordChanged');
  if (state.problem === 'PASSWORD_CHANGE_RESULT_UNKNOWN') return $t('console.passwordUnknown');
  if (state.problem?.startsWith('PASSWORD_') || state.problem === 'VALIDATION_FAILED')
    return $t('console.passwordInvalid');
  if (state.status === 'logoutPending') return $t('console.logoutPending');
  if (state.problem === 'AUTHENTICATION_FAILED') return $t('console.credentials');
  if (state.problem === 'TARGET_CONTEXT_UNAVAILABLE') return $t('console.targetUnavailable');
  if (state.problem === 'SESSION_EXPIRED') return $t('console.expired');
  if (state.status === 'blocked') return $t('console.blocked');
  if (state.snapshot?.state === 'NO_AVAILABLE_CONTEXT') return $t('console.noContext');
  if (state.snapshot?.state === 'PASSWORD_CHANGE_REQUIRED') return $t('console.initial');
  if (state.snapshot?.state === 'CONTEXT_SELECTION_REQUIRED') return $t('console.selection');
  if (state.snapshot?.activeContext?.type === 'TENANT') return $t('console.tenant');
  return '';
});
async function submit() {
  if (busy.value) return;
  invalid.value = !email.value.includes('@') || !password.value;
  if (invalid.value) return;
  const value = password.value;
  password.value = '';
  await consoleRuntime().login(email.value, value);
}
</script>

<template>
  <LoginShell>
    <div aria-live="polite" :aria-busy="busy">
      <ElAlert v-if="message" :title="message" :closable="false" type="warning" class="mb-20px" />
      <p v-if="busy" role="status">{{ $t('console.loading') }}</p>
      <form v-if="consoleState.status === 'anonymous'" @submit.prevent="submit">
        <ElFormItem :label="$t('console.email')">
          <ElInput
            v-model="email"
            name="email"
            type="email"
            autocomplete="username"
            :aria-label="$t('console.email')"
            required
          />
        </ElFormItem>
        <ElFormItem :label="$t('console.password')">
          <ElInput
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            :aria-label="$t('console.password')"
            required
          />
        </ElFormItem>
        <ElAlert v-if="invalid" :title="$t('console.invalid')" :closable="false" type="error" />
        <ElButton native-type="submit" type="primary" size="large" class="w-full" :disabled="busy">
          {{ $t('console.signIn') }}
        </ElButton>
      </form>
      <InitialPassword
        v-if="consoleState.status === 'restricted' && consoleState.snapshot?.state === 'PASSWORD_CHANGE_REQUIRED'"
      />
      <WorkContexts
        v-if="consoleState.status === 'restricted' && consoleState.snapshot?.state === 'CONTEXT_SELECTION_REQUIRED'"
        class="mb-24px"
      />
      <ElSpace v-if="!busy && consoleState.status !== 'anonymous'" wrap>
        <ElButton type="primary" @click="retry">{{ $t('console.retry') }}</ElButton>
        <ElButton v-if="consoleState.status !== 'logoutPending' && !unavailable" @click="consoleRuntime().logout()">
          {{ $t('console.logout') }}
        </ElButton>
      </ElSpace>
      <p class="text-color-secondary mt-24px text-12px">
        {{ $t('console.footer') }}
      </p>
    </div>
  </LoginShell>
</template>
