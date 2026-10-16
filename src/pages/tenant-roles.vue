<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { PermissionCatalogFailure } from '@/service/forge/permissions';
import type { PermissionEntry } from '@/service/forge/permissions';
import { TenantRoleFailure } from '@/service/forge/tenant-roles';
import type { TenantRole } from '@/service/forge/tenant-roles';
import { consolePermissionCatalog, consoleState, consoleTenantRoles } from '@/runtime/console';
import { captureConsoleActionContext, sameConsoleActionContext } from '@/runtime/console-action-context';
import { $t } from '@/locales';

const api = consoleTenantRoles();
const catalog = consolePermissionCatalog();
const roles = ref<TenantRole[]>([]);
const permissions = ref<PermissionEntry[]>([]);
const status = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
const failure = ref<'conflict' | 'invalid' | 'unavailable' | null>(null);
const open = ref(false);
const editing = ref<string | null>(null);
const roleKey = ref('');
const selected = ref<string[]>([]);
const saving = ref(false);
let generation = 0;
let controller = new AbortController();

async function load() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  roles.value = [];
  permissions.value = [];
  open.value = false;
  const context = consoleState.value.snapshot?.activeContext;
  if (consoleState.value.status !== 'authenticated' || context?.type !== 'TENANT') return;
  status.value = 'loading';
  const started = generation;
  try {
    const [currentRoles, currentCatalog] = await Promise.all([
      api.list(controller.signal),
      catalog.list(controller.signal)
    ]);
    if (started !== generation) return;
    roles.value = currentRoles;
    permissions.value = currentCatalog;
    status.value = 'ready';
  } catch (error) {
    if (started !== generation) return;
    status.value =
      (error instanceof TenantRoleFailure || error instanceof PermissionCatalogFailure) && error.code === 'forbidden'
        ? 'forbidden'
        : 'unavailable';
  }
}

function edit(role?: TenantRole) {
  editing.value = role?.id ?? null;
  roleKey.value = role?.roleKey ?? '';
  selected.value = [...(role?.permissions ?? [])];
  failure.value = null;
  open.value = true;
}

async function save() {
  if (saving.value) return;
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(roleKey.value)) {
    failure.value = 'invalid';
    return;
  }
  saving.value = true;
  failure.value = null;
  const started = generation;
  try {
    const change = { roleKey: roleKey.value, permissions: selected.value };
    if (editing.value) await api.update(editing.value, change);
    else await api.create(change);
    if (started !== generation) return;
    open.value = false;
    ElMessage.success($t('tenantRoles.saved'));
    await load();
  } catch (error) {
    if (started !== generation) return;
    failure.value = error instanceof TenantRoleFailure && error.code !== 'forbidden' ? error.code : 'unavailable';
  } finally {
    saving.value = false;
  }
}

async function remove(role: TenantRole) {
  if (role.systemManaged || role.assignedMembers) return;
  const context = captureConsoleActionContext(consoleState.value, 'TENANT');
  if (!context) return;
  try {
    await ElMessageBox.confirm($t('tenantRoles.confirmDelete', { role: role.roleKey }), $t('tenantRoles.delete'), {
      type: 'warning',
      confirmButtonText: $t('tenantRoles.delete'),
      cancelButtonText: $t('tenantRoles.cancel')
    });
  } catch {
    return;
  }
  if (!sameConsoleActionContext(context, consoleState.value)) return;
  const started = generation;
  try {
    await api.delete(role.id);
    if (started !== generation) return;
    ElMessage.success($t('tenantRoles.deleted'));
    await load();
  } catch (error) {
    if (started !== generation) return;
    failure.value = error instanceof TenantRoleFailure && error.code !== 'forbidden' ? error.code : 'unavailable';
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
</script>

<template>
  <section :aria-label="$t('tenantRoles.title')" :aria-busy="status === 'loading'">
    <div class="mb-16px flex items-center justify-between gap-12px">
      <h2 class="text-18px font-semibold">{{ $t('tenantRoles.title') }}</h2>
      <div class="flex gap-8px">
        <ElButton :disabled="status === 'loading'" @click="load">{{ $t('tenantRoles.reload') }}</ElButton>
        <ElButton v-if="status === 'ready'" type="primary" @click="edit()">{{ $t('tenantRoles.create') }}</ElButton>
      </div>
    </div>
    <p v-if="status === 'loading'" role="status">{{ $t('tenantRoles.loading') }}</p>
    <ElAlert
      v-else-if="status === 'forbidden'"
      role="status"
      type="warning"
      :closable="false"
      :title="$t('tenantRoles.forbidden')"
    />
    <ElAlert
      v-else-if="status === 'unavailable'"
      role="alert"
      type="error"
      :closable="false"
      :title="$t('tenantRoles.unavailable')"
    />
    <template v-else>
      <ElAlert
        v-if="failure"
        class="mb-12px"
        role="alert"
        type="error"
        :closable="false"
        :title="$t(`tenantRoles.${failure}`)"
      />
      <p v-if="!roles.length" role="status">{{ $t('tenantRoles.empty') }}</p>
      <ElTable v-else :data="roles" :aria-label="$t('tenantRoles.title')">
        <ElTableColumn prop="roleKey" :label="$t('tenantRoles.roleKey')" min-width="220" />
        <ElTableColumn :label="$t('tenantRoles.permissions')" min-width="260">
          <template #default="scope">
            {{
              scope.row.systemManaged
                ? $t('tenantRoles.automatic')
                : scope.row.permissions.join(', ') || $t('tenantRoles.none')
            }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="assignedMembers" :label="$t('tenantRoles.assignedMembers')" width="150" />
        <ElTableColumn :label="$t('tenantRoles.actions')" width="200">
          <template #default="scope">
            <ElTag v-if="scope.row.systemManaged" type="info">{{ $t('tenantRoles.system') }}</ElTag>
            <template v-else>
              <ElButton link type="primary" @click="edit(scope.row)">{{ $t('tenantRoles.edit') }}</ElButton>
              <ElButton link type="danger" :disabled="scope.row.assignedMembers > 0" @click="remove(scope.row)">
                {{ $t('tenantRoles.delete') }}
              </ElButton>
            </template>
          </template>
        </ElTableColumn>
      </ElTable>
    </template>
    <ElDialog v-model="open" :title="$t(editing ? 'tenantRoles.edit' : 'tenantRoles.create')" width="min(640px, 90vw)">
      <ElForm label-position="top" @submit.prevent="save">
        <ElFormItem :label="$t('tenantRoles.roleKey')">
          <ElInput v-model="roleKey" maxlength="64" :aria-label="$t('tenantRoles.roleKey')" />
        </ElFormItem>
        <ElFormItem :label="$t('tenantRoles.permissions')">
          <ElCheckboxGroup v-model="selected" class="flex flex-col items-start">
            <ElCheckbox
              v-for="permission in permissions"
              :key="permission.code"
              :value="permission.code"
              :disabled="/^(system:(role|membership-role|permission)):/.test(permission.code)"
            >
              {{ permission.code }} {{ permission.enabled ? '' : `(${$t('permissionCatalog.disabled')})` }}
            </ElCheckbox>
          </ElCheckboxGroup>
        </ElFormItem>
        <ElAlert v-if="failure" role="alert" type="error" :closable="false" :title="$t(`tenantRoles.${failure}`)" />
      </ElForm>
      <template #footer>
        <ElButton @click="open = false">{{ $t('tenantRoles.cancel') }}</ElButton>
        <ElButton type="primary" :loading="saving" @click="save">{{ $t('tenantRoles.save') }}</ElButton>
      </template>
    </ElDialog>
  </section>
</template>
