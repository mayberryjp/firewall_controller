<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { retryDHCP } from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";

const props = defineProps<{ name: string }>();
const store = useControllerStore();
const pending = ref(false), error = ref(""), message = ref("");
const committed = computed(() => store.state.data?.desired);
const eligible = computed(() => Boolean(committed.value?.dhcp_clients?.[props.name]));
const blocked = computed(() => !store.connected || store.busy || store.incompatible || Boolean(store.uncertain || store.submitted) ||
  store.upgradePending || Boolean(store.upgradeBlockedReason) ||
  store.activeTransactions.length > 0 || !store.transactions.data || store.transactions.stale ||
  !committed.value?.interfaces.find(link => link.name === props.name)?.up);
const lease = computed(() => store.runtime.data?.dhcp_clients?.leases[props.name]);
let timer: ReturnType<typeof setTimeout> | undefined;
let watching = false, stopped = false;
let watchUntil = 0;
let previousAcquisition: number | undefined, previousError: string | undefined;
function inspect(): void {
  const failure = store.runtime.data?.dhcp_clients?.errors[props.name];
  if (failure && failure !== previousError) { error.value = failure; message.value = ""; watching = false; return; }
  if (lease.value && lease.value.acquired_at !== previousAcquisition) {
    message.value = `Lease updated: ${lease.value.address}`; watching = false;
  }
}
function poll(): void {
  clearTimeout(timer);
  if (stopped || !watching || !store.connected) return;
  if (Date.now() >= watchUntil) {
    watching = false; message.value = "No lease update observed; inspect current runtime before retrying."; return;
  }
  timer = setTimeout(async () => {
    if (stopped || !watching) return;
    if (document.visibilityState !== "hidden") { await store.refreshRuntime(); inspect(); }
    poll();
  }, 5000);
}
async function retry(): Promise<void> {
  if (pending.value || blocked.value || !eligible.value) return;
  pending.value = true; error.value = ""; message.value = "";
  clearTimeout(timer); watching = false;
  try {
    await store.checkMaintenance();
    await store.refreshRuntime();
    if (stopped || blocked.value) return;
    previousAcquisition = lease.value?.acquired_at;
    previousError = store.runtime.data?.dhcp_clients?.errors[props.name];
    const result = await retryDHCP(props.name);
    if (result.interface !== props.name) throw new Error("Retry response refers to a different interface");
    message.value = "Retry started; awaiting a lease update.";
    watching = true;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : "DHCP retry failed";
    watching = failure instanceof ApiFailure && failure.uncertain && (!failure.status || failure.status === 408 || failure.status === 504);
  } finally {
    await store.refreshRuntime();
    if (!stopped && watching) { watchUntil = Date.now() + 60_000; inspect(); poll(); }
    pending.value = false;
  }
}
onUnmounted(() => { stopped = true; watching = false; clearTimeout(timer); });
</script>

<template>
  <div
    v-if="eligible"
    class="dhcp-retry"
    @click.stop
  >
    <v-btn
      icon="mdi-autorenew"
      :aria-label="`Reload DHCP ${name}`"
      title="Reload DHCP"
      size="small"
      variant="text"
      :loading="pending"
      :disabled="pending || blocked"
      @click="retry"
    />
    <p
      v-if="error"
      role="alert"
      class="text-error text-caption"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
      class="text-caption"
    >
      {{ message }}
    </p>
    <p
      v-if="(message || error) && lease"
      class="text-caption"
    >
      Current lease: {{ lease.address }}
    </p>
    <p
      v-if="(message || error) && store.runtime.error"
      role="alert"
      class="text-error text-caption"
    >
      {{ store.runtime.error }}
    </p>
  </div>
</template>

<style scoped>
.dhcp-retry p { max-width: 220px; white-space: normal; }
</style>