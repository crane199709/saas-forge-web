<script setup lang="ts">
import { computed } from 'vue';
import { consoleRuntime, consoleState } from '@/runtime/console';
import type { WorkContextTarget } from '@/runtime/console-session';
import { $t } from '@/locales';

const contexts = computed(() => consoleState.value.snapshot?.availableContexts);
const enabled = computed(() => ['authenticated', 'restricted'].includes(consoleState.value.status));
async function select(target: WorkContextTarget) {
  await consoleRuntime().select(target, async () => {
    try {
      // 后台页可能被浏览器冻结，无法证明没有新编辑；每次切换都明确确认全标签页丢弃。
      await window.$messageBox?.confirm($t('console.switchWarning'), $t('console.switchTitle'), {
        confirmButtonText: $t('console.switchConfirm'),
        cancelButtonText: $t('common.cancel'),
        type: 'warning',
        closeOnClickModal: false
      });
      return Boolean(window.$messageBox);
    } catch {
      return false;
    }
  });
}
</script>

<template>
  <section v-if="contexts" :aria-label="$t('console.chooseWorkspace')" class="space-y-20px">
    <div v-if="contexts.platform">
      <h2 class="mb-12px text-16px font-semibold">{{ $t('console.platformManagement') }}</h2>
      <ElButton type="primary" size="large" :disabled="!enabled" @click="select({ type: 'PLATFORM' })">
        {{ $t('console.platformManagement') }}
      </ElButton>
    </div>
    <div v-if="contexts.companies.length">
      <h2 class="mb-12px text-16px font-semibold">{{ $t('console.tenant') }}</h2>
      <div class="grid grid-cols-1 gap-12px sm:grid-cols-2">
        <ElButton
          v-for="company in contexts.companies"
          :key="company.membershipId"
          class="min-h-56px m-0! h-auto! justify-start! whitespace-normal! p-16px! text-left!"
          :disabled="!enabled"
          @click="select({ type: 'TENANT', membershipId: company.membershipId })"
        >
          {{ company.tenantDisplayName }}
        </ElButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 深浅主题均使用正文前景色显示焦点，不依赖可能较深的 Tenant 品牌色。 */
:deep(.el-button:focus-visible) {
  outline: 2px solid var(--el-text-color-primary);
  outline-offset: 3px;
}
</style>
