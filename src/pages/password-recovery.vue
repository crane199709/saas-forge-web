<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createPasswordRecovery } from '@/service/forge/password-recovery';
import type { PasswordRecoveryState } from '@/service/forge/password-recovery';
import LoginShell from '@/views/_builtin/login/index.vue';
import { onPasswordRecoveryLink, takePasswordRecoveryChallenge } from '@/runtime/password-recovery-link';
import { $t } from '@/locales';
import PasswordForm from './password-form.vue';

const router = useRouter();
const result = ref<HTMLElement>();
const email = ref('');
const hasChallenge = ref(false);
const formGeneration = ref(0);
const state = ref<PasswordRecoveryState>('ready');
let recovery: ReturnType<typeof createPasswordRecovery> | undefined;
function openLink() {
  recovery?.dispose();
  formGeneration.value += 1;
  const token = takePasswordRecoveryChallenge();
  hasChallenge.value = Boolean(token);
  try {
    recovery = createPasswordRecovery(import.meta.env.VITE_API_ORIGIN, token);
    state.value = recovery.state;
  } catch {
    state.value = 'unavailable';
  }
  nextTick(() => result.value?.focus());
}
openLink();
const stopLinks = onPasswordRecoveryLink(openLink);
const message = computed(() => {
  if (state.value === 'requested') return $t('console.recoveryRequested');
  if (state.value === 'pending') return $t('console.recoveryPending');
  if (state.value === 'complete') return $t('console.recoveryComplete');
  if (state.value === 'invalid') return $t('console.recoveryInvalid');
  if (state.value === 'policy') return $t('console.passwordInvalid');
  if (state.value === 'unknown') return $t('console.recoveryUnknown');
  if (state.value === 'unavailable') return $t('console.recoveryUnavailable');
  return hasChallenge.value ? $t('console.recoveryNewPassword') : $t('console.recoveryIntro');
});
async function request() {
  if (!recovery || !email.value || state.value === 'requesting') return;
  state.value = 'requesting';
  state.value = await recovery.request(email.value);
  await nextTick();
  result.value?.focus();
}
async function redeem(password: string) {
  if (!recovery || state.value === 'submitting') return;
  const generation = formGeneration.value;
  state.value = 'submitting';
  const outcome = await recovery.redeem(password);
  if (generation !== formGeneration.value) return;
  state.value = outcome;
  await nextTick();
  result.value?.focus();
}
function leave() {
  recovery?.dispose();
  router.replace('/login');
}
function clear() {
  formGeneration.value += 1;
  recovery?.dispose();
  email.value = '';
}
onMounted(() => {
  window.addEventListener('pagehide', clear);
  result.value?.focus();
});
onUnmounted(() => {
  stopLinks();
  clear();
  window.removeEventListener('pagehide', clear);
});
</script>

<template>
  <LoginShell :title="$t('console.recoveryTitle')">
    <div :aria-busy="['requesting', 'submitting'].includes(state)">
      <p ref="result" tabindex="-1" role="status" class="mb-20px">{{ message }}</p>
      <form v-if="!hasChallenge && ['ready', 'unavailable'].includes(state)" @submit.prevent="request">
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
        <ElButton native-type="submit" type="primary" class="w-full" :disabled="state === 'requesting'">
          {{ $t('console.recoverySend') }}
        </ElButton>
      </form>
      <PasswordForm
        v-if="hasChallenge && ['ready', 'policy', 'pending', 'unknown'].includes(state)"
        :key="formGeneration"
        :submit-password="redeem"
      />
      <ElButton @click="leave">{{ $t('console.backToLogin') }}</ElButton>
    </div>
  </LoginShell>
</template>
