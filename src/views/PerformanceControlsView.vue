<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { getRpsDiagnostics } from "@/services/netcontrol";
import { rpsMaskCpus, rpsMaskForCpuCount, rpsTarget, type RpsDiagnostics } from "@/services/rps";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { useTimestamps } from "@/composables/useTimestamps";
import { useInterfaceCapabilities } from "@/composables/useInterfaceCapabilities";
import { nicOffloadFeatures, tuningSettings } from "@/services/tuning";

type Mode = "enabled" | "disabled" | "unmanaged";
type QueueEdit = { target: string; mode: Mode; mask: string };
type OffloadEdit = { interface: string; feature: typeof nicOffloadFeatures[number]; mode: Mode };
const offloadGroups = ["Checksums", "Sending", "Receiving", "VLAN tags"] as const;
type OffloadGroup = typeof offloadGroups[number];
const offloadDescriptions: Record<OffloadEdit["feature"], { group: OffloadGroup; label: string; description: string }> = {
  "rx-checksum": { group: "Checksums", label: "Receive checksums", description: "Validate incoming packet checksums on the network adapter." },
  "tx-checksum-ipv4": { group: "Checksums", label: "IPv4 transmit checksums", description: "Compute outgoing IPv4 packet checksums on the adapter." },
  "tx-checksum-ip-generic": { group: "Checksums", label: "General transmit checksums", description: "Compute outgoing checksums for protocols supported by the driver." },
  "tx-checksum-ipv6": { group: "Checksums", label: "IPv6 transmit checksums", description: "Compute outgoing IPv6 transport checksums on the adapter." },
  "tx-scatter-gather": { group: "Sending", label: "Scatter/gather", description: "Send packet data from separate memory buffers without first copying it together." },
  "tx-scatter-gather-fraglist": { group: "Sending", label: "Fragment-list scatter/gather", description: "Send packets assembled from linked lists of memory fragments." },
  "tx-tcp-segmentation": { group: "Sending", label: "TCP segmentation (IPv4)", description: "Let the adapter split large outgoing IPv4 TCP packets." },
  "tx-tcp6-segmentation": { group: "Sending", label: "TCP segmentation (IPv6)", description: "Let the adapter split large outgoing IPv6 TCP packets." },
  "tx-tcp-ecn-segmentation": { group: "Sending", label: "TCP segmentation with ECN", description: "Support TCP segmentation while preserving explicit congestion notification." },
  "tx-tcp-mangleid-segmentation": { group: "Sending", label: "TCP segmentation with IPv4 ID changes", description: "Allow the adapter to adjust IPv4 identification fields during TCP segmentation." },
  "tx-generic-segmentation": { group: "Sending", label: "Generic segmentation (GSO)", description: "Allow large outgoing packets to be split later in the transmit path." },
  "tx-gso-partial": { group: "Sending", label: "Partial generic segmentation", description: "Combine software preparation with adapter-assisted packet segmentation." },
  "rx-gro": { group: "Receiving", label: "Generic receive aggregation (GRO)", description: "Combine incoming packets before upper-layer processing." },
  "rx-gro-hw": { group: "Receiving", label: "Hardware receive aggregation", description: "Let the adapter combine incoming packets." },
  "rx-udp-gro-forwarding": { group: "Receiving", label: "UDP aggregation for forwarding", description: "Allow receive aggregation for UDP packets being forwarded." },
  "rx-lro": { group: "Receiving", label: "Large receive aggregation (LRO)", description: "Combine incoming TCP packets. Only disabling is allowed on a forwarding firewall." },
  "rx-vlan-hw-parse": { group: "VLAN tags", label: "Receive VLAN tag parsing", description: "Let the adapter extract incoming 802.1Q VLAN tags." },
  "tx-vlan-hw-insert": { group: "VLAN tags", label: "Transmit VLAN tag insertion", description: "Let the adapter insert outgoing 802.1Q VLAN tags." },
  "rx-vlan-stag-hw-parse": { group: "VLAN tags", label: "Receive service-VLAN tag parsing", description: "Let the adapter extract incoming 802.1ad service-VLAN tags." },
  "tx-vlan-stag-hw-insert": { group: "VLAN tags", label: "Transmit service-VLAN tag insertion", description: "Let the adapter insert outgoing 802.1ad service-VLAN tags." },
};
const props = defineProps<{ mode: "rps" | "offloads" }>();
const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const title = computed(() => props.mode === "rps" ? "RPS Configuration" : "NIC Offloads");
const {
  snapshot, loading: capabilitiesLoading, error: capabilitiesError, stale: capabilitiesStale,
  refreshDenied, read: readCapabilities,
} = useInterfaceCapabilities(() => props.mode === "offloads");
const diagnostics = ref<RpsDiagnostics | null>(null), loading = ref(false), error = ref(""), formError = ref(""), notice = ref("");
const rows = ref<QueueEdit[]>([]), offloadRows = ref<OffloadEdit[]>([]);
const selectedOffloadInterface = ref("");
const offloadPanel = ref<"configuration" | "status">("configuration");
const offloadGroup = ref<OffloadGroup>("Checksums");
const advancedMask = ref(false);
const newInterface = ref(""), newQueue = ref(""), manualTargets = ref<string[]>([]);
const onlineCpus = computed(() => [...new Set(diagnostics.value?.sections.online_cpus.data ?? [])].sort((left, right) => left - right));
const cpuCounts = computed(() => Array.from({ length: onlineCpus.value.length + 1 }, (_, count) => count));
const formValue = computed(() => stableJson(props.mode === "rps" ? rows.value : offloadRows.value));
const initial = ref(formValue.value), initialTuning = ref("");
const editing = computed(() => store.draft ?? store.state.data?.desired);
const dirty = computed(() => formValue.value !== initial.value);
const rpsInterfaces = computed(() => (diagnostics.value?.interfaces ?? []).filter(link => link.managed &&
  editing.value?.interfaces.some(item => item.name === link.name &&
    (item.kind === "ethernet" && link.physical || item.kind === "wireguard" && !link.physical))));
