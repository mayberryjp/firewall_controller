<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import { configSchema } from "@/types/domain";
import { selectedRelayPrefix } from "@/services/configuration";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import RelayStatus from "@/components/feature/RelayStatus.vue";
import ServiceRepair from "@/components/feature/ServiceRepair.vue";
const store = useControllerStore();
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const observed = computed(() => configSchema.safeParse(store.state.data?.observed));
const names = computed(() => [...new Set([
  ...(stored.value?.interfaces.map(link => link.name) ?? []),
  ...(store.runtime.data?.dhcp_relay.map(item => item.interface) ?? []),
])].sort());
function observedEnabled(name: string): string {
  const link = observed.value.success ? observed.value.data.interfaces.find(item => item.name === name) : undefined;
  return link ? link.dhcp_relay.enabled ? "Yes" : "No" : "Unknown";
}
function selected(name: string): string {
  const link = stored.value?.interfaces.find(item => item.name === name);
  if (!link) return "Unknown";
  try { return selectedRelayPrefix(link) ?? "No eligible IPv4 prefix"; }
  catch (error) { return error instanceof Error ? error.message : "Invalid configured relay address"; }
}
</script>
<template>
  <section>
    <h1 class="text-h4 mb-4">
      DHCPv4 relay
    </h1>
    <p class="mb-4">
      Configure relay under each managed interface. This screen shows stored committed/pending settings, not the local draft. Failed observation never overwrites desired enabled settings.
    </p>
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
    <v-alert
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      All enabled interfaces share one dnsmasq process/PID. Server, selected-address or enabled-interface-set changes may restart it and briefly disrupt relay on other interfaces.
      Running verifies local process/socket readiness only, not lease delivery or upstream reachability.
    </v-alert>
    <ServiceRepair service="dhcp-relay" />
    <v-table>
      <thead><tr><th>Interface / role</th><th>Stored enabled</th><th>All upstream servers</th><th>Selected relay address / subnet</th><th>Observed enabled</th><th>Runtime</th></tr></thead>
      <tbody>
        <tr
          v-for="name in names"
          :key="name"
        >
          <td>
            <router-link :to="`/interfaces/${encodeURIComponent(name)}`">
              {{ name }}
            </router-link> · {{ stored?.interfaces.find(link => link.name === name)?.role.toUpperCase() ?? "Unknown" }}
          </td>
          <td>{{ stored?.interfaces.find(link => link.name === name)?.dhcp_relay.enabled ?? "Unknown" }}</td>
          <td class="mono">
            {{ stored?.interfaces.find(link => link.name === name)?.dhcp_relay.servers.join(", ") || "None" }}
          </td>
          <td class="mono">
            {{ selected(name) }}
          </td>
          <td>{{ observedEnabled(name) }}</td>
          <td><RelayStatus :status="store.runtime.data?.dhcp_relay.find(item => item.interface === name)" /></td>
        </tr>
        <tr v-if="!names.length">
          <td colspan="6">
            No interface records available.
          </td>
        </tr>
      </tbody>
    </v-table>
    <h2 class="text-h6 mt-6 mb-3">
      Operator prerequisites
    </h2>
    <p>Install trusted relay-capable dnsmasq and configure backend flags -dhcp-relay-binary, -dhcp-relay-runtime-dir, -dhcp-relay-uid and -dhcp-relay-gid. The service account/group must exist and be non-root. The binary/runtime must meet the backend's root-ownership and namespace/procfs privilege requirements.</p>
    <p class="mt-3">
      Do not run another DHCP service on UDP 67 in the managed namespace. Upstream routes, server return paths and UDP 67/68 firewall permissions are operator responsibilities. No DHCP server, DHCPv6, DNS, automatic routes/NAT/firewall rules, package installation or identity editing is provided here. WAN/LAN roles do not select upstream links or restrict relay enablement.
    </p>
  </section>
</template>
