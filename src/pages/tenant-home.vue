<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { consoleEffectivePermissions, consoleRuntime, consoleState } from '@/runtime/console';
import { $t } from '@/locales';
import WorkContexts from './work-contexts.vue';
import BusinessRemote from './business-remote.vue';
import PermissionCatalog from './permission-catalog.vue';
import InvitationManager from './invitation-manager.vue';
import MemberDirectory from './member-directory.vue';
import TenantRoles from './tenant-roles.vue';
import OrganizationUnits from './organization-units.vue';

const RemoteAcceptance =
  import.meta.env.DEV || import.meta.env.MODE === 'static-acceptance'
    ? defineAsyncComponent(() => import('./remote-acceptance.vue'))
    : undefined;

const heading = useTemplateRef<HTMLElement>('heading');
const company = computed(() =>
  consoleState.value.snapshot?.availableContexts?.companies.find(
    item => item.membershipId === consoleState.value.snapshot?.activeContext?.membershipId
  )
);
const permissionStatus = ref<'loading' | 'ready' | 'unavailable'>('loading');
const effective = ref<string[]>([]);
let generation = 0;
let controller = new AbortController();
async function refreshPermissions() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  if (consoleState.value.status !== 'authenticated' || consoleState.value.snapshot?.activeContext?.type !== 'TENANT')
    return;
  const started = generation;
  permissionStatus.value = 'loading';
  try {
    const result = await consoleEffectivePermissions().listEffectivePermissions({
      signal: controller.signal,
      redirect: 'error'
    });
    if (started !== generation) return;
    effective.value = result.codes;
    permissionStatus.value = 'ready';
  } catch {
    if (started === generation) permissionStatus.value = 'unavailable';
  }
}
watch(
  () => [
    consoleState.value.status,
    consoleState.value.snapshot?.sessionId,
    consoleState.value.snapshot?.activeContext?.membershipId
  ],
  refreshPermissions,
  { immediate: true }
);
onBeforeUnmount(() => {
  generation += 1;
  controller.abort();
});
onMounted(async () => {
  await nextTick();
  heading.value?.focus();
});
</script>

<template>
  <p v-if="permissionStatus === 'loading'" role="status">{{ $t('members.loading') }}</p>
  <ElCard v-else-if="permissionStatus === 'ready' && effective.length === 0 && consoleState.status === 'authenticated'">
    <h1 class="mb-16px text-20px font-semibold">{{ $t('waiting.title') }}</h1>
    <p role="status" class="mb-16px">{{ $t('waiting.message') }}</p>
    <ElSpace wrap>
      <ElButton type="primary" @click="refreshPermissions">{{ $t('waiting.refresh') }}</ElButton>
      <ElButton @click="consoleRuntime().logout()">{{ $t('console.logout') }}</ElButton>
    </ElSpace>
    <WorkContexts class="mt-24px" />
  </ElCard>
  <ElAlert
    v-else-if="permissionStatus === 'unavailable'"
    :title="$t('waiting.unavailable')"
    type="error"
    :closable="false"
  />
  <ElCard
    v-else-if="
      permissionStatus === 'ready' &&
      ['authenticated', 'checking'].includes(consoleState.status) &&
      consoleState.snapshot?.activeContext?.type === 'TENANT'
    "
  >
    <template #header>
      <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('console.tenant') }}</h1>
    </template>
    <ElDescriptions :column="1" border class="mb-24px">
      <ElDescriptionsItem :label="$t('console.company')">{{ company?.tenantDisplayName }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('console.identity')">
        {{ consoleState.snapshot.identity?.email }}
      </ElDescriptionsItem>
    </ElDescriptions>
    <RemoteAcceptance
      v-if="RemoteAcceptance"
      :key="`${consoleState.snapshot.sessionId}:${consoleState.snapshot.revision}`"
      :enabled="consoleState.status === 'authenticated'"
    />
    <ElDivider />
    <PermissionCatalog />
    <ElDivider />
    <InvitationManager />
    <ElDivider />
    <MemberDirectory />
    <ElDivider />
    <TenantRoles />
    <ElDivider />
    <OrganizationUnits />
    <ElDivider />
    <BusinessRemote />
    <ElDivider />
    <h2 class="mb-16px text-18px font-semibold">{{ $t('console.chooseWorkspace') }}</h2>
    <WorkContexts />
  </ElCard>
</template>
