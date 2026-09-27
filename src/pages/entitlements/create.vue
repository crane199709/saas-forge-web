<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import type { QuotaDefinition } from '@crane199709/saas-forge-api-client';
import { entitlementFailure, positiveLimit } from '@/service/forge/entitlements';
import type { EntitlementFailure, EntitlementKind } from '@/service/forge/entitlements';
import { $t } from '@/locales';
import { useEntitlements } from './shared';
import Recovery from './recovery.vue';
defineOptions({ name: 'EntitlementCreate' });
const props = defineProps<{ kind: EntitlementKind }>();
const emit = defineEmits<{ close: []; view: [id: string] }>();
const { workspace, state, enabled } = useEntitlements(props.kind);
const code = ref('');
const name = ref('');
const limit = ref('1');
const attempted = ref(false);
const codeInput = useTemplateRef<{ focus(): void }>('codeInput');
const nameInput = useTemplateRef<{ focus(): void }>('nameInput');
const limitInput = useTemplateRef<{ focus(): void }>('limitInput');
const invalidCode = computed(() => attempted.value && !/^[a-z][a-z0-9-]{1,62}$/.test(code.value));
const invalidName = computed(() => attempted.value && (!name.value.trim() || name.value.length > 200));
const invalidLimit = computed(() => attempted.value && positiveLimit(limit.value) === undefined);
const complete = ref(false);
const submitting = ref(false);
const definition = shallowRef<QuotaDefinition>();
const checked = ref(false);
const loading = ref(false);
const problem = ref<EntitlementFailure['code']>();
let controller: AbortController | undefined;
let alive = true;
const target = computed(() => (props.kind === 'plan' ? code.value : 'max_users'));
const locked = computed(() => {
  return submitting.value || (state.value.unknown && workspace.hasUnknown('CREATE', target.value));
});
const allowed = computed(() => {
  return (
    state.value.checked &&
    enabled.value &&
    checked.value &&
    !locked.value &&
    workspace.canStart('CREATE', target.value) &&
    (props.kind === 'quota' || definition.value?.status === 'ACTIVE')
  );
});
const dirty = computed(
  () => !complete.value && (code.value !== '' || name.value !== '' || limit.value !== '1' || locked.value)
);
async function read() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  checked.value = false;
  loading.value = true;
  problem.value = undefined;
  definition.value = undefined;
  try {
    const value = await workspace.maxUsers(current.signal);
    if (!current.signal.aborted) {
      definition.value = value;
      checked.value = true;
    }
  } catch (error) {
    if (!current.signal.aborted) problem.value = entitlementFailure(error);
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
  await workspace.checkOperations();
}
async function canLeave() {
  if (!dirty.value || !enabled.value) return true;
  try {
    await window.$messageBox?.confirm($t('tenants.leaveWarning'), $t('tenants.leaveTitle'), {
      confirmButtonText: $t('tenants.leave'),
      cancelButtonText: $t('common.cancel'),
      type: 'warning',
      closeOnClickModal: false
    });
    return Boolean(window.$messageBox);
  } catch {
    return false;
  }
}
async function close() {
  if (await canLeave()) emit('close');
}
function view(id: string) {
  complete.value = true;
  emit('view', id);
}
async function viewRecord(id: string) {
  if (await canLeave()) view(id);
}
async function submit() {
  if (props.kind === 'plan') {
    attempted.value = true;
    if (invalidCode.value) {
      codeInput.value?.focus();
      return;
    }
    if (invalidName.value) {
      nameInput.value?.focus();
      return;
    }
    if (invalidLimit.value) {
      limitInput.value?.focus();
      return;
    }
  }
  if (!allowed.value) return;
  submitting.value = true;
  const id =
    props.kind === 'plan'
      ? await workspace.createPlan(code.value, name.value, limit.value)
      : await workspace.createQuota();
  submitting.value = false;
  if (alive && enabled.value && id) view(id);
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeRouteLeave(canLeave);
onMounted(read);
onUnmounted(() => {
  alive = false;
  controller?.abort();
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <ElDrawer
    :model-value="true"
    :title="$t(`entitlements.${kind}.create`)"
    size="min(720px, 90vw)"
    :show-close="false"
    :before-close="close"
    destroy-on-close
  >
    <template #header="{ titleId, titleClass }">
      <h2 :id="titleId" :class="titleClass">{{ $t(`entitlements.${kind}.create`) }}</h2>
      <ElButton :aria-label="$t(`entitlements.${kind}.closeCreate`)" @click="close">{{ $t('common.close') }}</ElButton>
    </template>
    <p v-if="loading" role="status">{{ $t('tenants.loading') }}</p>
    <ElAlert v-if="problem" :title="$t(`entitlements.errors.${problem}`)" type="error" :closable="false" />
    <ElAlert
      v-if="kind === 'plan' && checked && definition?.status !== 'ACTIVE'"
      :title="$t('entitlements.errors.definitionRequired')"
      type="warning"
      :closable="false"
    />
    <ElButton :disabled="!enabled || loading || state.busy" @click="read">{{ $t('common.refresh') }}</ElButton>
    <ElForm
      :aria-label="$t(`entitlements.${kind}.create`)"
      label-position="top"
      class="mt-16px"
      @submit.prevent="submit"
    >
      <template v-if="kind === 'plan'">
        <ElFormItem :label="$t('entitlements.code')">
          <ElInput
            ref="codeInput"
            v-model="code"
            :aria-label="$t('entitlements.code')"
            :aria-invalid="invalidCode"
            :aria-describedby="invalidCode ? 'plan-code-error' : 'plan-code-hint'"
            :placeholder="$t('entitlements.codeExample')"
            maxlength="63"
            :disabled="!enabled || locked || state.busy"
          />
          <p v-if="invalidCode" id="plan-code-error" class="mt-4px text-error" role="alert">
            {{ $t('entitlements.errors.codeInvalid') }}
          </p>
          <p v-else id="plan-code-hint" class="mt-4px text-sm text-gray-500">{{ $t('entitlements.codeHint') }}</p>
        </ElFormItem>
        <ElFormItem :label="$t('entitlements.name')">
          <ElInput
            ref="nameInput"
            v-model="name"
            :aria-label="$t('entitlements.name')"
            :aria-invalid="invalidName"
            :aria-describedby="invalidName ? 'plan-name-error' : undefined"
            maxlength="200"
            :disabled="!enabled || locked || state.busy"
          />
          <p v-if="invalidName" id="plan-name-error" class="mt-4px text-error" role="alert">
            {{ $t('entitlements.errors.nameInvalid') }}
          </p>
        </ElFormItem>
        <ElFormItem :label="$t('entitlements.limit')">
          <ElInput
            ref="limitInput"
            v-model="limit"
            :aria-label="$t('entitlements.limit')"
            :aria-invalid="invalidLimit"
            :aria-describedby="invalidLimit ? 'plan-limit-error' : undefined"
            inputmode="numeric"
            maxlength="10"
            :disabled="!enabled || locked || state.busy"
          />
          <p v-if="invalidLimit" id="plan-limit-error" class="mt-4px text-error" role="alert">
            {{ $t('entitlements.errors.limitInvalid') }}
          </p>
        </ElFormItem>
      </template>
      <p v-else>max_users</p>
      <p v-if="state.checked && !allowed && !loading && !locked" role="status">{{ $t('entitlements.requirements') }}</p>
      <div class="mt-16px flex justify-end">
        <ElButton
          v-if="kind === 'quota' && definition"
          type="primary"
          :disabled="!enabled || state.busy"
          @click="view(definition.id)"
        >
          {{ $t('entitlements.reuse') }}
        </ElButton>
        <ElButton v-else native-type="submit" type="primary" :loading="submitting" :disabled="!allowed">
          {{ $t(`entitlements.${kind}.create`) }}
        </ElButton>
      </div>
    </ElForm>
    <Recovery :kind="kind" @view="viewRecord" />
  </ElDrawer>
</template>
