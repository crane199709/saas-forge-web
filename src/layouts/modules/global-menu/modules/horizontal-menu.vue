<script setup lang="ts">
import type { RouteKey } from '@elegant-router/types';
import { GLOBAL_HEADER_MENU_ID } from '@/constants/app';
import { useRouteStore } from '@/store/modules/route';
import { useMenu } from '../../../context';
import MenuItem from '../components/menu-item.vue';

defineOptions({ name: 'HorizontalMenu' });

const routeStore = useRouteStore();
const { selectedKeyDummy, handleSelect } = useMenu();
</script>

<template>
  <!-- 工作区切换会重建布局，等待同轮渲染中的菜单挂载目标就绪。 -->
  <Teleport defer :to="`#${GLOBAL_HEADER_MENU_ID}`">
    <ElMenu
      ellipsis
      class="w-full"
      mode="horizontal"
      :default-active="selectedKeyDummy"
      @select="val => handleSelect(val as RouteKey)"
    >
      <MenuItem v-for="item in routeStore.menus" :key="item.key" :item="item" :index="item.key" />
    </ElMenu>
  </Teleport>
</template>

<style scoped></style>
