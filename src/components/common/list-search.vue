<script setup lang="ts">
import { $t } from '@/locales';

defineProps<{ title: string; appliedCount: number; disabled: boolean }>();
const emit = defineEmits<{ search: []; reset: [] }>();
</script>

<template>
  <ElCard class="list-search card-wrapper">
    <ElCollapse>
      <ElCollapseItem name="search">
        <template #title>
          <span>{{ title }}</span>
          <span v-if="appliedCount" class="ml-12px text-sm text-primary" role="status">
            {{ $t('common.appliedFilters', { count: appliedCount }) }}
          </span>
        </template>
        <ElForm :aria-label="title" label-position="top" class="list-search-form" @submit.prevent="emit('search')">
          <slot />
          <div class="list-search-actions">
            <ElButton :disabled="disabled" @click="emit('reset')">
              <template #icon><icon-ic-round-refresh class="text-icon" /></template>
              {{ $t('common.reset') }}
            </ElButton>
            <ElButton native-type="submit" type="primary" plain :disabled="disabled">
              <template #icon><icon-ic-round-search class="text-icon" /></template>
              {{ $t('common.search') }}
            </ElButton>
          </div>
        </ElForm>
      </ElCollapseItem>
    </ElCollapse>
  </ElCard>
</template>

<style scoped>
.list-search-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 16px 24px;
}

.list-search-form :deep(.el-form-item) {
  min-width: 0;
  margin-bottom: 0;
}

.list-search-actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.list-search-actions .el-button + .el-button {
  margin-left: 0;
}

.list-search :deep(.el-collapse-item__header:focus-visible),
.list-search :deep(.el-button:focus-visible) {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
