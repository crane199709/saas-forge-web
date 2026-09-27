<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import { entitlementFailure } from '@/service/forge/entitlements';
import type { EntitlementFailure, EntitlementKind, EntitlementResource } from '@/service/forge/entitlements';
import { $t } from '@/locales';
import { useEntitlements } from './shared';
import Create from './create.vue';
import Recovery from './recovery.vue';
defineOptions({ name: 'EntitlementList' });
const props = defineProps<{ kind: EntitlementKind }>();
const { workspace, enabled, base, instant } = useEntitlements(props.kind);
const router = useRouter();
const heading = useTemplateRef<HTMLElement>('heading');
const createButton = useTemplateRef<{ $el: HTMLElement }>('createButton');
const code = ref('');
const status = ref<'DRAFT' | 'ACTIVE' | 'RETIRED'>();
const rows = shallowRef<EntitlementResource[]>([]);
const cursors = ref<(string | undefined)[]>([undefined]);
const nextCursor = ref<string | null>(null);
const busy = ref(false);
const loaded = ref(false);
const problem = ref<EntitlementFailure['code']>();
const drawer = ref(false);
let query: { code?: string; status?: 'DRAFT' | 'ACTIVE' | 'RETIRED' } = {};
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
    if (result.nextCursor && next.includes(result.nextCursor)) throw new Error('Repeated cursor');
    rows.value = result.items;
    cursors.value = next;
    nextCursor.value = result.nextCursor;
    loaded.value = true;
  } catch (error) {
    if (!current.signal.aborted) problem.value = entitlementFailure(error);
  } finally {
    if (!current.signal.aborted) busy.value = false;
  }
}
function search() {
  query = { code: code.value || undefined, status: status.value };
  read([undefined]);
}
function reset() {
  code.value = '';
  status.value = undefined;
  search();
}
function view(id: string) {
  router.push(`${base}/${id}`);
}
async function close() {
  drawer.value = false;
  await nextTick();
  createButton.value?.$el.focus();
}
onMounted(async () => {
  read();
  workspace.checkOperations();
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
          <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t(`entitlements.${kind}.title`) }}</h1>
          <ElButton ref="createButton" type="primary" :disabled="!enabled" @click="drawer = true">
            {{ $t(`entitlements.${kind}.create`) }}
          </ElButton>
        </div>
      </template>
      <ElForm :aria-label="$t('entitlements.filters')" inline @submit.prevent="search">
        <ElFormItem :label="$t('entitlements.code')">
          <ElInput v-model="code" :aria-label="$t('entitlements.code')" clearable maxlength="63" />
        </ElFormItem>
        <ElFormItem :label="$t('tenants.status')">
          <ElSelect v-model="status" :aria-label="$t('tenants.status')" clearable class="w-180px">
            <ElOption
              v-for="value in ['DRAFT', 'ACTIVE', 'RETIRED'] as const"
              :key="value"
              :label="$t(`entitlements.states.${value}`)"
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
      <ElAlert v-if="problem" :title="$t(`entitlements.errors.${problem}`)" type="error" :closable="false" show-icon />
      <p v-if="busy" role="status">{{ $t('tenants.loading') }}</p>
      <ElTable
        v-if="loaded"
        :data="rows"
        row-key="id"
        :empty-text="$t('entitlements.empty')"
        :aria-label="$t(`entitlements.${kind}.title`)"
      >
        <ElTableColumn prop="code" :label="$t('entitlements.code')" min-width="160" />
        <ElTableColumn v-if="kind === 'plan'" prop="displayName" :label="$t('entitlements.name')" min-width="180" />
        <ElTableColumn :label="$t('tenants.status')" min-width="100">
          <template #default="{ row }">
            {{ $t(`entitlements.states.${row.status as 'DRAFT' | 'ACTIVE' | 'RETIRED'}`) }}
          </template>
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
    <ElCard v-if="!drawer"><Recovery :kind="kind" @view="view" /></ElCard>
    <Create v-if="drawer" :kind="kind" @close="close" @view="view" />
  </div>
</template>
