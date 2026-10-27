<script setup lang="ts">
import { computed, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { serviceRepairPermissions } from "@/services/configuration";
import type { RepairService } from "@/types/domain";
const props = defineProps<{ service: RepairService }>();
const store = useControllerStore();
const dialog = ref(false), error = ref("");
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const permissions = computed(() => stored.value ? serviceRepairPermissions(stored.value, props.service).join(", ") : "Unknown; committed/pending settings unavailable");
const blocked = computed(() => !store.connected || store.busy || store.incompatible || Boolean(store.uncertain) ||
  store.upgradePending || Boolean(store.upgradeBlockedReason) ||
  store.activeTransactions.some(item => ["applying", "rolling_back", "recovery_failed"].includes(item.status)));
async function repair(): Promise<void> {
  error.value = "";
  try { await store.reconcile(props.service); dialog.value = false; }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Service repair failed"; }
}
</script>
<template>
  <v-btn
    class="mb-4"
    :disabled="blocked"
    @click="dialog = true; error = ''"
  >
    Reconcile all managed services
  </v-btn>
  <v-dialog
    v-model="dialog"
    max-width="660"
    :persistent="store.busy"
  >
    <v-card title="Reconcile all managed services?">
      <v-card-text>
        <p>Uses committed/pending stored configuration, never the local draft. No networking replay or new revision. No automatic retry.</p>
        <p class="mt-3">
          May lose flow caches and briefly disrupt DHCP relay on other interfaces: enabled links share one dnsmasq process. Running is local readiness, not lease delivery or upstream reachability.
        </p>
        <p class="mt-3">
          Repairs may reset gateway measurements. NTP affects the whole appliance clock, not reversible clock history. Syslog owns local system logging as well as forwarding; stopping it can stop local logs. vnStat databases persist across graceful repair but are not delivery/synchronization metrics.
        </p>
        <p
          v-if="stored?.mdns?.enabled || service === 'mdns'"
          class="mt-3"
        >
          mDNS repair restarts discovery workers and resets counters. Interface lifecycle failures require explicit repair; no competing UDP 5353 owner is stopped.
        </p>
        <p class="mt-3">
          Required permissions across stored enabled services: <span class="mono">{{ permissions }}</span>. The backend checks authorization under its engine lock; this client has no permission-discovery endpoint.
        </p>
        <v-alert
          v-if="error"
          type="error"
          role="alert"
          class="mt-3"
        >
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn
          :disabled="store.busy"
          @click="dialog = false"
        >
          Cancel
        </v-btn>
        <v-btn
          color="warning"
          :loading="store.busy"
          :disabled="blocked"
          @click="repair"
        >
          Reconcile all services
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
