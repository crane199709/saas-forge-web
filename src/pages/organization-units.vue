<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { ResponseError } from '@crane199709/saas-forge-api-client';
import type { OrganizationUnit } from '@crane199709/saas-forge-api-client';
import { consoleOrganization, consoleState } from '@/runtime/console';
import { $t } from '@/locales';

type TreeUnit = OrganizationUnit & { children: TreeUnit[] };
type Action = 'create' | 'rename' | 'move';

const api = consoleOrganization();
const units = ref<OrganizationUnit[]>([]);
const state = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
const problem = ref<'invalid' | 'missing' | 'conflict' | 'forbidden' | 'unavailable'>();
const dialog = ref(false);
const action = ref<Action>('create');
const selected = ref<OrganizationUnit>();
const name = ref('');
const parentId = ref('');
const saving = ref(false);
let generation = 0;
let controller = new AbortController();
let mutation = new AbortController();

const trees = computed(() => {
  const byId = new Map<string, TreeUnit>(units.value.map(unit => [unit.id, { ...unit, children: [] }]));
  const roots: TreeUnit[] = [];
  for (const unit of byId.values()) {
    const parent = unit.parentId ? byId.get(unit.parentId) : undefined;
    if (parent) parent.children.push(unit);
    else roots.push(unit);
  }
  return roots;
});

const allowedParents = computed(() => {
  if (action.value !== 'move' || !selected.value) return units.value;
  const excluded = new Set<string>([selected.value.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of units.value) {
      if (unit.parentId && excluded.has(unit.parentId) && !excluded.has(unit.id)) {
        excluded.add(unit.id);
        changed = true;
      }
    }
  }
  return units.value.filter(unit => !excluded.has(unit.id));
});

async function load() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  const started = generation;
  units.value = [];
  const context = consoleState.value.snapshot?.activeContext;
  if (consoleState.value.status !== 'authenticated' || context?.type !== 'TENANT') return;
  state.value = 'loading';
  try {
    const result = await api.listOrganizationUnits({ signal: controller.signal, redirect: 'error' });
    if (started !== generation) return;
    units.value = result.items;
    state.value = 'ready';
  } catch (error) {
    if (started !== generation) return;
    state.value = error instanceof ResponseError && error.response.status === 403 ? 'forbidden' : 'unavailable';
  }
}

function open(next: Action, unit?: OrganizationUnit) {
  action.value = next;
  selected.value = unit;
  name.value = next === 'rename' ? (unit?.name ?? '') : '';
  parentId.value = next === 'create' ? (unit?.id ?? '') : (unit?.parentId ?? '');
  problem.value = undefined;
  dialog.value = true;
}

function failure(error: unknown): NonNullable<typeof problem.value> {
  if (!(error instanceof ResponseError)) return 'unavailable';
  switch (error.response.status) {
    case 400:
      return 'invalid';
    case 403:
      return 'forbidden';
    case 404:
      return 'missing';
    case 409:
      return 'conflict';
    default:
      return 'unavailable';
  }
}

async function save() {
  if (saving.value) return;
  if (action.value !== 'move' && !name.value.trim()) {
    problem.value = 'invalid';
    return;
  }
  saving.value = true;
  problem.value = undefined;
  const pending = new AbortController();
  mutation = pending;
  const options = { signal: AbortSignal.any([AbortSignal.timeout(8000), pending.signal]), redirect: 'error' as const };
  try {
    if (action.value === 'create') {
      await api.createOrganizationUnit(
        {
          createOrganizationUnitRequest: { name: name.value.trim(), parentId: parentId.value || undefined }
        },
        options
      );
    } else if (action.value === 'rename' && selected.value) {
      await api.renameOrganizationUnit(
        {
          unitId: selected.value.id,
          renameOrganizationUnitRequest: { name: name.value.trim() }
        },
        options
      );
    } else if (selected.value) {
      await api.moveOrganizationUnit(
        {
          unitId: selected.value.id,
          moveOrganizationUnitRequest: { parentId: parentId.value || undefined }
        },
        options
      );
    }
    dialog.value = false;
    await load();
  } catch (error) {
    if (!pending.signal.aborted) problem.value = failure(error);
  } finally {
    saving.value = false;
  }
}

