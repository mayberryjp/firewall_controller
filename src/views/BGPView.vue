<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import { bgpNeighborSchema, bgpSchema, type BGPNeighbor } from "@/types/domain";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { interfaceChoices } from "@/services/resourceCollections";
import { formatInterfaceName } from "@/services/interfaceNames";
import { bgpPeerStatus } from "@/services/bgp";
import DatasetStatus from "@/components/base/DatasetStatus.vue";

withDefaults(defineProps<{ mode?: "process" | "peers" }>(), { mode: "process" });
const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const rows = computed(() => selected.value?.bgp?.neighbors ?? []);
const settings = ref(bgpSchema.parse({})), baseline = ref(""), settingsStart = ref(stableJson(settings.value));
const editing = ref<number | null>(null), error = ref(""), formStart = ref("");
const form = ref<BGPNeighbor>(bgpNeighborSchema.parse({ name: "", address: "", interface: "", local_address: "", remote_asn: 65002 }));
const nextHopsText = ref("");
const toggleVersions = ref<Record<string, number>>({});
const rejectionReasons: Record<string, string> = {
  as_path: "AS path rejected", next_hop_not_allowed: "Next hop not allowed",
  default_not_allowed: "Default route not allowed", invalid_prefix: "Invalid prefix", connected_route: "Connected route",
};
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value || store.bgpUnsupported);
const processStatus = computed(() => {
  const state = store.bgpStatusCurrent ? store.bgpStatus.data?.error ? "error" : store.bgpStatus.data?.state : undefined;
  const labels: Record<string, string> = { running: "Running", starting: "Starting", restarting: "Restarting", stopped: "Stopped", disabled: "Disabled", simulated: "Simulated", error: "Error" };
  return { label: state ? labels[state] ?? "Unknown" : "Unknown", color: state === "running" ? "success" : state === "error" ? "error" : "default" };
});
const settingsDirty = computed(() => stableJson(settings.value) !== settingsStart.value);
const formValue = () => stableJson({ ...form.value, allowed_next_hops: nextHopsText.value });
const formDirty = computed(() => editing.value !== null && formValue() !== formStart.value);
watch([settingsDirty, formDirty], () => { store.editorDirty = settingsDirty.value || formDirty.value; }, { flush: "sync" });
function sync(): void {
  settings.value = bgpSchema.parse(selected.value?.bgp ?? {});
  settingsStart.value = stableJson(settings.value); baseline.value = stableJson(selected.value?.bgp);
  store.editorDirty = false;
}
watch(() => selected.value?.bgp, () => { if (!settingsDirty.value && editing.value === null) sync(); }, { immediate: true });
onUnmounted(() => { store.editorDirty = false; });
const interfaces = computed(() => selected.value?.interfaces.filter(link => link.up && link.addresses.some(address => !address.includes(":"))) ?? []);
const link = computed(() => interfaces.value.find(item => item.name === form.value.interface));
const addresses = computed(() => link.value?.addresses.filter(address => !address.includes(":")).map(address => address.split("/")[0]!) ?? []);
const keys = computed(() => link.value?.kind === "wireguard" ? link.value.wireguard.peers.filter(peer => peer.enabled !== false).map(peer => peer.public_key) : []);
function changeInterface(): void {
  form.value.local_address = ""; form.value.wireguard_public_key = "";
}
function open(index: number): void {
  error.value = ""; editing.value = index;
  const row = rows.value[index];
  form.value = bgpNeighborSchema.parse(row ?? { name: "", address: "", interface: "", local_address: "", remote_asn: 65002 });
  nextHopsText.value = form.value.allowed_next_hops.join("\n");
  formStart.value = formValue();
}
function close(): void { editing.value = null; store.editorDirty = settingsDirty.value; }
function commit(peers: BGPNeighbor[]): void {
  if (blocked.value || !selected.value) throw new Error(store.readOnlyReason || (store.bgpUnsupported ? "BGP requires a supporting backend and state.read permission" : "Committed configuration is unavailable"));
  if (baseline.value !== stableJson(selected.value.bgp)) throw new Error("BGP configuration changed. Cancel and reload the editor.");
  const candidate = cloneConfig(selected.value);
  candidate.bgp = bgpSchema.parse({ ...settings.value, neighbors: peers });
  const issues = validateConfig(candidate).filter(issue => issue.path === "bgp" || issue.path.startsWith("bgp."));
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
  store.stage(candidate); close(); sync();
}
function message(failure: unknown): string {
  return failure instanceof ZodError ? failure.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(". ") : failure instanceof Error ? failure.message : "Unable to stage BGP settings";
}
function savePeer(): void {
  error.value = "";
  try {
    const peer = bgpNeighborSchema.parse({ ...form.value, allowed_next_hops: nextHopsText.value.trim() ? nextHopsText.value.trim().split(/[\s,]+/) : [], accept_default: false });
    const peers = [...rows.value];
    if (editing.value === -1) peers.push(peer);
    else if (editing.value !== null) peers[editing.value] = peer;
    else return;
    commit(peers);
  } catch (failure) { error.value = message(failure); }
}
function saveSettings(): void { error.value = ""; try { commit([...rows.value]); } catch (failure) { error.value = message(failure); } }
function remove(index: number): void { error.value = ""; try { commit(rows.value.filter((_, position) => position !== index)); } catch (failure) { error.value = message(failure); } }
function toggle(peer: BGPNeighbor, enabled: boolean): void {
  error.value = "";
  try { commit(rows.value.map(row => row.name === peer.name ? { ...row, enabled } : row)); }
  catch (failure) { error.value = message(failure); }
  toggleVersions.value[peer.name] = (toggleVersions.value[peer.name] ?? 0) + 1;
}
function cancelSettings(): void { close(); sync(); error.value = ""; }
function status(peer: BGPNeighbor) {
  const applied = (store.state.data?.active_transaction?.candidate ?? store.state.data?.desired)?.bgp;
  const currentPeer = applied?.neighbors.find(item => item.name === peer.name);
  if (stableJson(peer) !== stableJson(currentPeer) || selected.value?.bgp?.enabled !== applied?.enabled) return { label: "Not applied", color: "default", observation: undefined };
  return bgpPeerStatus(peer, applied?.enabled === true, store.bgpStatus.data, store.bgpStatusCurrent);
}
onMounted(() => { if (store.connected) void store.refreshBGPStatus(); });
</script>

