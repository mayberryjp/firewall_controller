<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { getDiscoveredInterfaces } from "@/services/netcontrol";
import { record } from "@/types/forms";
import type { ResourceRow } from "@/composables/useResourceCollection";
import ResourceTable from "@/components/feature/ResourceTable.vue";
import type { DiscoveredInterface } from "@/types/domain";

const props = withDefaults(defineProps<{ expandedName?: string; loopbacks?: boolean; editingRow?: number }>(), { expandedName: undefined, loopbacks: false, editingRow: undefined });
const emit = defineEmits<{ manage: [link: DiscoveredInterface]; edit: [value: unknown]; delete: [row: ResourceRow] }>();
const store = useControllerStore();
const inventory = ref<DiscoveredInterface[] | null>(null), loading = ref(false), error = ref("");
const selected = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const rows = computed<ResourceRow[]>(() => {
  const links = (inventory.value ?? []).filter(link => {
    const loopback = link.name === "lo" || link.kind === "loopback" || link.ownership === "loopback" || link.kind === "dummy";
    const vlan = link.kind === "vlan" || selected.value?.interfaces.some(item => item.name === link.name && item.kind === "vlan");
    const tunnel = link.kind === "wireguard" || selected.value?.interfaces.some(item => item.name === link.name && item.kind === "wireguard");
    return props.loopbacks ? loopback : !loopback && !vlan && !tunnel;
  });
  const result: ResourceRow[] = links.map(link => {
    const index = selected.value?.interfaces.findIndex(item => item.name === link.name) ?? -1;
    return { discovered: link, index, rowID: link.name, value: record(selected.value?.interfaces[index] ?? { name: link.name, kind: link.kind }) };
  });
  if (props.loopbacks) selected.value?.interfaces.forEach((link, index) => {
    if (link.kind === "dummy" && !links.some(discovered => discovered.name === link.name)) result.push({ index, rowID: link.name, value: record(link) });
  });
  return result;
});
let controller: AbortController | undefined;
async function refresh(): Promise<void> {
  if (loading.value) return;
  loading.value = true; error.value = "";
  controller = new AbortController();
  try { inventory.value = await getDiscoveredInterfaces(controller.signal); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Interface discovery unavailable"; }
  finally { loading.value = false; }
}
onMounted(refresh);
onUnmounted(() => controller?.abort());
defineExpose({ refresh });
</script>

<template>
  <v-progress-linear
    v-if="loading"
    indeterminate
  />
  <v-alert
    v-if="error"
    type="error"
    role="alert"
    class="mb-4"
  >
    {{ inventory === null ? 'Interface inventory unavailable.' : 'Interface inventory stale; showing last discovered interfaces.' }} {{ error }}
    <v-btn
      icon="mdi-refresh"
      size="small"
      variant="text"
      aria-label="Retry interface discovery"
      title="Retry interface discovery"
      :loading="loading"
      @click="refresh"
    />
  </v-alert>
  <ResourceTable
    v-if="inventory !== null || (loopbacks && editingRow !== undefined)"
    section="interfaces"
    :rows="rows"
    :total="rows.length"
    :disabled="Boolean(store.readOnlyReason) || loading || Boolean(error)"
    :detail="false"
    inventory
    :loopbacks="loopbacks"
    :expanded-name="expandedName"
    :editing-row="editingRow"
    @edit="emit('edit', $event)"
    @delete="emit('delete', $event)"
    @manage="emit('manage', $event)"
  >
    <template #editing-row="slotProps">
      <slot
        name="editing-row"
        v-bind="slotProps"
      />
    </template>
    <template #additional-rows="slotProps">
      <slot
        name="additional-rows"
        v-bind="slotProps"
      />
    </template>
  </ResourceTable>
</template>