async function remove(unit: OrganizationUnit) {
  if (saving.value) return;
  const contextKey = `${consoleState.value.snapshot?.sessionId}:${consoleState.value.snapshot?.activeContext?.membershipId}`;
  try {
    await ElMessageBox.confirm($t('organization.deleteConfirm'), $t('organization.delete'), {
      type: 'warning',
      confirmButtonText: $t('organization.delete'),
      cancelButtonText: $t('organization.cancel')
    });
  } catch {
    return;
  }
  if (
    contextKey !==
    `${consoleState.value.snapshot?.sessionId}:${consoleState.value.snapshot?.activeContext?.membershipId}`
  )
    return;
  problem.value = undefined;
  saving.value = true;
  const pending = new AbortController();
  mutation = pending;
  try {
    await api.deleteOrganizationUnit(
      { unitId: unit.id },
      {
        signal: AbortSignal.any([AbortSignal.timeout(8000), pending.signal]),
        redirect: 'error'
      }
    );
    await load();
  } catch (error) {
    if (!pending.signal.aborted) problem.value = failure(error);
  } finally {
    saving.value = false;
  }
}

watch(
  () => [consoleState.value.snapshot?.sessionId, consoleState.value.snapshot?.activeContext?.membershipId],
  () => {
    mutation.abort();
    dialog.value = false;
  }
);

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
  mutation.abort();
});
</script>

<template>
  <section :aria-label="$t('organization.title')" :aria-busy="state === 'loading'">
    <div class="mb-16px flex items-center justify-between gap-12px">
      <h2 class="text-18px font-semibold">{{ $t('organization.title') }}</h2>
      <div class="flex gap-8px">
        <ElButton :disabled="state === 'loading'" @click="load">{{ $t('organization.reload') }}</ElButton>
        <ElButton type="primary" :disabled="state !== 'ready'" @click="open('create')">
          {{ $t('organization.addRoot') }}
        </ElButton>
      </div>
    </div>
    <ElAlert v-if="problem" type="error" role="alert" :closable="false" :title="$t(`organization.errors.${problem}`)" />
    <p v-if="state === 'loading'" role="status">{{ $t('organization.loading') }}</p>
    <ElAlert
      v-else-if="state === 'forbidden'"
      type="warning"
      role="status"
      :closable="false"
      :title="$t('organization.errors.forbidden')"
    />
    <ElAlert
      v-else-if="state === 'unavailable'"
      type="error"
      role="alert"
      :closable="false"
      :title="$t('organization.errors.unavailable')"
    />
    <p v-else-if="!units.length" role="status">{{ $t('organization.empty') }}</p>
    <ElTree
      v-else
      :data="trees"
      node-key="id"
      default-expand-all
      :expand-on-click-node="false"
      :props="{ label: 'name', children: 'children' }"
      :aria-label="$t('organization.title')"
    >
      <template #default="{ data }">
        <div class="min-w-0 flex flex-1 items-center justify-between gap-12px py-4px">
          <span class="truncate">
            {{ data.name }}
            <span class="text-gray-500">({{ data.memberCount }})</span>
          </span>
          <span class="flex gap-4px">
            <ElButton text size="small" @click.stop="open('create', data)">{{ $t('organization.addChild') }}</ElButton>
            <ElButton text size="small" @click.stop="open('rename', data)">{{ $t('organization.rename') }}</ElButton>
            <ElButton text size="small" @click.stop="open('move', data)">{{ $t('organization.move') }}</ElButton>
            <ElButton text type="danger" size="small" @click.stop="remove(data)">
              {{ $t('organization.delete') }}
            </ElButton>
          </span>
        </div>
      </template>
    </ElTree>
    <ElDialog v-model="dialog" :title="$t(`organization.actions.${action}`)" width="480px">
      <ElForm label-position="top" @submit.prevent="save">
        <ElFormItem v-if="action !== 'move'" :label="$t('organization.name')">
          <ElInput v-model="name" :aria-label="$t('organization.name')" maxlength="200" show-word-limit />
        </ElFormItem>
        <ElFormItem v-if="action !== 'rename'" :label="$t('organization.parent')">
          <ElSelect v-model="parentId" :aria-label="$t('organization.parent')" class="w-full">
            <ElOption value="" :label="$t('organization.root')" />
            <ElOption v-for="unit in allowedParents" :key="unit.id" :value="unit.id" :label="unit.name" />
          </ElSelect>
        </ElFormItem>
        <ElAlert
          v-if="problem"
          type="error"
          role="alert"
          :closable="false"
          :title="$t(`organization.errors.${problem}`)"
        />
      </ElForm>
      <template #footer>
        <ElButton @click="dialog = false">{{ $t('organization.cancel') }}</ElButton>
        <ElButton type="primary" :loading="saving" @click="save">{{ $t('organization.save') }}</ElButton>
      </template>
    </ElDialog>
  </section>
</template>
