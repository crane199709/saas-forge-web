<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { oauthFailure } from '@/service/forge/oauth-clients';
import type { OAuthProblem, OAuthWorkspace } from '@/service/forge/oauth-clients';
import { $t } from '@/locales';
import { useOAuth } from './shared';
import Recovery from './recovery.vue';
import Secret from './secret.vue';
defineOptions({ name: 'OAuthDetail' });
const route = useRoute();
const router = useRouter();
const { workspace, state, enabled, instant } = useOAuth();
const heading = useTemplateRef<HTMLElement>('heading');
const value = shallowRef<Awaited<ReturnType<OAuthWorkspace['detail']>>>();
const problem = ref<OAuthProblem>();
const busy = ref(false);
const mutating = ref(false);
const actionController = new AbortController();
let controller: AbortController | undefined;
async function read() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  busy.value = true;
  problem.value = undefined;
  value.value = undefined;
  try {
    const result = await workspace.detail(String(route.params.id), current.signal);
    if (!current.signal.aborted) value.value = result;
  } catch (error) {
    if (!current.signal.aborted) problem.value = oauthFailure(error);
  } finally {
    if (!current.signal.aborted) busy.value = false;
  }
}
async function act(action: 'ROTATE' | 'REVOKE') {
  const current = value.value;
  if (!current || !enabled.value || mutating.value) return;
  mutating.value = true;
  try {
    await window.$messageBox?.confirm(
      $t(action === 'ROTATE' ? 'oauth.rotateWarning' : 'oauth.revokeWarning'),
      $t(`oauth.actions.${action}`),
      {
        confirmButtonText: $t('common.confirm'),
        cancelButtonText: $t('common.cancel'),
        type: 'warning',
        closeOnClickModal: false
      }
    );
    if (!window.$messageBox || actionController.signal.aborted) return;
    if (action === 'ROTATE')
      await workspace.rotate(current.client.clientId, current.client.displayName, actionController.signal);
    else await workspace.revoke(current.client.clientId, current.client.displayName, actionController.signal);
    if (!actionController.signal.aborted) {
      await read();
      await workspace.checkOperations();
    }
  } catch {
    /* 取消确认不发送写请求。 */
  } finally {
    mutating.value = false;
  }
}
onMounted(async () => {
  read();
  workspace.checkOperations();
  await nextTick();
  heading.value?.focus();
});
onUnmounted(() => {
  controller?.abort();
  actionController.abort();
});
</script>

<template>
  <div class="space-y-16px">
    <ElCard>
      <template #header>
        <div class="flex items-center justify-between gap-16px">
          <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('oauth.detail') }}</h1>
          <ElButton @click="router.push('/oauth-clients')">{{ $t('oauth.back') }}</ElButton>
        </div>
      </template>
      <p v-if="busy" role="status">{{ $t('tenants.loading') }}</p>
      <ElAlert v-if="problem" :title="$t(`oauth.errors.${problem}`)" type="error" :closable="false" />
      <ElDescriptions v-if="value" :column="1" border>
        <ElDescriptionsItem :label="$t('oauth.id')">{{ value.client.clientId }}</ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('oauth.name')">{{ value.client.displayName }}</ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('oauth.type')">
          {{ $t(`oauth.types.${value.client.clientType}`) }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('oauth.reservedKey')">
          {{ value.client.reservedServiceKey || '—' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('oauth.scopes')">
          {{ [...value.client.allowedScopes].join(', ') }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('tenants.status')">
          {{ $t(`oauth.states.${value.client.status}`) }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('tenants.createdAt')">{{ instant(value.client.createdAt) }}</ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('tenants.updatedAt')">{{ instant(value.client.updatedAt) }}</ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('oauth.revokedAt')">
          {{ value.client.revokedAt ? instant(value.client.revokedAt) : '—' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem :label="$t('oauth.overlap')">
          {{ value.credentials.overlapEndsAt ? instant(value.credentials.overlapEndsAt) : $t('oauth.noOverlap') }}
        </ElDescriptionsItem>
      </ElDescriptions>
      <p class="my-16px">{{ $t('oauth.authorityHint') }}</p>
      <ElSpace wrap>
        <ElButton :disabled="!enabled || busy || mutating || state.busy" @click="read">
          {{ $t('common.refresh') }}
        </ElButton>
        <ElButton
          type="primary"
          :disabled="
            !enabled ||
            !value?.credentials.canRotate ||
            mutating ||
            busy ||
            !state.checked ||
            !workspace.canStart('ROTATE', value.client.clientId)
          "
          @click="act('ROTATE')"
        >
          {{ $t('oauth.actions.ROTATE') }}
        </ElButton>
        <ElButton
          type="danger"
          :disabled="
            !enabled ||
            !value?.credentials.canRevoke ||
            mutating ||
            busy ||
            !state.checked ||
            !workspace.canStart('REVOKE', value.client.clientId)
          "
          @click="act('REVOKE')"
        >
          {{ $t('oauth.actions.REVOKE') }}
        </ElButton>
      </ElSpace>
    </ElCard>
    <ElCard><Recovery /></ElCard>
    <Secret @closed="heading?.focus()" />
  </div>
</template>
