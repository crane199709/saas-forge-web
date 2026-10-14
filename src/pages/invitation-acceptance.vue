<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Console } from '@crane199709/saas-forge-api-client';
import LoginShell from '@/views/_builtin/login/index.vue';
import { $t } from '@/locales';
import { operationKey } from '@/runtime/browser-coordination';
import { consoleInvitationAcceptance, consoleRuntime, consoleState, startConsole } from '@/runtime/console';
import { onInvitationLink, takeInvitationToken } from '@/runtime/invitation-link';
import WorkContexts from './work-contexts.vue';

const token = ref(takeInvitationToken());
const email = ref('');
const password = ref('');
const busy = ref(false);
const success = ref(false);
const errorCode = ref('');
let key = operationKey();
function openLink() {
  token.value = takeInvitationToken();
  key = operationKey();
  success.value = false;
  errorCode.value = '';
}
const stopLinks = onInvitationLink(openLink);
const identity = computed(() => consoleState.value.snapshot?.identity);
const canAccept = computed(() =>
  Boolean(
    token.value &&
    identity.value &&
    ['authenticated', 'restricted'].includes(consoleState.value.status) &&
    consoleState.value.snapshot?.state !== 'PASSWORD_CHANGE_REQUIRED'
  )
);
const message = computed(() => {
  if (!token.value) return $t('invitationAcceptance.invalid');
  if (success.value) return $t('invitationAcceptance.success');
  if (errorCode.value) {
    const known = {
      INVITATION_INVALID: 'invitationAcceptance.errors.INVITATION_INVALID',
      INVITATION_IDENTITY_MISMATCH: 'invitationAcceptance.errors.INVITATION_IDENTITY_MISMATCH',
      INVITATION_REVOKED: 'invitationAcceptance.errors.INVITATION_REVOKED',
      INVITATION_EXPIRED: 'invitationAcceptance.errors.INVITATION_EXPIRED',
      INVITATION_ALREADY_ACCEPTED: 'invitationAcceptance.errors.INVITATION_ALREADY_ACCEPTED',
      INVITATION_NOT_PENDING: 'invitationAcceptance.errors.INVITATION_NOT_PENDING',
      MEMBERSHIP_ALREADY_EXISTS: 'invitationAcceptance.errors.MEMBERSHIP_ALREADY_EXISTS',
      QUOTA_EXCEEDED: 'invitationAcceptance.errors.QUOTA_EXCEEDED',
      SUBSCRIPTION_REQUIRED: 'invitationAcceptance.errors.SUBSCRIPTION_REQUIRED',
      INVITATION_ACTIVATION_COMPENSATING: 'invitationAcceptance.errors.INVITATION_ACTIVATION_COMPENSATING',
      INVITATION_ACCEPTANCE_RETRY_REQUIRED: 'invitationAcceptance.errors.INVITATION_ACCEPTANCE_RETRY_REQUIRED',
      INVITATION_ACCEPTANCE_IN_PROGRESS: 'invitationAcceptance.errors.INVITATION_ACCEPTANCE_IN_PROGRESS'
    } as const;
    const translationKey = known[errorCode.value as keyof typeof known];
    return translationKey ? $t(translationKey) : $t('invitationAcceptance.unavailable');
  }
  if (consoleState.value.problem === 'AUTHENTICATION_FAILED') return $t('console.credentials');
  if (consoleState.value.status === 'blocked') return $t('console.blocked');
  return $t('invitationAcceptance.intro');
});
async function signIn() {
  if (busy.value || !email.value.includes('@') || !password.value) return;
  busy.value = true;
  const secret = password.value;
  password.value = '';
  try {
    await consoleRuntime().login(email.value, secret);
  } finally {
    busy.value = false;
  }
}
async function accept() {
  const revision = consoleState.value.snapshot?.revision;
  if (busy.value || !canAccept.value || !revision) return;
  busy.value = true;
  errorCode.value = '';
  try {
    await consoleInvitationAcceptance().acceptInvitation(
      {
        xSFCSRF: '1',
        ifMatch: `"${revision}"`,
        idempotencyKey: key,
        invitationAcceptanceRequest: { token: token.value }
      },
      { signal: AbortSignal.timeout(12000), redirect: 'error' }
    );
    success.value = true;
    await consoleRuntime().recover();
  } catch (error) {
    if (error instanceof Console.ResponseError) {
      const problem: unknown = await error.response.json().catch(() => undefined);
      errorCode.value =
        problem && typeof problem === 'object' && 'code' in problem && typeof problem.code === 'string'
          ? problem.code
          : 'UNAVAILABLE';
    } else {
      errorCode.value = 'UNAVAILABLE';
    }
  } finally {
    busy.value = false;
  }
}
function clear() {
  token.value = '';
  password.value = '';
}
onMounted(() => {
  window.addEventListener('pagehide', clear);
  startConsole();
});
onUnmounted(() => {
  stopLinks();
  clear();
  window.removeEventListener('pagehide', clear);
});
</script>

<template>
  <LoginShell :title="$t('invitationAcceptance.title')">
    <div class="space-y-16px" :aria-busy="busy">
      <p role="status" aria-live="polite">{{ message }}</p>
      <form v-if="token && consoleState.status === 'anonymous'" class="space-y-12px" @submit.prevent="signIn">
        <ElFormItem :label="$t('console.email')">
          <ElInput v-model="email" name="email" type="email" autocomplete="username" required />
        </ElFormItem>
        <ElFormItem :label="$t('console.password')">
          <ElInput v-model="password" name="password" type="password" autocomplete="current-password" required />
        </ElFormItem>
        <ElButton native-type="submit" type="primary" :loading="busy">{{ $t('console.signIn') }}</ElButton>
      </form>
      <div v-if="identity">
        <p>{{ $t('invitationAcceptance.currentIdentity') }}: {{ identity.email }}</p>
        <ElButton v-if="!success" type="primary" :disabled="!canAccept" :loading="busy" @click="accept">
          {{ $t('invitationAcceptance.accept') }}
        </ElButton>
        <ElButton @click="consoleRuntime().recover()">{{ $t('invitationAcceptance.refresh') }}</ElButton>
        <ElButton @click="consoleRuntime().logout()">{{ $t('console.logout') }}</ElButton>
        <WorkContexts v-if="success" class="mt-20px" />
      </div>
    </div>
  </LoginShell>
</template>
