<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { consoleRuntime } from '@/runtime/console';
import { $t } from '@/locales';

const password = ref('');
const confirmation = ref('');
const invalid = ref(false);
const heading = ref<HTMLElement>();
onMounted(() => heading.value?.focus());
onUnmounted(() => {
  password.value = '';
  confirmation.value = '';
});
async function submit() {
  invalid.value =
    password.value !== confirmation.value ||
    [...password.value.normalize('NFC')].length < 12 ||
    [...password.value.normalize('NFC')].length > 128 ||
    /\s/u.test(password.value);
  if (invalid.value) return;
  const value = password.value;
  password.value = '';
  confirmation.value = '';
  await consoleRuntime().changePassword(value);
}
</script>

<template>
  <form class="mb-24px" @submit.prevent="submit">
    <h2 ref="heading" tabindex="-1" class="mb-16px text-18px">
      {{ $t('console.changePassword') }}
    </h2>
    <p id="password-rules" class="mb-16px">{{ $t('console.passwordRules') }}</p>
    <ElFormItem :label="$t('console.newPassword')">
      <ElInput
        v-model="password"
        type="password"
        autocomplete="new-password"
        required
        :aria-label="$t('console.newPassword')"
        aria-describedby="password-rules password-error"
      />
    </ElFormItem>
    <ElFormItem :label="$t('console.confirmPassword')">
      <ElInput
        v-model="confirmation"
        type="password"
        autocomplete="new-password"
        required
        :aria-label="$t('console.confirmPassword')"
        aria-describedby="password-error"
      />
    </ElFormItem>
    <p id="password-error" role="alert" class="mb-16px">
      {{ invalid ? $t('console.passwordInvalid') : '' }}
    </p>
    <ElButton native-type="submit" type="primary" class="w-full">{{ $t('console.changePassword') }}</ElButton>
  </form>
</template>
