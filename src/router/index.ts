import type { App } from 'vue';
import { watch } from 'vue';
import {
  type RouterHistory,
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory
} from 'vue-router';
import { capturePasswordSetupLink } from '@/runtime/password-setup-link';
import { consoleState, startConsole } from '@/runtime/console';
import { createProgressGuard } from './guard/progress';
import { createDocumentTitleGuard } from './guard/title';

const { VITE_ROUTER_HISTORY_MODE = 'history', VITE_BASE_URL } = import.meta.env;

const historyCreatorMap: Record<Env.RouterHistoryMode, (base?: string) => RouterHistory> = {
  hash: createWebHashHistory,
  history: createWebHistory,
  memory: createMemoryHistory
};

capturePasswordSetupLink();

export const router = createRouter({
  history: historyCreatorMap[VITE_ROUTER_HISTORY_MODE](VITE_BASE_URL),
  routes: [
    {
      path: '/password-setup',
      name: 'password-setup',
      component: () => import('@/pages/password-setup.vue'),
      meta: { title: 'SaaS Forge', constant: true }
    },
    { path: '/', name: 'root', redirect: '/home' },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/console-entry.vue'),
      meta: { title: 'SaaS Forge', constant: true }
    },
    {
      path: '/home',
      component: () => import('@/layouts/base-layout/index.vue'),
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('@/pages/platform-home.vue'),
          meta: { title: 'SaaS Forge', i18nKey: 'route.home' }
        }
      ]
    },
    {
      path: '/tenants',
      component: () => import('@/layouts/base-layout/index.vue'),
      children: [
        {
          path: '',
          name: 'tenants',
          component: () => import('@/pages/tenants/index.vue'),
          meta: { title: 'Tenants', i18nKey: 'tenants.title' }
        },
        {
          path: ':id',
          name: 'tenant-detail',
          component: () => import('@/pages/tenants/detail.vue'),
          meta: { title: 'Tenant details', i18nKey: 'tenants.detail' }
        }
      ]
    },
    {
      path: '/workbench',
      component: () => import('@/layouts/base-layout/index.vue'),
      children: [
        {
          path: '',
          name: 'workbench',
          component: () => import('@/pages/tenant-home.vue'),
          meta: { title: 'SaaS Forge', i18nKey: 'console.tenant' }
        }
      ]
    },
    {
      path: '/connection',
      name: 'gateway-connection',
      component: () => import('@/pages/gateway-connection.vue'),
      meta: { title: 'SaaS Forge', constant: true }
    },
    { path: '/:pathMatch(.*)*', redirect: '/home' }
  ]
});

/** Setup Vue Router */
export async function setupRouter(app: App) {
  app.use(router);
  createProgressGuard(router);
  createDocumentTitleGuard(router);
  router.beforeEach(async to => {
    if (to.name === 'password-setup' || to.name === 'gateway-connection') return true;
    await startConsole();
    const active =
      consoleState.value.status === 'authenticated' ? consoleState.value.snapshot?.activeContext?.type : undefined;
    const home = active === 'PLATFORM' ? '/home' : '/workbench';
    if (!active && to.name !== 'login') return '/login';
    const allowed = active === 'PLATFORM' ? ['home', 'tenants', 'tenant-detail'] : ['workbench'];
    if (active && !allowed.includes(String(to.name))) return home;
    return true;
  });
  watch(consoleState, state => {
    // 首次导航由 beforeEach 处理，避免恢复会话时把深链接抢先改为首页。
    if (!router.currentRoute.value.matched.length) return;
    // Remove protected content as soon as a transition starts; the page also checks state directly.
    if (state.status === 'loading' || state.status === 'checking') return;
    const active = state.status === 'authenticated' ? state.snapshot?.activeContext?.type : undefined;
    const home = active === 'PLATFORM' ? '/home' : '/workbench';
    const name = String(router.currentRoute.value.name);
    if (['password-setup', 'gateway-connection'].includes(name)) return;
    const allowed = active === 'PLATFORM' ? ['home', 'tenants', 'tenant-detail'] : ['workbench'];
    if (!active || !allowed.includes(name)) router.replace(active ? home : '/login');
  });
  await router.isReady();
}