const physical = computed(() => rpsInterfaces.value.filter(link => link.physical && !link.errors.length));
const newWireGuard = computed(() => (editing.value?.interfaces ?? []).filter(item => item.kind === "wireguard" &&
  !store.state.data?.desired.interfaces.some(saved => saved.name === item.name)).map(item => item.name));
const queues = computed(() => {
  const observed = rpsInterfaces.value.filter(link => !link.errors.length).flatMap(link => (link.rx_queues ?? []).map(queue => ({
    target: `${link.name}/${queue.name}`, observed: queue.rps_cpus, verified: true,
  })));
  const targets = new Set([...manualTargets.value, ...Object.keys(editing.value?.kernel?.rps ?? {})]);
  return [...observed, ...[...targets].filter(target => newWireGuard.value.includes(target.split("/")[0]!) &&
    !observed.some(queue => queue.target === target)).map(target => ({
    target, observed: null, verified: false,
  }))];
});
const supportsOffloads = computed(() => diagnostics.value?.configured_offloads !== undefined);
const offloadInterfaces = computed(() => [...new Set([...physical.value.map(link => link.name), ...offloadRows.value.map(row => row.interface)])].sort());
const visibleOffloads = computed(() => offloadRows.value.filter(row => row.interface === selectedOffloadInterface.value &&
  offloadDescriptions[row.feature].group === offloadGroup.value));
watch(offloadInterfaces, names => {
  if (!names.includes(selectedOffloadInterface.value)) selectedOffloadInterface.value = names[0] ?? "";
});
const blockedReason = computed(() => {
  const data = diagnostics.value;
  if (loading.value || !data) return "";
  if (store.state.error) return store.state.error;
  if (!store.state.data) return "";
  if (store.state.stale) return "Refresh committed state before staging performance settings.";
  if (store.readOnlyReason || store.operationBlockedReason) return store.readOnlyReason || store.operationBlockedReason;
  if (data.sample.scope !== "host" || data.sample.status === "simulated") return "Performance controls require native host mode.";
  if (!data.tuning_available) return "The backend does not hold exclusive host-tuning ownership. Check the backend's lock or ownership error before making changes; the web UI cannot acquire ownership.";
  if (data.transaction_id !== null) return "Finish the provisionally applied transaction before editing performance settings.";
  if (data.config_revision !== store.state.data.revision) return "Configuration changed. Refresh performance state before staging.";
  if (stableJson(data.configured_rps) !== stableJson(store.state.data.desired.kernel?.rps ?? {})) return "Applied RPS settings differ from committed state. Refresh and reconcile state before staging.";
  if (stableJson(data.configured_rfs ?? null) !== stableJson(store.state.data.desired.kernel?.rfs ?? null) ||
      stableJson(data.configured_offloads ?? {}) !== stableJson(store.state.data.desired.kernel?.offloads ?? {})) {
    return "Applied RFS or offload settings differ from committed state. Refresh and reconcile state before staging.";
  }
  return "";
});
const rpsBlockedReason = computed(() => {
  const data = diagnostics.value;
  if (loading.value || !data) return "";
  if (data.sections.online_cpus.status !== "available" || !data.sections.online_cpus.data?.length) {
    return `Online CPUs could not be verified. ${data.sections.online_cpus.error ?? "Refresh RPS state."}`;
  }
  if (!data.sample.identity_stable) return "CPU or boot identity could not be verified. Refresh RPS state.";
  return "";
});
const disabled = computed(() => loading.value || !diagnostics.value || Boolean(error.value || blockedReason.value) ||
  !store.state.data || store.state.loading || !store.connected || (props.mode === "offloads" && capabilitiesLoading.value));
