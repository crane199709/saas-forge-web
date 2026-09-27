<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Tenant } from '@crane199709/saas-forge-api-client';
import { failureCode } from '@/service/forge/tenants';
import type { TenantFailure } from '@/service/forge/tenants';
import { tenantWorkspace } from '@/runtime/console';
import { $t } from '@/locales';
import { useTenantDisplay } from './shared';
defineOptions({ name: 'TenantDetail' });
const route = useRoute();
const router = useRouter();
const { enabled, instant } = useTenantDisplay();
const heading = useTemplateRef<HTMLElement>('heading');
const tenant = shallowRef<Tenant>();
const busy = ref(false);
const problem = ref<TenantFailure['code']>();
let controller: AbortController | undefined;
async function read() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  busy.value = true;
  tenant.value = undefined;
  problem.value = undefined;
  try {
    const result = await tenantWorkspace().detail(String(route.params.id), current.signal);
    if (!current.signal.aborted) tenant.value = result;
  } catch (error) {
    if (!current.signal.aborted) problem.value = failureCode(error);
  } finally {
    if (!current.signal.aborted) busy.value = false;
  }
}
onMounted(async () => {
  read();
  await nextTick();
  heading.value?.focus();
});
onUnmounted(() => controller?.abort());
</script>

<template>
  <ElCard>
    <template #header>
      <div class="flex items-center justify-between gap-16px">
        <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('tenants.detail') }}</h1>
        <div class="flex justify-end">
          <ElButton :aria-label="$t('tenants.back')" @click="router.push('/tenants')">
            {{ $t('tenants.back') }}
          </ElButton>
          <ElButton :disabled="!enabled || busy" @click="read">{{ $t('common.refresh') }}</ElButton>
        </div>
      </div>
    </template>
    <p v-if="busy" role="status">{{ $t('tenants.loading') }}</p>
    <ElAlert v-if="problem" :title="$t(`tenants.errors.${problem}`)" type="error" :closable="false" show-icon />
    <ElDescriptions v-if="tenant" :column="1" border>
      <ElDescriptionsItem :label="$t('tenants.name')">{{ tenant.displayName }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('tenants.id')">{{ tenant.id }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('tenants.status')">{{ $t(`tenants.states.${tenant.status}`) }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('tenants.expiresAt')">{{ instant(tenant.expiresAt) }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('tenants.createdAt')">{{ instant(tenant.createdAt) }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="$t('tenants.updatedAt')">{{ instant(tenant.updatedAt) }}</ElDescriptionsItem>
    </ElDescriptions>
    <!-- #2：后续订阅、管理员初始化和生命周期页面在权威详情后接入，各自业务票实现前不展示动作。 -->
  </ElCard>
</template>
