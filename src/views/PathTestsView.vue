<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { useTimestamps } from "@/composables/useTimestamps";
import { generatePairingSecret, pathAddresses, pathTestRequestSchema, validatePathInterfaces } from "@/services/pathTests";
import PathTestResults from "@/components/feature/PathTestResults.vue";

const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const selected = ref(""), source = ref(""), peer = ref(""), port = ref("49872"), maximum = ref("");
const secret = ref(""), approved = ref(false), error = ref("");
const copied = ref(false);
const parents = ref<Array<{ interface: string; maximum: string; approved: boolean }>>([]);
const links = computed(() => store.pathInterfaces.data ?? []);
const eligible = computed(() => links.value.filter(link => pathAddresses(link).length).map(link => link.name));
const local = computed(() => links.value.find(link => link.name === selected.value));
const sources = computed(() => local.value ? pathAddresses(local.value) : []);
const status = computed(() => store.pathTests.data);
const frozen = computed(() => Boolean(store.operationBlockedReason));
const initialLoading = computed(() => !store.pathTests.data && !store.pathTests.error ||
  !store.pathInterfaces.data && !store.pathInterfaces.error);
const unavailable = computed(() => store.pathTestsUnsupported ? "This backend does not expose paired path tests. Deploy a backend with native path-test support before starting." : "");
const input = computed(() => ({
  interface: selected.value, source_address: source.value, peer_address: peer.value,
  port: Number(port.value), maximum_mtu: Number(maximum.value), pairing_secret: secret.value,
  parents: parents.value.map(row => ({ interface: row.interface, maximum_mtu: Number(row.maximum) })),
}));
const problem = computed(() => {
  if (initialLoading.value) return "";
  if (store.pathInterfaces.error || store.pathInterfaces.stale) return "Fresh live interfaces are required.";
  if (store.pathTests.error || store.pathTests.stale) return "Fresh native path-test status is required.";
  if (!approved.value || parents.value.some(row => !row.approved)) return "Approve the selected interface and each requested ancestor change.";
  const result = pathTestRequestSchema.safeParse(input.value);
  if (!result.success) return result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  try { validatePathInterfaces(result.data, links.value); }
  catch (failure) { return failure instanceof Error ? failure.message : "Live interface verification failed."; }
  return "";
});
const canStart = computed(() => !initialLoading.value && !frozen.value && !unavailable.value &&
  Boolean(status.value) && !problem.value);
