<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { PlatformAdminFailure } from '@/service/forge/platform-administrators';
import type { PlatformAdministrator } from '@/service/forge/platform-administrators';
import { consolePlatformAdministrators, consoleState } from '@/runtime/console';
import { operationKey } from '@/runtime/browser-coordination';
import { $t } from '@/locales';

const api = consolePlatformAdministrators();
const rows = ref<PlatformAdministrator[]>([]);
const email = ref('');
const loading = ref(false);
const saving = ref(false);
const revoking = ref(false);
const state = ref<'ready' | 'forbidden' | 'unavailable'>('ready');
const result = ref<string>();
const pending = ref<{ owner: string; email: string; key: string }>();
const revokePending = ref<{ owner: string; identityId: string; email: string; key: string }>();
const revokeResult = ref<'revoked' | PlatformAdminFailure['code']>();
const heading = ref<HTMLElement>();
let controller = new AbortController();
const storageKey = 'sf:platform-administrator-grant';
const revokeStorageKey = 'sf:platform-administrator-revoke';

function owner() {
  return consoleState.value.snapshot?.identity?.identityId ?? '';
}

function restorePending() {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if (
      saved &&
      typeof saved === 'object' &&
      'owner' in saved &&
      saved.owner === owner() &&
      'email' in saved &&
      typeof saved.email === 'string' &&
      'key' in saved &&
      typeof saved.key === 'string'
    )
      pending.value = saved as { owner: string; email: string; key: string };
    else pending.value = undefined;
  } catch {
    pending.value = undefined;
  }
  restoreRevokePending();
}

function restoreRevokePending() {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(revokeStorageKey) ?? 'null');
    if (
      saved &&
      typeof saved === 'object' &&
      'owner' in saved &&
      saved.owner === owner() &&
      'identityId' in saved &&
      typeof saved.identityId === 'string' &&
      'email' in saved &&
      typeof saved.email === 'string' &&
      'key' in saved &&
      typeof saved.key === 'string'
    )
      revokePending.value = saved as { owner: string; identityId: string; email: string; key: string };
    else revokePending.value = undefined;
  } catch {
    revokePending.value = undefined;
  }
}

async function load() {
  controller.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  state.value = 'ready';
  try {
    rows.value = await api.list(current.signal);
  } catch (error) {
    if (!current.signal.aborted)
      state.value = error instanceof PlatformAdminFailure && error.code === 'forbidden' ? 'forbidden' : 'unavailable';
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
}

async function grant() {
  if (saving.value || !owner()) return;
  const target = pending.value?.email ?? email.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) || target.length > 254) {
    result.value = 'invalid';
    return;
  }
  const attempt = pending.value ?? { owner: owner(), email: target, key: operationKey() };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(attempt));
  } catch {
    result.value = 'unavailable';
    return;
  }
  pending.value = attempt;
  saving.value = true;
  result.value = undefined;
  try {
    const outcome = await api.grant(attempt.email, attempt.key);
    if (attempt.owner !== owner()) return;
    if (outcome.setupState !== 'PENDING') {
      sessionStorage.removeItem(storageKey);
      pending.value = undefined;
      email.value = '';
    }
    result.value = outcome.setupState;
    if (outcome.setupState !== 'PENDING') ElMessage.success($t(`platformAdministrators.results.${outcome.setupState}`));
    await load();
  } catch (error) {
    if (attempt.owner !== owner()) return;
    const code = error instanceof PlatformAdminFailure ? error.code : 'unavailable';
    result.value = code;
    if (code === 'invalid' || code === 'conflict') {
      sessionStorage.removeItem(storageKey);
      pending.value = undefined;
    }
  } finally {
    saving.value = false;
  }
}

async function revoke(row?: PlatformAdministrator) {
  if (revoking.value || !owner()) return;
  if (!revokePending.value && row) {
    try {
      await ElMessageBox.confirm(
        $t('platformAdministrators.revokeConfirm', { email: row.email }),
        $t('platformAdministrators.revoke'),
        {
          type: 'warning',
          confirmButtonText: $t('platformAdministrators.revoke'),
          cancelButtonText: $t('platformAdministrators.cancel')
        }
      );
    } catch {
      return;
    }
  }
  const attempt =
    revokePending.value ??
    (row
      ? {
          owner: owner(),
          identityId: row.identityId,
          email: row.email,
          key: operationKey()
        }
      : undefined);
  if (!attempt) return;
  try {
    sessionStorage.setItem(revokeStorageKey, JSON.stringify(attempt));
  } catch {
    revokeResult.value = 'unavailable';
    return;
  }
  revokePending.value = attempt;
  revokeResult.value = undefined;
  revoking.value = true;
  try {
    await api.revoke(attempt.identityId, attempt.key);
    if (attempt.owner !== owner()) return;
    sessionStorage.removeItem(revokeStorageKey);
    revokePending.value = undefined;
    revokeResult.value = 'revoked';
    ElMessage.success($t('platformAdministrators.revokeResults.revoked'));
    await load();
  } catch (error) {
    if (attempt.owner !== owner()) return;
    const code = error instanceof PlatformAdminFailure ? error.code : 'unavailable';
    revokeResult.value = code;
    if (code === 'conflict' || code === 'last-admin' || code === 'missing' || code === 'invalid') {
      sessionStorage.removeItem(revokeStorageKey);
      revokePending.value = undefined;
    }
  } finally {
    revoking.value = false;
  }
}

