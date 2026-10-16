<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { Tenant } from '@crane199709/saas-forge-api-client';
import { failureCode } from '@/service/forge/tenants';
import type { TenantFailure } from '@/service/forge/tenants';
import { tenantWorkspace } from '@/runtime/console';
import { useTenantDisplay } from './shared';

defineOptions({ name: 'TenantDetailsEdit' });
const props = defineProps<{ tenant: Tenant }>();
const emit = defineEmits<{ changed: [tenant: Tenant] }>();
const { enabled } = useTenantDisplay();
const name = ref('');
const expiry = ref<Date | null>(null);
const noExpiry = ref(false);
const busy = ref(false);
const problem = ref<TenantFailure['code']>();
const unknown = ref(false);
let alive = true;

function reset(tenant: Tenant) {
  name.value = tenant.displayName;
  expiry.value = tenant.expiresAt;
  noExpiry.value = tenant.expiresAt === null;
  problem.value = undefined;
  unknown.value = false;
}
const effectiveExpiry = computed(() => (noExpiry.value ? null : expiry.value));
const dirty = computed(
  () =>
    name.value !== props.tenant.displayName ||
    effectiveExpiry.value?.getTime() !== props.tenant.expiresAt?.getTime() ||
    (effectiveExpiry.value === null) !== (props.tenant.expiresAt === null)
);
watch(
  () => props.tenant,
  (value, previous) => {
    const unchanged =
      !previous ||
      (name.value === previous.displayName &&
        effectiveExpiry.value?.getTime() === previous.expiresAt?.getTime() &&
        (effectiveExpiry.value === null) === (previous.expiresAt === null));
    if (!busy.value && !unknown.value && (unchanged || value.id !== previous?.id)) reset(value);
  },
  { immediate: true }
);

async function submit() {
  if (!enabled.value || busy.value || !dirty.value) return;
  if (!name.value.trim() || name.value.length > 200) {
    problem.value = 'nameInvalid';
    return;
  }
  const deadline = effectiveExpiry.value;
  if (
    !noExpiry.value &&
    (!(deadline instanceof Date) || !Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now())
  ) {
    problem.value = 'expiryInvalid';
    return;
  }
  busy.value = true;
  problem.value = undefined;
  try {
    const result = await tenantWorkspace().update(props.tenant.id, name.value, deadline);
    if (!alive || !enabled.value) return;
    reset(result);
    emit('changed', result);
  } catch (error) {
    if (!alive) return;
    problem.value = failureCode(error);
    unknown.value = problem.value === 'unavailable';
  } finally {
    if (alive) busy.value = false;
  }
}

onUnmounted(() => {
  alive = false;
});
</script>

<template>
  <section :aria-busy="busy" class="pt-8px" aria-labelledby="tenant-details-edit-heading">
    <h2 id="tenant-details-edit-heading" class="mb-16px text-18px font-semibold">{{ $t('tenants.edit.title') }}</h2>
    <ElAlert
      v-if="problem"
      :title="$t(`tenants.errors.${problem}`)"
      :type="unknown ? 'warning' : 'error'"
      :closable="false"
      show-icon
      class="mb-16px"
    />
    <p v-if="unknown" role="status" class="mb-12px">{{ $t('tenants.edit.unknown') }}</p>
    <ElForm :aria-label="$t('tenants.edit.title')" label-position="top" @submit.prevent="submit">
      <ElFormItem
        :label="$t('tenants.name')"
        :error="problem === 'nameInvalid' ? $t('tenants.errors.nameInvalid') : undefined"
      >
        <ElInput
          v-model="name"
          maxlength="200"
          :disabled="!enabled || busy || unknown"
          :aria-label="$t('tenants.name')"
        />
      </ElFormItem>
      <ElFormItem
        :label="$t('tenants.expiresAt')"
        :error="problem === 'expiryInvalid' ? $t('tenants.errors.expiryInvalid') : undefined"
      >
        <ElDatePicker
          v-model="expiry"
          class="w-full"
          type="datetime"
          :placeholder="$t('tenants.edit.chooseExpiry')"
          :disabled="!enabled || busy || unknown || noExpiry"
          :aria-label="$t('tenants.expiresAt')"
        />
      </ElFormItem>
      <ElCheckbox v-model="noExpiry" :disabled="!enabled || busy || unknown">{{ $t('tenants.noExpiry') }}</ElCheckbox>
      <div class="mt-16px flex justify-end">
        <ElButton type="primary" native-type="submit" :loading="busy" :disabled="!enabled || busy || !dirty">
          {{ $t('tenants.edit.save') }}
        </ElButton>
      </div>
    </ElForm>
  </section>
</template>
