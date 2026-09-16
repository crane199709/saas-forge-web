<script setup lang="ts">
import { consoleState } from '@/runtime/console';
import { $t } from '@/locales';
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
        <h1 class="text-20px font-semibold">{{ $t('console.home') }}</h1>
      </template>
      <p class="mb-24px">{{ $t('console.welcome') }}</p>
      <ElDescriptions :column="1" border>
        <ElDescriptionsItem :label="$t('console.identity')">
          {{ consoleState.snapshot.identity?.email }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('console.context')">{{ $t('console.platform') }}</ElDescriptionsItem>
      </ElDescriptions>
    </ElCard>
  </div>
</template>
