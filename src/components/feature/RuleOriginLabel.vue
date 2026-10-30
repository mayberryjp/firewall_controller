<script setup lang="ts">
import { ruleOwnershipLabel } from "@/services/ruleOwnership";
defineProps<{ rule: unknown; inherited?: boolean }>();
</script>
<template>
  <span class="rule-origin text-caption">{{ inherited ? `Inherited · ${ruleOwnershipLabel(rule)}` : ruleOwnershipLabel(rule) }}</span>
</template>
<style scoped>
.rule-origin { overflow-wrap: anywhere; }
</style>
