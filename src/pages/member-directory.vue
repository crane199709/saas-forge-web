<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ResponseError } from '@crane199709/saas-forge-api-client';
import type { Member } from '@crane199709/saas-forge-api-client';
import type { TenantRole } from '@/service/forge/tenant-roles';
import { MembershipRoleFailure } from '@/service/forge/membership-roles';
import type { MemberRoleAssignment } from '@/service/forge/membership-roles';
import { consoleMembers, consoleMembershipRoles, consoleState, consoleTenantRoles } from '@/runtime/console';
import { $t } from '@/locales';
import { operationKey } from '@/runtime/browser-coordination';

const items = ref<Member[]>([]);
const roles = ref<TenantRole[]>([]);
const canManageRoles = ref(false);
const status = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
const busy = ref<string | null>(null);
const selectedMember = ref<Member | null>(null);
const assignments = ref<MemberRoleAssignment[]>([]);
const detailStatus = ref<'loading' | 'ready' | 'unavailable'>('loading');
const actionError = ref<MembershipRoleFailure['code'] | null>(null);
const chosenRole = ref('');
const saving = ref(false);
const detailOpen = ref(false);
const assignableRoles = computed(() =>
  roles.value.filter(role => !assignments.value.some(assignment => assignment.roleId === role.id))
);
let generation = 0;
let detailGeneration = 0;
let controller = new AbortController();
let detailController = new AbortController();
async function load() {
  generation += 1;
  detailGeneration += 1;
  controller.abort();
  detailController.abort();
  controller = new AbortController();
  items.value = [];
  roles.value = [];
  canManageRoles.value = false;
  detailOpen.value = false;
  if (consoleState.value.status !== 'authenticated' || consoleState.value.snapshot?.activeContext?.type !== 'TENANT')
    return;
  status.value = 'loading';
  const started = generation;
  try {
    const [memberResult, roleResult] = await Promise.allSettled([
      consoleMembers().listMembers({
        signal: controller.signal,
        redirect: 'error'
      }),
      consoleTenantRoles().list(controller.signal)
    ]);
    if (started !== generation) return;
    if (memberResult.status === 'rejected') throw memberResult.reason;
    items.value = memberResult.value.items;
    if (roleResult.status === 'fulfilled') {
      roles.value = roleResult.value;
      canManageRoles.value = true;
    }
    status.value = 'ready';
  } catch (error) {
    if (started !== generation) return;
    status.value = error instanceof ResponseError && error.response.status === 403 ? 'forbidden' : 'unavailable';
  }
}

async function disable(item: Member) {
  if (busy.value || item.status !== 'ENABLED' || item.disableStatus !== 'NONE') return;
  try {
    await ElMessageBox.confirm($t('members.confirmDisable'), $t('members.disable'));
  } catch {
    return;
  }
  busy.value = item.membershipId;
  try {
    const progress = await consoleMembers().disableMembership(
      { membershipId: item.membershipId, idempotencyKey: operationKey() },
      { signal: AbortSignal.timeout(12000), redirect: 'error' }
    );
    ElMessage.info($t(progress.pending ? 'members.disablePending' : 'members.disableCompleted'));
  } catch (error) {
    ElMessage.error(
      error instanceof ResponseError && error.response.status === 409
        ? $t('members.disableConflict')
        : $t('members.disableFailed')
    );
  } finally {
    busy.value = null;
    await load();
  }
}

async function recover(item: Member) {
  if (busy.value || item.disableStatus !== 'RECOVERY_REQUIRED') return;
  busy.value = item.membershipId;
  try {
    await consoleMembers().recoverMembershipDisable(
      { membershipId: item.membershipId },
      { signal: AbortSignal.timeout(12000), redirect: 'error' }
    );
    ElMessage.info($t('members.disablePending'));
  } catch {
    ElMessage.error($t('members.disableFailed'));
  } finally {
    busy.value = null;
    await load();
  }
}
async function inspect(member: Member) {
  detailGeneration += 1;
  detailController.abort();
  detailController = new AbortController();
  selectedMember.value = member;
  assignments.value = [];
  chosenRole.value = '';
  actionError.value = null;
  detailStatus.value = 'loading';
  detailOpen.value = true;
  const started = generation;
  const detailStarted = detailGeneration;
  try {
    const result = await consoleMembershipRoles().list(member.membershipId, detailController.signal);
    if (started !== generation || detailStarted !== detailGeneration) return;
    assignments.value = result;
    detailStatus.value = 'ready';
  } catch {
    if (started === generation && detailStarted === detailGeneration) detailStatus.value = 'unavailable';
  }
}

