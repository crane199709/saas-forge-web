<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, useTemplateRef, watch } from 'vue';
import { AdminLayout, LAYOUT_SCROLL_EL_ID } from '@sa/materials';
import type { LayoutMode } from '@sa/materials';
import { useAppStore } from '@/store/modules/app';
import { useThemeStore } from '@/store/modules/theme';
import { $t } from '@/locales';
import { consoleState } from '@/runtime/console';
import GlobalHeader from '../modules/global-header/index.vue';
import GlobalSider from '../modules/global-sider/index.vue';
import GlobalTab from '../modules/global-tab/index.vue';
import GlobalContent from '../modules/global-content/index.vue';
import GlobalFooter from '../modules/global-footer/index.vue';
import ThemeDrawer from '../modules/theme-drawer/index.vue';
import { setupMixMenuContext } from '../context';

defineOptions({ name: 'BaseLayout' });

const appStore = useAppStore();
const themeStore = useThemeStore();
const checking = computed(() => consoleState.value.status === 'checking');
const checkDialog = useTemplateRef<HTMLDialogElement>('checkDialog');
// 原生模态层同时遮蔽并禁用传送到 body 的菜单、抽屉等浮层。
watch(
  [checking, checkDialog],
  ([value]) => {
    if (value) checkDialog.value?.showModal();
    else checkDialog.value?.close();
  },
  { flush: 'post' }
);
let checkedFocus: HTMLElement | undefined;
watch(
  checking,
  async value => {
    if (value) {
      checkedFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    } else {
      await nextTick();
      if (
        consoleState.value.status === 'authenticated' &&
        document.hasFocus() &&
        document.activeElement === document.body &&
        checkedFocus?.isConnected
      )
        checkedFocus.focus();
      checkedFocus = undefined;
    }
  },
  { flush: 'sync' }
);
const { childLevelMenus, isActiveFirstLevelMenuHasChildren } = setupMixMenuContext();

const GlobalMenu = defineAsyncComponent(() => import('../modules/global-menu/index.vue'));

const layoutMode = computed(() => {
  const vertical: LayoutMode = 'vertical';
  const horizontal: LayoutMode = 'horizontal';
  return themeStore.layout.mode.includes(vertical) ? vertical : horizontal;
});

const headerProps = computed(() => {
  const { mode, reverseHorizontalMix } = themeStore.layout;

  const headerPropsConfig: Record<UnionKey.ThemeLayoutMode, App.Global.HeaderProps> = {
    vertical: {
      showLogo: false,
      showMenu: false,
      showMenuToggler: true
    },
    'vertical-mix': {
      showLogo: false,
      showMenu: false,
      showMenuToggler: false
    },
    horizontal: {
      showLogo: true,
      showMenu: true,
      showMenuToggler: false
    },
    'horizontal-mix': {
      showLogo: true,
      showMenu: true,
      showMenuToggler: reverseHorizontalMix && isActiveFirstLevelMenuHasChildren.value
    }
  };

  return headerPropsConfig[mode];
});

const siderVisible = computed(() => themeStore.layout.mode !== 'horizontal');

const isVerticalMix = computed(() => themeStore.layout.mode === 'vertical-mix');

const isHorizontalMix = computed(() => themeStore.layout.mode === 'horizontal-mix');

const siderWidth = computed(() => getSiderWidth());

const siderCollapsedWidth = computed(() => getSiderCollapsedWidth());

function getSiderWidth() {
  const { reverseHorizontalMix } = themeStore.layout;
  const { width, mixWidth, mixChildMenuWidth } = themeStore.sider;

  if (isHorizontalMix.value && reverseHorizontalMix) {
    return isActiveFirstLevelMenuHasChildren.value ? width : 0;
  }

  let w = isVerticalMix.value || isHorizontalMix.value ? mixWidth : width;

  if (isVerticalMix.value && appStore.mixSiderFixed && childLevelMenus.value.length) {
    w += mixChildMenuWidth;
  }

  return w;
}

function getSiderCollapsedWidth() {
  const { reverseHorizontalMix } = themeStore.layout;
  const { collapsedWidth, mixCollapsedWidth, mixChildMenuWidth } = themeStore.sider;

  if (isHorizontalMix.value && reverseHorizontalMix) {
    return isActiveFirstLevelMenuHasChildren.value ? collapsedWidth : 0;
  }

  let w = isVerticalMix.value || isHorizontalMix.value ? mixCollapsedWidth : collapsedWidth;

  if (isVerticalMix.value && appStore.mixSiderFixed && childLevelMenus.value.length) {
    w += mixChildMenuWidth;
  }

  return w;
}
</script>

<template>
  <dialog
    ref="checkDialog"
    class="m-0 h-screen max-h-none max-w-none w-screen border-0 bg-layout p-0"
    :aria-label="$t('console.loading')"
    @cancel.prevent
  >
    <div class="size-full flex-center" role="status" aria-live="polite">{{ $t('console.loading') }}</div>
  </dialog>
  <AdminLayout
    v-if="
      ['authenticated', 'checking'].includes(consoleState.status) &&
      consoleState.snapshot?.activeContext?.type === 'PLATFORM'
    "
    v-model:sider-collapse="appStore.siderCollapse"
    :inert="checking"
    :style="checking ? { visibility: 'hidden' } : undefined"
    :mode="layoutMode"
    :scroll-el-id="LAYOUT_SCROLL_EL_ID"
    :scroll-mode="themeStore.layout.scrollMode"
    :is-mobile="appStore.isMobile"
    :full-content="appStore.fullContent"
    :fixed-top="themeStore.fixedHeaderAndTab"
    :header-height="themeStore.header.height"
    :tab-visible="themeStore.tab.visible"
    :tab-height="themeStore.tab.height"
    :content-class="appStore.contentXScrollable ? 'overflow-x-hidden' : ''"
    :sider-visible="siderVisible"
    :sider-width="siderWidth"
    :sider-collapsed-width="siderCollapsedWidth"
    :footer-visible="themeStore.footer.visible"
    :footer-height="themeStore.footer.height"
    :fixed-footer="themeStore.footer.fixed"
    :right-footer="themeStore.footer.right"
  >
    <template #header>
      <GlobalHeader v-bind="headerProps" />
    </template>
    <template #tab>
      <GlobalTab />
    </template>
    <template #sider>
      <GlobalSider />
    </template>
    <GlobalMenu />
    <GlobalContent />
    <ThemeDrawer />
    <template #footer>
      <GlobalFooter />
    </template>
  </AdminLayout>
  <div
    v-if="consoleState.status !== 'authenticated'"
    class="fixed inset-0 flex-center bg-layout"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    {{ $t('console.loading') }}
  </div>
</template>

<style lang="scss">
#__SCROLL_EL_ID__ {
  @include scrollbar();
}
</style>