const rpsDisabled = computed(() => disabled.value || Boolean(rpsBlockedReason.value));
let active: AbortController | null = null;

function resetForm() {
  const kernel = editing.value?.kernel, settings = kernel?.rps ?? {};
  rows.value = queues.value.map(queue => ({
    target: queue.target,
    mode: settings[queue.target] === undefined ? "unmanaged" : settings[queue.target] === "0" ? "disabled" : "enabled",
    mask: settings[queue.target] && settings[queue.target] !== "0" ? settings[queue.target]! : "",
  }));
  const names = new Set([...physical.value.map(link => link.name), ...Object.keys(kernel?.offloads ?? {})]);
  offloadRows.value = [...names].sort().flatMap(name => {
    const inventory = snapshot.value?.inventory.interfaces.find(link => link.name === name);
    return nicOffloadFeatures.filter(feature => inventory?.capabilities.some(item => item.name === `ethtool:${feature}`) ||
      kernel?.offloads?.[name]?.[feature] !== undefined).map(feature => ({
      interface: name, feature,
      mode: kernel?.offloads?.[name]?.[feature] === undefined ? "unmanaged" : kernel.offloads[name]![feature] ? "enabled" : "disabled",
    }));
  });
  initial.value = formValue.value; initialTuning.value = stableJson(tuningSettings(kernel));
  store.editorDirty = false; formError.value = "";
}
watch(dirty, value => { store.editorDirty = value; }, { flush: "sync" });
watch(() => [stableJson(tuningSettings(editing.value?.kernel)), stableJson(editing.value?.interfaces.map(item => [item.name, item.kind])), snapshot.value],
  () => { if (!dirty.value) resetForm(); });
watch(formValue, () => { formError.value = ""; notice.value = ""; }, { flush: "sync" });

async function read(): Promise<boolean> {
  if (!store.connected || loading.value) return false;
  const controller = new AbortController(), session = store.sessionVersion;
  active = controller; loading.value = true; notice.value = "";
  const current = () => active === controller && store.sessionVersion === session;
  try {
    const result = await getRpsDiagnostics(controller.signal);
    if (!current()) return false;
    diagnostics.value = result; error.value = "";
    if (!dirty.value) resetForm();
    return true;
  } catch (failure) {
    if (current()) error.value = failure instanceof Error ? failure.message : String(failure);
    return false;
  } finally {
    if (current()) { active = null; loading.value = false; }
  }
}
watch(() => [store.connected, store.sessionVersion, props.mode], () => {
  active?.abort(); active = null;
  diagnostics.value = null; loading.value = false; error.value = ""; formError.value = ""; notice.value = "";
  rows.value = []; offloadRows.value = [];
  advancedMask.value = false;
  selectedOffloadInterface.value = ""; offloadPanel.value = "configuration"; offloadGroup.value = "Checksums";
  newInterface.value = ""; newQueue.value = ""; manualTargets.value = [];
  initial.value = formValue.value; initialTuning.value = ""; store.editorDirty = false;
  if (store.connected) void read();
}, { immediate: true, flush: "sync" });
onBeforeUnmount(() => { active?.abort(); active = null; store.editorDirty = false; });