async function changeRole(roleId: string, action: 'assign' | 'revoke') {
  const member = selectedMember.value;
  if (!member || saving.value) return;
  saving.value = true;
  actionError.value = null;
  const started = generation;
  try {
    const current = await consoleMembershipRoles()[action](member.membershipId, roleId);
    if (started !== generation || selectedMember.value?.membershipId !== member.membershipId) return;
    assignments.value = current;
    chosenRole.value = '';
    try {
      const currentRoles = await consoleTenantRoles().list();
      if (started === generation && selectedMember.value?.membershipId === member.membershipId)
        roles.value = currentRoles;
    } catch {
      // 角色分配已成功，列表刷新失败不应把该操作展示为失败。
    }
  } catch (error) {
    if (started !== generation) return;
    actionError.value = error instanceof MembershipRoleFailure ? error.code : 'unavailable';
  } finally {
    saving.value = false;
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
watch(detailOpen, open => {
  if (!open) {
    detailGeneration += 1;
    detailController.abort();
  }
});
onBeforeUnmount(() => {
  generation += 1;
  controller.abort();
  detailController.abort();
});
</script>

<template>
  <section :aria-label="$t('members.title')" :aria-busy="status === 'loading'">
    <div class="mb-16px flex flex-wrap items-center gap-12px">
      <h2 class="text-18px font-semibold">{{ $t('members.title') }}</h2>
      <ElButton :loading="status === 'loading'" @click="load">{{ $t('members.refresh') }}</ElButton>
    </div>
    <p v-if="status === 'loading'" role="status">{{ $t('members.loading') }}</p>
    <p v-else-if="status === 'forbidden'" role="status">
      {{ $t('members.forbidden') }}
    </p>
    <ElAlert v-else-if="status === 'unavailable'" :title="$t('members.unavailable')" type="error" :closable="false" />
    <p v-else-if="items.length === 0" role="status">
      {{ $t('members.empty') }}
    </p>
    <ElTable v-else :data="items" :aria-label="$t('members.title')">
      <ElTableColumn :label="$t('members.identity')" min-width="220">
        <template #default="{ row }">{{ row.invitedEmail || row.identityId }}</template>
      </ElTableColumn>
      <ElTableColumn :label="$t('members.status')" min-width="120">
        <template #default="{ row }">
          {{ $t(row.status === 'ENABLED' ? 'members.enabled' : 'members.disabled') }}
        </template>
      </ElTableColumn>
      <ElTableColumn :label="$t('members.operation')" min-width="200">
        <template #default="{ row }">
          <span v-if="row.disableStatus === 'REVOKING'" role="status">{{ $t('members.revoking') }}</span>
          <span v-else-if="row.disableStatus === 'RELEASE_PENDING'" role="status">
            {{ $t('members.releasePending') }}
          </span>
          <span v-else-if="row.disableStatus === 'RECOVERY_REQUIRED'" role="status">
            {{ $t('members.recoveryRequired') }}
          </span>
          <span v-else>{{ $t('members.noPendingOperation') }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn :label="$t('members.actions')" min-width="190">
        <template #default="{ row }">
          <ElButton
            v-if="row.status === 'ENABLED' && row.disableStatus === 'NONE'"
            type="danger"
            :loading="busy === row.membershipId"
            :aria-label="`${$t('members.disable')} ${row.invitedEmail || row.identityId}`"
            @click="disable(row)"
          >
            {{ $t('members.disable') }}
          </ElButton>
          <ElButton
            v-else-if="row.disableStatus === 'RECOVERY_REQUIRED'"
            :loading="busy === row.membershipId"
            :aria-label="`${$t('members.recover')} ${row.invitedEmail || row.identityId}`"
            @click="recover(row)"
          >
            {{ $t('members.recover') }}
          </ElButton>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="canManageRoles" :label="$t('members.roles')" min-width="140">
        <template #default="{ row }">
          <ElButton link type="primary" @click="inspect(row)">{{ $t('members.manageRoles') }}</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
    <ElDialog v-model="detailOpen" :title="$t('members.manageRoles')" width="min(640px, 90vw)">
      <p class="mb-12px">
        {{ selectedMember?.invitedEmail || selectedMember?.identityId }}
      </p>
      <p v-if="detailStatus === 'loading'" role="status">
        {{ $t('members.loadingRoles') }}
      </p>
      <ElAlert
        v-else-if="detailStatus === 'unavailable'"
        type="error"
        role="alert"
        :title="$t('members.unavailableRoles')"
        :closable="false"
      />
      <template v-else>
        <p v-if="assignments.length === 0" role="status">
          {{ $t('members.noRoles') }}
        </p>
        <ul v-else class="mb-16px flex flex-col gap-8px">
          <li
            v-for="assignment in assignments"
            :key="assignment.roleId"
            class="flex items-center justify-between gap-12px"
          >
            <span>{{ assignment.roleKey }}</span>
            <ElButton link type="danger" :disabled="saving" @click="changeRole(assignment.roleId, 'revoke')">
              {{ $t('members.revokeRole') }}
            </ElButton>
          </li>
        </ul>
        <div class="flex flex-wrap items-center gap-8px">
          <ElSelect v-model="chosenRole" :aria-label="$t('members.chooseRole')" class="min-w-200px">
            <ElOption v-for="role in assignableRoles" :key="role.id" :label="role.roleKey" :value="role.id" />
          </ElSelect>
          <ElButton
            type="primary"
            :disabled="!chosenRole || saving"
            :loading="saving"
            @click="changeRole(chosenRole, 'assign')"
          >
            {{ $t('members.assignRole') }}
          </ElButton>
        </div>
      </template>
      <ElAlert
        v-if="actionError"
        class="mt-12px"
        type="error"
        role="alert"
        :closable="false"
        :title="$t(`members.roleError.${actionError}`)"
      />
    </ElDialog>
  </section>
</template>
