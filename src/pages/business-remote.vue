<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onErrorCaptured, ref, shallowRef, version, watch } from 'vue';
import * as vue from 'vue';
import type { Component } from 'vue';
import * as elementPlus from 'element-plus';
import { consoleProjectHost, consoleRuntime, consoleState, discoverBusinessRemotes } from '@/runtime/console';
import { loadBusinessRemote } from '@/runtime/business-remote-loader';
import { $t } from '@/locales';
import type { ProjectTextKey } from '@/remotes/project-host';

const component = shallowRef<Component>();
const status = ref<'loading' | 'empty' | 'failed' | 'ready'>('loading');
const host = consoleProjectHost();
let generation = 0;
let controller = new AbortController();
let dispose: (() => void) | undefined;
let observedOwner: string | undefined;
const company = computed(() =>
  consoleState.value.snapshot?.availableContexts?.companies.find(
    item => item.membershipId === consoleState.value.snapshot?.activeContext?.membershipId
  )
);
const text = (key: ProjectTextKey) => $t(`projectRemote.${key}`);
function unload() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  dispose?.();
  dispose = undefined;
  component.value = undefined;
}
async function load() {
  unload();
  if (consoleState.value.status !== 'authenticated' || consoleState.value.snapshot?.activeContext?.type !== 'TENANT')
    return;
  status.value = 'loading';
  const started = generation;
  try {
    const page = await discoverBusinessRemotes(controller.signal);
    if (started !== generation) return;
    const manifest = page.items.find(item => item.module === 'project');
    if (!manifest) {
      status.value = 'empty';
      return;
    }
    const loaded = await loadBusinessRemote(manifest, {
      consoleOrigin: location.origin,
      uiVersion: `vue@${version};element-plus@${elementPlus.version}`,
      dependencies: Object.freeze({ vue, elementPlus }),
      signal: controller.signal
    });
    if (started !== generation) {
      loaded.dispose();
      return;
    }
    dispose = loaded.dispose;
    component.value = markRaw(loaded.component);
    status.value = 'ready';
  } catch {
    if (started === generation) status.value = 'failed';
  }
}
async function recoverSession() {
  await consoleRuntime().recover();
  await load();
}
watch(
  [
    () => consoleState.value.status,
    () => consoleState.value.snapshot?.sessionId,
    () => consoleState.value.snapshot?.identity?.identityId,
    () => consoleState.value.snapshot?.activeContext?.tenantId,
    () => consoleState.value.snapshot?.activeContext?.membershipId
  ],
  () => {
    // 只读会话核查期间 Host 已禁止调用；保留组件草稿，核查失败或换上下文时再卸载。
    if (consoleState.value.status === 'checking') return;
    const snapshot = consoleState.value.snapshot;
    const next =
      consoleState.value.status === 'authenticated' && snapshot?.activeContext?.type === 'TENANT'
        ? JSON.stringify([snapshot.sessionId, snapshot.identity?.identityId, snapshot.activeContext])
        : undefined;
    if (next === observedOwner) return;
    observedOwner = next;
    load();
  },
  { immediate: true }
);
onErrorCaptured(() => {
  unload();
  status.value = 'failed';
  return false;
});
onBeforeUnmount(unload);
</script>

<template>
  <section :aria-busy="status === 'loading'">
    <p v-if="status === 'loading'" role="status">{{ $t('remote.loading') }}</p>
    <p v-else-if="status === 'empty'" role="status">{{ $t('remote.businessEmpty') }}</p>
    <ElAlert v-else-if="status === 'failed'" :title="$t('remote.failed')" type="error" :closable="false" role="alert" />
    <ElButton v-if="status !== 'ready'" @click="load">{{ $t('projectRemote.reload') }}</ElButton>
    <ElButton @click="recoverSession">{{ $t('remote.recoverSession') }}</ElButton>
    <component
      :is="component"
      v-if="component"
      v-show="consoleState.status === 'authenticated'"
      :host="host"
      :text="text"
      :brand-name="company?.tenantDisplayName ?? ''"
    />
  </section>
</template>
