<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { parseSubscriptionExpiry } from '@/service/forge/subscriptions';
import { useAppStore } from '@/store/modules/app';
import { subscriptionWorkspace } from '@/runtime/console';
import { $t } from '@/locales';
import Initialization from './initialization.vue';
import { useTenantDisplay } from './shared';
defineOptions({ name: 'TenantSubscription' });
const props = defineProps<{ tenantId: string }>();
const emit = defineEmits<{ changed: [] }>();
const workspace = subscriptionWorkspace();
const state = shallowRef(workspace.state);
const stop = workspace.subscribe(value => {
  state.value = value;
});
const app = useAppStore();
const { enabled, instant, stateText } = useTenantDisplay();
const open = ref(false);
const planId = ref('');
const expiry = ref('');
const attempted = ref(false);
const complete = ref(false);
const configureButton = useTemplateRef<{ $el: HTMLButtonElement }>('configureButton');
const heading = useTemplateRef<HTMLElement>('heading');
const planInput = useTemplateRef<{ focus(): void }>('planInput');
const expiryInput = useTemplateRef<{ focus(): void }>('expiryInput');
const current = computed(() => state.value.tenantId === props.tenantId);
const snapshot = computed(() => (current.value ? state.value.snapshot : undefined));
const allowed = computed(
  () => current.value && state.value.checked && enabled.value && workspace.canCreate(props.tenantId)
);
const locked = computed(() => state.value.busy || state.value.unknown || !enabled.value);
const dirty = computed(
  () => open.value && !complete.value && Boolean(planId.value || expiry.value || state.value.unknown)
);
const invalidPlan = computed(() => attempted.value && !state.value.plans.some(row => row.id === planId.value));
const invalidExpiry = computed(() => attempted.value && parseSubscriptionExpiry(expiry.value) === undefined);
const number = (value: number | null) => (value === null ? '—' : new Intl.NumberFormat(app.locale).format(value));
const subscription = computed(() => snapshot.value?.subscription);
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
  if (await canLeave()) open.value = false;
}
function configure() {
  planId.value = '';
  expiry.value = '';
  attempted.value = false;
  complete.value = false;
  open.value = true;
}
async function submit() {
  attempted.value = true;
  if (invalidPlan.value) {
    planInput.value?.focus();
    return;
  }
  if (invalidExpiry.value) {
    expiryInput.value?.focus();
    return;
  }
  if (!allowed.value) return;
  if (await workspace.create(props.tenantId, planId.value, parseSubscriptionExpiry(expiry.value)!)) {
    complete.value = true;
    open.value = false;
  }
}
async function resume(id: string) {
  if (await workspace.continueOperation(id)) {
    complete.value = true;
    open.value = false;
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
async function focusConfigure() {
  await nextTick();
  if (configureButton.value?.$el.disabled) heading.value?.focus();
  else configureButton.value?.$el.focus();
}
onBeforeRouteLeave(canLeave);
onBeforeRouteUpdate(canLeave);
onMounted(() => {
  workspace.read(props.tenantId);
  window.addEventListener('beforeunload', beforeUnload);
});
onUnmounted(() => {
  stop();
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <section class="mt-24px space-y-16px" :aria-label="$t('subscriptions.title')" :aria-busy="state.busy">
    <div class="flex items-center justify-between gap-16px">
      <h2 ref="heading" tabindex="-1" class="text-18px font-semibold">{{ $t('subscriptions.title') }}</h2>
      <div class="flex justify-end">
        <ElButton :disabled="!enabled || state.busy" @click="workspace.read(tenantId)">
          {{ $t('subscriptions.refresh') }}
        </ElButton>
        <ElButton ref="configureButton" type="primary" :disabled="!allowed" @click="configure">
          {{ $t('subscriptions.configure') }}
        </ElButton>
      </div>
    </div>
    <p>{{ $t('subscriptions.immediate') }}</p>
    <p v-if="state.busy" role="status">{{ $t('tenants.loading') }}</p>
    <ElAlert v-if="state.problem" :title="$t(`subscriptions.errors.${state.problem}`)" type="error" :closable="false" />
    <ElAlert
      v-if="!state.snapshotChecked && snapshot"
      :title="$t('subscriptions.stale')"
      type="warning"
      :closable="false"
    />
    <ElAlert v-if="state.unknown" :title="$t('subscriptions.unknown')" type="warning" :closable="false" />
    <p v-if="!snapshot" role="status">{{ $t('subscriptions.unchecked') }}</p>
    <p v-else-if="snapshot.subscription === null">{{ $t('subscriptions.absent') }}</p>
    <ElDescriptions v-if="snapshot" :column="1" border>
      <ElDescriptionsItem :label="$t('subscriptions.observedAt')">
        {{ instant(snapshot.observedAt) }}
      </ElDescriptionsItem>
      <template v-if="subscription">
        <ElDescriptionsItem :label="$t('subscriptions.id')">{{ subscription.id }}</ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('subscriptions.plan')">
          <RouterLink class="text-primary" :to="`/plans/${subscription.planId}`">{{ subscription.planId }}</RouterLink>
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('tenants.status')">{{ stateText(subscription.status) }}</ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('subscriptions.effective')">
          {{ $t(snapshot.effective ? 'subscriptions.yes' : 'subscriptions.no') }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('subscriptions.startsAt')">
          {{ instant(subscription.createdAt) }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('subscriptions.endsAt')">{{ instant(subscription.endsAt) }}</ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('entitlements.limit')">{{ number(snapshot.maxUsersLimit) }}</ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('subscriptions.used')">{{ number(snapshot.maxUsersUsed) }}</ElDescriptionsItem>
      </template>
    </ElDescriptions>
    <p v-if="state.checked && !state.plans.length">
      {{ $t('subscriptions.noPlans') }}
      <RouterLink class="text-primary" to="/plans">{{ $t('subscriptions.managePlans') }}</RouterLink>
    </p>
    <section :aria-label="$t('subscriptions.operations')">
      <h3 class="mb-8px text-16px font-semibold">{{ $t('subscriptions.operations') }}</h3>
      <p>{{ $t('subscriptions.recoveryHint') }}</p>
      <ElTable
        class="business-table"
        border
        :data="current ? state.operations : []"
        row-key="id"
        :empty-text="$t(state.operationsChecked ? 'subscriptions.noOperations' : 'subscriptions.unchecked')"
        :aria-label="$t('subscriptions.operations')"
      >
        <ElTableColumn
          align="left"
          header-align="center"
          prop="id"
          :label="$t('subscriptions.operationId')"
          min-width="300"
        />
        <ElTableColumn header-align="center" :label="$t('tenants.status')" align="center" min-width="120">
          <template #default="{ row }">{{ row.state ? stateText(row.state) : '' }}</template>
        </ElTableColumn>
        <ElTableColumn align="left" header-align="center" :label="$t('tenants.createdAt')" min-width="210">
          <template #default="{ row }">{{ row.createdAt ? instant(row.createdAt) : '' }}</template>
        </ElTableColumn>
        <ElTableColumn align="left" header-align="center" :label="$t('subscriptions.replayUntil')" min-width="210">
          <template #default="{ row }">{{ row.replayUntil ? instant(row.replayUntil) : '' }}</template>
        </ElTableColumn>
        <ElTableColumn header-align="center" :label="$t('common.action')" align="center" fixed="right" width="220">
          <template #default="{ row }">
            <ElButton
              v-if="row.canReplay"
              type="success"
              plain
              size="small"
              :disabled="!enabled || state.busy || !state.operationsChecked"
              @click="resume(row.id)"
            >
              {{ $t('tenants.continue') }}
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
    </section>
    <Initialization
      :tenant-id="tenantId"
      @changed="
        workspace.read(tenantId);
        emit('changed');
      "
    />
    <ElDrawer
      v-model="open"
      :title="$t('subscriptions.configure')"
      size="min(720px, 90vw)"
      :show-close="false"
      :before-close="close"
      destroy-on-close
      @closed="focusConfigure"
    >
      <template #header="{ titleId, titleClass }">
        <h2 :id="titleId" :class="titleClass">{{ $t('subscriptions.configure') }}</h2>
        <ElButton :aria-label="$t('subscriptions.close')" @click="close">{{ $t('common.close') }}</ElButton>
      </template>
      <p>{{ $t('subscriptions.immediate') }}</p>
      <ElAlert
        v-if="state.problem"
        :title="$t(`subscriptions.errors.${state.problem}`)"
        type="error"
        :closable="false"
      />
      <ElAlert v-if="state.unknown" :title="$t('subscriptions.unknown')" type="warning" :closable="false" />
      <ElButton :disabled="!enabled || state.busy" @click="workspace.read(tenantId)">
        {{ $t('subscriptions.refresh') }}
      </ElButton>
      <ElForm label-position="top" class="mt-16px" :aria-label="$t('subscriptions.configure')" @submit.prevent="submit">
        <ElFormItem :label="$t('subscriptions.plan')">
          <ElSelect
            ref="planInput"
            v-model="planId"
            :aria-label="$t('subscriptions.plan')"
            :disabled="locked || !state.checked"
            :aria-invalid="invalidPlan"
            :aria-describedby="invalidPlan ? 'subscription-plan-error' : undefined"
            class="w-full"
          >
            <ElOption
              v-for="row in state.plans"
              :key="row.id"
              :value="row.id"
              :label="`${row.displayName} (${row.code}) · ${number(state.limitByPlan[row.id])}`"
            />
          </ElSelect>
          <p v-if="invalidPlan" id="subscription-plan-error" role="alert" class="text-error">
            {{ $t('subscriptions.planInvalid') }}
          </p>
        </ElFormItem>
        <ElFormItem :label="$t('subscriptions.endsAt')">
          <ElInput
            ref="expiryInput"
            v-model="expiry"
            :aria-label="$t('subscriptions.endsAt')"
            :disabled="locked"
            :aria-invalid="invalidExpiry"
            aria-describedby="subscription-expiry-hint subscription-expiry-error"
            placeholder="2099-01-01T08:00:00+08:00"
          />
          <p id="subscription-expiry-hint">{{ $t('subscriptions.expiryHint') }}</p>
          <p v-if="invalidExpiry" id="subscription-expiry-error" role="alert" class="text-error">
            {{ $t('subscriptions.expiryInvalid') }}
          </p>
        </ElFormItem>
        <div class="flex justify-end">
          <ElButton native-type="submit" type="primary" :disabled="!allowed" :loading="state.busy">
            {{ $t('subscriptions.submit') }}
          </ElButton>
        </div>
      </ElForm>
      <p v-if="state.unknown" class="mt-16px">{{ $t('subscriptions.recoveryHint') }}</p>
      <div
        v-for="row in state.operations.filter(item => item.canReplay)"
        :key="row.id"
        class="mt-16px flex items-center justify-between gap-8px"
      >
        <span>{{ row.id }}</span>
        <ElButton :disabled="!enabled || state.busy || !state.operationsChecked" @click="resume(row.id)">
          {{ $t('tenants.continue') }}
        </ElButton>
      </div>
    </ElDrawer>
  </section>
</template>
