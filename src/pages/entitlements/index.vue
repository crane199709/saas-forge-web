<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import { entitlementFailure } from '@/service/forge/entitlements';
import type { EntitlementFailure, EntitlementKind, EntitlementResource } from '@/service/forge/entitlements';
import { $t } from '@/locales';
import ListSearch from '@/components/common/list-search.vue';
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
const query = shallowRef<{ code?: string; status?: 'DRAFT' | 'ACTIVE' | 'RETIRED' }>({});
const appliedCount = computed(() => Object.values(query.value).filter(Boolean).length);
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
    const result = await workspace.list({ ...query.value, cursor: next.at(-1), limit: 20 }, current.signal);
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
  query.value = { code: code.value || undefined, status: status.value };
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
    <ListSearch
      :title="$t('entitlements.filters')"
      :applied-count="appliedCount"
      :disabled="!enabled || busy"
      @search="search"
      @reset="reset"
    >
      <ElFormItem :label="$t('entitlements.code')">
        <ElInput v-model="code" :aria-label="$t('entitlements.code')" clearable maxlength="63" />
      </ElFormItem>
      <ElFormItem :label="$t('tenants.status')">
        <ElSelect v-model="status" :aria-label="$t('tenants.status')" clearable class="w-full">
          <ElOption
            v-for="value in ['DRAFT', 'ACTIVE', 'RETIRED'] as const"
            :key="value"
            :label="$t(`entitlements.states.${value}`)"
            :value="value"
          />
        </ElSelect>
      </ElFormItem>
    </ListSearch>
    <ElCard class="card-wrapper">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-16px">
          <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t(`entitlements.${kind}.title`) }}</h1>
          <ElButton ref="createButton" type="primary" plain :disabled="!enabled" @click="drawer = true">
            <template #icon><icon-ic-round-plus class="text-icon" /></template>
            {{ $t(`entitlements.${kind}.create`) }}
          </ElButton>
        </div>
      </template>

      <ElAlert v-if="problem" :title="$t(`entitlements.errors.${problem}`)" type="error" :closable="false" show-icon />
      <p v-if="busy" role="status">{{ $t('tenants.loading') }}</p>
      <ElTable
        v-if="loaded"
        class="business-table"
        border
        :data="rows"
        row-key="id"
        :empty-text="$t('entitlements.empty')"
        :aria-label="$t(`entitlements.${kind}.title`)"
      >
        <ElTableColumn
          align="left"
          header-align="center"
          prop="code"
          :label="$t('entitlements.code')"
          min-width="160"
        />
        <ElTableColumn
          v-if="kind === 'plan'"
          align="left"
          header-align="center"
          prop="displayName"
          :label="$t('entitlements.name')"
          min-width="180"
        />
        <ElTableColumn header-align="center" :label="$t('tenants.status')" align="center" min-width="100">
          <template #default="{ row }">
            <template v-if="row.status">
              {{ $t(`entitlements.states.${row.status as 'DRAFT' | 'ACTIVE' | 'RETIRED'}`) }}
            </template>
          </template>
        </ElTableColumn>
        <ElTableColumn align="left" header-align="center" :label="$t('tenants.createdAt')" min-width="210">
          <template #default="{ row }">{{ row.createdAt ? instant(row.createdAt) : '' }}</template>
        </ElTableColumn>
        <ElTableColumn header-align="center" :label="$t('common.action')" align="center" fixed="right" width="130">
          <template #default="{ row }">
            <ElButton plain size="small" :disabled="!enabled" @click="view(row.id)">{{ $t('tenants.view') }}</ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="mt-16px flex flex-wrap items-center justify-end gap-12px">
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
    <ElCard v-if="!drawer" class="card-wrapper"><Recovery :kind="kind" @view="view" /></ElCard>
    <Create v-if="drawer" :kind="kind" @close="close" @view="view" />
  </div>
</template>
