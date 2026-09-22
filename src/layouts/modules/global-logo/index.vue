<script setup lang="ts">
import { consoleState } from '@/runtime/console';
import { $t } from '@/locales';

defineOptions({ name: 'GlobalLogo' });

interface Props {
  /** Whether to show the title */
  showTitle?: boolean;
}

withDefaults(defineProps<Props>(), {
  showTitle: true
});
</script>

<template>
  <RouterLink
    :aria-label="consoleState.brand?.displayName ?? $t('system.title')"
    to="/"
    class="w-full flex-center nowrap-hidden"
  >
    <img v-if="consoleState.brand" :src="consoleState.brand.logoUrl" alt="" class="size-32px object-contain" />
    <SystemLogo v-else class="size-32px" />
    <h2 v-show="showTitle" class="pl-8px text-16px text-primary font-bold transition duration-300 ease-in-out">
      {{ consoleState.brand?.displayName ?? $t('system.title') }}
    </h2>
  </RouterLink>
</template>

<style scoped></style>
