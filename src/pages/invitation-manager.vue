<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ResponseError } from '@crane199709/saas-forge-api-client';
import type { Invitation } from '@crane199709/saas-forge-api-client';
import { consoleInvitations, consoleState } from '@/runtime/console';
import { $t } from '@/locales';

const api = consoleInvitations();
const email = ref('');
const items = ref<Invitation[]>([]);
const status = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
const submitting = ref(false);
let generation = 0;
let controller = new AbortController();

async function load() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  items.value = [];
  if (consoleState.value.status !== 'authenticated' || consoleState.value.snapshot?.activeContext?.type !== 'TENANT')
    return;
  status.value = 'loading';
  const started = generation;
  try {
    const result = await api.listInvitations({ signal: controller.signal, redirect: 'error' });
    if (started !== generation) return;
    items.value = result.items;
    status.value = 'ready';
  } catch (error) {
    if (started !== generation) return;
    status.value = error instanceof ResponseError && error.response.status === 403 ? 'forbidden' : 'unavailable';
  }
}

async function create() {
  if (submitting.value || !email.value.trim()) return;
  submitting.value = true;
  try {
    await api.createInvitation(
      { createInvitationRequest: { email: email.value.trim() } },
      { signal: AbortSignal.timeout(12000), redirect: 'error' }
    );
    email.value = '';
    ElMessage.success($t('invitations.created'));
    await load();
  } catch (error) {
    ElMessage.error(
      error instanceof ResponseError && error.response.status === 409
        ? $t('invitations.duplicate')
        : $t('invitations.failed')
    );
    await load();
  } finally {
    submitting.value = false;
  }
}

async function change(item: Invitation, operation: 'resend' | 'revoke') {
  if (submitting.value) return;
  if (operation === 'revoke') {
    try {
      await ElMessageBox.confirm($t('invitations.confirmRevoke'), $t('invitations.revoke'));
    } catch {
      return;
    }
  }
  submitting.value = true;
  try {
    const options = { signal: AbortSignal.timeout(12000), redirect: 'error' as const };
    if (operation === 'resend') await api.resendInvitation({ invitationId: item.id }, options);
    else await api.revokeInvitation({ invitationId: item.id }, options);
    ElMessage.success($t(operation === 'resend' ? 'invitations.resent' : 'invitations.revoked'));
  } catch {
    ElMessage.error($t('invitations.failed'));
  } finally {
    submitting.value = false;
    await load();
  }
}

watch(
  () => [
    consoleState.value.status,
    consoleState.value.snapshot?.sessionId,
    consoleState.value.snapshot?.activeContext?.membershipId
  ],
  load,
  { immediate: true }
);
onBeforeUnmount(() => {
  generation += 1;
  controller.abort();
});

function statusLabel(value: string) {
  switch (value) {
    case 'ACCEPTED':
      return $t('invitations.states.ACCEPTED');
    case 'REVOKED':
      return $t('invitations.states.REVOKED');
    case 'EXPIRED':
      return $t('invitations.states.EXPIRED');
    default:
      return $t('invitations.states.PENDING');
  }
}

function deliveryLabel(value: string) {
  switch (value) {
    case 'SENT':
      return $t('invitations.deliveryStates.SENT');
    case 'FAILED':
      return $t('invitations.deliveryStates.FAILED');
    default:
      return $t('invitations.deliveryStates.PENDING');
  }
}
</script>

<template>
  <section :aria-label="$t('invitations.title')" :aria-busy="status === 'loading'">
    <div class="mb-16px flex items-center justify-between gap-12px">
      <h2 class="text-18px font-semibold">{{ $t('invitations.title') }}</h2>
      <ElButton :loading="status === 'loading'" @click="load">{{ $t('invitations.reload') }}</ElButton>
    </div>
    <p v-if="status === 'loading'" role="status">{{ $t('invitations.loading') }}</p>
    <ElAlert
      v-else-if="status === 'forbidden'"
      type="warning"
      role="status"
      :closable="false"
      :title="$t('invitations.forbidden')"
    />
    <ElAlert
      v-else-if="status === 'unavailable'"
      type="error"
      role="alert"
      :closable="false"
      :title="$t('invitations.unavailable')"
    />
    <template v-else>
      <form class="mb-20px flex flex-wrap items-end gap-12px" @submit.prevent="create">
        <ElFormItem :label="$t('invitations.email')" class="mb-0 min-w-240px flex-1">
          <ElInput
            id="invitation-email"
            v-model="email"
            type="email"
            autocomplete="email"
            :placeholder="$t('invitations.emailHint')"
            :disabled="submitting"
          />
        </ElFormItem>
        <ElButton native-type="submit" type="primary" :loading="submitting" :disabled="!email.trim()">
          {{ $t('invitations.create') }}
        </ElButton>
      </form>
      <p v-if="!items.length" role="status">{{ $t('invitations.empty') }}</p>
      <ElTable v-else :data="items" :aria-label="$t('invitations.title')">
        <ElTableColumn prop="email" :label="$t('invitations.email')" min-width="220" />
        <ElTableColumn :label="$t('invitations.status')" min-width="120">
          <template #default="scope">{{ statusLabel(scope.row.status) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('invitations.delivery')" min-width="120">
          <template #default="scope">{{ deliveryLabel(scope.row.deliveryStatus) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('invitations.expiresAt')" min-width="210">
          <template #default="scope">{{ scope.row.expiresAt.toISOString() }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('invitations.actions')" min-width="180">
          <template #default="scope">
            <ElButton :disabled="scope.row.status !== 'PENDING' || submitting" @click="change(scope.row, 'resend')">
              {{ $t('invitations.resend') }}
            </ElButton>
            <ElButton
              type="danger"
              plain
              :disabled="scope.row.status !== 'PENDING' || submitting"
              @click="change(scope.row, 'revoke')"
            >
              {{ $t('invitations.revoke') }}
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </template>
  </section>
</template>
