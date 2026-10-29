<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { parse, stringify } from "lossless-json";
import { inspectApiPath } from "@/services/api";
import { useControllerStore } from "@/stores/controller";

const store = useControllerStore();
const path = ref("/api/v1/services/vnstat/status");
const loading = ref(false), error = ref("");
const response = ref<{ path: string; status: number; body: string } | null>(null);
let controller: AbortController | undefined;
const endpoints = [
  "/state", "/runtime", "/platform/status", "/interfaces/discovered", "/gateway-monitors",
  "/statistics", "/statistics/host", "/statistics/link-diagnostics", "/statistics/connections",
  "/statistics/gateways", "/statistics/vnstat", "/routes/bgp", "/routes/bgp/advertised",
  "/services/gateway-monitoring/status", "/services/mqtt/status", "/services/dynamic-dns/status",
  ...["ntp", "syslog", "vnstat", "mdns", "bgp", "udp-broadcast-relay"].flatMap(service => [
    `/services/${service}`, `/services/${service}/status`,
  ]),
  "/transactions", "/revisions", "/revisions/latest", "/system/upgrade", "/system/timezones",
].map(endpoint => `/api/v1${endpoint}`).sort();
const formattedBody = computed(() => {
  const body = response.value?.body ?? "";
  try { return stringify(parse(body), undefined, 2) ?? body; }
  catch { return body; }
});

function reset(): void {
  controller?.abort(); controller = undefined;
  loading.value = false; error.value = ""; response.value = null;
}
watch(() => store.sessionVersion, reset, { flush: "sync" });
onBeforeUnmount(reset);

async function send(): Promise<void> {
  if (!store.connected || loading.value) return;
  const requestPath = path.value;
  const active = new AbortController(); controller = active;
  loading.value = true; error.value = ""; response.value = null;
  try {
    const result = await inspectApiPath(requestPath, active.signal);
    if (controller === active) response.value = { ...result, path: requestPath.trim() };
  } catch (failure) {
    if (controller === active) error.value = failure instanceof Error ? failure.message : "Unable to read the appliance response.";
  } finally {
    if (controller === active) { controller = undefined; loading.value = false; }
  }
}
</script>

<template>
  <section aria-label="API explorer">
    <form class="api-request" @submit.prevent="send">
      <v-combobox
        v-model="path"
        label="Appliance API path"
        :items="endpoints"
        :return-object="false"
        :disabled="loading"
        density="compact"
        variant="outlined"
        hide-details
        :clearable="false"
        class="api-path"
      />
      <v-btn type="submit" prepend-icon="mdi-play" :loading="loading" :disabled="!store.connected || loading || !path">GET</v-btn>
      <v-btn v-if="loading" icon="mdi-stop" title="Cancel request" aria-label="Cancel request" variant="text" @click="reset" />
    </form>
    <v-alert v-if="error" type="error" class="mt-4" role="alert">{{ error }}</v-alert>
    <section v-if="response" class="mt-4" aria-label="API response">
      <div class="api-response-heading">
        <strong :class="response.status >= 400 ? 'text-error' : 'text-success'">HTTP {{ response.status }}</strong>
        <code>{{ response.path }}</code>
      </div>
      <pre class="api-response" tabindex="0" aria-label="Response body">{{ formattedBody || '(empty response)' }}</pre>
    </section>
  </section>
</template>

<style scoped>
.api-request { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.api-path { flex: 1 1 320px; min-width: 0; }
.api-response-heading { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; overflow-wrap: anywhere; }
.api-response { margin-top: 12px; padding: 16px; max-height: 70vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 4px; background: rgb(var(--v-theme-surface)); }
</style>