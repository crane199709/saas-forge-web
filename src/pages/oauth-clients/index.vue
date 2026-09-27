<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import type { OAuthClientDetail, OAuthClientStatus, OAuthClientType } from '@crane199709/saas-forge-api-client';
import { oauthFailure } from '@/service/forge/oauth-clients';
import type { OAuthProblem } from '@/service/forge/oauth-clients';
import { $t } from '@/locales';
import { useOAuth } from './shared';
import Secret from './secret.vue';
import Create from './create.vue';
import Recovery from './recovery.vue';
defineOptions({ name: 'OAuthList' });
const { workspace, enabled, instant } = useOAuth();
const base = '/oauth-clients';
const router = useRouter();
const heading = useTemplateRef<HTMLElement>('heading');
const createButton = useTemplateRef<{ $el: HTMLElement }>('createButton');
const code = ref('');
const status = ref<OAuthClientStatus>();
const clientType = ref<OAuthClientType>();
const rows = shallowRef<OAuthClientDetail[]>([]);
const cursors = ref<(string | undefined)[]>([undefined]);
const nextCursor = ref<string | null>(null);
const busy = ref(false);
const loaded = ref(false);
const problem = ref<OAuthProblem>();
const drawer = ref(false);
let query: { name?: string; status?: OAuthClientStatus; clientType?: OAuthClientType } = {};
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
    if (!current.signal.aborted) problem.value = oauthFailure(error);
  } finally {
    if (!current.signal.aborted) busy.value = false;
  }
}
function search() {
  query = { name: code.value || undefined, status: status.value, clientType: clientType.value };
  read([undefined]);
}
function reset() {
  code.value = '';
  status.value = undefined;
  clientType.value = undefined;
  search();
}
function view(id: string) {
  router.push(`${base}/${id}`);
}
async function close() {
  drawer.value = false;
  await nextTick();
  if (!workspace.state.secret) createButton.value?.$el.focus();
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
          <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('oauth.title') }}</h1>
          <ElButton ref="createButton" type="primary" :disabled="!enabled" @click="drawer = true">
            {{ $t('oauth.create') }}
          </ElButton>
        </div>
      </template>
      <ElForm :aria-label="$t('oauth.filters')" inline @submit.prevent="search">
        <ElFormItem :label="$t('oauth.name')">
          <ElInput v-model="code" :aria-label="$t('oauth.name')" clearable maxlength="200" />
        </ElFormItem>
        <ElFormItem :label="$t('tenants.status')">
          <ElSelect v-model="status" :aria-label="$t('tenants.status')" clearable class="w-180px">
            <ElOption
              v-for="value in ['ACTIVE', 'REVOKED'] as const"
              :key="value"
              :label="$t(`oauth.states.${value}`)"
              :value="value"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem :label="$t('oauth.type')">
          <ElSelect v-model="clientType" :aria-label="$t('oauth.type')" clearable class="w-200px">
            <ElOption
              v-for="value in ['RUNTIME_SERVICE', 'RESERVED_SERVICE'] as const"
              :key="value"
              :value="value"
              :label="$t(`oauth.types.${value}`)"
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
      <ElAlert v-if="problem" :title="$t(`oauth.errors.${problem}`)" type="error" :closable="false" show-icon />
      <p v-if="busy" role="status">{{ $t('tenants.loading') }}</p>
      <ElTable
        v-if="loaded"
        :data="rows"
        row-key="clientId"
        :empty-text="$t('oauth.empty')"
        :aria-label="$t('oauth.title')"
      >
        <ElTableColumn prop="displayName" :label="$t('oauth.name')" min-width="160" />
        <ElTableColumn prop="clientId" :label="$t('oauth.id')" min-width="300" />
        <ElTableColumn :label="$t('oauth.type')" min-width="160">
          <template #default="{ row }">
            {{ row.clientType ? $t(`oauth.types.${row.clientType as 'RUNTIME_SERVICE'}`) : '' }}
          </template>
        </ElTableColumn>
        <ElTableColumn :label="$t('tenants.status')" min-width="100">
          <template #default="{ row }">
            <template v-if="row.status">
              {{ $t(`oauth.states.${row.status as 'ACTIVE' | 'REVOKED'}`) }}
            </template>
          </template>
        </ElTableColumn>
        <ElTableColumn :label="$t('tenants.createdAt')" min-width="210">
          <template #default="{ row }">{{ row.createdAt ? instant(row.createdAt) : '' }}</template>
        </ElTableColumn>
        <ElTableColumn :label="$t('common.action')" align="right" width="130">
          <template #default="{ row }">
            <ElButton :disabled="!enabled" @click="view(row.clientId)">{{ $t('tenants.view') }}</ElButton>
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
    <ElCard v-if="!drawer"><Recovery /></ElCard>
    <Create v-if="drawer" @close="close" @created="read([undefined])" />
    <Secret @closed="createButton?.$el.focus()" />
  </div>
</template>
