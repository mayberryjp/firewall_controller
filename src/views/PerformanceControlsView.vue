<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { getRpsDiagnostics } from "@/services/netcontrol";
import { rpsMaskCpus, rpsMaskForCpuCount, rpsTarget, type RpsDiagnostics } from "@/services/rps";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { useTimestamps } from "@/composables/useTimestamps";
import { useInterfaceCapabilities } from "@/composables/useInterfaceCapabilities";
import { nicOffloadFeatures, tuningSettings } from "@/services/tuning";

type OffloadMode = "enabled" | "disabled";
type Mode = OffloadMode | "unmanaged";
type QueueEdit = { target: string; mode: Mode; mask: string };
type OffloadEdit = { interface: string; feature: typeof nicOffloadFeatures[number]; mode: Mode };
const offloadDescriptions: Record<OffloadEdit["feature"], { label: string; description: string }> = {
  "rx-checksum": { label: "Receive checksums", description: "Lets the adapter verify incoming packet checksums so the CPU can skip checks already completed by hardware. This detects packet corruption; it does not replace firewall rules or authenticate traffic." },
  "tx-checksum-ipv4": { label: "IPv4 transmit checksums", description: "Lets the adapter calculate transport checksums for outgoing IPv4 packets. This can reduce CPU work when transmitting; disabling it can shift checksum work to software or another supported checksum feature." },
  "tx-checksum-ip-generic": { label: "General transmit checksums", description: "Lets the adapter finish outgoing checksums using a generic mechanism rather than a separate feature for each IP protocol. It can support multiple packet types, including some tunnel traffic, depending on the driver." },
  "tx-checksum-ipv6": { label: "IPv6 transmit checksums", description: "Lets the adapter calculate transport checksums for outgoing IPv6 packets. This can reduce transmit CPU work; IPv6 itself has no IP-header checksum, so this setting concerns protocols such as TCP and UDP." },
  "tx-scatter-gather": { label: "Scatter/gather", description: "Lets the adapter transmit a packet directly from several separate memory buffers instead of first copying them into one buffer. This reduces copying and is often a prerequisite for hardware segmentation features." },
  "tx-scatter-gather-fraglist": { label: "Fragment-list scatter/gather", description: "Allows transmission of packets stored as linked lists of packet-buffer fragments. It can avoid extra copying for workloads that produce this buffer layout; the benefit depends on the network stack and driver." },
  "tx-tcp-segmentation": { label: "TCP segmentation (IPv4)", description: "Lets the adapter split large outgoing IPv4 TCP buffers into correctly sized packets instead of making the CPU build each packet separately. It can lower CPU usage at high throughput; captures taken before segmentation may show packets larger than the wire MTU." },
  "tx-tcp6-segmentation": { label: "TCP segmentation (IPv6)", description: "Lets the adapter split large outgoing IPv6 TCP buffers into correctly sized packets. It reduces per-packet transmit work without increasing the interface MTU; captures before hardware segmentation may show oversized buffers." },
  "tx-tcp-ecn-segmentation": { label: "TCP segmentation with ECN", description: "Allows TCP segmentation offload for traffic using Explicit Congestion Notification, which signals congestion without relying only on packet loss. This extends segmentation support; it does not enable ECN negotiation by itself." },
  "tx-tcp-mangleid-segmentation": { label: "TCP segmentation with IPv4 ID changes", description: "Allows the adapter to choose IPv4 identification values while splitting a large TCP buffer into packets. It is a specialized segmentation capability, not a way to change connection identities or firewall matching." },
  "tx-generic-segmentation": { label: "Generic segmentation (GSO)", description: "Lets the network stack carry large outgoing packet buffers and split them into MTU-sized packets later in the transmit path. This can reduce per-packet CPU work and supports more traffic types than TCP-only segmentation; it does not raise the link MTU." },
  "tx-gso-partial": { label: "Partial generic segmentation", description: "Shares segmentation work between software and the adapter, often for encapsulated or tunnel packets. Software prepares the parts the adapter cannot handle, allowing hardware to finish supported work; usefulness depends on the driver and packet type." },
  "rx-gro": { label: "Generic receive aggregation (GRO)", description: "Combines compatible incoming packets from the same flow into larger buffers before higher-level processing. This reduces per-packet CPU overhead; packet captures and counters may reflect aggregated buffers rather than individual wire packets." },
  "rx-gro-hw": { label: "Hardware receive aggregation", description: "Lets the adapter combine compatible incoming packets before delivering them to the host, using hardware GRO support. It can reduce receive-side CPU work, but changes the packet boundaries seen by later processing and some capture tools." },
  "rx-udp-gro-forwarding": { label: "UDP aggregation for forwarding", description: "Allows compatible incoming UDP packets to stay aggregated when they are forwarded rather than delivered to a local application. This can improve high-rate UDP forwarding, including some tunnel workloads; benefits depend on the rest of the forwarding path." },
  "rx-lro": { label: "Large receive aggregation (LRO)", description: "Combines incoming TCP packets into larger buffers to reduce processing overhead. Unlike GRO, LRO can alter header assumptions needed for correct routing and forwarding, so this firewall only allows disabling it; an enabled reported state can be turned off but not selected as a new setting." },
  "rx-vlan-hw-parse": { label: "Receive VLAN tag parsing", description: "Lets the adapter extract an incoming 802.1Q VLAN tag and pass its VLAN ID to the network stack as metadata. This reduces software parsing and can change how tags appear in captures; it does not create VLAN interfaces or set filtering policy." },
  "tx-vlan-hw-insert": { label: "Transmit VLAN tag insertion", description: "Lets the adapter insert an outgoing 802.1Q VLAN tag using metadata supplied by the network stack. This avoids software insertion work; the configured VLAN interface still determines the VLAN ID and whether traffic is tagged." },
  "rx-vlan-stag-hw-parse": { label: "Receive service-VLAN tag parsing", description: "Lets the adapter extract an incoming 802.1ad service-VLAN tag, commonly used as the outer tag in provider or stacked-VLAN networks. This is separate from ordinary 802.1Q tag handling and does not configure stacked VLANs by itself." },
  "tx-vlan-stag-hw-insert": { label: "Transmit service-VLAN tag insertion", description: "Lets the adapter insert an outgoing 802.1ad service-VLAN tag supplied by the network stack. It is useful for supported provider or stacked-VLAN traffic; enabling it alone does not add an outer tag or create a service-VLAN interface." },
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
const visibleOffloads = computed(() => offloadRows.value.filter(row => row.interface === selectedOffloadInterface.value));
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
  selectedOffloadInterface.value = "";
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
function offloadSelection(row: OffloadEdit): OffloadMode | null {
  if (row.mode !== "unmanaged") return row.mode;
  const enabled = offloadEvidence(row)?.enabled;
  return enabled === true ? "enabled" : enabled === false ? "disabled" : null;
}
function offloadOptions(row: OffloadEdit) {
  const options: Array<{ title: string; value: OffloadMode }> = [
    { title: "Enabled", value: "enabled" }, { title: "Disabled", value: "disabled" },
  ];
  return options.map(option => ({
    ...option, props: { disabled: Boolean(offloadBlocked(row)) || (row.feature === "rx-lro" && option.value === "enabled") },
  }));
}
function setOffloadMode(row: OffloadEdit, value: OffloadMode) {
  const problem = disabled.value ? blockedReason.value || "Performance editing is unavailable." :
    offloadBlocked(row) || (row.feature === "rx-lro" && value === "enabled" ? "LRO can only be disabled on a forwarding firewall." : "");
  if (problem) { formError.value = problem; return; }
  row.mode = editing.value?.kernel?.offloads?.[row.interface]?.[row.feature] === undefined &&
    offloadEvidence(row)?.enabled === (value === "enabled") ? "unmanaged" : value;
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
      <div
        v-if="mode === 'rps' && onlineCpus.length"
        class="online-cpus"
      >
        <span class="cpu-label text-medium-emphasis">Online CPUs</span>
        <div
          class="cpu-chips"
          role="list"
          aria-label="Online CPUs"
        >
          <v-chip
            v-for="cpu in onlineCpus"
            :key="cpu"
            class="cpu-chip"
            role="listitem"
            :title="`Logical CPU ${cpu}`"
            prepend-icon="mdi-chip"
            color="primary"
            variant="tonal"
            rounded="lg"
          >
            CPU {{ cpu }}
          </v-chip>
        </div>
      </div>
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
            </div>
            <p>
              Select Enabled or Disabled, then STAGE CHANGES and review in SAVE. Hover a setting name for its Linux feature name.
            </p>
            <p v-if="!offloadRows.length">
              No configurable offloads were found. Refresh capabilities to scan the physical NICs.
            </p>
            <section
              aria-label="NIC offload configuration"
              class="offload-settings"
            >
              <p v-if="!visibleOffloads.length && offloadRows.length">
                No configurable offloads were reported for {{ selectedOffloadInterface }}. Refresh capabilities to scan again.
              </p>
              <div
                v-for="row in visibleOffloads"
                :key="`${row.interface}/${row.feature}`"
                class="setting-row"
              >
                <label
                  :for="`offload-${row.interface}-${row.feature}`"
                  class="setting-name"
                  :title="row.feature"
                >{{ offloadDescriptions[row.feature].label }}</label>
                <div class="setting-control">
                  <v-select
                    :id="`offload-${row.interface}-${row.feature}`"
                    :model-value="offloadSelection(row)"
                    :items="offloadOptions(row)"
                    :aria-label="`Desired ${row.feature} for ${row.interface}`"
                    :aria-describedby="`offload-description-${row.interface}-${row.feature}`"
                    :disabled="disabled || Boolean(offloadBlocked(row))"
                    :placeholder="offloadEvidence(row)?.support === 'unsupported' ? 'Unsupported' : 'Unknown'"
                    :title="offloadTitle(row)"
                    density="compact"
                    hide-details
                    class="setting-field"
                    @update:model-value="setOffloadMode(row, $event)"
                  />
                  <p
                    :id="`offload-description-${row.interface}-${row.feature}`"
                    class="setting-desc"
                  >
                    {{ offloadDescriptions[row.feature].description }}
                    <span
                      v-if="offloadBlocked(row)"
                      class="d-block text-warning mt-1"
                    >{{ offloadBlocked(row) }}</span>
                  </p>
                </div>
              </div>
            </section>
            <p class="text-caption text-medium-emphasis">
              Status collected ({{ timeZone }}):
              <time
                v-if="snapshot?.collected_at"
                :datetime="snapshot.collected_at"
              >{{ formatTimestamp(snapshot.collected_at) }}</time><span v-else>Unavailable</span>.
            </p>
          </template>
        </template>
        <p
          v-if="candidateError"
          class="text-error"
          role="alert"
        >
          {{ candidateError }}
        </p>
        <div class="rps-actions">
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
.online-cpus { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-top: 16px; }
.cpu-label { font-size: 0.875rem; font-weight: 600; }
.cpu-chips { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
.cpu-chip { flex: 0 0 auto; border: 1px solid rgba(var(--v-theme-primary), 0.3); font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 0.025em; box-shadow: inset 0 0 12px rgba(var(--v-theme-primary), 0.08); }
.rps-controls p, .rps-controls form, .rps-controls .v-alert, .rps-actions { margin-top: 12px; }
.rps-controls p, .mask-cell { overflow-wrap: anywhere; }
.rps-controls small { display: block; font-weight: normal; }
.rps-controls :deep(table > tbody > tr > th),
.rps-controls :deep(table > tbody > tr > td) { padding: 8px; vertical-align: middle; white-space: nowrap; }
.rps-controls :deep(.rps-enable) { min-width: 150px; }
.rps-controls :deep(.rps-enable .v-label) { white-space: nowrap; }
.mask-cell { min-width: 200px; max-width: 320px; }
.mask-cell small { white-space: normal; }
.offload-selectors { max-width: 360px; margin-top: 16px; }
.offload-settings { min-width: 0; }
.setting-row { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start; padding: 18px 4px; border-top: 1px solid var(--border-color); }
.setting-name { padding-top: 6px; font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; }
.setting-control { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; }
.setting-field { width: 100%; max-width: 360px; }
.rps-controls .setting-desc { margin: 0; max-width: 760px; font-size: 0.8125rem; line-height: 1.45; color: var(--text-muted); }
@media (max-width: 700px) {
  .setting-row { grid-template-columns: minmax(0, 1fr); }
  .setting-row { gap: 10px; padding: 16px 4px; }
  .setting-name { padding-top: 0; }
}
</style>
