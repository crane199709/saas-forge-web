<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { $t } from '@/locales';
import { useOAuth } from './shared';
defineOptions({ name: 'OAuthSecret' });
const emit = defineEmits<{ closed: [] }>();
const { workspace, state, enabled } = useOAuth();
const copied = ref(false);
const failed = ref(false);
let recovery = false;
watch(
  () => state.value.secret,
  value => {
    if (value) recovery = value.source === 'recovery';
  }
);
function closed() {
  // 等关闭动画结束再恢复焦点，避免被父页面的默认签发入口覆盖。
  if (recovery) document.getElementById('oauth-recovery-heading')?.focus();
  else emit('closed');
  recovery = false;
}
function clear() {
  workspace.clearSecret();
  copied.value = false;
  failed.value = false;
}
async function copy() {
  const secret = state.value.secret;
  if (!enabled.value || !secret) return;
  try {
    await navigator.clipboard.writeText(secret.value);
    if (state.value.secret === secret) copied.value = true;
  } catch {
    if (state.value.secret === secret) failed.value = true;
  }
}
window.addEventListener('pagehide', clear);
onBeforeRouteLeave(clear);
onUnmounted(() => {
  clear();
  window.removeEventListener('pagehide', clear);
});
</script>

<template>
  <ElDialog
    :model-value="Boolean(state.secret) && enabled"
    :title="$t('oauth.secretTitle')"
    width="min(640px, 90vw)"
    :close-on-click-modal="false"
    destroy-on-close
    @close="clear"
    @closed="closed"
  >
    <template v-if="state.secret">
      <ElAlert :title="$t('oauth.secretHint')" type="warning" :closable="false" />
      <p class="my-12px break-all">{{ $t('oauth.id') }}: {{ state.secret.clientId }}</p>
      <ElInput :model-value="state.secret.value" :aria-label="$t('oauth.secretTitle')" readonly autocomplete="off" />
      <p v-if="copied" role="status">{{ $t('oauth.copied') }}</p>
      <p v-if="failed" role="alert">{{ $t('oauth.copyFailed') }}</p>
    </template>
    <template #footer>
      <ElButton @click="copy">{{ $t('oauth.copy') }}</ElButton>
      <ElButton type="primary" @click="clear">{{ $t('common.close') }}</ElButton>
    </template>
  </ElDialog>
</template>
