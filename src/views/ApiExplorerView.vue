<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { parse, stringify } from "lossless-json";
import { inspectApiPath } from "@/services/api";
import { useControllerStore } from "@/stores/controller";
import { adoptVlanRequestSchema } from "@/types/domain";
import { decodeJson, encodeJson } from "@/services/json";
import { isInitialLoad } from "@/services/datasets";
import { useRouter } from "vue-router";

const store = useControllerStore();
const router = useRouter();
const path = ref("/api/v1/platform/status");
const loading = ref(false), error = ref("");
const response = ref<{ path: string; status: number; body: string } | null>(null);
const copying = ref(false), copied = ref(false), copyError = ref("");
const capabilitiesPath = "/api/v1/interface-capabilities";
const refreshPath = `${capabilitiesPath}/refresh`;
const adoptionPath = "/api/v1/interfaces/adopt-vlan";
const discordWebhookPath = "/api/v1/services/discord/webhooks";
const adoptionBody = ref('{"name":"","parent":"","id":1}');
const savedCapabilities = ref<typeof response.value>(null);
const capabilitiesStale = ref(false), refreshDenied = ref(false);
const selectedPath = computed(() => path.value.trim().split("?")[0]);
const refreshingCapabilities = computed(() => selectedPath.value === refreshPath);
const readingCapabilities = computed(() => selectedPath.value === capabilitiesPath);
const adoptingVlan = computed(() => selectedPath.value === adoptionPath);
const configuringDiscord = computed(() => selectedPath.value === discordWebhookPath);
const adoptionInitializing = computed(() => store.connected && !store.state.error && !store.transactions.error &&
  (isInitialLoad(store.state) || isInitialLoad(store.transactions)));
const staleResponse = computed(() => capabilitiesStale.value && response.value !== null && response.value === savedCapabilities.value);
let controller: AbortController | undefined;
const endpoints = [
  "/state", "/runtime", "/platform/status", "/interfaces/discovered", "/interfaces/adopt-vlan", "/gateway-monitors",
  "/interface-capabilities", "/interface-capabilities/refresh",
  "/kernel/tunables/catalog", "/kernel/tunables",
  "/diagnostics/path-tests",
  "/statistics", "/statistics/host", "/statistics/link-diagnostics", "/statistics/connections", "/statistics/performance",
  "/statistics/gateways", "/statistics/vnstat", "/routes/bgp", "/routes/bgp/advertised",
  "/services/gateway-monitoring/status", "/services/mqtt/status", "/services/dynamic-dns/status",
  "/services/discord/status", "/services/discord/webhooks",
  ...["ntp", "syslog", "vnstat", "mdns", "bgp", "udp-broadcast-relay"].flatMap(service => [
    `/services/${service}`, `/services/${service}/status`,
  ]),
  "/transactions", "/revisions", "/revisions/latest", "/system/upgrade", "/system/timezones",
].map(endpoint => `/api/v1${endpoint}`).sort().map(value => ({
  value,
  title: value === adoptionPath ? `${value} (POST: Adopt existing VLAN)` :
    value === discordWebhookPath ? `${value} (POST: use Notifications)` :
    value === capabilitiesPath ? `${value} (Read saved interface capabilities)` :
    value === refreshPath ? `${value} (Scans hardware and saves)` : value,
}));
const formattedBody = computed(() => {
  const body = response.value?.body ?? "";
  try { return stringify(parse(body), undefined, 2) ?? body; }
  catch { return body; }
});
watch(response, () => {
  copying.value = false; copied.value = false; copyError.value = "";
}, { flush: "sync" });

function selectResponse(event: KeyboardEvent): void {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.key.toLowerCase() !== "a" ||
    !(event.currentTarget instanceof HTMLElement)) return;
  const selection = event.currentTarget.ownerDocument.getSelection();
  if (!selection) return;
  const range = event.currentTarget.ownerDocument.createRange();
  range.selectNodeContents(event.currentTarget);
  selection.removeAllRanges(); selection.addRange(range);
  event.preventDefault(); event.stopPropagation();
}

