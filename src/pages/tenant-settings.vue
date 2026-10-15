<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import type { BrandProfileChange, BrandProfileRevision } from '@crane199709/saas-forge-api-client';
import { BrandProfileFailure } from '@/service/forge/brand-profile';
import { consoleBrandProfiles, consoleRuntime, consoleState } from '@/runtime/console';
import { releaseConsoleBrand, resolveBrandProfile, validBrand, writableBrand } from '@/runtime/console-brand';
import type { ConsoleBrand } from '@/runtime/console-brand';
import { $t } from '@/locales';
import BrandAssets from './brand-assets.vue';

const heading = useTemplateRef<HTMLElement>('heading');
const api = consoleBrandProfiles();
const empty = (): BrandProfileChange => ({
  displayName: '',
  logoUrl: '',
  faviconUrl: '',
  primaryColor: '#123456',
  accentColor: '#234567'
});
const form = ref<BrandProfileChange>(empty());
const revision = ref(0);
const status = ref<'loading' | 'ready' | 'forbidden' | 'unavailable'>('loading');
const failure = ref<'stale' | 'asset' | 'invalid' | 'unavailable'>();
const saving = ref(false);
const preview = ref<ConsoleBrand>();
const previewBusy = ref(false);
const savedAssetInvalid = ref(false);
let generation = 0;
let previewGeneration = 0;
let controller = new AbortController();

function clearPreview() {
  previewGeneration += 1;
  releaseConsoleBrand(preview.value);
  preview.value = undefined;
  previewBusy.value = false;
}

function invalidate() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  clearPreview();
  previewBusy.value = false;
  saving.value = false;
  savedAssetInvalid.value = false;
}

function applyLoaded(value: BrandProfileRevision) {
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid revision');
  revision.value = value.revision;
  form.value = {
    displayName: value.profile?.displayName ?? '',
    logoUrl: value.profile?.logoUrl ?? '',
    faviconUrl: value.profile?.faviconUrl ?? '',
    primaryColor: value.profile?.primaryColor ?? '#123456',
    accentColor: value.profile?.accentColor ?? '#234567'
  };
  status.value = 'ready';
}

async function load() {
  invalidate();
  form.value = empty();
  failure.value = undefined;
  const context = consoleState.value.snapshot?.activeContext;
  if (consoleState.value.status !== 'authenticated' || context?.type !== 'TENANT') return;
  const started = generation;
  status.value = 'loading';
  try {
    const value = await api.read(controller.signal);
    if (started !== generation) return;
    applyLoaded(value);
    if (value.profile) {
      const resolved = await resolveBrandProfile(value.profile, import.meta.env.VITE_API_ORIGIN);
      if (started !== generation) {
        releaseConsoleBrand(resolved);
        return;
      }
      savedAssetInvalid.value = !resolved;
      releaseConsoleBrand(resolved);
    }
  } catch (error) {
    if (started !== generation) return;
    status.value = error instanceof BrandProfileFailure && error.code === 'forbidden' ? 'forbidden' : 'unavailable';
  }
}

function uploaded(kind: 'logo' | 'favicon', reference: string) {
  if (status.value !== 'ready') return;
  clearPreview();
  if (kind === 'logo') form.value.logoUrl = reference;
  else form.value.faviconUrl = reference;
}

async function showPreview() {
  clearPreview();
  failure.value = undefined;
  if (!writableBrand(form.value)) {
    failure.value = 'invalid';
    return;
  }
  const started = generation;
  const previewStarted = previewGeneration;
  previewBusy.value = true;
  try {
    const resolved = await resolveBrandProfile({ ...form.value }, import.meta.env.VITE_API_ORIGIN);
    if (started !== generation || previewStarted !== previewGeneration) {
      releaseConsoleBrand(resolved);
      return;
    }
    if (!resolved) failure.value = 'asset';
    else preview.value = resolved;
  } catch {
    if (started === generation && previewStarted === previewGeneration) failure.value = 'asset';
  } finally {
    if (started === generation && previewStarted === previewGeneration) previewBusy.value = false;
  }
}

