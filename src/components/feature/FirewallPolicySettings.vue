<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, policyHostAddress } from "@/services/configuration";
import type { Config } from "@/types/domain";
import { getSandoDevices, type SandoDevice } from "@/services/sando";
import DeviceIcon from "@/components/base/DeviceIcon.vue";
import FirewallRuleTable from "@/components/feature/FirewallRuleTable.vue";
import FirewallCounterOverview from "@/components/feature/FirewallCounterOverview.vue";

const props = defineProps<{ selectedConfig?: Config; showDraft: boolean }>();
const emit = defineEmits<{ staged: []; error: [message: string] }>();
const store = useControllerStore();
const editingConfig = computed(() => props.selectedConfig);
const policyMode = computed(() => Boolean(editingConfig.value?.firewall.policies));
const hosts = computed(() => editingConfig.value?.firewall.policies?.hosts ?? []);
const devices = ref<SandoDevice[]>([]);
const inventoryError = ref("");
const search = ref("");
const addingHost = ref(false);
const hostAddress = ref("");
const hostAction = ref<"accept" | "drop">("drop");
const hostError = ref("");
const hostEditingBlocked = computed(() => !editingConfig.value || Boolean(store.readOnlyReason));
watch([hostAddress, hostAction], () => {
  if (addingHost.value) store.editorDirty = Boolean(hostAddress.value || hostAction.value !== "drop");
});
onUnmounted(() => { if (addingHost.value) store.editorDirty = false; });
function openHost(): void {
  if (hostEditingBlocked.value || store.editorDirty) return;
  hostAddress.value = ""; hostAction.value = "drop"; hostError.value = "";
  addingHost.value = true;
}
function cancelHost(): void {
  addingHost.value = false; store.editorDirty = false; hostError.value = "";
}
function stageHost(): void {
  hostError.value = "";
  try {
    if (hostEditingBlocked.value || !editingConfig.value) throw new Error(store.readOnlyReason || "Configuration unavailable.");
    const address = hostAddress.value.trim();
    const parsed = policyHostAddress(address);
    if (editingConfig.value.ipv6_enabled === false && parsed.kind() === "ipv6") throw new Error("IPv6 is disabled.");
    const candidate = cloneConfig(editingConfig.value);
    const policies = candidate.firewall.policies;
    if (!policies) throw new Error("Host policies are no longer available.");
    if (policies.hosts.length >= 128) throw new Error("At most 128 hosts.");
    if (policies.hosts.some(host => host.addresses.includes(address))) throw new Error("This IP address already belongs to a host.");
    if (policies.hosts.some(host => host.name === address)) throw new Error("A host with this name already exists.");
    const baseID = `host_${address.replace(/[:.]/g, "_")}`;
    let id = baseID;
    for (let suffix = 2; policies.hosts.some(host => host.id === id); suffix++) id = `${baseID}_${suffix}`;
    policies.hosts.push({ id, name: address, addresses: [address], policy: hostAction.value, rules: [] });
    store.stage(candidate);
    selectedHostID.value = id; search.value = "";
    cancelHost(); emit("staged");
  } catch (error) {
    hostError.value = error instanceof Error ? error.message : "Unable to stage host.";
  }
}
const committedSando = computed(() => store.state.data?.desired.sando);
watch([() => policyMode.value && committedSando.value?.sync_enabled ? committedSando.value.api_url : "", () => store.sessionVersion], async ([endpoint], _, onCleanup) => {
  devices.value = []; inventoryError.value = "";
  if (!endpoint) return;
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  try {
    const inventory = await getSandoDevices(endpoint, controller.signal);
    if (!controller.signal.aborted) devices.value = inventory;
  } catch (error) {
    if (!controller.signal.aborted) inventoryError.value = error instanceof Error ? error.message : "Unable to load host descriptions from Sando.";
  }
}, { immediate: true });
const hostOptions = computed(() => hosts.value.map(host => {
  const device = devices.value.find(device => host.addresses.includes(device.ip_address) || Boolean(device.ip6_address && host.addresses.includes(device.ip6_address)));
  const name = (device?.local_description?.trim() || host.metadata?.display_name || host.name).toUpperCase();
  const address = host.addresses.join(", ").toUpperCase();
  const type = (typeof device?.device_type === "string" ? device.device_type : device?.icon || "").toUpperCase();
  return { id: host.id, name, title: `${name} (${address})`, type, icon: device?.icon, score: device?.threat_score };
}).sort((a, b) => a.name.localeCompare(b.name) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)));
const filteredHosts = computed(() => {
  const query = (search.value ?? "").trim().toUpperCase();
  return hostOptions.value.filter(host => `${host.title} ${host.type}`.includes(query));
});
const selectedHostID = ref("");
const selectedHost = computed(() => hosts.value.find(host => host.id === selectedHostID.value));
const selectedHostTitle = computed(() => hostOptions.value.find(host => host.id === selectedHostID.value)?.title);
watch(() => hostOptions.value.map(host => host.id), ids => {
  if (!ids.includes(selectedHostID.value)) selectedHostID.value = ids[0] ?? "";
}, { immediate: true });
const policy = ref<"accept" | "drop">("accept");
watch(() => editingConfig.value?.firewall.policy, value => { if (value) policy.value = value; }, { immediate: true });
function stage(): void {
  if (!editingConfig.value) return;
  try {
    const candidate = cloneConfig(editingConfig.value);
    candidate.firewall.policy = policy.value;
    store.stage(candidate); emit("staged");
  } catch (error) { emit("error", error instanceof Error ? error.message : "Unable to stage firewall setting"); }
}
</script>