function maskError(row: QueueEdit): string {
  if (row.mode !== "enabled") return "";
  if (!row.mask) return advancedMask.value ? "Enter a canonical lowercase hexadecimal CPU mask." : "Choose how many CPUs to use.";
  try {
    const cpus = rpsMaskCpus(row.mask);
    if (!cpus.length) return "An enabled RPS queue needs at least one explicitly selected CPU.";
    const evidence = diagnostics.value?.sections.online_cpus;
    if (evidence?.status !== "available" || evidence.data === null) return "";
    const online = new Set(evidence.data);
    const offline = cpus.filter(cpu => !online.has(cpu));
    if (offline.length) return `CPUs not online: ${offline.join(", ")}`;
    return "";
  } catch (failure) { return failure instanceof Error ? failure.message : String(failure); }
}
function selectedCpuCount(row: QueueEdit): number | null {
  if (row.mode === "disabled") return 0;
  if (row.mode !== "enabled" || !row.mask) return null;
  try { return rpsMaskCpus(row.mask).length; } catch { return null; }
}
function selectCpuCount(row: QueueEdit, count: number | null) {
  try {
    if (count === null) throw new Error("Choose how many CPUs to use.");
    const mask = rpsMaskForCpuCount(count, onlineCpus.value);
    row.mask = mask === "0" ? "" : mask;
    row.mode = count === 0 ? "disabled" : "enabled";
  } catch (failure) { formError.value = failure instanceof Error ? failure.message : String(failure); }
}
function selectedCpus(row: QueueEdit): string {
  if (row.mode !== "enabled" || maskError(row)) return "";
  return rpsMaskCpus(row.mask).join(", ");
}
function addWireGuardQueue() {
  if (rpsDisabled.value) return;
  formError.value = "";
  try {
    if (!newWireGuard.value.includes(newInterface.value)) throw new Error("Select a newly configured WireGuard interface from the current draft.");
    const target = `${newInterface.value}/${newQueue.value}`;
    rpsTarget(target);
    if (queues.value.some(queue => queue.target === target)) throw new Error(`${target} is already listed.`);
    manualTargets.value.push(target);
    rows.value.push({ target, mode: "unmanaged", mask: "" });
    newQueue.value = "";
  } catch (failure) { formError.value = failure instanceof Error ? failure.message : String(failure); }
}
function offloadEvidence(row: OffloadEdit) {
  return snapshot.value?.inventory.interfaces.find(link => link.name === row.interface)?.capabilities.find(item => item.name === `ethtool:${row.feature}`);
}
function offloadFixed(row: OffloadEdit): boolean {
  return offloadEvidence(row)?.evidence.some(line => /^ethtool feature bit \d+; changeable=false; active=(?:true|false)$/.test(line)) ?? false;
}
function offloadBlocked(row: OffloadEdit): string {
  if (!supportsOffloads.value) return "This backend does not expose NIC offload controls.";
  if (capabilitiesStale.value) return "Refresh the stale capability snapshot before editing offloads.";
  if (snapshot.value?.inventory.source !== "native" || snapshot.value.inventory.status === "simulated") return "Native NIC capability evidence is unavailable. Refresh capabilities.";
  const cached = snapshot.value.inventory.interfaces.find(link => link.name === row.interface);
  const measured = physical.value.find(link => link.name === row.interface);
  if (!cached || !measured || cached.index !== measured.index || cached.mac !== measured.mac) return "Refresh capabilities and performance state to verify this physical interface.";
  const evidence = offloadEvidence(row);
  if (offloadFixed(row)) return "Cached driver evidence reports a fixed feature; it cannot be changed.";
  if (evidence?.support !== "supported") return evidence?.reason ?? "Cached evidence does not establish support. Refresh capabilities.";
  return "";
}
function offloadTitle(row: OffloadEdit): string {
  const evidence = offloadEvidence(row);
  return [offloadBlocked(row), evidence?.reason, ...(evidence?.evidence ?? [])].filter(Boolean).join(" ");
}
function offloadState(row: OffloadEdit): string {
  const evidence = offloadEvidence(row);
  if (evidence?.enabled === true) return offloadFixed(row) ? "Fixed enabled" : "Enabled";
  if (evidence?.enabled === false) return offloadFixed(row) ? "Fixed disabled" : "Disabled";
  return evidence?.support === "supported" ? "Supported" : evidence?.support === "unsupported" ? "Unsupported" : "Unknown";
}
function offloadOptions(row: OffloadEdit) {
  const options: Array<{ title: string; value: Mode }> = [
    { title: "Original", value: "unmanaged" }, { title: "On", value: "enabled" }, { title: "Off", value: "disabled" },
  ];
  return options.filter(option => row.feature !== "rx-lro" || option.value !== "enabled")
    .map(option => ({ ...option, props: { disabled: option.value !== "unmanaged" && Boolean(offloadBlocked(row)) } }));
}
function setOffloadMode(row: OffloadEdit, value: Mode) {
  const problem = disabled.value ? blockedReason.value || "Performance editing is unavailable." :
    value !== "unmanaged" ? offloadBlocked(row) : "";
  if (problem) { formError.value = problem; return; }
  row.mode = value;
}
function buildCandidate() {
  if (!editing.value) throw new Error("Committed desired configuration is unavailable.");
  const candidate = cloneConfig(editing.value);
  candidate.kernel = { namespace: {}, host: {}, ...candidate.kernel };
  if (props.mode === "rps") {
    const rps = { ...candidate.kernel.rps };
    for (const row of rows.value) {
      if (!queues.value.some(queue => queue.target === row.target)) throw new Error(`${row.target} is no longer an available managed Ethernet or WireGuard RX queue.`);
      const problem = maskError(row);
      if (problem) throw new Error(`${row.target}: ${problem}`);
      if (row.mode === "unmanaged") delete rps[row.target];
      else rps[row.target] = row.mode === "disabled" ? "0" : row.mask;
    }
    if (Object.keys(rps).length) candidate.kernel.rps = rps;
    else delete candidate.kernel.rps;
    return candidate;
  }
  const offloads = candidate.kernel.offloads ?? {};
  for (const row of offloadRows.value) {
    const value = row.mode === "unmanaged" ? undefined : row.mode === "enabled";
    if (value !== candidate.kernel.offloads?.[row.interface]?.[row.feature] && value !== undefined) {
      const problem = offloadBlocked(row);
      if (problem) throw new Error(`${row.interface}/${row.feature}: ${problem}`);
    }
    if (value === undefined) delete offloads[row.interface]?.[row.feature];
    else (offloads[row.interface] ??= {})[row.feature] = value;
    if (!Object.keys(offloads[row.interface] ?? {}).length) delete offloads[row.interface];
  }
  if (Object.keys(offloads).length) candidate.kernel.offloads = offloads;
  else delete candidate.kernel.offloads;
  return candidate;
}
const candidateError = computed(() => {
  if (!dirty.value || !editing.value) return "";
  if (props.mode === "rps" && rpsBlockedReason.value) return rpsBlockedReason.value;
  try {
    return validateConfig(buildCandidate(), undefined, store.baseline ?? store.state.data?.desired)
      .filter(issue => issue.path.startsWith("kernel")).map(issue => `${issue.path}: ${issue.message}`).join("; ");
  } catch (failure) { return failure instanceof Error ? failure.message : String(failure); }
});
async function stage() {
  if (props.mode === "offloads" && offloadPanel.value === "status") {
    formError.value = "Switch to Configuration to stage offload changes.";
    return;
  }
  if (disabled.value || !dirty.value) return;
  formError.value = "";
  const session = store.sessionVersion;
  if (!await read() || store.sessionVersion !== session) return;
  try {
    if (disabled.value) throw new Error(blockedReason.value || "Performance state is unavailable.");
    if (!editing.value) throw new Error("Committed desired configuration is unavailable.");
    if (stableJson(tuningSettings(editing.value.kernel)) !== initialTuning.value) throw new Error("The tuning draft changed while this form was open. Reset the editor before staging.");
    if (candidateError.value) throw new Error(candidateError.value);
    store.stage(buildCandidate()); resetForm();
    notice.value = "Performance changes staged. Review in SAVE, then verify connectivity and performance before confirming.";
  } catch (failure) { formError.value = failure instanceof Error ? failure.message : String(failure); }
}
</script>