watch(
  () => consoleState.value.snapshot?.identity?.identityId,
  () => {
    restorePending();
    load();
  }
);
onMounted(async () => {
  restorePending();
  load();
  await nextTick();
  heading.value?.focus();
});
onBeforeUnmount(() => controller.abort());
</script>

<template>
  <div class="space-y-16px">
    <ElCard class="card-wrapper">
      <template #header>
        <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('platformAdministrators.title') }}</h1>
      </template>
      <p class="mb-16px">{{ $t('platformAdministrators.description') }}</p>
      <ElForm @submit.prevent="grant">
        <ElFormItem :label="$t('platformAdministrators.email')">
          <ElInput
            v-model="email"
            type="email"
            autocomplete="email"
            :aria-label="$t('platformAdministrators.email')"
            :disabled="Boolean(pending) || saving"
            maxlength="254"
          />
        </ElFormItem>
        <ElButton
          type="primary"
          native-type="submit"
          :loading="saving"
          :disabled="state !== 'ready' || Boolean(pending)"
        >
          {{ $t('platformAdministrators.grant') }}
        </ElButton>
      </ElForm>
      <ElAlert
        v-if="pending"
        class="mt-16px"
        type="warning"
        :closable="false"
        :title="$t('platformAdministrators.pending', { email: pending.email })"
        show-icon
      >
        <ElButton :loading="saving" @click="grant">{{ $t('platformAdministrators.retry') }}</ElButton>
      </ElAlert>
      <ElAlert
        v-if="result"
        class="mt-16px"
        :type="
          ['DELIVERED', 'PASSWORD_READY', 'RECOVERY_REQUIRED', 'ALREADY_GRANTED'].includes(result)
            ? 'success'
            : 'warning'
        "
        :title="$t(`platformAdministrators.results.${result as 'invalid'}`)"
        :closable="false"
        show-icon
      />
    </ElCard>
    <ElCard class="card-wrapper">
      <template #header>
        <div class="flex items-center justify-between gap-16px">
          <h2 class="text-18px font-semibold">{{ $t('platformAdministrators.list') }}</h2>
          <ElButton :loading="loading" @click="load">{{ $t('platformAdministrators.reload') }}</ElButton>
        </div>
      </template>
      <ElAlert
        v-if="state !== 'ready'"
        type="error"
        :closable="false"
        :title="$t(`platformAdministrators.results.${state}`)"
        show-icon
      />
      <ElAlert
        v-if="revokePending"
        class="mb-16px"
        type="warning"
        :closable="false"
        :title="$t('platformAdministrators.revokePending', { email: revokePending.email })"
        show-icon
      >
        <ElButton :loading="revoking" @click="revoke()">{{ $t('platformAdministrators.retry') }}</ElButton>
      </ElAlert>
      <ElAlert
        v-if="revokeResult"
        class="mb-16px"
        :type="revokeResult === 'revoked' ? 'success' : 'warning'"
        :title="$t(`platformAdministrators.revokeResults.${revokeResult}`)"
        :closable="false"
        show-icon
      />
      <p v-if="loading" role="status">{{ $t('tenants.loading') }}</p>
      <ElTable
        v-else-if="state === 'ready'"
        :data="rows"
        row-key="identityId"
        border
        :empty-text="$t('platformAdministrators.empty')"
        :aria-label="$t('platformAdministrators.list')"
      >
        <ElTableColumn prop="email" :label="$t('platformAdministrators.email')" min-width="220" />
        <ElTableColumn :label="$t('platformAdministrators.passwordStatus')" min-width="180">
          <template #default="{ row }">
            {{
              $t(row.passwordReady ? 'platformAdministrators.passwordReady' : 'platformAdministrators.passwordPending')
            }}
          </template>
        </ElTableColumn>
        <ElTableColumn :label="$t('platformAdministrators.actions')" min-width="160">
          <template #default="{ row }">
            <ElButton
              type="danger"
              plain
              :aria-label="$t('platformAdministrators.revokeConfirm', { email: row.email })"
              :disabled="Boolean(revokePending) || revoking"
              @click="revoke(row)"
            >
              {{ $t('platformAdministrators.revoke') }}
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </ElCard>
  </div>
</template>
