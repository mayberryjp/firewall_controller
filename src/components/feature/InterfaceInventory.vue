<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { getDiscoveredInterfaces } from "@/services/netcontrol";
import { displayResourceValue } from "@/services/resourceCollections";
import type { DiscoveredInterface } from "@/types/domain";

withDefaults(defineProps<{ columns?: number }>(), { columns: 7 });
const emit = defineEmits<{ manage: [link: DiscoveredInterface] }>();
const store = useControllerStore();
const inventory = ref<DiscoveredInterface[]>([]), loading = ref(false), error = ref("");
const managed = computed(() => new Set((store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired)?.interfaces.map(link => link.name) ?? []));
const available = computed(() => inventory.value.filter(link =>
  link.ownership === "unmanaged" && ["ethernet", "veth"].includes(link.kind) && !managed.value.has(link.name) &&
  !store.runtime.data?.parent_interfaces.some(parent => parent.name === link.name)));
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
  <tr v-if="error">
    <td
      :colspan="columns"
      role="alert"
      class="text-error"
    >
      {{ error }}
      <v-btn
        icon="mdi-refresh"
        size="small"
        variant="text"
        aria-label="Retry interface discovery"
        title="Retry interface discovery"
        :loading="loading"
        @click="refresh"
      />
    </td>
  </tr>
  <tr
    v-for="link in available"
    :key="link.name"
  >
    <td>{{ link.name }}</td>
    <td>{{ displayResourceValue(link.kind, "kind") }}</td>
    <td class="text-medium-emphasis">
      Unmanaged
    </td>
    <td>{{ link.up ? "Up" : "Down" }}</td>
    <td>{{ link.mtu }}</td>
    <td>{{ link.addresses.join(", ") || "None" }}</td>
    <td v-if="columns > 7" />
    <td>
      <v-btn
        size="small"
        prepend-icon="mdi-plus"
        :disabled="Boolean(store.readOnlyReason)"
        @click="emit('manage', link)"
      >
        Manage this interface
      </v-btn>
    </td>
  </tr>
</template>