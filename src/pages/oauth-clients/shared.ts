import { computed, onUnmounted, shallowRef } from 'vue';
import { useAppStore } from '@/store/modules/app';
import { formatInstant } from '@/locales/format';
import { consoleState, oauthWorkspace } from '@/runtime/console';
export function useOAuth() {
  const workspace = oauthWorkspace();
  const state = shallowRef(workspace.state);
  onUnmounted(
    workspace.subscribe(value => {
      state.value = value;
    })
  );
  const enabled = computed(
    () =>
      consoleState.value.status === 'authenticated' && consoleState.value.snapshot?.activeContext?.type === 'PLATFORM'
  );
  const app = useAppStore();
  const instant = (value: Date) => formatInstant({ value: value.toISOString(), locale: app.locale });
  return { workspace, state, enabled, instant };
}
