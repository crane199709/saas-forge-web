<script setup lang="ts">
import { consoleState } from '@/runtime/console';

interface Props {
  item: App.Global.Menu;
}

const { item } = defineProps<Props>();

const hasChildren = item.children && item.children.length > 0;
</script>

<template>
  <ElSubMenu v-if="hasChildren" :index="item.key">
    <template #title>
      <ElIcon>
        <component :is="item.icon" />
      </ElIcon>
      <span class="ib-ellipsis">{{ item.label }}</span>
    </template>
    <MenuItem v-for="child in item.children" :key="child.key" :item="child" :index="child.key"></MenuItem>
  </ElSubMenu>
  <ElMenuItem v-else :aria-label="item.label" :class="{ 'tenant-brand-menu-item': consoleState.brand }">
    <ElIcon>
      <component :is="item.icon" />
    </ElIcon>
    <template #title>
      <span class="ib-ellipsis">{{ item.label }}</span>
    </template>
  </ElMenuItem>
</template>

<style scoped>
/* 品牌色可接近黑色，深色背景上的选中文字使用主题正文色。 */
:global(html.dark .tenant-brand-menu-item.is-active) {
  color: var(--el-text-color-primary);
}

.ib-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  position: relative;
}
</style>
