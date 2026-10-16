<script setup lang="ts">
import { ref } from 'vue';
import { ElMessageBox } from 'element-plus';
import type { BrandAssetDisableResult } from '@crane199709/saas-forge-api-client';
import { BrandPolicyFailure } from '@/service/forge/brand-policy';
import { consoleBrandPolicy, consoleState } from '@/runtime/console';
import { $t } from '@/locales';

const input = ref('');
const busy = ref(false);
const result = ref<BrandAssetDisableResult>();
const problem = ref<'invalid' | 'missing' | 'forbidden' | 'unavailable'>();
const policy = consoleBrandPolicy();
const assetIdPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

function assetId(): string | undefined {
  const value = input.value.trim().replace(/^\/brands\//, '');
  return assetIdPattern.exec(value)?.[1];
}

async function disable() {
  if (busy.value || consoleState.value.snapshot?.activeContext?.type !== 'PLATFORM') return;
  const id = assetId();
  problem.value = undefined;
  result.value = undefined;
  if (!id) {
    problem.value = 'invalid';
    return;
  }
  try {
    await ElMessageBox.confirm($t('brandPolicy.confirm', { id }), $t('brandPolicy.disable'), {
      type: 'warning',
      confirmButtonText: $t('brandPolicy.disable'),
      cancelButtonText: $t('brandPolicy.cancel')
    });
  } catch {
    return;
  }
  if (consoleState.value.snapshot?.activeContext?.type !== 'PLATFORM') return;
  const sessionId = consoleState.value.snapshot.sessionId;
  busy.value = true;
  try {
    const disabled = await policy.disable(id);
    if (
      consoleState.value.snapshot?.activeContext?.type === 'PLATFORM' &&
      consoleState.value.snapshot.sessionId === sessionId
    )
      result.value = disabled;
  } catch (error) {
    if (
      consoleState.value.snapshot?.activeContext?.type === 'PLATFORM' &&
      consoleState.value.snapshot.sessionId === sessionId
    )
      problem.value = error instanceof BrandPolicyFailure ? error.code : 'unavailable';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ElCard v-if="consoleState.snapshot?.activeContext?.type === 'PLATFORM'" class="mt-16px">
    <template #header>
      <h2 class="text-18px font-semibold">{{ $t('brandPolicy.title') }}</h2>
    </template>
    <label class="block" for="brand-policy-id">{{ $t('brandPolicy.assetId') }}</label>
    <ElInput id="brand-policy-id" v-model="input" class="mt-6px max-w-600px" :disabled="busy" />
    <div class="mt-12px">
      <ElButton type="danger" plain :loading="busy" @click="disable">{{ $t('brandPolicy.disable') }}</ElButton>
    </div>
    <ElAlert
      v-if="problem"
      class="mt-12px"
      type="error"
      role="alert"
      :closable="false"
      :title="$t(`brandPolicy.${problem}`)"
    />
    <ElAlert
      v-if="result"
      class="mt-12px"
      type="success"
      role="status"
      :closable="false"
      :title="$t('brandPolicy.disabled', { tenantId: result.tenantId, kind: result.kind })"
    />
  </ElCard>
</template>
