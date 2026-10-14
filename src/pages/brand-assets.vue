<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ResponseError } from '@crane199709/saas-forge-api-client';
import type { BrandAsset } from '@crane199709/saas-forge-api-client';
import { consoleBrandAssets, consoleState } from '@/runtime/console';
import { $t } from '@/locales';

type Kind = 'logo' | 'favicon';
type Failure = 'invalid' | 'forbidden' | 'unavailable';
interface Preview {
  url: string;
  reference: string;
  width: number;
  height: number;
}
interface PendingPreview {
  kind: Kind;
  asset: BrandAsset;
  options: RequestInit;
  started: number;
  tenantId: string;
}

const api = consoleBrandAssets();
const preview = ref<Partial<Record<Kind, Preview>>>({});
const busy = ref<Kind>();
const problem = ref<Failure>();
let generation = 0;
let controller = new AbortController();

function reset() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  for (const item of Object.values(preview.value)) if (item) URL.revokeObjectURL(item.url);
  preview.value = {};
  problem.value = undefined;
  busy.value = undefined;
}

watch(() => consoleState.value.snapshot?.activeContext?.membershipId, reset);
onBeforeUnmount(reset);

function classify(error: unknown): Failure {
  if (!(error instanceof ResponseError)) return 'unavailable';
  if (error.response.status === 400 || error.response.status === 413 || error.response.status === 415) return 'invalid';
  if (error.response.status === 401 || error.response.status === 403) return 'forbidden';
  return 'unavailable';
}

function isCurrent(started: number, tenantId: string) {
  return started === generation && tenantId === consoleState.value.snapshot?.activeContext?.tenantId;
}

function selectedFile(kind: Kind, event: Event): File | undefined {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || busy.value) return undefined;
  const max = kind === 'logo' ? 2 * 1024 * 1024 : 256 * 1024;
  if (file.type !== 'image/png' || file.size > max || file.size === 0) {
    problem.value = 'invalid';
    return undefined;
  }
  return file;
}

async function showPreview({ kind, asset, options, started, tenantId }: PendingPreview) {
  if (!isCurrent(started, tenantId)) return;
  const image = await api.readPublicBrandAsset({ assetId: asset.id }, options);
  if (!isCurrent(started, tenantId)) return;
  if (image.type !== 'image/png') throw new Error('BRAND_ASSET_RESPONSE_INVALID');
  const url = URL.createObjectURL(image);
  const previous = preview.value[kind];
  preview.value = { ...preview.value, [kind]: { url, reference: asset.url, width: asset.width, height: asset.height } };
  if (previous) URL.revokeObjectURL(previous.url);
}

async function upload(kind: Kind, event: Event) {
  const file = selectedFile(kind, event);
  if (!file) return;
  const started = generation;
  const tenantId = consoleState.value.snapshot?.activeContext?.tenantId;
  if (consoleState.value.status !== 'authenticated' || !tenantId) return;
  busy.value = kind;
  problem.value = undefined;
  try {
    const options = {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      redirect: 'error' as const
    };
    const asset = await api.uploadBrandAsset({ kind, body: file }, options);
    await showPreview({ kind, asset, options, started, tenantId });
  } catch (error) {
    if (started === generation) problem.value = classify(error);
  } finally {
    if (started === generation) busy.value = undefined;
  }
}
</script>

<template>
  <section :aria-label="$t('brandAssets.title')" class="border border-gray-200 rounded-12px border-solid p-20px">
    <h2 class="mb-8px text-18px font-semibold">{{ $t('brandAssets.title') }}</h2>
    <p class="mb-16px text-sm">{{ $t('brandAssets.explanation') }}</p>
    <ElAlert v-if="problem" type="error" role="alert" :closable="false" :title="$t(`brandAssets.errors.${problem}`)" />
    <div class="grid gap-16px md:grid-cols-2">
      <div
        v-for="kind in ['logo', 'favicon'] as const"
        :key="kind"
        class="border border-gray-200 rounded-8px border-solid p-16px"
      >
        <label :for="`brand-${kind}`" class="mb-8px block font-medium">{{ $t(`brandAssets.${kind}`) }}</label>
        <input
          :id="`brand-${kind}`"
          type="file"
          accept="image/png"
          :disabled="Boolean(busy)"
          @change="upload(kind, $event)"
        />
        <p class="mt-8px text-xs">{{ $t(`brandAssets.${kind}Limit`) }}</p>
        <p v-if="busy === kind" role="status">{{ $t('brandAssets.uploading') }}</p>
        <div v-if="preview[kind]" class="mt-16px rounded-8px bg-white p-12px" :aria-label="$t('brandAssets.preview')">
          <img
            :src="preview[kind]?.url"
            :alt="$t(`brandAssets.${kind}`)"
            class="max-h-160px max-w-full object-contain"
          />
          <p class="mt-8px break-all text-xs">{{ preview[kind]?.reference }}</p>
          <p class="text-xs">{{ preview[kind]?.width }} × {{ preview[kind]?.height }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
