<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { lookupDNS } from "@/services/netcontrol";
import { dnsLookupRequestSchema, type DNSLookup } from "@/services/operations";

const props = defineProps<{ server: string }>();
const store = useControllerStore();
const hostname = ref(""), loading = ref(false), error = ref("");
const result = ref<DNSLookup | null>(null);
const blockedReason = computed(() => store.operationBlockedReason);
let controller: AbortController | undefined;
function reset(): void {
  controller?.abort(); controller = undefined; loading.value = false; error.value = ""; result.value = null;
}
watch(() => [store.sessionVersion, store.state.data?.revision, props.server], reset);
watch(hostname, () => { error.value = ""; result.value = null; });
onUnmounted(reset);
async function lookup(): Promise<void> {
  if (loading.value) return;
  error.value = ""; result.value = null;
  if (blockedReason.value) { error.value = blockedReason.value; return; }
  const parsed = dnsLookupRequestSchema.safeParse({
    server: props.server, hostname: hostname.value.trim(),
  });
  if (!parsed.success) { error.value = parsed.error.issues.map(issue => issue.message).join(". "); return; }
  loading.value = true;
  const request = new AbortController();
  controller = request;
  try {
    const response = await lookupDNS(parsed.data, request.signal);
    if (controller === request) result.value = response;
  } catch (failure) {
    if (controller === request) error.value = failure instanceof Error ? failure.message : "DNS lookup failed";
  } finally { if (controller === request) { loading.value = false; controller = undefined; } }
}
const resultError = computed(() => error.value || result.value?.error ||
  result.value?.attempts.find(attempt => attempt.status === "failed")?.error ||
  (result.value?.status === "failed" ? "DNS lookup failed" : ""));
const responseCodes: Record<number, string> = {
  0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED",
  6: "YXDOMAIN", 7: "YXRRSET", 8: "NXRRSET", 9: "NOTAUTH", 10: "NOTZONE", 11: "DSOTYPENI",
};
const queryResult = computed(() => {
  const response = result.value;
  if (!response) return "\u2014";
  if (response.status === "simulated") return "Simulated";
  if (response.status !== "answered") return "Unavailable";
  if (response.rcode === null) return "Response code unavailable";
  if (response.rcode !== 0) return responseCodes[response.rcode] ?? `RCODE ${response.rcode}`;
  return response.addresses.length ? response.addresses.join(", ") : "No answers (NOERROR)";
});
</script>

<template>
  <td class="dns-domain">
    <v-text-field
      v-model="hostname"
      :aria-label="`Domain for ${server}`"
      placeholder="example.com"
      density="compact"
      hide-details
      :disabled="loading || Boolean(blockedReason)"
      @keydown.enter.prevent="lookup"
    />
  </td>
  <td>
    <v-btn
      size="small"
      color="primary"
      variant="elevated"
      :aria-label="`Test DNS ${server}`"
      :title="blockedReason || undefined"
      :disabled="loading || Boolean(blockedReason)"
      :loading="loading"
      @click="lookup"
    >
      Test
    </v-btn>
  </td>
  <td
    class="dns-rtt"
    aria-live="polite"
    :aria-label="`RTT for ${server}`"
  >
    {{ result ? result.status === "answered" && result.rtt_ms !== null ? `${result.rtt_ms.toFixed(0)} ms` : "Unavailable" : "\u2014" }}
  </td>
  <td
    class="dns-result"
    aria-live="polite"
    :aria-label="`Result for ${server}`"
  >
    <span
      v-if="resultError"
      role="alert"
      class="text-error"
    >{{ resultError }}</span>
    <template v-else>
      {{ blockedReason || queryResult }}
    </template>
  </td>
</template>

<style scoped>
.dns-domain { min-width: 160px; }
.dns-rtt { min-width: 90px; }
.dns-result { min-width: 160px; }
</style>
