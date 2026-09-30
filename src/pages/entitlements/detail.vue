<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { QuotaDefinition } from '@crane199709/saas-forge-api-client';
import { entitlementFailure, maxUsersLimit } from '@/service/forge/entitlements';
import type { EntitlementFailure, EntitlementKind, EntitlementResource } from '@/service/forge/entitlements';
import { $t } from '@/locales';
import { useEntitlements } from './shared';
import Recovery from './recovery.vue';
defineOptions({ name: 'EntitlementDetail' });
const props = defineProps<{ kind: EntitlementKind }>();
const { workspace, state, enabled, base, instant, integer } = useEntitlements(props.kind);
const route = useRoute();
const router = useRouter();
const heading = useTemplateRef<HTMLElement>('heading');
const resource = shallowRef<EntitlementResource>();
const definition = shallowRef<QuotaDefinition>();
const busy = ref(false);
const problem = ref<EntitlementFailure['code']>();
const definitionProblem = ref(false);
let controller: AbortController | undefined;
let alive = true;
const limit = computed(() =>
  resource.value && 'quotaLimits' in resource.value ? maxUsersLimit(resource.value, definition.value) : undefined
);
const eligible = computed(
  () =>
    resource.value?.status === 'DRAFT' &&
    (props.kind === 'quota'
      ? resource.value.code === 'max_users'
      : definition.value?.status === 'ACTIVE' && limit.value !== undefined && limit.value >= 1)
);
const canActivate = computed(() => {
  return (
    state.value.checked &&
    enabled.value &&
    !busy.value &&
    eligible.value &&
    workspace.canStart('ACTIVATE', String(route.params.id))
  );
});
async function read() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  busy.value = true;
  problem.value = undefined;
  resource.value = undefined;
  definition.value = undefined;
  definitionProblem.value = false;
  try {
    const result = await workspace.detail(String(route.params.id), current.signal);
    if (current.signal.aborted) return;
    resource.value = result;
    if (props.kind === 'plan') {
      try {
        const value = await workspace.maxUsers(current.signal);
        if (!current.signal.aborted) definition.value = value;
      } catch {
        if (!current.signal.aborted) definitionProblem.value = true;
      }
    }
  } catch (error) {
    if (!current.signal.aborted) problem.value = entitlementFailure(error);
  } finally {
    if (!current.signal.aborted) busy.value = false;
  }
  if (!current.signal.aborted) await workspace.checkOperations();
}
async function activate() {
  if (!canActivate.value) return;
  const id = await workspace.activate(String(route.params.id));
  if (alive && id && enabled.value && id === route.params.id) await read();
}
function view(id: string) {
  if (id === route.params.id) read();
  else router.push(`${base}/${id}`);
}
watch(
  () => route.params.id,
  async () => {
    read();
    await nextTick();
    heading.value?.focus();
  },
  { immediate: true }
);
onUnmounted(() => {
  alive = false;
  controller?.abort();
});
</script>

<template>
  <ElCard>
    <template #header>
      <div class="flex items-center justify-between gap-16px">
        <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t(`entitlements.${kind}.detail`) }}</h1>
        <div class="flex justify-end">
          <ElButton :aria-label="$t(`entitlements.${kind}.back`)" @click="router.push(base)">
            {{ $t(`entitlements.${kind}.back`) }}
          </ElButton>
          <ElButton :disabled="!enabled || busy || state.busy" @click="read">{{ $t('common.refresh') }}</ElButton>
          <ElButton v-if="eligible" type="primary" :disabled="!canActivate" :loading="state.busy" @click="activate">
            {{ $t(`entitlements.${kind}.activate`) }}
          </ElButton>
        </div>
      </div>
    </template>
    <p v-if="busy" role="status">{{ $t('tenants.loading') }}</p>
    <ElAlert v-if="problem" :title="$t(`entitlements.errors.${problem}`)" type="error" :closable="false" show-icon />
    <ElDescriptions v-if="resource" :column="1" border>
      <ElDescriptionsItem :label="$t('entitlements.id')">{{ resource.id }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('entitlements.code')">{{ resource.code }}</ElDescriptionsItem>
      <ElDescriptionsItem v-if="'displayName' in resource" :label="$t('entitlements.name')">
        {{ resource.displayName }}
      </ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('tenants.status')">
        {{ $t(`entitlements.states.${resource.status}`) }}
      </ElDescriptionsItem>
      <ElDescriptionsItem v-if="limit !== undefined" :label="$t('entitlements.limit')">
        {{ integer(limit) }}
      </ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('tenants.createdAt')">{{ instant(resource.createdAt) }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('tenants.updatedAt')">{{ instant(resource.updatedAt) }}</ElDescriptionsItem>
    </ElDescriptions>
    <ElAlert
      v-if="limit === 0"
      class="mt-16px"
      :title="$t('entitlements.legacyZero')"
      type="warning"
      :closable="false"
      show-icon
    />
    <ElAlert
      v-else-if="
        kind === 'plan' &&
        resource &&
        !busy &&
        (definitionProblem || limit === undefined || definition?.status !== 'ACTIVE')
      "
      class="mt-16px"
      :title="$t('entitlements.errors.definitionRequired')"
      type="warning"
      :closable="false"
      show-icon
    />
    <p v-if="eligible && state.checked && !canActivate && !state.busy" class="mt-16px" role="status">
      {{ $t('entitlements.errors.pending') }}
    </p>
    <Recovery class="mt-24px" :kind="kind" @view="view" />
  </ElCard>
</template>