<template>
  <section
    class="rps-controls"
    :aria-label="title"
  >
    <header class="rps-header">
      <h2>{{ title }}</h2>
      <v-btn
        v-if="mode === 'offloads'"
        size="small"
        variant="text"
        :loading="capabilitiesLoading"
        :disabled="capabilitiesLoading || !store.connected || refreshDenied || Boolean(store.pathTestWriteBlockedReason)"
        :title="store.pathTestWriteBlockedReason"
        @click="readCapabilities(true)"
      >
        Refresh capabilities
      </v-btn>
      <v-btn
        v-if="mode === 'offloads'"
        size="small"
        variant="text"
        :loading="loading"
        :disabled="loading || !store.connected"
        @click="read"
      >
        Refresh performance state
      </v-btn>
    </header>
    <p
      v-if="mode === 'rps'"
      class="text-medium-emphasis"
    >
      Receive Packet Steering (RPS) distributes incoming packet processing across selected CPUs.
    </p>
    <p v-if="mode === 'offloads'">
      Changes apply only through SAVE. RSS, XPS and XDP remain read-only.
    </p>
    <p
      v-if="capabilitiesLoading"
      role="status"
    >
      Loading NIC capability evidence...
    </p>
    <v-alert
      v-if="capabilitiesError"
      type="error"
      variant="tonal"
      role="alert"
    >
      {{ capabilitiesError }}<span v-if="capabilitiesStale"> Previous capability evidence is stale; changes requiring support verification are disabled.</span>
    </v-alert>
    <p
      v-if="loading"
      role="status"
    >
      Reading performance prerequisites...
    </p>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      role="alert"
    >
      {{ error }}<span v-if="diagnostics"> Previous performance observations are stale; editing is disabled.</span>
    </v-alert>
    <v-alert
      v-if="formError"
      type="error"
      variant="tonal"
      role="alert"
    >
      {{ formError }}
    </v-alert>
    <p v-if="blockedReason">
      {{ blockedReason }}
    </p>
    <template v-if="diagnostics && diagnostics.sample.scope === 'host' && diagnostics.sample.status !== 'simulated' && store.state.data">
      <p v-if="mode === 'rps' && rpsBlockedReason">
        {{ rpsBlockedReason }}
      </p>
      <p v-if="mode === 'rps' && diagnostics.sections.online_cpus.data">
        Online CPUs: {{ diagnostics.sections.online_cpus.data.join(", ") }}
      </p>
      <p v-if="mode === 'rps' && !rows.length && !loading">
        No managed Ethernet or WireGuard RX queues are available.
      </p>
      <p
        v-for="link in mode === 'rps' ? rpsInterfaces.filter(item => item.errors.length) : []"
        :key="link.name"
        role="status"
      >
        {{ link.name }}: {{ link.errors.join("; ") }}
      </p>
      <form
        @submit.prevent="stage"
      >
        <template v-if="mode === 'rps'">
          <div class="rps-actions">
            <h4>RPS Advanced CPU Mask</h4>
            <v-switch
              v-model="advancedMask"
              aria-label="RPS Advanced CPU Mask"
              aria-describedby="rps-advanced-mask-description"
              class="flex-grow-0"
              color="primary"
              hide-details
            />
            <span id="rps-advanced-mask-description">to pin specific interfaces to specific CPUs</span>
          </div>
          <div
            v-if="newWireGuard.length"
            class="rps-actions"
          >
            <v-select
              v-model="newInterface"
              :items="newWireGuard"
              aria-label="New WireGuard interface"
              placeholder="Select interface"
              :disabled="rpsDisabled"
              density="compact"
              variant="outlined"
              hide-details
            />
            <v-text-field
              v-model="newQueue"
              aria-label="New WireGuard RX queue"
              placeholder="rx-N"
              :disabled="rpsDisabled"
              density="compact"
              variant="outlined"
              hide-details
            />
            <v-btn
              type="button"
              :disabled="rpsDisabled || !newInterface || !newQueue"
              @click="addWireGuardQueue"
            >
              Add WireGuard queue
            </v-btn>
          </div>
          <p v-if="newWireGuard.length">
            New WireGuard queues require a backend with WireGuard RPS support. Queue support is unverified until native apply; missing controls cause rollback.
          </p>
          <v-table
            v-if="rows.length"
            density="compact"
            aria-label="RPS queue settings"
          >
            <caption class="d-sr-only">
              RPS queue settings
            </caption>
            <thead><tr><th>Queue</th><th>Enable RPS</th><th>{{ advancedMask ? "CPU mask (hex)" : "CPU count" }}</th></tr></thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.target"
              >
                <th scope="row">
                  {{ row.target }}<small v-if="advancedMask">Observed mask: {{ queues.find(queue => queue.target === row.target)?.observed ?? "Unknown" }}</small>
                  <small v-if="queues.find(queue => queue.target === row.target)?.verified === false">Queue support unverified until apply</small>
                </th>
                <td>
                  <v-switch
                    class="rps-enable"
                    :model-value="row.mode === 'enabled'"
                    :label="row.mode === 'unmanaged' ? 'Unmanaged' : row.mode === 'enabled' ? 'Enabled' : 'Disabled'"
                    :aria-label="`Enable RPS for ${row.target}`"
                    :disabled="rpsDisabled"
                    color="primary"
                    hide-details
                    @update:model-value="row.mode = $event ? 'enabled' : 'disabled'; notice = ''"
                  />
                </td>
                <td class="mask-cell">
                  <v-text-field
                    v-if="advancedMask"
                    :model-value="row.mode === 'disabled' ? '0' : row.mask"
                    :aria-label="`CPU mask for ${row.target}`"
                    :disabled="rpsDisabled || row.mode !== 'enabled'"
                    :error-messages="maskError(row)"
                    density="compact"
                    variant="outlined"
                    autocomplete="off"
                    hide-details="auto"
                    @update:model-value="row.mask = $event; notice = ''"
                  />
                  <v-select
                    v-else
                    :model-value="selectedCpuCount(row)"
                    :items="cpuCounts"
                    :aria-label="`CPU count for ${row.target}`"
                    :disabled="rpsDisabled || row.mode !== 'enabled'"
                    :error-messages="maskError(row)"
                    placeholder="Select"
                    density="compact"
                    variant="outlined"
                    hide-details="auto"
                    @update:model-value="selectCpuCount(row, $event)"
                  />
                  <small v-if="selectedCpus(row)">Selected CPUs: {{ selectedCpus(row) }}</small>
                </td>
              </tr>
            </tbody>
          </v-table>
        </template>
        <template v-else-if="!capabilitiesLoading || snapshot">
          <p v-if="!supportsOffloads">
            This backend does not expose NIC offload controls.
          </p>
          <template v-else>
            <div class="offload-selectors">
              <v-select
                v-model="selectedOffloadInterface"
                :items="offloadInterfaces"
                label="Interface"
                aria-label="Offload interface"
                density="compact"
                hide-details
              />
              <v-select
                v-model="offloadGroup"
                :items="offloadGroups"
                label="Category"
                aria-label="Offload category"
                density="compact"
                hide-details
              />
            </div>
            <div
              class="offload-panels"
              role="group"
              aria-label="Offload display"
            >
              <v-btn
                type="button"
                :aria-pressed="offloadPanel === 'configuration'"
                :variant="offloadPanel === 'configuration' ? 'tonal' : 'text'"
                @click="offloadPanel = 'configuration'"
              >
                Configuration
              </v-btn>
              <v-btn
                type="button"
                :aria-pressed="offloadPanel === 'status'"
                :variant="offloadPanel === 'status' ? 'tonal' : 'text'"
                @click="offloadPanel = 'status'"
              >
                Status
              </v-btn>
            </div>
            <p v-if="offloadPanel === 'configuration'">
              Original releases this setting and restores the backend-captured value; On and Off explicitly manage it. Review changes in SAVE. Hover a setting name for its Linux feature name.
            </p>
            <p v-else>
              Cached status, not live readback. Collected ({{ timeZone }}):
              <time
                v-if="snapshot?.collected_at"
                :datetime="snapshot.collected_at"
              >{{ formatTimestamp(snapshot.collected_at) }}</time><span v-else>Unavailable</span>.
              Refresh capabilities to scan again; hover a state for driver evidence.
            </p>
            <p v-if="!offloadRows.length">
              No configurable offloads were found. Refresh capabilities to scan the physical NICs.
            </p>
            <section
              :aria-label="`NIC offload ${offloadPanel}`"
              class="offload-settings"
            >
              <h3 class="settings-head">
                {{ offloadGroup }}
              </h3>
              <p v-if="!visibleOffloads.length && offloadRows.length">
                No settings in this category were reported for {{ selectedOffloadInterface }}. Choose another category or refresh capabilities.
              </p>
              <div
                v-for="row in visibleOffloads"
                :key="`${row.interface}/${row.feature}`"
                class="setting-row"
              >
                <label
                  v-if="offloadPanel === 'configuration'"
                  :for="`offload-${row.interface}-${row.feature}`"
                  class="setting-name"
                  :title="row.feature"
                >{{ offloadDescriptions[row.feature].label }}</label>
                <span
                  v-else
                  class="setting-name"
                  :title="row.feature"
                >{{ offloadDescriptions[row.feature].label }}</span>
                <div class="setting-control">
                  <template v-if="offloadPanel === 'configuration'">
                    <v-select
                      :id="`offload-${row.interface}-${row.feature}`"
                      :model-value="row.mode"
                      :items="offloadOptions(row)"
                      :aria-label="`Desired ${row.feature} for ${row.interface}`"
                      :aria-describedby="`offload-description-${row.interface}-${row.feature}`"
                      :disabled="disabled || !supportsOffloads || (Boolean(offloadBlocked(row)) && row.mode === 'unmanaged')"
                      density="compact"
                      hide-details
                      class="setting-field"
                      @update:model-value="setOffloadMode(row, $event)"
                    />
                    <p
                      :id="`offload-description-${row.interface}-${row.feature}`"
                      class="setting-desc"
                    >
                      {{ offloadBlocked(row) || offloadDescriptions[row.feature].description }}
                    </p>
                  </template>
                  <template v-else>
                    <v-chip
                      size="small"
                      :title="offloadTitle(row)"
                      :color="offloadState(row) === 'Enabled' ? 'success' : offloadState(row) === 'Disabled' ? 'warning' : offloadState(row) === 'Unsupported' ? 'error' : undefined"
                    >
                      {{ offloadState(row) }}
                    </v-chip>
                    <p class="setting-desc">
                      {{ offloadDescriptions[row.feature].description }}
                    </p>
                  </template>
                </div>
              </div>
            </section>
          </template>
        </template>
        <p
          v-if="candidateError && (mode === 'rps' || offloadPanel === 'configuration')"
          class="text-error"
          role="alert"
        >
          {{ candidateError }}
        </p>
        <div
          v-if="mode === 'rps' || offloadPanel === 'configuration'"
          class="rps-actions"
        >
          <v-btn
            type="submit"
            color="primary"
            :disabled="disabled || !dirty || Boolean(candidateError)"
          >
            STAGE CHANGES
          </v-btn>
          <v-btn
            variant="text"
            :disabled="loading || !dirty"
            @click="resetForm(); error = ''; notice = ''"
          >
            Reset editor
          </v-btn>
        </div>
      </form>
    </template>
    <p
      v-if="notice"
      role="status"
    >
      {{ notice }} <router-link :to="{ name: 'changes' }">
        Review in SAVE
      </router-link>
    </p>
  </section>
