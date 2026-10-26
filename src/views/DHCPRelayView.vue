<script setup lang="ts">
import { computed, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, validateConfig } from "@/services/configuration";
import { dhcpRelaySchema } from "@/types/domain";
import DatasetStatus from "@/components/base/DatasetStatus.vue";

const store = useControllerStore();
const stored = computed(() => store.draft ?? store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const links = computed(() => (stored.value?.interfaces ?? []).filter(link => link.kind !== "wireguard").sort((a, b) => a.name.localeCompare(b.name)));
const blocked = computed(() => Boolean(store.readOnlyReason) || !stored.value);
const editing = ref<string | null>(null), servers = ref(""), error = ref("");
const runtimeError = (name: string) => store.runtime.data?.dhcp_relay.find(item => item.interface === name)?.error;

function commit(name: string, mutate: (relay: { enabled: boolean; servers: string[] }) => void): void {
  if (!stored.value) throw new Error("Committed configuration is unavailable.");
  const candidate = cloneConfig(stored.value), index = candidate.interfaces.findIndex(link => link.name === name);
  const entry = candidate.interfaces[index];
  if (!entry) throw new Error("Interface unavailable");
  const relay = { ...entry.dhcp_relay };
  mutate(relay);
  entry.dhcp_relay = dhcpRelaySchema.parse(relay);
  const base = `interfaces.${index}.dhcp_relay`;
  const issues = validateConfig(candidate).filter(issue => issue.path === base || issue.path.startsWith(`${base}.`) || issue.path === `dhcp_clients.${name}`);
  if (issues.length) throw new Error([...new Set(issues.map(issue => issue.message))].join(". "));
  store.stage(candidate);
}
function attempt(action: () => void, fallback: string): void {
  error.value = "";
  try { action(); } catch (cause) { error.value = cause instanceof Error ? cause.message : fallback; }
}
function edit(name: string): void {
  error.value = ""; editing.value = name;
  servers.value = links.value.find(link => link.name === name)?.dhcp_relay.servers.join(", ") ?? "";
}
function save(): void {
  const name = editing.value;
  if (!name) return;
  attempt(() => {
    commit(name, relay => { relay.servers = servers.value.split(/[\s,]+/).filter(Boolean); });
    editing.value = null;
  }, "Unable to stage DHCP relay");
}
function toggle(name: string, enabled: boolean): void {
  attempt(() => commit(name, relay => { relay.enabled = enabled; }), "Unable to stage DHCP relay");
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
    <v-alert
      v-if="error"
      type="error"
      role="alert"
      class="mb-4"
    >
      {{ error }}
    </v-alert>
    <v-table class="relay-table">
      <thead>
        <tr>
          <th>Interface</th>
          <th>Servers</th>
          <th>Status</th>
          <th class="column-actions">
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="link in links"
          :key="link.name"
        >
          <td>{{ link.name }}</td>
          <td v-if="editing === link.name">
            <v-text-field
              v-model="servers"
              aria-label="DHCPv4 relay servers"
              placeholder="198.51.100.10, 198.51.100.20"
              density="compact"
              hide-details
              autofocus
              @keydown.enter.prevent="save"
            />
          </td>
          <td
            v-else
            class="mono"
          >
            {{ link.dhcp_relay.servers.join(", ") || "None" }}
            <span
              v-if="runtimeError(link.name)"
              role="alert"
              class="text-error"
            > · {{ runtimeError(link.name) }}</span>
          </td>
          <td>
            <v-switch
              :model-value="link.dhcp_relay.enabled"
              :aria-label="`Relay enabled for ${link.name}`"
              :title="link.dhcp_relay.enabled ? 'Enabled' : 'Disabled'"
              :disabled="blocked"
              color="primary"
              density="compact"
              hide-details
              @update:model-value="toggle(link.name, Boolean($event))"
            />
          </td>
          <td>
            <template v-if="editing === link.name">
              <v-btn
                color="primary"
                size="small"
                :disabled="blocked"
                @click="save"
              >
                Save
              </v-btn>
              <v-btn
                variant="text"
                size="small"
                @click="editing = null; error = ''"
              >
                Cancel
              </v-btn>
            </template>
            <v-btn
              v-else
              icon="mdi-pencil-outline"
              variant="text"
              size="x-small"
              :aria-label="`Edit DHCP relay ${link.name}`"
              :title="`Edit DHCP relay ${link.name}`"
              :disabled="blocked"
              @click="edit(link.name)"
            />
          </td>
        </tr>
        <tr v-if="!links.length">
          <td colspan="4">
            No interface records available.
          </td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
.relay-table :deep(.column-actions) { width: 160px; }
</style>
