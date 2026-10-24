<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import { configSchema } from "@/types/domain";
import { record } from "@/types/forms";
import { differences, stableJson } from "@/services/configuration";
import { displayResourceValue, resourceColumns } from "@/services/resourceCollections";
import type { Section } from "@/services/resourceForms";
import type { ResourceRow } from "@/composables/useResourceCollection";

const props = defineProps<{ section: Section; rows: ResourceRow[]; total: number; disabled: boolean; detail: boolean }>();
defineEmits<{ edit: [value: unknown]; delete: [row: ResourceRow]; move: [index: number, delta: number] }>();
const store = useControllerStore();
const hasChanges = computed(() => store.diff.some(item => item.area === (props.section === "policy_rules" ? "policy-rules" : props.section)));
const columns = computed(() => resourceColumns[props.section].length + 1 + Number(hasChanges.value) + Number(props.section === "softflowd") + Number(["firewall", "nat"].includes(props.section)));
function heading(key: string): string {
  const labels: Record<string, string> = { kind: "Type", up: "Admin state", mtu: "MTU", source_address: "Source address", routing_table: "Routing table" };
  return labels[key] ?? key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
}
function observedEnabled(name: unknown): string {
  const observed = configSchema.safeParse(store.state.data?.observed);
  if (!observed.success) return "Unknown";
  const service = observed.data.softflowd.find(item => item.name === name);
  return service ? (service.enabled ? "Yes" : "No") : "Unknown (not observed)";
}
function runtime(name: unknown): string {
  const status = store.runtime.data?.softflowd.find(item => item.name === name);
  if (!status) return "Unknown";
  const labels: Record<string, string> = {
    running: "Running; local responsiveness checked, delivery not verified", disabled: "Disabled", simulated: "Simulated; no real process",
    not_running: "Not running", unhealthy: "Unhealthy", exited: "Exited",
  };
  return `${labels[status.state] ?? `Unknown (${status.state})`}${status.pid ? ` · PID ${status.pid}` : ""}${status.started_at ? ` · ${status.started_at}` : ""}${status.error ? ` · ${status.error}` : ""}`;
}
function staged(value: unknown): string {
  if (!store.draft || !store.state.data) return "Committed desired";
  const changes = differences(store.state.data.desired, store.draft).filter(item => item.area === (props.section === "policy_rules" ? "policy-rules" : props.section));
  const name = record(value).name;
  return changes.some(item => name ? item.identity === name : stableJson(item.before) === stableJson(value) || stableJson(item.after) === stableJson(value)) ? "Staged change" : "Unchanged";
}
</script>

<template>
  <v-table :class="{ 'interface-table': section === 'interfaces' }">
    <thead>
      <tr>
        <th v-if="['firewall', 'nat'].includes(section)">
          Position
        </th>
        <th
          v-for="key in resourceColumns[section]"
          :key="key"
        >
          {{ heading(key) }}
        </th>
        <th v-if="section === 'softflowd'">
          Observed enabled / runtime
        </th>
        <th v-if="hasChanges">
          Changes
        </th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in rows"
        :key="row.rowID"
      >
        <td v-if="['firewall', 'nat'].includes(section)">
          {{ row.index + 1 }}
        </td>
        <td
          v-for="key in resourceColumns[section]"
          :key="key"
        >
          <router-link
            v-if="key === 'name' && ['interfaces', 'softflowd'].includes(section)"
            :to="`${section === 'softflowd' ? '/services/softflowd' : '/interfaces'}/${encodeURIComponent(String(row.value.name))}`"
          >
            {{ row.value.name }}
          </router-link>
          <template v-else>
            {{ displayResourceValue(row.value[key], key) }}
          </template>
        </td>
        <td v-if="section === 'softflowd'">
          {{ observedEnabled(row.value.name) }}<br>{{ runtime(row.value.name) }}
        </td>
        <td v-if="hasChanges">
          <span class="text-warning">{{ staged(row.value) === "Staged change" ? "Unsaved" : "" }}</span>
        </td>
        <td>
          <div class="d-flex ga-2 py-2">
            <v-btn
              icon="mdi-pencil-outline"
              aria-label="Edit / stage"
              :title="`Edit ${row.value.name ?? 'entry'}`"
              size="small"
              variant="text"
              :disabled="disabled"
              @click="$emit('edit', row.value)"
            />
            <v-btn
              :icon="row.value.kind === 'ethernet' ? 'mdi-ethernet-off' : 'mdi-delete-outline'"
              :aria-label="row.value.kind === 'ethernet' ? 'Release management' : 'Delete'"
              :title="row.value.kind === 'ethernet' ? 'Release management' : 'Delete'"
              size="small"
              color="error"
              variant="text"
              :disabled="disabled"
              @click="$emit('delete', row)"
            />
            <template v-if="['firewall', 'nat'].includes(section)">
              <v-btn
                icon="mdi-arrow-up"
                aria-label="Move up"
                title="Move up"
                variant="text"
                size="small"
                :disabled="Boolean(store.readOnlyReason) || row.index === 0"
                @click="$emit('move', row.index, -1)"
              />
              <v-btn
                icon="mdi-arrow-down"
                aria-label="Move down"
                title="Move down"
                variant="text"
                size="small"
                :disabled="Boolean(store.readOnlyReason) || row.index === total - 1"
                @click="$emit('move', row.index, 1)"
              />
            </template>
          </div>
        </td>
      </tr>
      <slot
        name="additional-rows"
        :columns="columns"
      />
      <tr v-if="!rows.length && (section !== 'interfaces' || detail)">
        <td :colspan="columns">
          {{ detail ? "Resource not found in this configuration." : "No configured resources." }}
        </td>
      </tr>
    </tbody>
  </v-table>
</template>

<style scoped>
.interface-table :deep(td) {
  vertical-align: middle;
  white-space: nowrap;
  overflow-wrap: normal;
}
.interface-table :deep(td:nth-child(6)) {
  min-width: 180px;
  white-space: normal;
}
.interface-table :deep(th) {
  white-space: nowrap;
}
</style>