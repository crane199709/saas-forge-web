<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createPasswordSetup } from '@/service/forge/password-setup';
import type { PasswordSetupState } from '@/service/forge/password-setup';
import LoginShell from '@/views/_builtin/login/index.vue';
import { onPasswordSetupLink, takePasswordSetupChallenge } from '@/runtime/password-setup-link';
import { $t } from '@/locales';
import PasswordForm from './password-form.vue';

const router = useRouter();
const result = ref<HTMLElement>();
let setup: ReturnType<typeof createPasswordSetup> | undefined;
const state = ref<PasswordSetupState>('unavailable');
const formGeneration = ref(0);
function openLink() {
  setup?.dispose();
  formGeneration.value += 1;
  state.value = 'unavailable';
  try {
    setup = createPasswordSetup(import.meta.env.VITE_API_ORIGIN, takePasswordSetupChallenge());
    state.value = setup.state;
  } catch {
    /* 配置错误不能发出请求；Challenge 已从 URL 和交接状态清除。 */
  }
}
openLink();
const stopLinks = onPasswordSetupLink(openLink);
const message = computed(() => {
  if (state.value === 'complete') return $t('console.passwordChanged');
  if (state.value === 'policy') return $t('console.passwordInvalid');
  if (state.value === 'unknown') return $t('console.setupUnknown');
  if (state.value === 'invalid') return $t('console.setupInvalid');
  if (state.value === 'unavailable') return $t('console.setupUnavailable');
  return $t('console.setupIntro');
});
async function submit(password: string) {
  if (!setup || state.value === 'submitting') return;
  const current = setup;
  const generation = formGeneration.value;
  state.value = 'submitting';
  const outcome = await current.submit(password);
  if (generation !== formGeneration.value) return;
  state.value = outcome;
  await nextTick();
  result.value?.focus();
}
function leave() {
  setup?.dispose();
  router.replace('/login');
}
function clear() {
  formGeneration.value += 1;
  setup?.dispose();
  state.value = 'invalid';
}
onMounted(() => {
  window.addEventListener('pagehide', clear);
  if (['invalid', 'unavailable'].includes(state.value)) result.value?.focus();
});
onUnmounted(() => {
  stopLinks();
  clear();
  window.removeEventListener('pagehide', clear);
});
</script>

<template>
  <LoginShell :title="$t('console.setupTitle')">
    <div :aria-busy="state === 'submitting'">
      <p ref="result" tabindex="-1" role="status" class="mb-20px">{{ message }}</p>
      <PasswordForm
        v-if="['ready', 'policy', 'unknown'].includes(state)"
        :key="formGeneration"
        :submit-password="submit"
      />
      <p v-if="state === 'submitting'" role="status">{{ $t('console.setupSubmitting') }}</p>
      <ElButton @click="leave">{{ $t('console.backToLogin') }}</ElButton>
    </div>
  </LoginShell>
</template>