<template>
  <div
    v-if="policyMode"
    class="host-policy-layout"
  >
    <nav
      class="host-navigation"
      aria-label="Hosts"
    >
      <h1 class="text-subtitle-1 font-weight-bold host-list-heading">
        PROTECTED HOSTS
      </h1>
      <div class="search-container pa-3">
        <v-text-field
          v-model="search"
          aria-label="Search hosts"
          placeholder="Search hosts..."
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          class="search-field"
          @click:clear="search = ''"
        />
      </div>
      <p v-if="!hosts.length">
        No hosts with policies.
      </p>
      <p v-else-if="!filteredHosts.length">
        No matching hosts.
      </p>
      <ul class="host-list">
        <li
          v-for="host in filteredHosts"
          :key="host.id"
        >
          <button
            type="button"
            class="host-link host-list-item"
            :class="{ 'host-link--selected': selectedHostID === host.id }"
            :aria-current="selectedHostID === host.id ? 'true' : undefined"
            :aria-label="host.title"
            :title="host.title"
            :disabled="store.editorDirty || addingHost"
            @click="selectedHostID = host.id"
          >
            <span class="icon-container">
              <DeviceIcon
                :name="host.icon"
                :score="host.score"
              />
            </span>
            <span class="host-info">{{ host.name }}</span>
          </button>
        </li>
        <li
          v-if="addingHost"
          class="host-add-row pa-3"
        >
          <form
            aria-label="Add forwarding host"
            @submit.prevent="stageHost"
          >
            <v-text-field
              v-model="hostAddress"
              label="IP address"
              placeholder="192.0.2.10"
              variant="outlined"
              density="compact"
              :disabled="hostEditingBlocked"
              hide-details
              autofocus
            />
            <v-select
              v-model="hostAction"
              label="Default action"
              :items="['drop', 'accept']"
              variant="outlined"
              density="compact"
              :disabled="hostEditingBlocked"
              hide-details
              class="mt-3"
            />
            <v-alert
              v-if="hostError"
              type="error"
              variant="tonal"
              role="alert"
              class="mt-3"
            >
              {{ hostError }}
            </v-alert>
            <div class="d-flex flex-wrap ga-2 mt-3">
              <v-btn
                type="submit"
                color="primary"
                :disabled="hostEditingBlocked"
              >
                Add
              </v-btn>
              <v-btn
                variant="text"
                @click="cancelHost"
              >
                Cancel
              </v-btn>
            </div>
          </form>
        </li>
      </ul>
      <div
        v-if="!addingHost"
        class="pa-3"
      >
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          block
          :disabled="hostEditingBlocked || store.editorDirty"
          @click="openHost"
        >
          Add host
        </v-btn>
      </div>
    </nav>
    <div class="host-policy-content">
      <v-alert
        v-if="inventoryError"
        type="warning"
        variant="tonal"
        class="mb-4"
      >
        {{ inventoryError }} Showing configured host names.
      </v-alert>
      <h2
        v-if="selectedHost"
        class="text-subtitle-1 font-weight-bold mb-3 host-heading"
      >
        {{ selectedHostTitle }}
      </h2>
      <FirewallRuleTable
        v-if="selectedHost && !addingHost"
        :key="selectedHost.id"
        scope="host"
        :owner="selectedHost.id"
      />
      <FirewallCounterOverview
        v-else-if="!selectedHost"
        chain="forward"
      />
    </div>
  </div>
  <template v-else>
    <div class="d-flex flex-wrap ga-3 align-center mb-4">
      <v-select
        v-model="policy"
        label="Default policy"
        :items="['accept', 'drop']"
        hide-details
      />
      <v-btn
        :disabled="Boolean(store.readOnlyReason)"
        @click="stage"
      >
        Save
      </v-btn>
    </div>
    <v-alert
      v-if="selectedConfig?.firewall.policy === 'drop' || selectedConfig?.firewall.rules.some(item => !item.source && !item.destination)"
      type="warning"
      class="mb-4"
    >
      Default drop or catch-all rules may block access. Review the rules before applying.
    </v-alert>
  </template>