</template>

<style scoped>
.rps-controls { min-width: 0; }
.rps-header, .rps-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.rps-header { justify-content: space-between; }
.rps-controls p, .rps-controls form, .rps-controls .v-alert, .rps-actions { margin-top: 12px; }
.rps-controls p, .mask-cell { overflow-wrap: anywhere; }
.rps-controls small { display: block; font-weight: normal; }
.rps-controls :deep(table > tbody > tr > th),
.rps-controls :deep(table > tbody > tr > td) { padding: 8px; vertical-align: middle; white-space: nowrap; }
.rps-controls :deep(.rps-enable) { min-width: 150px; }
.rps-controls :deep(.rps-enable .v-label) { white-space: nowrap; }
.mask-cell { min-width: 200px; max-width: 320px; }
.mask-cell small { white-space: normal; }
.offload-selectors { display: grid; grid-template-columns: repeat(2, minmax(0, 360px)); gap: 16px; margin-top: 16px; }
.offload-panels { display: flex; gap: 8px; margin-top: 16px; }
.offload-settings { min-width: 0; }
.settings-head { padding: 18px 4px 12px; font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); }
.setting-row { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start; padding: 18px 4px; border-top: 1px solid var(--border-color); }
.setting-name { padding-top: 6px; font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; }
.setting-control { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; }
.setting-field { width: 100%; max-width: 360px; }
.rps-controls .setting-desc { margin: 0; max-width: 760px; font-size: 0.8125rem; line-height: 1.45; color: var(--text-muted); }
@media (max-width: 700px) {
  .offload-selectors, .setting-row { grid-template-columns: minmax(0, 1fr); }
  .setting-row { gap: 10px; padding: 16px 4px; }
  .setting-name { padding-top: 0; }
}
</style>
