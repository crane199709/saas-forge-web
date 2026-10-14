<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ResponseError } from '@crane199709/saas-forge-api-client';
import type { Member, OrganizationUnit } from '@crane199709/saas-forge-api-client';
import { consoleMembers, consoleOrganization, consoleState } from '@/runtime/console';
import { $t } from '@/locales';

const items = ref<Member[]>([]);
const status = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
const editorOpen = ref(false);
const editing = ref<Member>();
const units = ref<OrganizationUnit[]>([]);
const unitIds = ref<string[]>([]);
const chosenUnit = ref('');
const unitStatus = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
const unitProblem = ref<'missing' | 'conflict' | 'forbidden' | 'unavailable'>();
const saving = ref(false);
let generation = 0;
let controller = new AbortController();
let editorController = new AbortController();
let mutation = new AbortController();
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
    const result = await consoleMembers().listMembers({ signal: controller.signal, redirect: 'error' });
    if (started !== generation) return;
    items.value = result.items;
    status.value = 'ready';
  } catch (error) {
    if (started !== generation) return;
    status.value = error instanceof ResponseError && error.response.status === 403 ? 'forbidden' : 'unavailable';
  }
}
async function openEditor(member: Member) {
  editorController.abort();
  editorController = new AbortController();
  const pending = editorController;
  editing.value = member;
  unitIds.value = [];
  units.value = [];
  chosenUnit.value = '';
  unitProblem.value = undefined;
  unitStatus.value = 'loading';
  editorOpen.value = true;
  try {
    const [list, associations] = await Promise.all([
      consoleOrganization().listOrganizationUnits({ signal: pending.signal, redirect: 'error' }),
      consoleMembers().listMembershipOrganizationUnits(
        { membershipId: member.membershipId },
        { signal: pending.signal, redirect: 'error' }
      )
    ]);
    if (pending.signal.aborted || editing.value?.membershipId !== member.membershipId) return;
    units.value = list.items;
    unitIds.value = Array.from(associations.unitIds);
    unitStatus.value = 'ready';
  } catch (error) {
    if (pending.signal.aborted) return;
    unitStatus.value = error instanceof ResponseError && error.response.status === 403 ? 'forbidden' : 'unavailable';
  }
}
function failure(error: unknown): NonNullable<typeof unitProblem.value> {
  if (!(error instanceof ResponseError)) return 'unavailable';
  switch (error.response.status) {
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
async function changeUnit(unitId: string, action: 'add' | 'remove') {
  const member = editing.value;
  if (!member || saving.value) return;
  saving.value = true;
  unitProblem.value = undefined;
  const pending = new AbortController();
  mutation = pending;
  const options = { signal: AbortSignal.any([AbortSignal.timeout(8000), pending.signal]), redirect: 'error' as const };
  try {
    if (action === 'add') {
      await consoleMembers().addMembershipOrganizationUnit(
        { membershipId: member.membershipId, addMembershipOrganizationUnitRequest: { unitId } },
        options
      );
    } else {
      await consoleMembers().removeMembershipOrganizationUnit({ membershipId: member.membershipId, unitId }, options);
    }
    if (pending.signal.aborted || editing.value?.membershipId !== member.membershipId) return;
    const result = await consoleMembers().listMembershipOrganizationUnits(
      { membershipId: member.membershipId },
      options
    );
    if (pending.signal.aborted || editing.value?.membershipId !== member.membershipId) return;
    unitIds.value = Array.from(result.unitIds);
    chosenUnit.value = '';
  } catch (error) {
    if (!pending.signal.aborted) unitProblem.value = failure(error);
  } finally {
    saving.value = false;
  }
}
const availableUnits = computed(() => units.value.filter(unit => !unitIds.value.includes(unit.id)));
function unitName(unitId: string) {
  return units.value.find(unit => unit.id === unitId)?.name ?? unitId;
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
watch(
  () => [consoleState.value.snapshot?.sessionId, consoleState.value.snapshot?.activeContext?.membershipId],
  () => {
    editorController.abort();
    mutation.abort();
    editorOpen.value = false;
  }
);
watch(editorOpen, open => {
  if (!open) {
    editorController.abort();
    mutation.abort();
  }
});
onBeforeUnmount(() => {
  generation += 1;
  controller.abort();
  editorController.abort();
  mutation.abort();
});
</script>

<template>
  <section :aria-label="$t('members.title')" :aria-busy="status === 'loading'">
    <div class="mb-16px flex flex-wrap items-center gap-12px">
      <h2 class="text-18px font-semibold">{{ $t('members.title') }}</h2>
      <ElButton :loading="status === 'loading'" @click="load">{{ $t('members.refresh') }}</ElButton>
    </div>
    <p v-if="status === 'loading'" role="status">{{ $t('members.loading') }}</p>
    <p v-else-if="status === 'forbidden'" role="status">{{ $t('members.forbidden') }}</p>
    <ElAlert v-else-if="status === 'unavailable'" :title="$t('members.unavailable')" type="error" :closable="false" />
    <p v-else-if="items.length === 0" role="status">{{ $t('members.empty') }}</p>
    <ElTable v-else :data="items" :aria-label="$t('members.title')">
      <ElTableColumn :label="$t('members.identity')" min-width="220">
        <template #default="{ row }">{{ row.invitedEmail || row.identityId }}</template>
      </ElTableColumn>
      <ElTableColumn :label="$t('members.status')" min-width="120">
        <template #default="{ row }">
          {{ $t(row.status === 'ENABLED' ? 'members.enabled' : 'members.disabled') }}
        </template>
      </ElTableColumn>
      <ElTableColumn :label="$t('members.organizationUnits')" min-width="150">
        <template #default="{ row }">
          <ElButton text @click="openEditor(row)">{{ $t('members.manageUnits') }}</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
    <ElDialog v-model="editorOpen" :title="$t('members.organizationUnits')" width="520px">
      <p v-if="unitStatus === 'loading'" role="status">{{ $t('members.unitsLoading') }}</p>
      <ElAlert
        v-else-if="unitStatus !== 'ready'"
        role="alert"
        type="error"
        :closable="false"
        :title="$t(unitStatus === 'forbidden' ? 'members.forbidden' : 'members.unitsUnavailable')"
      />
      <template v-else>
        <p class="mb-12px">{{ $t('members.unitsHint') }}</p>
        <ElButton class="mb-12px" :disabled="saving" @click="editing && openEditor(editing)">
          {{ $t('members.reloadUnits') }}
        </ElButton>
        <p v-if="unitIds.length === 0" role="status">{{ $t('members.noUnits') }}</p>
        <ul v-else class="mb-16px flex flex-wrap gap-8px">
          <li v-for="unitId in unitIds" :key="unitId">
            <ElButton :disabled="saving" @click="changeUnit(unitId, 'remove')">
              {{ unitName(unitId) }} · {{ $t('members.removeUnit') }}
            </ElButton>
          </li>
        </ul>
        <div class="flex items-center gap-8px">
          <ElSelect v-model="chosenUnit" :aria-label="$t('members.addUnit')" class="min-w-0 flex-1">
            <ElOption v-for="unit in availableUnits" :key="unit.id" :value="unit.id" :label="unit.name" />
          </ElSelect>
          <ElButton
            type="primary"
            :disabled="!chosenUnit || saving"
            :loading="saving"
            @click="changeUnit(chosenUnit, 'add')"
          >
            {{ $t('members.addUnit') }}
          </ElButton>
        </div>
        <ElAlert
          v-if="unitProblem"
          class="mt-12px"
          role="alert"
          type="error"
          :closable="false"
          :title="$t(`members.unitErrors.${unitProblem}`)"
        />
      </template>
    </ElDialog>
  </section>
</template>