</template>

<style scoped>
.host-policy-layout { display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr); gap: 24px; }
.host-navigation { min-width: 0; min-height: 0; overflow-y: auto; border-radius: 8px; background-color: #0d1117; }
.host-list-heading { padding: 12px 12px 0; }
.search-container { position: sticky; top: 0; z-index: 1; background-color: #0d1117; }
.search-field { background-color: #161b22; }
.search-field :deep(.v-field__input) { color: #b1b8c0; }
.search-field :deep(.v-field__outline) { opacity: 0.3; }
.host-list { list-style: none; padding: 8px 0; }
.host-navigation { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.1) transparent; }
.host-navigation::-webkit-scrollbar { width: 6px; height: 6px; }
.host-navigation::-webkit-scrollbar-track { background: transparent; }
.host-navigation::-webkit-scrollbar-thumb { background-color: rgba(255, 255, 255, 0.1); border-radius: 3px; border: none; }
.host-link { display: flex; align-items: center; width: 100%; min-height: 48px; text-align: left; }
.host-list-item { margin-bottom: 8px; padding: 8px 16px; color: #b1b8c0; text-transform: uppercase; font-size: 16px; line-height: 24px; transition: background-color 0.2s ease; }
.host-link:hover { background-color: rgba(177, 184, 192, 0.04); }
.host-list-item.host-link--selected { background-color: rgba(66, 165, 245, 0.2); border-left: 3px solid #42a5f5; }
.host-link:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.icon-container { display: flex; align-items: center; justify-content: center; width: 40px; min-width: 40px; }
.host-info { flex-grow: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 0; margin-left: 0; }
.host-policy-content { min-width: 0; }
.host-heading { overflow-wrap: anywhere; }
@media (min-width: 900px) {
  .host-policy-layout { flex: 1; min-height: 0; grid-template-rows: minmax(0, 1fr); }
  .host-policy-content { min-height: 0; overflow-y: auto; }
}
@media (max-width: 899px) {
  .host-policy-layout { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .host-navigation { max-height: 340px; }
}
</style>