<template>
  <section :aria-label="mode === 'process' ? 'BGP process' : 'BGP peers'">
    <template v-if="mode === 'process'">
      <v-chip
        size="small"
        variant="tonal"
        :color="processStatus.color"
        aria-label="BGP process status"
        role="status"
        class="mb-3"
      >
        {{ processStatus.label }}
      </v-chip>
      <div class="setting-row">
        <label
          for="bgp-enabled"
          class="setting-name"
        >BGP enabled</label>
        <v-switch
          id="bgp-enabled"
          v-model="settings.enabled"
          color="primary"
          aria-label="BGP enabled"
          :disabled="blocked"
          density="compact"
          hide-details
          class="setting-field"
        />
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="bgp-local-asn"
          class="setting-name"
        >Local ASN</label>
        <v-text-field
          id="bgp-local-asn"
          v-model.number="settings.local_asn"
          aria-label="Local ASN"
          type="number"
          density="compact"
          hide-details
          :disabled="blocked"
          class="setting-field"
        />
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="bgp-router-id"
          class="setting-name"
        >Router ID</label>
        <v-text-field
          id="bgp-router-id"
          v-model="settings.router_id"
          aria-label="Router ID"
          density="compact"
          hide-details
          :disabled="blocked"
          class="setting-field"
        />
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="bgp-keepalive"
          class="setting-name"
        >Keepalive (seconds)</label>
        <v-text-field
          id="bgp-keepalive"
          v-model.number="settings.keepalive_seconds"
          aria-label="Keepalive (seconds)"
          type="number"
          density="compact"
          hide-details
          :disabled="blocked"
          class="setting-field"
        />
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="bgp-hold"
          class="setting-name"
        >Hold (seconds)</label>
        <v-text-field
          id="bgp-hold"
          v-model.number="settings.hold_seconds"
          aria-label="Hold (seconds)"
          type="number"
          density="compact"
          hide-details
          :disabled="blocked"
          class="setting-field"
        />
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="bgp-max-prefixes"
          class="setting-name"
        >Maximum prefixes</label>
        <v-text-field
          id="bgp-max-prefixes"
          v-model.number="settings.max_prefixes"
          aria-label="Maximum prefixes"
          type="number"
          density="compact"
          hide-details
          :disabled="blocked"
          class="setting-field"
        />
      </div>
      <div class="d-flex flex-wrap ga-2 mt-4 mb-4">
        <v-btn
          color="primary"
          size="small"
          :disabled="blocked || !settingsDirty || editing !== null"
          @click="saveSettings"
        >
          Save BGP settings
        </v-btn>
        <v-btn
          v-if="settingsDirty"
          variant="text"
          size="small"
          @click="cancelSettings"
        >
          Cancel
        </v-btn>
      </div>
    </template>
    <template v-else>
      <v-btn
        class="mb-4"
        color="primary"
        prepend-icon="mdi-plus"
        :disabled="blocked || editing !== null"
        @click="open(-1)"
      >
        Add BGP peer
      </v-btn>
      <DatasetStatus
        :query="store.bgpStatus"
        label="BGP status"
      />
      <p
        v-if="store.bgpStatus.data?.error"
        role="alert"
        class="text-error mb-3"
      >
        {{ store.bgpStatus.data.error }}
      </p>
      <v-table
        v-if="editing === null"
        class="inline-table"
      >
        <thead><tr><th>Peer</th><th>Speaker address</th><th>Interface</th><th>Local address</th><th>Remote ASN</th><th>Status</th><th>Sent routes</th><th>Received routes</th><th>Rejected prefixes</th><th>Enabled</th><th>Actions</th></tr></thead>
        <tbody>
          <tr
            v-for="(peer, index) in rows"
            :key="index"
          >
            <td :title="peer.metadata?.description">
              {{ peer.metadata?.display_name || peer.name }}
            </td>
            <td>{{ peer.address }}</td><td>{{ formatInterfaceName(peer.interface) }}</td><td>{{ peer.local_address }}</td><td>{{ peer.remote_asn }}</td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="status(peer).color"
                :title="status(peer).observation?.error ?? undefined"
              >
                {{ status(peer).label }}
              </v-chip>
            </td>
            <td>{{ status(peer).observation?.advertised_prefixes ?? 'Unknown' }}</td>
            <td>{{ status(peer).observation?.received_prefixes ?? 'Unknown' }}</td>
            <td>
              {{ status(peer).observation?.rejected_prefixes ?? 'Unknown' }}
              <div
                v-if="status(peer).observation?.last_rejection"
                class="text-caption"
                title="Latest rejected prefix, not a session failure or installed route. Retained until another rejection or worker restart."
              >
                Last rejection: {{ status(peer).observation!.last_rejection!.prefix }}
                via {{ status(peer).observation!.last_rejection!.next_hop }}:
                {{ rejectionReasons[status(peer).observation!.last_rejection!.reason] ?? status(peer).observation!.last_rejection!.reason }}
              </div>
            </td>
            <td>
              <v-switch
                :key="toggleVersions[peer.name] ?? 0"
                :model-value="peer.enabled"
                :aria-label="`BGP peer enabled for ${peer.name}`"
                :title="peer.enabled ? 'Enabled' : 'Disabled'"
                :disabled="blocked"
                density="compact"
                hide-details
                color="primary"
                @update:model-value="toggle(peer, Boolean($event))"
              />
            </td>
            <td>
              <v-btn
                icon="mdi-pencil-outline"
                size="x-small"
                variant="text"
                :aria-label="`Edit BGP peer ${peer.name}`"
                :disabled="blocked || editing !== null"
                @click="open(index)"
              />
              <v-btn
                icon="mdi-delete-outline"
                size="x-small"
                variant="text"
                color="error"
                :aria-label="`Delete BGP peer ${peer.name}`"
                :disabled="blocked || editing !== null"
                @click="remove(index)"
              />
            </td>
          </tr>
          <tr v-if="!rows.length && editing === null">
            <td colspan="11">
              No BGP peers.
            </td>
          </tr>
        </tbody>
      </v-table>
      <div
        v-else
        class="peer-editor"
        role="group"
        aria-label="BGP peer editor"
      >
        <v-text-field
          v-model="form.name"
          label="Peer name"
          density="compact"
          hide-details
          :disabled="blocked"
        />
        <v-text-field
          v-model="form.address"
          label="Peer address"
          title="Remote BGP speaker's session address, not necessarily the forwarding gateway"
          density="compact"
          hide-details
          :disabled="blocked"
        />
        <v-select
          v-model="form.interface"
          :items="interfaceChoices(interfaces)"
          label="Peer interface"
          density="compact"
          hide-details
          :disabled="blocked"
          @update:model-value="changeInterface"
        />
        <div class="d-flex flex-column ga-2">
          <v-select
            v-model="form.local_address"
            :items="addresses"
            label="Local address"
            density="compact"
            hide-details
            :disabled="blocked"
          />
          <v-select
            v-if="link?.kind === 'wireguard'"
            v-model="form.wireguard_public_key"
            :items="keys"
            label="WireGuard peer"
            density="compact"
            hide-details
            :disabled="blocked"
          />
        </div>
        <v-text-field
          v-model.number="form.remote_asn"
          label="Remote ASN"
          type="number"
          density="compact"
          hide-details
          :disabled="blocked"
        />
        <div>
          <v-text-field
            v-model.number="form.multihop_ttl"
            label="Multihop TTL"
            type="number"
            min="1"
            max="255"
            density="compact"
            hide-details
            :disabled="blocked"
          />
          <p class="text-caption">
            Transmit hop budget (1-255), not inbound TTL security.
          </p>
        </div>
        <div class="peer-editor-wide">
          <v-textarea
            v-model="nextHopsText"
            label="Allowed next hops"
            rows="2"
            density="compact"
            hide-details
            :disabled="blocked"
          />
          <p class="text-caption">
            Empty: peer address only. Otherwise only listed forwarding gateways are authorized (up to 32 IPv4 addresses, separated by commas or newlines).
          </p>
          <p
            v-if="link?.kind === 'wireguard'"
            class="text-caption"
          >
            The speaker and gateways need the selected peer's static AllowedIPs coverage; gateways must not belong to another enabled peer. Gateways can be outside the local tunnel subnet; learned traffic uses the selected peer directly.
          </p>
          <p
            v-else
            class="text-caption"
          >
            Routed speakers need TTL &gt;1, listed gateways, independent bootstrap/return routes and TCP/179 permits.
          </p>
        </div>
        <div class="peer-editor-wide d-flex flex-wrap ga-2">
          <v-btn
            color="primary"
            size="small"
            :disabled="blocked"
            @click="savePeer"
          >
            Save peer
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            @click="close"
          >
            Cancel
          </v-btn>
        </div>
      </div>
    </template>
    <p
      v-if="error"
      role="alert"
      class="text-error mb-3"
    >
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
.setting-row { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start; padding: 18px 4px; }
.setting-name { padding-top: 6px; font-weight: 700; color: var(--text-primary); }
.setting-field { width: 100%; max-width: 360px; min-width: 0; }
@media (max-width: 700px) {
  .setting-row { grid-template-columns: 1fr; gap: 10px; padding: 16px 4px; }
  .setting-name { padding-top: 0; }
}
.inline-table :deep(th), .inline-table :deep(td) { padding: 2px 6px; }
.inline-table :deep(th), .inline-table :deep(td) { white-space: nowrap; }
.inline-table :deep(td) { vertical-align: top; }
.peer-editor { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
.peer-editor > * { min-width: 0; }
.peer-editor-wide { grid-column: 1 / -1; }
@media (max-width: 900px) {
  .peer-editor { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .peer-editor { grid-template-columns: minmax(0, 1fr); }
}
</style>
