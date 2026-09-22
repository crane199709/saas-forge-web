<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef } from 'vue';
import { consoleState } from '@/runtime/console';
import { $t } from '@/locales';
import WorkContexts from './work-contexts.vue';

const heading = useTemplateRef<HTMLElement>('heading');
const company = computed(() =>
  consoleState.value.snapshot?.availableContexts?.companies.find(
    item => item.membershipId === consoleState.value.snapshot?.activeContext?.membershipId
  )
);
onMounted(async () => {
  await nextTick();
  heading.value?.focus();
});
</script>

<template>
  <ElCard
    v-if="
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
    <ElDivider />
    <h2 class="mb-16px text-18px font-semibold">{{ $t('console.chooseWorkspace') }}</h2>
    <WorkContexts />
  </ElCard>
</template>