const phase = computed(() => {
  if (status.value?.state !== "running") return status.value?.state.replaceAll("_", " ") ?? "";
  if (status.value?.progress?.phase === "armed") return "Waiting for the peer (start both ends within 30 seconds)";
  if (status.value?.progress?.phase === "paired") return "Peer authenticated; measuring both directions";
  if (status.value?.progress?.phase === "udp_complete") return "Packet-size sampling finished; measuring TCP MSS";
  return status.value?.state ?? "";
});
watch(selected, () => { source.value = ""; maximum.value = ""; parents.value = []; approved.value = false; error.value = ""; });
watch([source, peer, port, maximum, parents], () => { approved.value = false; error.value = ""; }, { deep: true });
watch(() => [store.connected, store.sessionVersion], () => {
  selected.value = ""; source.value = ""; peer.value = ""; port.value = "49872"; maximum.value = "";
  secret.value = ""; parents.value = []; approved.value = false; error.value = "";
  if (store.connected) { void store.refreshPathTests(); void store.refreshPathInterfaces(); }
}, { immediate: true });
onBeforeUnmount(() => { secret.value = ""; });
watch(secret, () => { copied.value = false; });
async function copySecret() {
  error.value = "";
  const session = store.sessionVersion, value = secret.value;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard access requires HTTPS or localhost.");
    await navigator.clipboard.writeText(value);
    if (session === store.sessionVersion && value === secret.value) copied.value = true;
  } catch (failure) {
    if (session === store.sessionVersion) error.value = failure instanceof Error ? failure.message : "Unable to copy the one-time secret.";
  }
}
function generate() {
  error.value = "";
  try { secret.value = generatePairingSecret(); }
  catch { error.value = "Secure random generation is unavailable. Use a supported browser on HTTPS or localhost."; }
}
async function start() {
  error.value = "";
  if (!canStart.value) { error.value = problem.value || store.operationBlockedReason || unavailable.value || "Wait for native status and live interfaces."; return; }
  const request = pathTestRequestSchema.parse(input.value);
  secret.value = ""; approved.value = false;
  try { await store.startPathTest(request); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Path test start failed. Check status before trying again."; }
}
async function cancel() {
  error.value = "";
  try { await store.cancelPathTest(); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Cancellation failed. Check restoration status."; }
}
</script>

<template>
  <section
    class="path-tests"
    aria-label="Path MTU/MSS"
  >
    <header>
      <h2>Path MTU/MSS</h2>
      <v-btn
        variant="text"
        :disabled="!store.connected || Boolean(store.pathTestPending) || store.pathTests.loading || store.pathInterfaces.loading"
        :loading="store.pathTests.loading || store.pathInterfaces.loading"
        @click="store.refreshPathTests(); store.refreshPathInterfaces()"
      >
        Refresh status and interfaces
      </v-btn>
    </header>
    <p>Open this page on both firewalls. Use inverse source/peer IPs, the same port and a shared one-time secret. Start both ends within 30 seconds. Direct peer reachability is required; NAT traversal is not provided.</p>
    <p
      v-if="initialLoading"
      role="status"
    >
      Loading native test status and live interfaces...
    </p>
    <v-alert
      v-if="unavailable"
      type="warning"
      variant="tonal"
      role="alert"
    >
      {{ unavailable }}
    </v-alert>
    <v-alert
      v-for="(failure, index) in [store.pathTests.error, store.pathInterfaces.error, error || store.pathTestActionError].filter(Boolean)"
      :key="index"
      type="error"
      variant="tonal"
      role="alert"
    >
      {{ failure }}
    </v-alert>
    <p v-if="store.pathTests.stale && status">
      Previous test status is stale. Restoration has not been reverified; known ownership remains blocked.
    </p>
    <v-alert
      v-if="store.pathTestUncertain"
      type="warning"
      variant="tonal"
      role="alert"
    >
      Operation outcome is unknown. Only status reads are repeated automatically, never Start or Cancel.
    </v-alert>
    <section
      v-if="status && status.state !== 'idle'"
      aria-label="Path-test status"
    >
      <h3>{{ phase }}</h3>
      <p>Restoration: {{ status.restoration }}. {{ status.active ? 'Temporary state is still owned; conflicting writes are blocked.' : 'The temporary-state lease is released.' }}</p>
      <p v-if="status.deadline_unix_ms !== undefined">
        Session deadline ({{ timeZone }}): <time :datetime="new Date(status.deadline_unix_ms).toISOString()">{{ formatTimestamp(status.deadline_unix_ms) }}</time>
      </p>
      <v-alert
        v-if="status.error"
        type="error"
        variant="tonal"
        role="alert"
      >
        {{ status.error }}
      </v-alert>
      <ul>
        <li
          v-for="(warning, index) in status.warnings"
          :key="index"
        >
          {{ warning }}
        </li>
      </ul>
      <v-btn
        v-if="status.id && (status.active || store.pathTestUncertain)"
        :disabled="!store.connected || Boolean(store.pathTestPending)"
        :loading="store.pathTestPending === 'cancel'"
        @click="cancel"
      >
        Cancel and restore
      </v-btn>
      <p v-if="status.active">
        Test permissions expire within 90 seconds. MTU restoration requires the daemon to run or restart; permit expiry does not revoke established conntrack acceptance. Cancellation is not proof of completed restoration.
      </p>
      <v-table
        v-if="status.mtu_changes.length"
        density="compact"
      >
        <caption class="d-sr-only">
          MTU restoration observations
        </caption>
        <thead><tr><th>Interface</th><th>Approval</th><th>Original bytes</th><th>Maximum bytes</th><th>Observed bytes</th><th>Identity matches</th><th>Restored</th></tr></thead>
        <tbody>
          <tr
            v-for="row in status.mtu_changes"
            :key="row.index"
          >
            <th scope="row">
              {{ row.interface }} ({{ row.kind }})
            </th><td>{{ row.approved ? 'Approved' : 'Context only' }}</td>
            <td>{{ row.original_mtu }}</td><td>{{ row.maximum_mtu }}</td><td>{{ row.observed_mtu ?? 'Unavailable' }}</td>
            <td>{{ row.identity_matches ? 'Yes' : 'No' }}</td><td>{{ row.restored ? 'Yes' : 'No' }}</td>
          </tr>
        </tbody>
      </v-table>
      <PathTestResults :status="status" />
    </section>
    <v-form
      v-if="!unavailable"
      :disabled="initialLoading || frozen || Boolean(store.pathTests.error || store.pathInterfaces.error)"
      @submit.prevent="start"
    >
      <fieldset :disabled="initialLoading || frozen || Boolean(store.pathTests.error || store.pathInterfaces.error)">
        <legend>Start a paired test on this firewall</legend>
        <v-select
          v-model="selected"
          :items="eligible"
          label="Local interface"
          aria-label="Local interface"
        />
        <p v-if="local">
          Current live MTU: {{ local.mtu }} bytes. Interface kind: {{ local.kind }}.
        </p>
        <v-select
          v-model="source"
          :items="sources"
          label="Local source IP"
          aria-label="Local source IP"
        />
        <v-text-field
          v-model="peer"
          label="Peer IP"
          aria-label="Peer IP"
          autocomplete="off"
        />
        <div class="paired-fields">
          <v-text-field
            v-model="port"
            label="Common UDP/TCP port"
            aria-label="Common UDP/TCP port"
            inputmode="numeric"
          />
          <v-text-field
            v-model="maximum"
            label="Maximum MTU (bytes)"
            aria-label="Maximum MTU (bytes)"
            inputmode="numeric"
          />
        </div>
        <h3>Explicit ancestor approvals (optional)</h3>
        <p>Select only known ancestors. No uplinks or tunnel underlays are inferred or approved automatically. Leave this empty to change only the selected interface.</p>
        <div
          v-for="(row, index) in parents"
          :key="index"
          class="parent-row"
        >
          <v-select
            v-model="row.interface"
            :items="links.map(link => link.name).filter(name => name !== selected)"
            :label="`Ancestor ${index + 1}`"
            :aria-label="`Ancestor ${index + 1}`"
            @update:model-value="row.maximum = ''; row.approved = false"
          />
          <p>Current live MTU: {{ links.find(link => link.name === row.interface)?.mtu ?? 'Unavailable' }} bytes.</p>
          <v-text-field
            v-model="row.maximum"
            :label="`Ancestor ${index + 1} maximum MTU (bytes)`"
            :aria-label="`Ancestor ${index + 1} maximum MTU (bytes)`"
            inputmode="numeric"
            @update:model-value="row.approved = false"
          />
          <v-checkbox
            v-model="row.approved"
            :label="`Approve temporary MTU changes on ancestor ${index + 1}`"
            :aria-label="`Approve temporary MTU changes on ancestor ${index + 1}`"
          />
          <v-btn
            variant="text"
            :aria-label="`Remove ancestor ${index + 1}`"
            @click="parents.splice(index, 1)"
          >
            Remove
          </v-btn>
        </div>
        <v-btn
          variant="text"
          :disabled="parents.length >= 8"
          @click="parents.push({ interface: '', maximum: '', approved: false })"
        >
          Add ancestor
        </v-btn>
        <v-text-field
          v-model="secret"
          type="password"
          label="One-time pairing secret"
          aria-label="One-time pairing secret"
          autocomplete="off"
          :spellcheck="false"
        />
        <v-btn
          variant="text"
          @click="generate"
        >
          Generate one-time secret
        </v-btn>
        <v-btn
          variant="text"
          :disabled="!secret"
          @click="copySecret"
        >
          Copy one-time secret
        </v-btn>
        <span
          v-if="copied"
          role="status"
        >Secret copied; transfer it over a trusted channel.</span>
        <p>Generate here and transfer the secret to the peer over a trusted channel, or paste the peer's secret. It stays only in this form's memory and is cleared on submission, navigation or firewall change. Submit over HTTPS or trusted management connectivity.</p>
        <v-alert
          type="warning"
          variant="tonal"
        >
          Disruption warning: temporarily raising MTUs can affect unrelated traffic and management on every approved interface. Only peer/interface/test-port-scoped permissions are opened. No persistent configuration or MSS clamp is changed.
        </v-alert>
        <p v-if="local">
          Review: {{ selected }} ({{ source || 'select source' }}) to {{ peer || 'select peer' }}, UDP/TCP {{ port }}; maximum {{ maximum || 'enter maximum' }} bytes (current {{ local.mtu }}). Approved ancestors: {{ parents.filter(row => row.approved).map(row => `${row.interface}: ${row.maximum} bytes`).join(', ') || 'none' }}.
        </p>
        <v-checkbox
          v-model="approved"
          label="Approve the selected interface and disruption above"
          aria-label="Approve the selected interface and disruption above"
        />
        <p
          v-if="approved && problem"
          role="alert"
        >
          {{ problem }}
        </p>
        <v-btn
          type="submit"
          :disabled="!canStart"
          :loading="store.pathTestPending === 'start'"
        >
          Start paired test
        </v-btn>
      </fieldset>
      <p v-if="!initialLoading && store.operationBlockedReason">
        {{ store.operationBlockedReason }}
      </p>
    </v-form>
  </section>
</template>

<style scoped>
.path-tests { min-width: 0; }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
fieldset { min-width: 0; border: 0; padding: 0; margin-top: 24px; }
legend { font-size: 1.15rem; font-weight: 600; margin-bottom: 16px; }
.paired-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.parent-row { border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; margin-block: 16px; }
.path-tests :deep(.v-table) { margin-block: 16px; }
.path-tests :deep(th) { white-space: nowrap; }
@media (max-width: 600px) { .paired-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
