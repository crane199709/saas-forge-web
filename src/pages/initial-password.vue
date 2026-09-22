<script setup lang="ts">
import { consoleRuntime } from '@/runtime/console';
import PasswordForm from './password-form.vue';
</script>

<template>
  <PasswordForm :submit-password="password => consoleRuntime().changePassword(password)" />
</template>
