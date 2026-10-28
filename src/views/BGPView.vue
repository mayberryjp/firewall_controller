<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import { bgpNeighborSchema, bgpSchema, type BGPNeighbor } from "@/types/domain";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { interfaceChoice } from "@/services/resourceCollections";
import { bgpPeerStatus } from "@/services/bgp";
import DatasetStatus from "@/components/base/DatasetStatus.vue";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const rows = computed(() => selected.value?.bgp?.neighbors ?? []);
const settings = ref(bgpSchema.parse({})), baseline = ref(""), settingsStart = ref(stableJson(settings.value));
const editing = ref<number | null>(null), error = ref(""), formStart = ref("");
const form = ref<BGPNeighbor>({ name: "", address: "", interface: "", local_address: "", remote_asn: 65002, wireguard_public_key: "", accept_default: false });
const displayName = ref(""), description = ref("");
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value || store.bgpUnsupported);
const settingsDirty = computed(() => stableJson(settings.value) !== settingsStart.value);
const formValue = () => stableJson([form.value, displayName.value, description.value]);
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
function changeInterface(): void { form.value.local_address = ""; form.value.wireguard_public_key = ""; }
function open(index: number): void {
  error.value = ""; editing.value = index;
  const row = rows.value[index];
  form.value = row ? { ...row } : { name: "", address: "", interface: "", local_address: "", remote_asn: 65002, wireguard_public_key: "", accept_default: false };
  displayName.value = row?.metadata?.display_name ?? ""; description.value = row?.metadata?.description ?? "";
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
    const peer = bgpNeighborSchema.parse({ ...form.value, metadata: { display_name: displayName.value, description: description.value } });
    const peers = [...rows.value];
    if (editing.value === -1) peers.push(peer);
    else if (editing.value !== null) peers[editing.value] = peer;
    else return;
    commit(peers);
  } catch (failure) { error.value = message(failure); }
}
function saveSettings(): void { error.value = ""; try { commit([...rows.value]); } catch (failure) { error.value = message(failure); } }
function remove(index: number): void { error.value = ""; try { commit(rows.value.filter((_, position) => position !== index)); } catch (failure) { error.value = message(failure); } }
function cancelSettings(): void { close(); sync(); error.value = ""; }
function status(peer: BGPNeighbor) {
  const applied = (store.state.data?.active_transaction?.candidate ?? store.state.data?.desired)?.bgp;
  const currentPeer = applied?.neighbors.find(item => item.name === peer.name);
  if (stableJson(peer) !== stableJson(currentPeer) || selected.value?.bgp?.enabled !== applied?.enabled) return { label: "Not applied", color: "default", observation: undefined };
  return bgpPeerStatus(peer, applied?.enabled === true, store.bgpStatus.data, store.bgpStatusCurrent);
}
onMounted(() => { if (store.connected) { void store.refreshBGPStatus(); void store.refreshBGPRoutes(); } });
</script>

