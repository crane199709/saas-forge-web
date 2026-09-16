import type { App } from 'vue';
import { watch } from 'vue';
import {
  type RouterHistory,
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory
} from 'vue-router';
import { consoleState, startConsole } from '@/runtime/console';
import { createProgressGuard } from './guard/progress';
import { createDocumentTitleGuard } from './guard/title';

const { VITE_ROUTER_HISTORY_MODE = 'history', VITE_BASE_URL } = import.meta.env;

const historyCreatorMap: Record<Env.RouterHistoryMode, (base?: string) => RouterHistory> = {
  hash: createWebHashHistory,
  history: createWebHistory,
  memory: createMemoryHistory
};

export const router = createRouter({
  history: historyCreatorMap[VITE_ROUTER_HISTORY_MODE](VITE_BASE_URL),
  routes: [
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
    if (to.name === 'gateway-connection') return true;
    await startConsole();
    const platform =
      consoleState.value.status === 'authenticated' && consoleState.value.snapshot?.activeContext?.type === 'PLATFORM';
    if (!platform && to.name !== 'login') return '/login';
    if (platform && to.name === 'login') return '/home';
    return true;
  });
  watch(consoleState, state => {
    // Remove protected content as soon as a transition starts; the page also checks state directly.
    if (state.status === 'loading' || state.status === 'checking') return;
    const platform = state.status === 'authenticated' && state.snapshot?.activeContext?.type === 'PLATFORM';
    if (router.currentRoute.value.name !== 'gateway-connection') router.replace(platform ? '/home' : '/login');
  });
  await router.isReady();
}