async function copyResponse(): Promise<void> {
  const current = response.value;
  if (!current || copying.value) return;
  copying.value = true; copied.value = false; copyError.value = "";
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard access requires a supported browser using HTTPS or localhost.");
    await navigator.clipboard.writeText(formattedBody.value);
    if (response.value === current) copied.value = true;
  } catch (failure) {
    if (response.value === current) copyError.value = `Unable to copy response: ${failure instanceof Error ? failure.message : "Clipboard access failed."} Select the response and copy it manually.`;
  } finally {
    if (response.value === current) copying.value = false;
  }
}

function reset(): void {
  controller?.abort(); controller = undefined;
  loading.value = false; error.value = ""; response.value = null;
}
watch(() => store.sessionVersion, () => {
  reset(); savedCapabilities.value = null; capabilitiesStale.value = false; refreshDenied.value = false;
  adoptionBody.value = '{"name":"","parent":"","id":1}';
}, { flush: "sync" });
onBeforeUnmount(reset);

async function send(): Promise<void> {
  if (!store.connected || loading.value) return;
  if (configuringDiscord.value) { await router.push("/settings/notifications"); return; }
  const requestPath = path.value.trim();
  const isRefresh = refreshingCapabilities.value;
  const isAdoption = adoptingVlan.value;
  const isCapabilities = isRefresh || readingCapabilities.value;
  if (isAdoption && requestPath !== adoptionPath) {
    error.value = "VLAN adoption accepts no query parameters.";
    return;
  }
  if (isAdoption && store.vlanAdoptionBlockedReason) {
    error.value = store.vlanAdoptionBlockedReason;
    return;
  }
  if (isRefresh && store.pathTestWriteBlockedReason) {
    error.value = store.pathTestWriteBlockedReason;
    return;
  }
  if (isRefresh && refreshDenied.value) {
    error.value = "Refresh requires state.read and interfaces.write. Access was denied for this firewall session.";
    return;
  }
  const active = new AbortController(); controller = active;
  loading.value = true; error.value = "";
  response.value = isCapabilities ? savedCapabilities.value : null;
  try {
    if (isAdoption) {
      const input = adoptVlanRequestSchema.parse(decodeJson(adoptionBody.value));
      const result = await store.adoptVlan(input);
      if (controller === active && result) response.value = { path: requestPath, status: 200, body: encodeJson(result) };
      return;
    }
    const result = await inspectApiPath(requestPath, active.signal);
    if (controller !== active) return;
    if (isCapabilities && result.status === 403) refreshDenied.value = true;
    if (isCapabilities && result.status >= 400 && savedCapabilities.value) {
      capabilitiesStale.value = true;
      error.value = `HTTP ${result.status} from ${requestPath}: ${result.body}`;
    } else {
      response.value = { ...result, path: requestPath };
      if (isCapabilities && result.status >= 200 && result.status < 300) {
        savedCapabilities.value = response.value; capabilitiesStale.value = false;
      }
    }
  } catch (failure) {
    if (controller === active) {
      if (isCapabilities && savedCapabilities.value) capabilitiesStale.value = true;
      error.value = failure instanceof Error ? failure.message : "Unable to read the appliance response.";
      if (isRefresh) error.value += " Scan/save outcome is unknown. No automatic retry was made; read the saved capabilities before refreshing again.";
    }
  } finally {
    if (controller === active) { controller = undefined; loading.value = false; }
  }
}
</script>