<template>
  <section aria-label="BGP">
    <div class="bgp-settings mb-4">
      <v-switch
        v-model="settings.enabled"
        label="BGP enabled"
        :disabled="blocked"
        hide-details
      />
      <v-text-field
        v-model.number="settings.local_asn"
        label="Local ASN"
        type="number"
        density="compact"
        hide-details
        :disabled="blocked"
      />
      <v-text-field
        v-model="settings.router_id"
        label="Router ID"
        density="compact"
        hide-details
        :disabled="blocked"
      />
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
    <details class="mb-4">
      <summary>Options</summary>
      <div class="bgp-settings mt-3">
        <v-text-field
          v-model.number="settings.keepalive_seconds"
          label="Keepalive (seconds)"
          type="number"
          :disabled="blocked"
        />
        <v-text-field
          v-model.number="settings.hold_seconds"
          label="Hold (seconds)"
          type="number"
          :disabled="blocked"
        />
        <v-text-field
          v-model.number="settings.max_prefixes"
          label="Maximum prefixes"
          type="number"
          :disabled="blocked"
        />
      </div>
    </details>
    <v-btn
      class="mb-4"
      color="primary"
      prepend-icon="mdi-plus"
      :disabled="blocked || editing !== null"
      @click="open(-1)"
    >
      Add BGP peer
    </v-btn>
    <p
      v-if="error"
      role="alert"
      class="text-error mb-3"
    >
      {{ error }}
    </p>
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
    <v-table class="inline-table">
      <thead><tr><th>Peer</th><th>Address</th><th>Interface</th><th>Local address</th><th>Remote ASN</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        <template
          v-for="(peer, index) in [...rows, ...(editing === -1 ? [null] : [])]"
          :key="index"
        >
          <tr v-if="editing === index || editing === -1 && index === rows.length">
            <td>
              <v-text-field
                v-model="form.name"
                label="Peer name"
                density="compact"
                hide-details
                :disabled="blocked"
              />
            </td>
            <td>
              <v-text-field
                v-model="form.address"
                label="Peer address"
                density="compact"
                hide-details
                :disabled="blocked"
              />
            </td>
            <td>
              <v-select
                v-model="form.interface"
                :items="interfaces.map(interfaceChoice)"
                label="Peer interface"
                density="compact"
                hide-details
                :disabled="blocked"
                @update:model-value="changeInterface"
              />
            </td>
            <td>
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
            </td>
            <td>
              <v-text-field
                v-model.number="form.remote_asn"
                label="Remote ASN"
                type="number"
                density="compact"
                hide-details
                :disabled="blocked"
              />
            </td>
            <td>
              <v-switch
                v-model="form.accept_default"
                label="Accept default route"
                :disabled="blocked"
                hide-details
              />
              <p
                v-if="form.accept_default"
                class="text-caption"
              >
                Allows this peer to supply a default route. Does not advertise a default.
              </p>
              <details>
                <summary>Labels</summary><v-text-field
                  v-model="displayName"
                  label="Display name"
                  :disabled="blocked"
                /><v-textarea
                  v-model="description"
                  label="Description"
                  :disabled="blocked"
                />
              </details>
            </td>
            <td>
              <v-btn
                color="primary"
                size="small"
                :disabled="blocked"
                @click="savePeer"
              >
                Save peer
              </v-btn><v-btn
                variant="text"
                size="small"
                @click="close"
              >
                Cancel
              </v-btn>
            </td>
          </tr>
          <tr v-else-if="peer">
            <td :title="peer.metadata?.description">
              {{ peer.metadata?.display_name || peer.name }}
            </td>
            <td>{{ peer.address }}</td><td>{{ peer.interface }}</td><td>{{ peer.local_address }}</td><td>{{ peer.remote_asn }}</td>
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
        </template>
        <tr v-if="!rows.length && editing === null">
          <td colspan="7">
            No BGP peers.
          </td>
        </tr>
      </tbody>
    </v-table>
    <h2 class="text-subtitle-1 mt-6 mb-3">
      BGP routes
    </h2>
    <DatasetStatus
      :query="store.bgpRoutes"
      label="BGP routes"
    />
    <p
      v-if="store.bgpRoutes.data?.error"
      role="alert"
      class="text-error mb-3"
    >
      {{ store.bgpRoutes.data.error }}
    </p>
    <v-table class="inline-table">
      <thead><tr><th>Prefix</th><th>Peer</th><th>Interface</th><th>Next hop</th><th>AS path</th><th>Selected</th><th>Installed</th><th>Reason</th></tr></thead>
      <tbody>
        <tr
          v-for="(route, index) in store.bgpRoutes.data?.routes ?? []"
          :key="`${route.prefix}/${route.neighbor}/${index}`"
        >
          <td>{{ route.prefix }}</td><td>{{ route.neighbor }}</td><td>{{ route.interface }}</td><td>{{ route.next_hop }}</td><td>{{ route.as_path.join(' ') || 'None' }}</td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="!store.bgpRoutesCurrent ? 'default' : route.selected ? 'success' : 'default'"
            >
              {{ store.bgpRoutesCurrent ? route.selected ? 'Yes' : 'No' : 'Unknown' }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="!store.bgpRoutesCurrent ? 'default' : route.installed ? 'success' : route.selected ? 'warning' : 'default'"
            >
              {{ store.bgpRoutesCurrent ? route.installed ? 'Yes' : 'No' : 'Unknown' }}
            </v-chip>
          </td>
          <td>{{ route.error || route.reason || 'None' }}</td>
        </tr>
        <tr v-if="!store.bgpRoutes.data?.routes.length">
          <td colspan="8">
            {{ store.bgpRoutes.data ? 'No learned BGP routes.' : 'BGP routes unavailable.' }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
.bgp-settings { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.bgp-settings :deep(.v-input) { min-width: 160px; max-width: 260px; }
.inline-table :deep(th), .inline-table :deep(td) { padding: 2px 6px; }
.inline-table :deep(.v-input) { min-width: 140px; }
.inline-table :deep(td) { vertical-align: top; }
</style>