async function save() {
  if (saving.value || status.value !== 'ready') return;
  clearPreview();
  failure.value = undefined;
  if (!writableBrand(form.value)) {
    failure.value = 'invalid';
    return;
  }
  const started = generation;
  const submitted = { ...form.value };
  saving.value = true;
  try {
    const saved = await api.save(revision.value, submitted);
    if (started !== generation) return;
    if (!Number.isSafeInteger(saved.revision) || !saved.profile || !validBrand(saved.profile))
      throw new Error('Invalid authoritative profile');
    revision.value = saved.revision;
    savedAssetInvalid.value = false;
    form.value = {
      displayName: saved.profile.displayName,
      logoUrl: saved.profile.logoUrl!,
      faviconUrl: saved.profile.faviconUrl!,
      primaryColor: saved.profile.primaryColor,
      accentColor: saved.profile.accentColor
    };
    await consoleRuntime().verify();
  } catch (error) {
    if (started !== generation) return;
    failure.value = error instanceof BrandProfileFailure && error.code !== 'forbidden' ? error.code : 'unavailable';
  } finally {
    if (started === generation) saving.value = false;
  }
}

watch(() => [consoleState.value.snapshot?.sessionId, consoleState.value.snapshot?.activeContext?.membershipId], load, {
  immediate: true
});
watch(form, clearPreview, { deep: true });
onMounted(async () => {
  await nextTick();
  heading.value?.focus();
});
onBeforeUnmount(invalidate);
</script>

<template>
  <ElCard v-if="consoleState.snapshot?.activeContext?.type === 'TENANT'">
    <template #header>
      <h1 ref="heading" tabindex="-1" class="text-20px font-semibold">{{ $t('brandAssets.settings') }}</h1>
    </template>
    <section :aria-label="$t('brandProfile.title')" class="mb-20px">
      <div class="mb-12px flex items-center justify-between">
        <h2 class="text-18px font-semibold">{{ $t('brandProfile.title') }}</h2>
        <ElButton :disabled="saving" @click="load">{{ $t('brandProfile.reload') }}</ElButton>
      </div>
      <p v-if="status === 'loading'" role="status">{{ $t('brandProfile.loading') }}</p>
      <ElAlert
        v-else-if="status === 'forbidden'"
        type="warning"
        role="status"
        :closable="false"
        :title="$t('brandProfile.forbidden')"
      />
      <ElAlert
        v-else-if="status === 'unavailable'"
        type="error"
        role="alert"
        :closable="false"
        :title="$t('brandProfile.unavailable')"
      />
      <template v-else>
        <ElAlert
          v-if="savedAssetInvalid"
          class="mb-12px"
          type="warning"
          role="status"
          :closable="false"
          :title="$t('brandProfile.policyDisabled')"
        />
        <ElAlert
          v-if="failure"
          class="mb-12px"
          type="error"
          role="alert"
          :closable="false"
          :title="$t(`brandProfile.${failure}`)"
        />
        <p class="mb-12px text-sm">{{ $t('brandProfile.description') }}</p>
        <div class="grid gap-12px md:grid-cols-2">
          <label class="block">
            {{ $t('brandProfile.displayName') }}
            <ElInput v-model="form.displayName" class="mt-6px" maxlength="200" />
          </label>
          <div aria-hidden="true"></div>
          <label class="block">
            {{ $t('brandProfile.primaryColor') }}
            <ElInput v-model="form.primaryColor" class="mt-6px" maxlength="7" placeholder="#123456" />
          </label>
          <label class="block">
            {{ $t('brandProfile.accentColor') }}
            <ElInput v-model="form.accentColor" class="mt-6px" maxlength="7" placeholder="#234567" />
          </label>
        </div>
        <p class="mt-12px text-sm">{{ $t('brandProfile.logo') }}: {{ form.logoUrl || $t('brandProfile.missing') }}</p>
        <p class="text-sm">{{ $t('brandProfile.favicon') }}: {{ form.faviconUrl || $t('brandProfile.missing') }}</p>
        <div class="mt-16px flex gap-8px">
          <ElButton :loading="previewBusy" @click="showPreview">{{ $t('brandProfile.preview') }}</ElButton>
          <ElButton type="primary" :loading="saving" @click="save">{{ $t('brandProfile.save') }}</ElButton>
        </div>
        <div
          v-if="preview"
          class="mt-16px border border-gray-200 rounded-8px border-solid p-16px"
          :aria-label="$t('brandProfile.preview')"
        >
          <img :src="preview.logoUrl" alt="" class="max-h-80px max-w-full object-contain" />
          <strong class="mt-8px block">{{ preview.displayName }}</strong>
          <img :src="preview.faviconUrl" alt="" class="mt-8px size-32px object-contain" />
          <div class="mt-8px flex gap-8px">
            <span class="size-20px" :style="{ backgroundColor: preview.primaryColor }"></span>
            <span class="size-20px" :style="{ backgroundColor: preview.accentColor }"></span>
          </div>
        </div>
      </template>
    </section>
    <BrandAssets @uploaded="uploaded" />
  </ElCard>
</template>