<template>
  <section aria-label="API explorer">
    <form
      class="api-request"
      @submit.prevent="send"
    >
      <v-combobox
        v-model="path"
        label="Appliance API path"
        :items="endpoints"
        item-title="title"
        item-value="value"
        :return-object="false"
        :disabled="loading"
        density="compact"
        variant="outlined"
        hide-details
        :clearable="false"
        class="api-path"
      />
      <v-btn
        type="submit"
        prepend-icon="mdi-play"
        :loading="loading"
        :disabled="!store.connected || loading || !path || (adoptingVlan && Boolean(store.vlanAdoptionBlockedReason)) || (refreshingCapabilities && (refreshDenied || Boolean(store.pathTestWriteBlockedReason)))"
      >
        {{ configuringDiscord ? "Open Notifications" : adoptingVlan ? "POST: Adopt VLAN" : refreshingCapabilities ? "GET: Scan & save" : "GET" }}
      </v-btn>
      <v-btn
        v-if="loading && !refreshingCapabilities && !adoptingVlan"
        icon="mdi-stop"
        title="Cancel request"
        aria-label="Cancel request"
        variant="text"
        @click="reset"
      />
      <template v-if="adoptingVlan">
        <p class="adoption-body">
          Explicitly imports an existing unmanaged VLAN using interfaces.write and transactions.write.
          The parent must be managed Ethernet. This changes ownership immediately, without a confirmation timer;
          supported live settings are preserved and the imported role is unassigned.
          Assign LAN role, addresses, firewall or NAT afterward.
          Interrupted ownership recovery may need backend recovery. This POST is never sent on selection or automatically retried.
        </p>
        <v-textarea
          v-model="adoptionBody"
          label="VLAN adoption JSON"
          aria-label="VLAN adoption JSON"
          :disabled="loading || store.vlanAdoptionPending"
          rows="3"
          variant="outlined"
          class="adoption-body"
        />
        <p
          v-if="adoptionInitializing"
          class="adoption-body"
          role="status"
        >
          Loading configuration and transaction state...
        </p>
        <p
          v-else-if="store.vlanAdoptionBlockedReason"
          class="adoption-body"
          role="status"
        >
          {{ store.vlanAdoptionBlockedReason }}
        </p>
      </template>
    </form>
    <p
      v-if="refreshingCapabilities || readingCapabilities"
      class="text-body-2 mt-3"
    >
      <template v-if="refreshingCapabilities">
        Scans hardware and saves interface capabilities. Requires state.read and interfaces.write.
        <span v-if="refreshDenied">Refresh is disabled because access was denied for this firewall session.</span>
      </template>
      <template v-else>
        Reads the saved interface capabilities without scanning. Requires state.read.
      </template>
    </p>
    <v-alert
      v-if="error"
      type="error"
      class="mt-4"
      role="alert"
    >
      {{ error }}
    </v-alert>
    <section
      v-if="response"
      class="mt-4"
      aria-label="API response"
    >
      <div class="api-response-heading">
        <strong :class="response.status >= 400 ? 'text-error' : 'text-success'">HTTP {{ response.status }}</strong>
        <code>{{ response.path }}</code>
        <span
          v-if="staleResponse"
          role="status"
          class="text-warning text-caption"
        >Stale: previous saved capabilities; the latest request failed.</span>
        <v-btn
          :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
          :loading="copying"
          :disabled="copying"
          title="Copy response to clipboard"
          aria-label="Copy response to clipboard"
          variant="text"
          size="small"
          @click="copyResponse"
        />
        <span
          v-if="copied"
          role="status"
          class="text-caption"
        >Copied</span>
      </div>
      <v-alert
        v-if="copyError"
        type="error"
        class="mt-2"
        role="alert"
      >
        {{ copyError }}
      </v-alert>
      <p
        v-if="response.status === 200 && response.path === capabilitiesPath && response.body.trim() === 'null'"
        class="text-body-2 mt-3"
      >
        No saved capability snapshot. Use Refresh interface capabilities to scan hardware and save.
      </p>
      <pre
        class="api-response"
        tabindex="0"
        aria-label="Response body"
        @keydown="selectResponse"
      >{{ formattedBody || '(empty response)' }}</pre>
    </section>
  </section>
</template>

<style scoped>
.api-request { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.api-path { flex: 1 1 320px; min-width: 0; }
.adoption-body { flex: 1 1 100%; min-width: 0; }
.api-response-heading { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; overflow-wrap: anywhere; }
.api-response { margin-top: 12px; padding: 16px; max-height: 70vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 4px; background: rgb(var(--v-theme-surface)); }
</style>