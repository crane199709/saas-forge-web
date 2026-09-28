<script setup lang="ts">
import { ref } from 'vue';
import type { RemoteDisplayHost } from '../host';

defineOptions({ name: 'RemoteConsumerFixture' });
const props = defineProps<{ host: RemoteDisplayHost }>();
const name = ref('Remote');
const submitted = ref<string>();
</script>

<template>
  <section data-testid="brand-remote" class="space-y-16px">
    <h3 class="text-18px font-semibold">{{ props.host.text('title') }}</h3>
    <p>{{ props.host.text('brand') }}: {{ props.host.brandName }}</p>
    <ElCard shadow="never">
      <ElForm
        :aria-label="props.host.text('form')"
        label-position="top"
        @submit.prevent="submitted = name.trim() || 'Remote'"
      >
        <ElFormItem :label="props.host.text('name')">
          <ElInput v-model="name" :aria-label="props.host.text('name')" />
        </ElFormItem>
        <ElButton native-type="submit" type="primary">{{ props.host.text('submit') }}</ElButton>
      </ElForm>
      <ElAlert
        v-if="submitted"
        class="mt-16px"
        :title="props.host.text('success', { name: submitted })"
        type="success"
        :closable="false"
        role="status"
      />
    </ElCard>
    <dl class="grid gap-8px break-all">
      <dt>{{ props.host.text('number') }}</dt>
      <dd>{{ props.host.number('123456789012345678901234567890.0012300') }}</dd>
      <dt>{{ props.host.text('money') }}</dt>
      <dd>{{ props.host.money('12345678901234567890.400', 'USD') }}</dd>
      <dt>{{ props.host.text('date') }}</dt>
      <dd>{{ props.host.date('2026-01-02') }}</dd>
      <dt>{{ props.host.text('instant') }}</dt>
      <dd>{{ props.host.instant('2026-01-02T01:30:00Z') }}</dd>
    </dl>
  </section>
</template>
