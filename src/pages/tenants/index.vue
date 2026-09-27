<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import type { Tenant, TenantStatus } from '@crane199709/saas-forge-api-client';
import { failureCode, tenantStatuses } from '@/service/forge/tenants';
import type { TenantFailure } from '@/service/forge/tenants';
import { tenantWorkspace } from '@/runtime/console';
import { $t } from '@/locales';
import { useTenantDisplay } from './shared';
import Create from './create.vue';
import Recovery from './recovery.vue';
const workspace = tenantWorkspace();
const router = useRouter();
const { enabled, instant, stateText } = useTenantDisplay();
const heading = useTemplateRef<HTMLElement>('heading');
const createButton = useTemplateRef<{ $el: HTMLElement }>('createButton');
const name = ref('');
const status = ref<TenantStatus>();
const rows = shallowRef<Tenant[]>([]);
const cursors = ref<(string | undefined)[]>([undefined]);
const nextCursor = ref<string | null>(null);
const busy = ref(false);
const loaded = ref(false);
const problem = ref<TenantFailure['code']>();
const drawer = ref(false);
let query: { name?: string; status?: TenantStatus } = {};
let controller: AbortController | undefined;
async function read(next = cursors.value) {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  busy.value = true;
  problem.value = undefined;
  rows.value = [];
  nextCursor.value = null;
  loaded.value = false;
  try {
    const result = await workspace.list({ ...query, cursor: next.at(-1), limit: 20 }, current.signal);
    if (current.signal.aborted) return;
    rows.value = result.items;
    cursors.value = next;
    nextCursor.value = result.nextCursor;
    loaded.value = true;
  } catch (error) {
    if (!current.signal.aborted) problem.value = failureCode(error);
  } finally {
    if (!current.signal.aborted) busy.value = false;
  }
}
function search() {
  query = { name: name.value || undefined, status: status.value };
  read([undefined]);
}
function reset() {
  name.value = '';
  status.value = undefined;
  search();
}
function view(id: string) {
  router.push(`/tenants/${id}`);
}
async function close() {
  drawer.value = false;
  await nextTick();
  createButton.value?.$el.focus();
}
onMounted(async () => {
  read();
  workspace.checkCreations();
  await nextTick();
  heading.value?.focus();
});
onUnmounted(() => controller?.abort());
</script>

<template>
  <div class="space-y-16px">
    <ElCard>
      <template #header>
        <div class="flex items-center justify-between gap-16px">
          <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('tenants.title') }}</h1>
          <ElButton ref="createButton" type="primary" :disabled="!enabled" @click="drawer = true">
            {{ $t('tenants.create') }}
          </ElButton>
        </div>
      </template>
      <ElForm :aria-label="$t('tenants.filters')" inline @submit.prevent="search">
        <ElFormItem :label="$t('tenants.name')">
          <ElInput v-model="name" :aria-label="$t('tenants.name')" clearable maxlength="200" />
        </ElFormItem>
        <ElFormItem :label="$t('tenants.status')">
          <ElSelect v-model="status" :aria-label="$t('tenants.status')" clearable class="w-180px">
            <ElOption
              v-for="value in tenantStatuses"
              :key="value"
              :label="$t(`tenants.states.${value}`)"
              :value="value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem>
          <ElButton native-type="submit" type="primary" :disabled="!enabled || busy">
            {{ $t('tenants.search') }}
          </ElButton>
          <ElButton :disabled="!enabled || busy" @click="reset">{{ $t('tenants.reset') }}</ElButton>
        </ElFormItem>
      </ElForm>
      <ElAlert v-if="problem" :title="$t(`tenants.errors.${problem}`)" type="error" :closable="false" show-icon />
      <p v-if="busy" role="status">{{ $t('tenants.loading') }}</p>
      <ElTable
        v-if="loaded"
        :data="rows"
        row-key="id"
        :empty-text="$t('tenants.empty')"
        :aria-label="$t('tenants.title')"
      >
        <ElTableColumn prop="displayName" :label="$t('tenants.name')" min-width="180" />
        <ElTableColumn :label="$t('tenants.status')" min-width="120">
          <template #default="{ row }">{{ stateText(row.status) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('tenants.createdAt')" min-width="210">
          <template #default="{ row }">{{ instant(row.createdAt) }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('common.action')" align="right" width="130">
          <template #default="{ row }">
            <ElButton :disabled="!enabled" @click="view(row.id)">{{ $t('tenants.view') }}</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="mt-16px flex items-center justify-end gap-12px">
        <ElButton v-if="problem" :disabled="!enabled || busy" @click="read()">{{ $t('console.retry') }}</ElButton>
        <ElButton :disabled="!enabled || busy || cursors.length < 2" @click="read(cursors.slice(0, -1))">
          {{ $t('tenants.previous') }}
        </ElButton>
        <span>{{ $t('tenants.page', { page: cursors.length }) }}</span>
        <ElButton :disabled="!enabled || busy || !nextCursor" @click="read([...cursors, nextCursor!])">
          {{ $t('tenants.next') }}
        </ElButton>
      </div>
    </ElCard>
    <ElCard v-if="!drawer"><Recovery @view="view" /></ElCard>
    <Create v-if="drawer" @close="close" @view="view" />
  </div>
</template>
