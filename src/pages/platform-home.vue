<script setup lang="ts">
import { nextTick, onMounted, useTemplateRef } from 'vue';
import { consoleState } from '@/runtime/console';
import { $t } from '@/locales';
import WorkContexts from './work-contexts.vue';
const heading = useTemplateRef<HTMLElement>('heading');
onMounted(async () => {
  await nextTick();
  heading.value?.focus();
});
</script>

<template>
  <div
    v-if="
      ['authenticated', 'checking'].includes(consoleState.status) &&
      consoleState.snapshot?.activeContext?.type === 'PLATFORM'
    "
  >
    <ElCard>
      <template #header>
        <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('console.home') }}</h1>
      </template>
      <p class="mb-24px">{{ $t('console.welcome') }}</p>
      <ElDescriptions :column="1" border>
        <ElDescriptionsItem :label="$t('console.identity')">
          {{ consoleState.snapshot.identity?.email }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('console.context')">{{ $t('console.platform') }}</ElDescriptionsItem>
      </ElDescriptions>
      <ElDivider />
      <h2 class="mb-16px text-18px font-semibold">{{ $t('console.chooseWorkspace') }}</h2>
      <WorkContexts />
    </ElCard>
  </div>
</template>
