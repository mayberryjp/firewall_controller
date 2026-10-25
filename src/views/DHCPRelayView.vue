<script setup lang="ts">
import { computed, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { selectedRelayPrefix } from "@/services/configuration";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import RelayStatus from "@/components/feature/RelayStatus.vue";
import DHCPRelayEditor from "@/components/feature/DHCPRelayEditor.vue";
const store = useControllerStore();
const editing = ref<string | null>(null);
const stored = computed(() => store.draft ?? store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const names = computed(() => [...new Set([
  ...(stored.value?.interfaces.map(link => link.name) ?? []),
  ...(store.runtime.data?.dhcp_relay.map(item => item.interface) ?? []),
])].sort());
function selected(name: string): string {
  const link = stored.value?.interfaces.find(item => item.name === name);
  if (!link) return "Unknown";
  try { return selectedRelayPrefix(link) ?? "No eligible IPv4 prefix"; }
  catch (error) { return error instanceof Error ? error.message : "Invalid configured relay address"; }
}
</script>
<template>
  <section aria-label="DHCPv4 relay">
    <DatasetStatus
      :query="store.state"
      label="Stored / observed configuration"
    />
    <DatasetStatus
      :query="store.runtime"
      label="DHCP relay runtime"
    />
    <v-alert
      v-if="store.runtime.data?.error"
      type="error"
      class="mb-4"
    >
      {{ store.runtime.data.error }}
    </v-alert>
    <v-table>
      <thead><tr><th>Interface</th><th>Enabled</th><th>Servers</th><th>Relay address</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        <tr
          v-for="name in names"
          :key="name"
        >
          <td>
            <router-link :to="`/${stored?.interfaces.find(link => link.name === name)?.kind === 'vlan' ? 'vlans' : 'interfaces'}/${encodeURIComponent(name)}`">
              {{ name }}
            </router-link>
          </td>
          <td>{{ stored?.interfaces.find(link => link.name === name) ? stored.interfaces.find(link => link.name === name)!.dhcp_relay.enabled ? "Yes" : "No" : "Unknown" }}</td>
          <td class="mono">
            {{ stored?.interfaces.find(link => link.name === name)?.dhcp_relay.servers.join(", ") || "None" }}
          </td>
          <td class="mono">
            {{ selected(name) }}
          </td>
          <td><RelayStatus :status="store.runtime.data?.dhcp_relay.find(item => item.interface === name)" /></td>
          <td>
            <v-btn
              v-if="stored?.interfaces.some(link => link.name === name && link.kind !== 'wireguard')"
              icon="mdi-pencil"
              variant="text"
              size="small"
              :aria-label="`Edit DHCP relay ${name}`"
              :title="`Edit DHCP relay ${name}`"
              :disabled="Boolean(store.readOnlyReason)"
              @click="editing = name"
            />
          </td>
        </tr>
        <tr v-if="!names.length">
          <td colspan="6">
            No interface records available.
          </td>
        </tr>
      </tbody>
    </v-table>
    <DHCPRelayEditor v-model="editing" />
  </section>
</template>
