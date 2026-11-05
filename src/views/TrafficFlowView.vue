<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useId, watch } from "vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import HostPerformanceStrip from "@/components/feature/HostPerformanceStrip.vue";
import { useControllerStore } from "@/stores/controller";
import { isInitialLoad } from "@/services/datasets";
import { getInterfaceCapabilities } from "@/services/netcontrol";
import type { InterfaceCapabilitySnapshot } from "@/services/interfaceCapabilities";
import { trafficFrame, usableTrafficSample, type TrafficFrame } from "@/services/traffic";
import {
  flowPorts, flowMotion, flowLinkPath, flowCounter, flowDrops, flowTotal, formatFlowRate, formatFlowPackets,
  type FlowRole,
} from "@/services/trafficFlow";
import type { StateView, Statistics } from "@/types/domain";

const store = useControllerStore();
const id = `traffic-flow-${useId()}`;
const diagramScale = 1.4;
const paused = ref(false), hidden = ref(document.visibilityState === "hidden");
const viewport = ref<HTMLElement | null>(null), viewportWidth = ref(0);
const frame = ref<TrafficFrame | null>(null);
const sample = shallowRef<Statistics | null>(null), excludedState = shallowRef<StateView | null>(null);
const capabilities = shallowRef<InterfaceCapabilitySnapshot | null>(null), capabilitiesError = ref("");
const config = computed(() => store.state.data === excludedState.value ? undefined :
  store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const ports = computed(() => flowPorts(config.value, sample.value, frame.value, capabilities.value));
const zones = computed(() => ([
  { role: "wan" as const, label: "WAN", nodes: ports.value.filter(port => port.role === "wan") },
  { role: "lan" as const, label: "LAN", nodes: ports.value.filter(port => port.role === "lan") },
]));
const largestGroup = computed(() => Math.max(1, ...zones.value.map(zone => zone.nodes.length)));
const boardWidth = computed(() => Math.max(400, largestGroup.value * 168, viewportWidth.value));
const applianceWidth = computed(() => Math.min(400, boardWidth.value - 40, (viewportWidth.value || boardWidth.value) - 24));
const hostname = computed(() => [config.value?.system?.hostname, config.value?.system?.domain].filter(Boolean).join(".") || "Firewall appliance");
const live = computed(() => store.connected && !hidden.value && !paused.value && !store.statistics.stale &&
  !store.statistics.error && !store.statistics.delayed && !store.state.stale &&
  !store.state.error && !store.state.delayed && Boolean(frame.value));
const hasRates = computed(() => ports.value.some(port => port.rates.rx_bytes !== null || port.rates.tx_bytes !== null));
const hasTraffic = computed(() => live.value && ports.value.some(port => port.canFlow &&
  ((port.rates.rx_bytes ?? 0) > 0 || (port.rates.tx_bytes ?? 0) > 0)));
const notice = computed(() => {
  if (!store.connected || store.state.error || store.statistics.error) return "";
  if (isInitialLoad(store.state) || isInitialLoad(store.statistics) || store.state.data === excludedState.value) return "Loading your traffic map...";
  const data = sample.value;
  if (!config.value) return "Interface roles are unavailable.";
  if (!ports.value.length) return config.value.interfaces.some(item => item.role === "wan" || item.role === "lan")
    ? "No active WAN or LAN interfaces." : "Assign WAN or LAN roles to interfaces to build your traffic map.";
  if (data?.sample.status === "simulated") return "Simulated counters: live traffic flow is unavailable.";
  if (!data || !usableTrafficSample(data)) return "Live interface counters are unavailable.";
  if (!hasRates.value && !store.statistics.stale) return "Waiting for two comparable traffic samples...";
  return "";
});
const lanes = (role: FlowRole) => [
  { direction: "southbound", counter: role === "wan" ? "rx_bytes" as const : "tx_bytes" as const, offset: -5 },
  { direction: "northbound", counter: role === "wan" ? "tx_bytes" as const : "rx_bytes" as const, offset: 5 },
];
let previous: Statistics | null = null, seen: Statistics | null = null, session = store.sessionVersion;
function clearBaseline() { previous = null; frame.value = null; }
watch(() => [store.statistics.data, store.statistics.stale, store.statistics.error, store.connected, store.sessionVersion] as const,
  ([data, stale, error, connected, currentSession]) => {
    if (session !== currentSession || !connected) {
      session = currentSession; clearBaseline(); sample.value = null; excludedState.value = store.state.data; seen = data; return;
    }
    if (data === seen) { if (stale || error) previous = null; return; }
    seen = data;
    sample.value = data;
    if (!data || !usableTrafficSample(data)) { clearBaseline(); return; }
    if (stale || error || hidden.value) { clearBaseline(); return; }
    if (previous && (previous.sample.scope !== data.sample.scope ||
      Date.parse(data.sample.collected_at) <= Date.parse(previous.sample.collected_at))) previous = null;
    frame.value = trafficFrame(previous, data); previous = data;
  }, { immediate: true });

function visibilityChanged() {
  hidden.value = document.visibilityState === "hidden";
  clearBaseline();
}
let capabilitiesRequest: AbortController | null = null;
watch(() => [store.connected, store.sessionVersion] as const, async ([connected, currentSession]) => {
  capabilitiesRequest?.abort(); capabilitiesRequest = null;
  capabilities.value = null; capabilitiesError.value = "";
  if (!connected) return;
  const request = new AbortController();
  capabilitiesRequest = request;
  const current = () => capabilitiesRequest === request && store.sessionVersion === currentSession;
  try {
    const result = await getInterfaceCapabilities(request.signal);
    if (current()) capabilities.value = result;
  } catch (error) {
    if (current()) capabilitiesError.value = `Could not read interface link speeds. ${error instanceof Error ? error.message : String(error)} Animation uses a fixed speed where link speed is unknown.`;
  } finally {
    if (current()) capabilitiesRequest = null;
  }
}, { immediate: true, flush: "sync" });
let observer: ResizeObserver | null = null;
watch([() => ports.value.map(port => `${port.role}/${port.name}`).join(","), viewportWidth], async () => {
  await nextTick();
  const element = viewport.value;
  if (element) element.scrollLeft = Math.max(0, (boardWidth.value * diagramScale - element.clientWidth) / 2);
});
onMounted(() => {
  if (viewport.value) {
    viewportWidth.value = viewport.value.clientWidth / diagramScale;
    observer = new ResizeObserver(entries => { viewportWidth.value = (entries[0]?.contentRect.width ?? 0) / diagramScale; });
    observer.observe(viewport.value);
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  if (store.connected) { void store.refreshState(); void store.refreshStatistics(); }
});
onUnmounted(() => {
  capabilitiesRequest?.abort(); capabilitiesRequest = null;
  observer?.disconnect(); document.removeEventListener("visibilitychange", visibilityChanged);
});
</script>

<template>
  <section
    class="traffic-flow"
    aria-label="Overview"
  >
    <DatasetStatus
      :query="store.state"
      label="Interface roles"
    />
    <DatasetStatus
      :query="store.statistics"
      label="Traffic counters"
    />
    <p
      v-if="capabilitiesError"
      class="flow-notice"
      role="status"
    >
      {{ capabilitiesError }}
    </p>
    <p
      v-if="notice"
      class="flow-notice"
      role="status"
    >
      {{ notice }}
    </p>
    <div
      ref="viewport"
      class="flow-viewport"
      role="group"
      tabindex="0"
      aria-label="Traffic map; scroll horizontally or vertically for more interfaces"
    >
      <div
        class="flow-board"
        :style="{ width: `${boardWidth}px`, zoom: diagramScale }"
      >
        <template
          v-for="zone in zones"
          :key="zone.role"
        >
          <section
            class="flow-zone"
            :class="`flow-zone--${zone.role}`"
            :aria-label="`${zone.label} interfaces`"
          >
            <div
              class="flow-nodes"
              :style="{ gridTemplateColumns: `repeat(${Math.max(1, zone.nodes.length)}, minmax(0, 1fr))` }"
            >
              <article
                v-for="port in zone.nodes"
                :key="port.name"
                class="flow-node"
                :aria-label="`${port.name} interface counters`"
              >
                <p class="node-role">
                  {{ zone.label }}
                </p>
                <header class="node-heading">
                  <router-link
                    :to="{ name: 'real-time-traffic', query: { interface: port.name } }"
                    :aria-label="`View traffic history for ${port.name}`"
                  >
                    {{ port.name }}
                  </router-link>
                  <span class="node-kind">{{ port.kind }}</span>
                  <span
                    class="link-state"
                    :class="`link-state--${port.state}`"
                    :title="`Link ${port.state}`"
                    :aria-label="`Link ${port.state}`"
                  />
                </header>
                <div class="node-rates">
                  <div>
                    <span class="metric-label">RX</span>
                    <strong
                      data-rate="rx"
                      :class="{ unavailable: port.rates.rx_bytes === null }"
                    >{{ formatFlowRate(port.rates.rx_bytes) }}</strong>
                    <small>{{ formatFlowPackets(port.rates.rx_packets) }}</small>
                  </div>
                  <div>
                    <span class="metric-label">TX</span>
                    <strong
                      data-rate="tx"
                      :class="{ unavailable: port.rates.tx_bytes === null }"
                    >{{ formatFlowRate(port.rates.tx_bytes) }}</strong>
                    <small>{{ formatFlowPackets(port.rates.tx_packets) }}</small>
                  </div>
                </div>
                <dl class="node-totals">
                  <div>
                    <dt>RX total</dt><dd :title="flowCounter(port, 'rx_bytes') ?? undefined">
                      {{ flowTotal(port, "rx_bytes") }}
                    </dd>
                  </div>
                  <div>
                    <dt>TX total</dt><dd :title="flowCounter(port, 'tx_bytes') ?? undefined">
                      {{ flowTotal(port, "tx_bytes") }}
                    </dd>
                  </div>
                  <div><dt>Drops</dt><dd>{{ flowDrops(port) }}</dd></div>
                </dl>
                <p
                  v-if="port.error"
                  class="node-error"
                  role="status"
                >
                  {{ port.error }}
                </p>
              </article>
              <p
                v-if="config && !zone.nodes.length"
                class="empty-zone"
              >
                No {{ zone.label }} interfaces assigned
              </p>
            </div>
            <svg
              v-if="zone.nodes.length"
              class="flow-links"
              :viewBox="`0 0 ${boardWidth} 152`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  :id="`${id}-${zone.role}`"
                  gradientUnits="userSpaceOnUse"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="152"
                >
                  <stop
                    offset="0%"
                    stop-color="#ff657e"
                  />
                  <stop
                    offset="20%"
                    stop-color="#ffb25f"
                  />
                  <stop
                    offset="38%"
                    stop-color="#e6f67d"
                  />
                  <stop
                    offset="55%"
                    stop-color="#52f5bf"
                  />
                  <stop
                    offset="73%"
                    stop-color="#56cfff"
                  />
                  <stop
                    offset="100%"
                    stop-color="#bb82ff"
                  />
                </linearGradient>
              </defs>
              <g
                v-for="(port, index) in zone.nodes"
                :key="port.name"
              >
                <template
                  v-for="lane in lanes(zone.role)"
                  :key="lane.direction"
                >
                  <path
                    class="flow-track"
                    :d="flowLinkPath(boardWidth, index, zone.nodes.length, zone.role, lane.offset, applianceWidth)"
                  />
                  <path
                    v-if="flowMotion(port.rates[lane.counter], port.speedMbps).active"
                    class="flow-stream"
                    :class="{ 'is-moving': live && port.canFlow, 'flow-stream--north': lane.direction === 'northbound' }"
                    :data-interface="port.name"
                    :data-direction="lane.direction"
                    :data-counter="lane.counter"
                    :d="flowLinkPath(boardWidth, index, zone.nodes.length, zone.role, lane.offset, applianceWidth)"
                    :stroke="`url(#${id}-${zone.role})`"
                    :stroke-width="flowMotion(port.rates[lane.counter], port.speedMbps).width"
                    :style="{ animationDuration: flowMotion(port.rates[lane.counter], port.speedMbps).duration }"
                  />
                </template>
              </g>
            </svg>
          </section>
          <div
            v-if="zone.role === 'wan'"
            class="appliance"
            :style="{ width: `${applianceWidth}px` }"
          >
            <svg
              viewBox="0 0 640 210"
              role="img"
              aria-label="Illustration of a firewall hardware appliance"
            >
              <defs>
                <linearGradient
                  :id="`${id}-top`"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop stop-color="var(--bg-hover)" /><stop
                    offset="100%"
                    stop-color="var(--bg-elevated)"
                  />
                </linearGradient>
                <linearGradient
                  :id="`${id}-front`"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop stop-color="var(--bg-elevated)" /><stop
                    offset="100%"
                    stop-color="var(--bg-secondary)"
                  />
                </linearGradient>
              </defs>
              <ellipse
                cx="320"
                cy="178"
                rx="255"
                ry="20"
                fill="var(--bg-primary)"
                opacity=".6"
              />
              <path
                d="M 40 77 L 103 29 L 551 29 L 604 77 L 604 151 L 40 151 Z"
                fill="var(--bg-secondary)"
                stroke="var(--text-muted)"
                stroke-opacity=".4"
              />
              <path
                d="M 40 77 L 103 29 L 551 29 L 604 77 Z"
                :fill="`url(#${id}-top)`"
                stroke="var(--text-secondary)"
                stroke-opacity=".4"
              />
              <path
                d="M 40 77 L 604 77 L 604 151 L 40 151 Z"
                :fill="`url(#${id}-front)`"
              />
              <path
                d="M 604 77 L 621 66 L 621 139 L 604 151 Z"
                fill="var(--bg-primary)"
              />
              <path
                d="M 40 77 L 22 66 L 22 139 L 40 151 Z"
                fill="var(--bg-elevated)"
              />
              <path
                d="M 40 78 L 604 78"
                stroke="var(--text-secondary)"
                stroke-opacity=".35"
              />
              <path
                v-for="vent in 10"
                :key="`vent-${vent}`"
                :d="`M ${356 + vent * 16} 43 l 20 18`"
                stroke="var(--bg-primary)"
                stroke-width="5"
                stroke-linecap="round"
              />
              <g
                class="appliance-logo"
                transform="translate(80 111)"
                fill="none"
                stroke="#D5FF38"
                stroke-width="2.5"
                aria-label="Modan logo"
              >
                <circle r="13" />
                <circle r="9" />
              </g>
              <text
                x="109"
                y="115"
                fill="var(--text-primary)"
                font-size="16"
                font-family="inherit"
                font-weight="700"
                letter-spacing="3"
              >MODAN</text>
              <text
                x="110"
                y="134"
                fill="var(--text-muted)"
                font-size="8"
                font-family="inherit"
                letter-spacing="2"
              >KNOW YOUR NETWORK</text>
              <circle
                cx="52"
                cy="110"
                r="4"
                :fill="hasTraffic ? 'rgb(var(--v-theme-success))' : 'var(--text-muted)'"
              />
              <rect
                x="60"
                y="146"
                width="526"
                height="2"
                rx="1"
                fill="rgb(var(--v-theme-primary))"
                opacity=".8"
              />
              <circle
                cx="51"
                cy="90"
                r="2"
                fill="var(--text-muted)"
              /><circle
                cx="592"
                cy="138"
                r="2"
                fill="var(--text-muted)"
              />
            </svg>
            <div class="appliance-caption">
              <p class="appliance-name">
                {{ hostname }}
              </p>
              <v-btn
                :icon="paused ? 'mdi-play' : 'mdi-pause'"
                :aria-label="paused ? 'Resume animation' : 'Pause animation'"
                :title="paused ? 'Resume animation' : 'Pause animation'"
                variant="text"
                size="x-small"
                @click="paused = !paused"
              />
            </div>
            <HostPerformanceStrip />
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.traffic-flow {
  --flow-ink: var(--text-primary);
  --flow-muted: var(--text-secondary);
  position: relative; overflow: hidden; min-width: 0; padding: 10px 12px;
  display: flex; flex-direction: column;
  height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px) - 24px);
  color: var(--flow-ink); border: var(--app-border); border-radius: 20px;
  background: var(--bg-secondary);
}
.flow-notice { padding: 0 12px 16px; color: var(--flow-muted); font-size: 13px; }
.flow-viewport { display: flex; flex: 1; min-height: 0; max-width: 100%; overflow: auto; scrollbar-color: var(--border-light) transparent; scrollbar-width: thin; border-radius: 12px; }
.flow-viewport:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.flow-board { display: flex; flex-direction: column; flex-shrink: 0; margin: 0 auto; }
.flow-zone { display: flex; flex-direction: column; flex: 1; }
.flow-zone--lan { flex-direction: column-reverse; }
.flow-nodes { display: grid; align-items: stretch; width: 100%; }
.flow-node {
  position: relative; z-index: 1; justify-self: center; width: calc(100% - 24px); max-width: 315px;
  padding: 8px 10px; border: 1px solid var(--border-light); border-radius: 12px;
  background: var(--bg-elevated);
}
.node-role { margin-bottom: 4px; text-align: center; color: var(--text-primary); font-size: 12px; line-height: 16px; font-weight: 700; letter-spacing: 2px; }
.node-heading { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.node-heading a { color: var(--text-primary); font-weight: 650; font-size: 14px; line-height: 18px; text-decoration: none; overflow-wrap: anywhere; min-width: 0; }
.node-heading a:hover { color: rgb(var(--v-theme-primary)); text-decoration: underline; }
.node-heading a:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; border-radius: 2px; }
.link-state { flex: 0 0 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
.link-state--up { background: rgb(var(--v-theme-success)); }
.node-kind { margin-left: auto; color: var(--flow-muted); font-size: 8px; text-transform: uppercase; letter-spacing: .5px; }
.node-rates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 4px 0; }
.node-rates > div:last-child { text-align: right; }
.metric-label { display: block; color: rgb(var(--v-theme-primary)); font-size: 9px; line-height: 12px; font-weight: 600; letter-spacing: 1.5px; }
.node-rates > div:last-child .metric-label { color: rgb(var(--v-theme-secondary)); }
.node-rates strong { display: block; font-size: 15px; line-height: 18px; font-weight: 600; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.node-rates strong.unavailable { font-size: 11px; color: var(--flow-muted); white-space: normal; }
.node-rates small { display: block; color: var(--flow-muted); font-size: 10px; line-height: 12px; overflow-wrap: anywhere; }
.node-totals { border-top: var(--app-border); padding-top: 4px; font-size: 10px; color: var(--flow-muted); }
.node-totals > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px; line-height: 15px; }
.node-totals dd { max-width: 100%; color: var(--text-primary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.node-error { margin-top: 7px; color: rgb(var(--v-theme-error)); font-size: 11px; overflow-wrap: anywhere; }
.empty-zone { grid-column: 1 / -1; text-align: center; color: var(--flow-muted); font-size: 12px; padding: 18px; }
.flow-links { display: block; flex: 1 0 52px; width: 100%; height: 52px; overflow: visible; pointer-events: none; }
.flow-track { fill: none; stroke: var(--border-light); stroke-width: 1.5; }
.flow-track, .flow-stream { vector-effect: non-scaling-stroke; }
.flow-stream { fill: none; stroke-linecap: round; stroke-dasharray: 14 18; opacity: .9; }
.flow-stream.is-moving { animation: stream-south linear infinite; }
.flow-stream--north.is-moving { animation-direction: reverse; }
@keyframes stream-south { from { stroke-dashoffset: 64; } to { stroke-dashoffset: 0; } }
.appliance { position: relative; z-index: 1; flex-shrink: 0; margin: -20px auto 0; text-align: center; }
.appliance svg { display: block; position: relative; width: 100%; overflow: visible; }
.appliance-caption { position: relative; display: flex; align-items: center; justify-content: center; gap: 4px; width: fit-content; max-width: 90%; margin: -22px auto 0; padding: 0 6px; border-radius: 6px; background: var(--bg-secondary); }
.appliance-name { min-width: 0; color: var(--text-secondary); font-size: 11px; font-weight: 500; letter-spacing: .5px; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .traffic-flow { padding: 10px 4px; border-radius: 16px; }
  .flow-node { padding: 8px; width: calc(100% - 16px); }
  .node-rates { gap: 4px; }
  .node-rates strong { font-size: 12px; }
  .flow-links { height: 40px; flex-basis: 40px; }
  .appliance-caption { margin-top: -10px; }
}
@media (prefers-reduced-motion: reduce) {
  .flow-stream.is-moving { animation: none; }
}
</style>
