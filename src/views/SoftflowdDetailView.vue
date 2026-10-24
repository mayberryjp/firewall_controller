<script setup lang="ts">
import ResourcePage from "@/components/feature/ResourcePage.vue";
defineProps<{ name: string }>();
</script>
<template>
  <ResourcePage
    section="softflowd"
    :name="name"
  />
</template>