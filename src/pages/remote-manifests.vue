<script setup lang="ts">
import { ref, watch } from 'vue';
import { ResponseError } from '@crane199709/saas-forge-api-client';
import type { RemoteManifest } from '@crane199709/saas-forge-api-client';
import { consoleState, decideRemoteManifest, listRemoteManifests } from '@/runtime/console';
import { operationKey } from '@/runtime/browser-coordination';
import { $t } from '@/locales';

type Decision = 'approve' | 'reject' | 'enable';
const items = ref<RemoteManifest[]>([]);
const cursor = ref<string | null>(null);
const busy = ref(false);
const failed = ref(false);
const pending = ref<{ id: string; action: Decision; key: string }>();
let generation = 0;
let owner: string | undefined;
const stateText = (state: RemoteManifest['state']) =>
  $t(
    `manifest.${
      {
        PENDING_REVIEW: 'pending',
        APPROVED: 'approved',
        REJECTED: 'rejected',
        ENABLED: 'enabled'
      }[state] as 'pending' | 'approved' | 'rejected' | 'enabled'
    }`
  );

async function load(append = false) {
  const current = generation;
  const page = await listRemoteManifests(append ? (cursor.value ?? undefined) : undefined);
  if (current !== generation) return;
  items.value = append ? [...items.value, ...page.items] : page.items;
  cursor.value = page.nextCursor;
}
async function run(operation: () => Promise<void>) {
  if (busy.value || consoleState.value.status !== 'authenticated') return;
  busy.value = true;
  failed.value = false;
  const current = generation;
  try {
    await operation();
  } catch {
    if (current === generation) failed.value = true;
  } finally {
    if (current === generation) busy.value = false;
  }
}
async function replay() {
  const current = generation;
  const attempt = pending.value;
  if (!attempt) return;
  try {
    await decideRemoteManifest(attempt.id, attempt.action, attempt.key);
    if (pending.value === attempt) pending.value = undefined;
  } catch (error) {
    const problem =
      error instanceof ResponseError
        ? await error.response
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    if (
      error instanceof ResponseError &&
      error.response.status >= 400 &&
      error.response.status < 500 &&
      ![401, 403, 408, 429].includes(error.response.status) &&
      problem?.code !== 'IDEMPOTENCY_REQUEST_IN_PROGRESS' &&
      pending.value === attempt
    )
      pending.value = undefined;
    throw error;
  }
  if (current === generation) await load();
}
async function decide(id: string, action: Decision) {
  if (pending.value) return;
  pending.value = { id, action, key: operationKey() };
  await replay();
}
watch(
  () => [
    consoleState.value.status,
    consoleState.value.snapshot?.sessionId,
    consoleState.value.snapshot?.identity?.identityId,
    consoleState.value.snapshot?.activeContext?.type
  ],
  () => {
    const next =
      consoleState.value.snapshot?.activeContext?.type === 'PLATFORM'
        ? `${consoleState.value.snapshot?.sessionId}:${consoleState.value.snapshot?.identity?.identityId}`
        : undefined;
    if (owner === next) {
      if (next && consoleState.value.status === 'authenticated') run(() => load());
      return;
    }
    owner = next;
    generation += 1;
    items.value = [];
    cursor.value = null;
    pending.value = undefined;
    busy.value = false;
    failed.value = false;
    if (next) run(() => load());
  },
  { immediate: true }
);
</script>

<template>
  <ElCard class="mt-24px" :aria-busy="busy">
    <template #header>
      <h2 class="text-18px font-semibold">{{ $t('manifest.title') }}</h2>
    </template>
    <ElAlert v-if="failed" :title="$t('projectRemote.failed')" type="error" :closable="false" role="alert" />
    <ElAlert v-if="pending" :title="$t('projectRemote.unknown')" type="warning" :closable="false" role="status" />
    <ElButton :disabled="busy" @click="run(() => load())">{{ $t('projectRemote.reload') }}</ElButton>
    <ElButton v-if="pending" :disabled="busy" @click="run(replay)">{{ $t('projectRemote.recover') }}</ElButton>
    <p v-if="!items.length && !busy" class="mt-16px">{{ $t('projectRemote.empty') }}</p>
    <ElTable v-else :data="items" row-key="id" class="mt-16px">
      <ElTableColumn prop="module" :label="$t('manifest.module')" />
      <ElTableColumn prop="version" :label="$t('manifest.version')" />
      <ElTableColumn prop="source" :label="$t('manifest.source')" min-width="260" />
      <ElTableColumn :label="$t('manifest.state')">
        <template #default="{ row }">{{ stateText(row.state) }}</template>
      </ElTableColumn>
      <ElTableColumn min-width="200">
        <template #default="{ row }">
          <ElButton
            v-if="row.state === 'PENDING_REVIEW'"
            :disabled="busy || Boolean(pending)"
            @click="run(() => decide(row.id, 'approve'))"
          >
            {{ $t('manifest.approve') }}
          </ElButton>
          <ElButton
            v-if="row.state === 'PENDING_REVIEW'"
            :disabled="busy || Boolean(pending)"
            @click="run(() => decide(row.id, 'reject'))"
          >
            {{ $t('manifest.reject') }}
          </ElButton>
          <ElButton
            v-if="row.state === 'APPROVED'"
            :disabled="busy || Boolean(pending)"
            @click="run(() => decide(row.id, 'enable'))"
          >
            {{ $t('manifest.enable') }}
          </ElButton>
        </template>
      </ElTableColumn>
    </ElTable>
    <ElButton v-if="cursor" :disabled="busy" @click="run(() => load(true))">{{ $t('projectRemote.next') }}</ElButton>
  </ElCard>
</template>
