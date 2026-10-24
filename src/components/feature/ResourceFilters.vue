<script setup lang="ts">
import type { ResourceFilters } from "@/composables/useResourceCollection";
import type { Section } from "@/services/resourceForms";
defineProps<{ section: Section; interfaces: string[] }>();
const filters = defineModel<ResourceFilters>({ required: true });
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
        :items="['All', 'ethernet', 'dummy', 'vlan', 'wireguard']"
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
        v-model="filters.interface"
        :items="['All', ...interfaces]"
        label="Interface"
      />
      <v-select
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