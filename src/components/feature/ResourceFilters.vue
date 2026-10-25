<script setup lang="ts">
import type { ResourceFilters } from "@/composables/useResourceCollection";
import type { Section } from "@/services/resourceForms";
import { displayResourceValue } from "@/services/resourceCollections";
import { watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import type { Choice } from "@/types/forms";
defineProps<{ section: Section; interfaces: Choice[] }>();
const filters = defineModel<ResourceFilters>({ required: true });
const store = useControllerStore();
watch(() => store.ipv6Enabled, enabled => {
  if (!enabled && filters.value.family === "ipv6") filters.value.family = "All";
}, { immediate: true });
</script>

<template>
  <div class="filter-grid">
    <v-text-field
      v-model="filters.search"
      label="Filter text"
      clearable
    />
    <template v-if="section === 'interfaces'">
      <v-select
        v-model="filters.kind"
        :items="['All', 'ethernet', 'dummy', 'vlan', 'wireguard'].map(value => ({ title: value === 'All' ? value : displayResourceValue(value, 'kind'), value }))"
        label="Kind"
      />
      <v-select
        v-model="filters.role"
        :items="['All', 'WAN', 'LAN', 'Unassigned']"
        label="Role"
      />
      <v-select
        v-model="filters.admin"
        :items="['All', 'Up', 'Down']"
        label="Administrative state"
      />
    </template>
    <template v-if="section === 'routes'">
      <v-select
        v-model="filters.enabled"
        :items="['All', 'Enabled', 'Disabled']"
        label="Status"
      />
      <v-select
        v-model="filters.interface"
        :items="[{ title: 'All', value: 'All' }, ...interfaces]"
        label="Interface"
      />
      <v-select
        v-if="store.ipv6Enabled"
        v-model="filters.family"
        :items="['All', 'ipv4', 'ipv6']"
        label="Family"
      />
      <v-text-field
        v-model="filters.table"
        label="Table"
        type="number"
      />
    </template>
  </div>
</template>