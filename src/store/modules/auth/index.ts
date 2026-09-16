import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { SetupStoreId } from '@/enum';
import { consoleRuntime, consoleState, startConsole } from '@/runtime/console';

/** Soybean shell adapter. The store exposes presentation state, never bearer credentials. */
export const useAuthStore = defineStore(SetupStoreId.Auth, () => {
  const token = ref('');
  const userInfo = computed<Api.Auth.UserInfo>(() => ({
    userId: consoleState.value.snapshot?.identity?.identityId ?? '',
    userName: consoleState.value.snapshot?.identity?.email ?? '',
    roles: [],
    buttons: []
  }));
  const isLogin = computed(() => ['authenticated', 'checking'].includes(consoleState.value.status));
  const loginLoading = computed(() => consoleState.value.status === 'loading');
  const isStaticSuper = computed(() => false);
  const login = (email: string, password: string, _redirect = true) => consoleRuntime().login(email, password);
  const resetStore = () => consoleRuntime().logout();
  const initUserInfo = () => startConsole();
  return { token, userInfo, isLogin, loginLoading, isStaticSuper, login, resetStore, initUserInfo };
});
