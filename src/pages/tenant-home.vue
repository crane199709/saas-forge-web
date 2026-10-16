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
const permissionLoadedOnce = ref(false);
const permissionRefreshing = ref(false);
const effective = ref<string[]>([]);
let generation = 0;
let controller = new AbortController();
let permissionOwner: string | undefined;
async function refreshPermissions() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  if (consoleState.value.status !== 'authenticated' || consoleState.value.snapshot?.activeContext?.type !== 'TENANT')
    return;
  const started = generation;
  permissionRefreshing.value = true;
  if (!permissionLoadedOnce.value) permissionStatus.value = 'loading';
  try {
    const result = await consoleEffectivePermissions().listEffectivePermissions({
      signal: controller.signal,
      redirect: 'error'
    });
    if (started !== generation) return;
    effective.value = result.codes;
    permissionLoadedOnce.value = true;
    permissionStatus.value = 'ready';
  } catch {
    if (started === generation) permissionStatus.value = 'unavailable';
  } finally {
    if (started === generation) permissionRefreshing.value = false;
  }
}
watch(
  () => [
    consoleState.value.status,
    consoleState.value.snapshot?.sessionId,
    consoleState.value.snapshot?.activeContext?.membershipId
  ],
  async () => {
    if (consoleState.value.status === 'checking') return;
    const snapshot = consoleState.value.snapshot;
    const owner =
      consoleState.value.status === 'authenticated' && snapshot?.activeContext?.type === 'TENANT'
        ? `${snapshot.sessionId}:${snapshot.activeContext.membershipId}`
        : undefined;
    const sameOwner = Boolean(owner && owner === permissionOwner && permissionLoadedOnce.value);
    permissionOwner = owner;
    effective.value = [];
    if (!sameOwner) {
      permissionLoadedOnce.value = false;
      permissionStatus.value = 'loading';
    }
    await refreshPermissions();
  },
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
  <ElCard
    v-else-if="
      permissionLoadedOnce && !permissionRefreshing && effective.length === 0 && consoleState.status === 'authenticated'
    "
  >
    <h1 class="mb-16px text-20px font-semibold">{{ $t('waiting.title') }}</h1>
    <p role="status" class="mb-16px">{{ $t('waiting.message') }}</p>
    <ElAlert
      v-if="permissionStatus === 'unavailable'"
      :title="$t('waiting.unavailable')"
      type="error"
      :closable="false"
      role="alert"
    />
    <ElSpace wrap>
      <ElButton type="primary" @click="refreshPermissions">{{ $t('waiting.refresh') }}</ElButton>
      <ElButton @click="consoleRuntime().logout()">{{ $t('console.logout') }}</ElButton>
    </ElSpace>
    <WorkContexts class="mt-24px" />
  </ElCard>
  <ElAlert
    v-else-if="permissionStatus === 'unavailable' && !permissionLoadedOnce"
    :title="$t('waiting.unavailable')"
    type="error"
    :closable="false"
  />
  <ElButton v-if="permissionStatus === 'unavailable' && !permissionLoadedOnce" @click="refreshPermissions">
    {{ $t('waiting.refresh') }}
  </ElButton>
  <ElCard
    v-else-if="
      (permissionStatus === 'ready' || permissionLoadedOnce) &&
      ['authenticated', 'checking'].includes(consoleState.status) &&
      consoleState.snapshot?.activeContext?.type === 'TENANT'
    "
  >
    <template #header>
      <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('console.tenant') }}</h1>
    </template>
    <ElAlert
      v-if="permissionStatus === 'unavailable'"
      :title="$t('waiting.unavailable')"
      type="error"
      :closable="false"
      role="alert"
    />
    <p v-if="permissionRefreshing" role="status">{{ $t('members.loading') }}</p>
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
    <BusinessRemote
      :permissions="permissionStatus === 'ready' ? effective : []"
      :refresh-permissions="refreshPermissions"
    />
    <ElDivider />
    <h2 class="mb-16px text-18px font-semibold">{{ $t('console.chooseWorkspace') }}</h2>
    <WorkContexts />
  </ElCard>
</template>
