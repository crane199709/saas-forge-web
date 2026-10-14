<script setup lang="ts">
import { nextTick, onMounted, useTemplateRef } from 'vue';
import { consoleState } from '@/runtime/console';
import { $t } from '@/locales';
import BrandAssets from './brand-assets.vue';

const heading = useTemplateRef<HTMLElement>('heading');
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
      <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('brandAssets.settings') }}</h1>
    </template>
    <BrandAssets />
  </ElCard>
</template>
