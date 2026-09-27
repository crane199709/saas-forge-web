import { computed, onUnmounted, shallowRef } from 'vue';
import { useAppStore } from '@/store/modules/app';
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
  const instant = (value: Date) =>
    new Intl.DateTimeFormat(app.locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    }).format(value);
  return { workspace, state, enabled, instant };
}
