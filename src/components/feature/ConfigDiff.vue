<script setup lang="ts">
import { computed } from "vue";
import { differences } from "@/services/configuration";
import type { Config } from "@/types/domain";
import JsonPanel from "@/components/base/JsonPanel.vue";
const props = defineProps<{ before: Config; after: Config }>();
const changes = computed(() => differences(props.before, props.after));
</script>
<template>
  <p
    v-if="!changes.length"
    class="my-4"
  >
    No semantic changes.
  </p>
  <p
    v-else
    class="my-4"
  >
    {{ changes.length }} changed entities · {{ changes.filter(item => item.kind === "deleted").length }} deletions.
    Counts are UI entities, not kernel operation counts.
  </p>
  <v-expansion-panels
    variant="accordion"
    class="mb-4"
  >
    <v-expansion-panel
      v-for="(item, index) in changes"
      :key="index"
    >
      <v-expansion-panel-title>
        {{ item.area }} · {{ item.kind }} · {{ item.identity }}
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <JsonPanel
          :value="item.before"
          label="Exact previous value"
        />
        <JsonPanel
          :value="item.after"
          label="Exact next value"
        />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>
