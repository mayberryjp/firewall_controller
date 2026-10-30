<script setup lang="ts">
import { computed, ref } from "vue";
import GatewayStatisticsPanel from "@/components/feature/GatewayStatisticsPanel.vue";
import ServiceWorkerStatus from "@/components/feature/ServiceWorkerStatus.vue";
import { useTimestamps } from "@/composables/useTimestamps";
import { useControllerStore } from "@/stores/controller";
import { configSchema, type DiscoveredInterface } from "@/types/domain";
import { record } from "@/types/forms";
import { differences, stableJson } from "@/services/configuration";
import { displayResourceValue, resourceColumns } from "@/services/resourceCollections";
import type { Section } from "@/services/resourceForms";
import type { ResourceRow } from "@/composables/useResourceCollection";
import { useFirewallCounters } from "@/composables/useFirewallCounters";
import FirewallCounterCells from "@/components/feature/FirewallCounterCells.vue";
import FirewallCounterRows from "@/components/feature/FirewallCounterRows.vue";
import RuleOriginLabel from "@/components/feature/RuleOriginLabel.vue";
import { useRuleDrag } from "@/composables/useRuleDrag";
import { resourceItems } from "@/services/resourceCollections";
const { formatTimestamp, timeZone } = useTimestamps();

const props = defineProps<{ section: Section; rows: ResourceRow[]; total: number; disabled: boolean; detail: boolean; wireguard?: boolean; vlan?: boolean; inventory?: boolean; loopbacks?: boolean; expandedName?: string; editingRow?: number }>();
const emit = defineEmits<{ edit: [value: unknown]; delete: [row: ResourceRow]; move: [index: number, delta: number]; manage: [link: DiscoveredInterface]; toggle: [value: unknown, enabled: boolean] }>();
const store = useControllerStore();
const counterEnabled = computed(() => ["firewall", "nat"].includes(props.section));
const counterConfig = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const counters = useFirewallCounters(counterConfig, counterEnabled);
const dragError = ref("");
const { dropTarget, pointerStart, pointerMove, drop, cancel: cancelDrag } = useRuleDrag({
  blocked: () => props.disabled || props.editingRow !== undefined || Boolean(store.readOnlyReason),
  snapshot: () => ({ section: props.section, rules: counterConfig.value ? resourceItems(counterConfig.value, props.section) : [], rows: props.rows.map(row => row.index) }),
  move: (from, to) => { dragError.value = ""; emit("move", from, to - from); },
  error: message => { dragError.value = message; },
});
const expandedMonitor = ref<string | null>(null);
const statusVersions = ref<Record<string, number>>({});
const blackholeLabel = computed(() => ({ blackhole: 'Drop', unreachable: 'Unreachable', prohibit: 'Prohibited' })[blackholeTarget.value?.action ?? 'blackhole']);
// Enabled IPv4 routes on a DHCP interface are installed only while the lease is valid; enabled stays configured intent.
function waitingForDhcp(route: Record<string, unknown>): string {
  const name = String(route.interface), data = store.runtime.data;
  if (props.section !== "routes" || route.enabled === false || String(route.destination).includes(":") ||
      !store.state.data?.desired.dhcp_clients?.[name] || !data?.dhcp_clients || store.runtime.stale) return "";
  const lease = data.dhcp_clients.leases[name], error = data.dhcp_clients.errors[name];
  if (lease && lease.acquired_at + lease.lifetime > (store.runtime.lastSuccess ?? Date.now()) / 1000) return "";
  return `Not installed until ${name} has a valid DHCP lease${error ? `: ${error}` : ""}`;
}
const blackholeTarget = computed(() => {
  const target = (store.draft ?? store.state.data?.desired)?.blackhole;
  return target?.name ? target : undefined;
});
function toggleStatus(row: ResourceRow, enabled: boolean): void {
  emit("toggle", row.value, enabled);
  statusVersions.value[row.rowID] = (statusVersions.value[row.rowID] ?? 0) + 1;
}
const physical = computed(() => props.section === "interfaces" && !props.loopbacks && !props.vlan && !props.wireguard);
const compact = computed(() => physical.value || props.vlan || props.loopbacks || ["routes", "gateway_monitors", "nat", "softflowd"].includes(props.section));
const hasChanges = computed(() => !compact.value && store.diff.some(item => item.area === props.section));
const visibleColumns = computed(() => (physical.value ? ["name", "role", "up", "mtu", "address_mode", "addresses", "ipv6_addresses"] : props.loopbacks ? ["name", "role", "up", "mtu", "active_addresses"] : props.inventory ? ["name", "kind", "ownership", "role", "up", "mtu", "active_addresses"] : props.vlan ? ["name", "id", "up", "mtu", "parent", "addresses"] : props.wireguard ? ["name", "key_ref", "listen_port", "peers"] : resourceColumns[props.section])
  .filter(key => store.ipv6Enabled || key !== "ipv6_addresses"));
const previewColumns = computed(() => visibleColumns.value.filter(key => props.section !== "gateway_monitors" || key !== "target"));
const monitorMetrics = ["Health", "Loss", "Mean RTT", "Stddev", "RTT variation"];
const hasStatus = computed(() => ["routes", "gateway_monitors", "softflowd"].includes(props.section));
function statusLabel(value: Record<string, unknown>): string {
  if (props.section === "gateway_monitors") return `Monitoring enabled for ${value.name}`;
  return props.section === "softflowd" ? `Export enabled for ${value.name}` : `Route enabled for ${value.destination}`;
}
const columns = computed(() => previewColumns.value.length + 1 + Number(hasStatus.value) + Number(hasChanges.value) + Number(props.section === "softflowd") * 3 + (props.section === "gateway_monitors" ? monitorMetrics.length : 0) + Number(["firewall", "nat"].includes(props.section)) + Number(counterEnabled.value) * 3);
function editable(row: ResourceRow): boolean {
  return row.value.name !== "lo" && (!row.discovered || (row.index >= 0 && row.discovered.ownership !== "loopback" && ["ethernet", "veth", "dummy", "vlan", "wireguard"].includes(row.discovered.kind)));
}
function adoptable(row: ResourceRow): boolean {
  return Boolean(row.discovered && row.index < 0 && row.discovered.name !== "lo" && row.discovered.ownership === "unmanaged" && (props.loopbacks ? ["dummy"] : ["ethernet", "veth"]).includes(row.discovered.kind) && !store.runtime.data?.parent_interfaces.some(parent => parent.name === row.discovered!.name));
}
function cell(value: Record<string, unknown>, key: string, discovered?: DiscoveredInterface): string {
  if (props.vlan && key === "addresses") return (Array.isArray(value.addresses) ? value.addresses.filter(address => !String(address).includes(":")).join(", ") : "") || "None";
  if (physical.value) {
    if (key === "name") return String(value.name);
    if (key === "display_name") return String(record(value.metadata).display_name || "—");
    if (key === "address_mode") return discovered?.ownership === "unmanaged" ? "—" : rowMode(value);
    if (key === "ipv6_addresses" || key === "addresses") {
      if (key === "addresses" && rowMode(value) === "DHCP") {
        const committed = store.state.data?.desired.dhcp_clients?.[String(value.name)];
        return (committed ? discovered?.addresses.filter(address => !address.includes(":")).join(", ") : "") || "DHCP";
      }
      const addresses = Array.isArray(value.addresses) ? value.addresses.map(String) : [];
      return addresses.filter(address => address.includes(":") === (key === "ipv6_addresses")).join(", ") || "None";
    }
  }
  if (discovered) {
    if (key === "active_addresses") return discovered.addresses.filter(address => store.ipv6Enabled || !address.includes(":")).join(", ") || "None";
    if (key === "ownership") return displayResourceValue(discovered.ownership, key);
    if (["kind", "up"].includes(key)) return displayResourceValue(record(discovered)[key], key);
    if (key === "mtu") return displayResourceValue(value.mtu ?? discovered.mtu, key);
    if (key === "addresses" && !Array.isArray(value.addresses)) return "None";
  }
  if (key === "name" && record(value.metadata).display_name) return String(record(value.metadata).display_name);
  const item = props.vlan && ["parent", "id"].includes(key) ? record(value.vlan)[key] : props.wireguard && key !== "name" ? record(value.wireguard)[key] : value[key];
  return key === "peers" ? String(Array.isArray(item) ? item.length : 0) : displayResourceValue(item, key);
}
function rowMode(value: Record<string, unknown>): string {
  const config = store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired;
  return config?.dhcp_clients?.[String(value.name)] ? "DHCP" : "Static";
}
function heading(key: string): string {
  if (props.section === "gateway_monitors" && key === "target") return "Probe Target";
  const labels: Record<string, string> = { display_name: "Display name", address_mode: "Mode", ipv6_addresses: "IPv6 addresses", kind: "Type", id: "VLAN ID", up: "Admin state", mtu: "MTU", source_address: "Source address", routing_table: "Routing table", key_ref: "Key reference", listen_port: "Listen port" };
  if ((physical.value || props.vlan) && key === "addresses") return "IPv4";
  if (physical.value && key === "ipv6_addresses") return "IPv6";
  if (props.inventory && key === "active_addresses") return "Active Addresses";
  return labels[key] ?? key.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
}
function interfaceChipColor(row: ResourceRow, key: string): string {
  if (key === "up") {
    const up = row.discovered?.up ?? row.value.up;
    return up === true ? "success" : up === false ? "error" : "default";
  }
  if (key === "role") return row.value.role === "lan" ? "info" : row.value.role === "wan" ? "secondary" : "default";
  if (key === "address_mode") return rowMode(row.value) === "DHCP" ? "primary" : "default";
  if (key === "ownership") return row.discovered?.ownership === "managed" ? "success" : row.discovered?.ownership === "unmanaged" ? "warning" : "default";
  return "primary";
}
const softflowStatus = (name: unknown) => store.runtime.data?.softflowd.find(item => item.name === name);
function observedEnabled(name: unknown): string {
  const observed = configSchema.safeParse(store.state.data?.observed);
  if (!observed.success) return "Unknown";
  const service = observed.data.softflowd.find(item => item.name === name);
  return service ? (service.enabled ? "True" : "False") : "Unknown";
}
// Observed differing from the desired setting is the part worth noticing.
function observedColor(row: Record<string, unknown>): string {
  const observed = observedEnabled(row.name);
  if (observed === "Unknown") return "default";
  return (observed === "True") !== (row.enabled !== false) ? "warning" : observed === "True" ? "success" : "default";
}
function stateColor(state?: string): string {
  return state === "running" ? "success" : ["unhealthy", "not_running", "exited", "error"].includes(state ?? "") ? "error" : "default";
}
const countFormat = new Intl.NumberFormat("en-US");
function droppedColor(value?: string): string {
  if (value === undefined) return "default";
  const count = BigInt(value);
  return count === 0n ? "green" : count < 1000n ? "yellow" : count < 100000n ? "orange" : "red";
}
function droppedTitle(status?: { dropped_packets?: string; statistics_complete?: boolean }): string {
  if (status?.dropped_packets === undefined) return "Dropped packets are not reported";
  return `${status.dropped_packets} packets dropped since this worker started${status.statistics_complete === false ? "; capture statistics are incomplete, so flow totals may undercount" : ""}`;
}
function runtime(name: unknown): string {
  const status = softflowStatus(name);
  if (!status) return "Unknown";
  const labels: Record<string, string> = {
    running: "Running; local responsiveness checked, delivery not verified", disabled: "Disabled", simulated: "Simulated; no real process",
    not_running: "Not running", unhealthy: "Unhealthy", exited: "Exited",
  };
  return `${labels[status.state] ?? `Unknown (${status.state})`}${status.pid ? ` · PID ${status.pid}` : ""}${status.started_at ? ` · ${formatTimestamp(status.started_at)} ${timeZone.value}` : ""}${status.error ? ` · ${status.error}` : ""}`;
}
function staged(value: unknown): string {
  if (!store.draft || !store.state.data) return "Committed desired";
  const changes = differences(store.state.data.desired, store.draft).filter(item => item.area === props.section);
  const name = record(value).name;
  return changes.some(item => name ? item.identity === name : stableJson(item.before) === stableJson(value) || stableJson(item.after) === stableJson(value)) ? "Staged change" : "Unchanged";
}
</script>

<template>
  <p
    v-if="dragError"
    role="alert"
    class="text-error mb-3"
  >
    {{ dragError }}
  </p>
  <v-table :class="{ 'interface-table': section === 'interfaces', 'compact-interface-table': compact, 'physical-table': physical, 'wireguard-table': wireguard, 'vlan-table': vlan, 'loopback-table': loopbacks, 'routes-table': section === 'routes', 'monitors-table': section === 'gateway_monitors', 'nat-table': section === 'nat', 'inventory-table': inventory }">
    <caption
      v-if="counterEnabled"
      class="text-caption text-medium-emphasis text-left"
      style="caption-side: bottom"
    >
      {{ counters.notice.value }}
      <span v-if="section === 'nat'">NAT counts initial connection-mapping evaluations, not all established packets.</span>
    </caption>
    <thead>
      <tr>
        <th
          v-if="['firewall', 'nat'].includes(section)"
          class="column-position"
        >
          Position
        </th>
        <th
          v-for="key in previewColumns"
          :key="key"
          :class="`column-${key}`"
        >
          {{ heading(key) }}
        </th>
        <template v-if="section === 'gateway_monitors'">
          <th
            v-for="metric in monitorMetrics"
            :key="metric"
            :class="{ 'column-health': metric === 'Health', 'column-loss': metric === 'Loss' }"
          >
            {{ metric }}
          </th>
        </template>
        <template v-if="section === 'softflowd'">
          <th>Observed</th>
          <th>State</th>
          <th>Dropped packets</th>
        </template>
        <th
          v-if="hasStatus"
          class="column-status"
        >
          Status
        </th>
        <th
          v-if="hasChanges"
          class="column-changes"
        >
          Changes
        </th>
        <th class="column-actions">
          Actions
        </th>
        <template v-if="counterEnabled">
          <th>Origin</th><th>Packets</th><th>Bytes</th>
        </template>
      </tr>
    </thead>
    <tbody>
      <template
        v-for="row in rows"
        :key="row.rowID"
      >
        <slot
          v-if="(editingRow !== undefined && editingRow >= 0 && row.index === editingRow) || (row.value.kind === 'ethernet' && row.value.name === expandedName)"
          name="editing-row"
          :columns="columns"
          :row="row"
          :keys="visibleColumns"
          :has-changes="hasChanges"
        />
        <tr
          v-else
          :class="{ 'physical-interface-row': section === 'interfaces' && row.value.kind === 'ethernet' && editable(row), 'rule-drop-target': counterEnabled && dropTarget === row.index }"
          :data-rule-index="counterEnabled ? row.index : undefined"
          @click="section === 'interfaces' && row.value.kind === 'ethernet' && editable(row) && !disabled && $emit('edit', row.value)"
        >
          <td v-if="['firewall', 'nat'].includes(section)">
            <span
              v-if="compact"
              class="compact-cell-label"
              aria-hidden="true"
            >Position</span>
            {{ row.index + 1 }}
          </td>
          <td
            v-for="key in previewColumns"
            :key="key"
            :class="{ 'interface-addresses': key === 'addresses' || key === 'active_addresses', 'ipv4-cell': physical && key === 'addresses' }"
            :title="physical && key === 'name' ? `${cell(row.value, 'kind', row.discovered)} · ${row.discovered?.ownership ?? 'managed'}` : undefined"
          >
            <span
              v-if="compact"
              class="compact-cell-label"
              aria-hidden="true"
            >{{ heading(key) }}</span>
            <v-btn
              v-if="section === 'gateway_monitors' && key === 'name'"
              :icon="expandedMonitor === row.value.name ? 'mdi-chevron-down' : 'mdi-chevron-right'"
              :aria-label="`Live statistics for ${row.value.name}`"
              :aria-expanded="expandedMonitor === row.value.name"
              :title="`Live statistics for ${row.value.name}`"
              size="x-small"
              variant="text"
              @click.stop="expandedMonitor = expandedMonitor === row.value.name ? null : String(row.value.name)"
            />
            <router-link
              v-if="!vlan && !inventory && key === 'name' && section === 'interfaces' && row.value.kind !== 'ethernet'"
              :to="`${wireguard ? '/wireguard' : '/interfaces'}/${encodeURIComponent(String(row.value.name))}`"
            >
              {{ cell(row.value, 'name') }}
            </router-link>
            <template v-else>
              <div
                v-if="key === visibleColumns[0] && key !== 'name' && record(row.value.metadata).display_name"
                class="text-body-2"
              >
                {{ record(row.value.metadata).display_name }}
              </div>
              <v-chip
                v-if="section === 'interfaces' && ['kind', 'ownership', 'role', 'up', 'address_mode'].includes(key)"
                :color="interfaceChipColor(row, key)"
                size="small"
                variant="tonal"
              >
                {{ cell(row.value, key, row.discovered) }}
              </v-chip>
              <template v-else>
                {{ cell(row.value, key, row.discovered) }}
              </template>
            </template>
            <div
              v-if="key === 'name' && record(row.value.metadata).display_name"
              class="text-caption text-medium-emphasis"
            >
              {{ physical ? record(row.value.metadata).display_name : row.value.name }}
            </div>
            <div
              v-if="vlan && key === 'name'"
              class="vlan-role text-caption text-medium-emphasis"
            >
              {{ cell(row.value, 'role') }}
            </div>
            <v-chip
              v-if="section === 'routes' && key === 'interface' && row.value.interface === blackholeTarget?.name"
              size="x-small"
              variant="tonal"
              class="ml-1"
            >
              {{ blackholeLabel }}
            </v-chip>
            <v-chip
              v-if="section === 'routes' && key === 'interface' && waitingForDhcp(row.value)"
              color="warning"
              size="x-small"
              variant="tonal"
              class="ml-1"
              :title="waitingForDhcp(row.value)"
            >
              Waiting for DHCP
            </v-chip>
            <div
              v-if="section === 'gateway_monitors' && key === 'interface'"
              class="text-caption text-medium-emphasis"
            >
              {{ row.value.mode === 'dhcp' ? 'DHCP' : row.value.source_address }}
            </div>
            <div
              v-if="section !== 'interfaces' && key === visibleColumns[0] && record(row.value.metadata).description"
              class="text-caption text-medium-emphasis"
            >
              {{ record(row.value.metadata).description }}
            </div>
          </td>
          <GatewayStatisticsPanel
            v-if="section === 'gateway_monitors'"
            :name="String(row.value.name)"
            summary
          >
            <template #default="{ measurements, healthColor, metricIndicators, worker }">
              <td
                v-for="metric in monitorMetrics"
                :key="metric"
                class="monitor-statistic-cell"
                :data-metric="metric"
                :title="String(measurements[metric] ?? (metric === 'Health' ? 'unknown' : 'Unavailable'))"
              >
                <span
                  class="compact-cell-label"
                  aria-hidden="true"
                >{{ metric }}</span>
                <v-chip
                  :color="metric === 'Health' ? (worker?.retrying ? 'warning' : healthColor) : metricIndicators[metric]?.color"
                  :title="metricIndicators[metric]?.tooltip"
                  :aria-label="metricIndicators[metric] ? `${metric}: ${measurements[metric] ?? 'Unavailable'} (${metricIndicators[metric].rating})` : undefined"
                  size="small"
                  variant="tonal"
                >
                  <ServiceWorkerStatus
                    v-if="metric === 'Health'"
                    :status="worker"
                    :label="String(measurements[metric] ?? 'unknown')"
                  />
                  <template v-else>
                    {{ measurements[metric] ?? 'Unavailable' }}
                  </template>
                </v-chip>
              </td>
            </template>
          </GatewayStatisticsPanel>
          <template v-if="section === 'softflowd'">
            <td>
              <v-chip
                :color="observedColor(row.value)"
                size="small"
                variant="tonal"
                :title="observedColor(row.value) === 'warning' ? 'Observed state differs from the desired setting' : undefined"
              >
                {{ observedEnabled(row.value.name) }}
              </v-chip>
            </td>
            <td>
              <v-chip
                :color="softflowStatus(row.value.name)?.retrying ? 'warning' : stateColor(softflowStatus(row.value.name)?.state)"
                size="small"
                variant="tonal"
                :title="runtime(row.value.name)"
              >
                <ServiceWorkerStatus :status="softflowStatus(row.value.name)" />
              </v-chip>
            </td>
            <td>
              <v-chip
                :color="droppedColor(softflowStatus(row.value.name)?.dropped_packets)"
                size="small"
                variant="tonal"
                :title="droppedTitle(softflowStatus(row.value.name))"
              >
                {{ softflowStatus(row.value.name)?.dropped_packets === undefined ? '—' : countFormat.format(BigInt(softflowStatus(row.value.name)!.dropped_packets!)) }}
              </v-chip>
            </td>
          </template>
          <td v-if="hasStatus">
            <span
              class="compact-cell-label"
              aria-hidden="true"
            >Status</span>
            <v-switch
              :key="statusVersions[row.rowID] ?? 0"
              :model-value="row.value.enabled !== false"
              :aria-label="statusLabel(row.value)"
              :title="row.value.enabled === false ? 'Disabled' : 'Enabled'"
              :disabled="disabled || !editable(row)"
              color="primary"
              density="compact"
              hide-details
              @update:model-value="toggleStatus(row, Boolean($event))"
            />
          </td>
          <td v-if="hasChanges">
            <span class="text-warning">{{ staged(row.value) === "Staged change" ? "Unsaved" : "" }}</span>
          </td>
          <td>
            <div
              v-if="editable(row)"
              class="d-flex align-center ga-1"
            >
              <v-btn
                icon="mdi-pencil-outline"
                aria-label="Edit / stage"
                :aria-expanded="row.value.kind === 'ethernet' ? expandedName === row.value.name : undefined"
                :title="`Edit ${row.value.name ?? 'entry'}`"
                size="small"
                variant="text"
                :disabled="disabled"
                @click.stop="$emit('edit', row.value)"
              />
              <v-btn
                v-if="section === 'interfaces' && !wireguard && row.value.kind === 'wireguard'"
                icon="mdi-wan"
                :to="`/tunnels`"
                :aria-label="`Edit tunnel interface ${row.value.name}`"
                :title="`Edit tunnel interface ${row.value.name}`"
                size="small"
                variant="text"
              />
              <v-btn
                v-if="wireguard"
                icon="mdi-lan"
                :to="`/interfaces/${encodeURIComponent(String(row.value.name))}`"
                :aria-label="`Edit interface ${row.value.name}`"
                :title="`Edit interface ${row.value.name}`"
                size="small"
                variant="text"
                :disabled="disabled"
              />
              <v-btn
                v-else
                :icon="row.value.kind === 'ethernet' ? 'mdi-ethernet-off' : 'mdi-delete-outline'"
                :aria-label="row.value.kind === 'ethernet' ? 'Release management' : 'Delete'"
                :title="row.value.kind === 'ethernet' ? 'Release management' : 'Delete'"
                size="small"
                color="error"
                variant="text"
                :disabled="disabled"
                @click.stop="$emit('delete', row)"
              />
              <button
                v-if="counterEnabled"
                type="button"
                class="drag-handle"
                :aria-label="`Drag rule ${row.index + 1}`"
                :disabled="disabled || editingRow !== undefined || Boolean(store.readOnlyReason)"
                @pointerdown="pointerStart($event, row.index)"
                @pointermove="pointerMove"
                @pointerup="drop"
                @pointercancel="cancelDrag"
              >
                <v-icon icon="mdi-drag" />
              </button>
            </div>
            <v-btn
              v-else-if="physical && adoptable(row)"
              icon="mdi-plus"
              aria-label="Manage this interface"
              title="Manage this interface"
              size="small"
              variant="text"
              :disabled="disabled"
              @click.stop="$emit('manage', row.discovered!)"
            />
            <v-btn
              v-else-if="adoptable(row)"
              size="small"
              prepend-icon="mdi-plus"
              :disabled="disabled"
              @click.stop="$emit('manage', row.discovered!)"
            >
              Manage this interface
            </v-btn>
            <span
              v-else
              class="text-medium-emphasis"
            >Read-only</span>
          </td>
          <td v-if="counterEnabled">
            <span class="compact-cell-label">Origin</span>
            <RuleOriginLabel :rule="row.value" />
          </td>
          <FirewallCounterCells
            v-if="counterEnabled"
            :counts="counters.counts(section === 'nat' ? `/firewall/nat/masquerade/${row.index}` : `/firewall/rules/${row.index}`, section === 'nat' ? 'postrouting' : 'forward')"
          />
        </tr>
        <slot
          name="expanded-row"
          :row="row"
          :columns="columns"
        />
        <tr v-if="section === 'gateway_monitors' && expandedMonitor === row.value.name && editingRow !== row.index">
          <td :colspan="columns">
            <GatewayStatisticsPanel :name="String(row.value.name)" />
          </td>
        </tr>
      </template>
      <slot
        name="additional-rows"
        :columns="columns"
        :keys="visibleColumns"
      />
      <FirewallCounterRows
        v-if="section === 'firewall'"
        :rows="counters.summaries('forward')"
        :columns="columns"
      />
      <tr v-if="(inventory || counterConfig) && !rows.length && editingRow === undefined && (inventory || section !== 'interfaces' || detail || wireguard || vlan)">
        <td :colspan="columns">
          {{ inventory ? "No discovered interfaces match this filter." : detail ? "Resource not found in this configuration." : "No configured resources." }}
        </td>
      </tr>
    </tbody>
  </v-table>
</template>

<style scoped>
.physical-interface-row { cursor: pointer; }
.interface-table :deep(td) {
  vertical-align: middle;
  white-space: nowrap;
  overflow-wrap: normal;
}
.interface-table:not(.compact-interface-table):not(.wireguard-table):not(.vlan-table):not(.inventory-table) :deep(td:nth-child(6)) {
  min-width: 180px;
  white-space: normal;
}
.interface-table :deep(th) {
  white-space: nowrap;
}
.interface-table :deep(td.interface-addresses) {
  min-width: 180px;
  max-width: 320px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.compact-interface-table { container-type: inline-size; }
.compact-interface-table :deep(.v-table__wrapper > table > thead > tr > th),
.compact-interface-table :deep(.v-table__wrapper > table > tbody > tr > td) { padding: 2px 6px; }
.compact-interface-table :deep(th) { white-space: normal; }
.compact-cell-label { display: none; }
.compact-interface-table :deep(td.interface-addresses) { min-width: 0; }
.compact-interface-table :deep(td) { white-space: normal; overflow-wrap: anywhere; }
.compact-interface-table :deep(td .v-btn) { max-width: 100%; }
.compact-interface-table :deep(.v-btn__content) { min-width: 0; white-space: normal; }
.compact-interface-table :deep(table) { width: 100%; min-width: 0; table-layout: fixed; }
.compact-interface-table :deep(.column-name) { width: 16%; }
.compact-interface-table :deep(.column-role) { width: 104px; }
.compact-interface-table :deep(.column-up) { width: 88px; }
.compact-interface-table :deep(.column-mtu) { width: 76px; }
.physical-table :deep(.column-address_mode) { width: 96px; }
.physical-table :deep(.column-ipv6_addresses) { width: 160px; }
.compact-interface-table :deep(.column-actions) { width: 96px; }
.vlan-table :deep(.column-id) { width: 120px; }
.vlan-table :deep(.column-parent) { width: 144px; }
.vlan-table :deep(.column-actions) { width: 112px; }
.loopback-table :deep(.column-kind) { width: 80px; }
.loopback-table :deep(.column-ownership) { width: 96px; }
.loopback-table :deep(.column-role) { width: 176px; }
.compact-interface-table :deep(.v-table__wrapper > table > tbody > .physical-editor-row > td),
.compact-interface-table :deep(.v-table__wrapper > table > tbody > .vlan-editor-row > td),
.compact-interface-table :deep(.v-table__wrapper > table > tbody > .resource-editor-row > td) { vertical-align: top; padding: 12px 6px; }
.routes-table :deep(.column-destination) { width: 30%; }
.routes-table :deep(.column-interface) { width: 128px; }
.routes-table :deep(.column-table) { width: 88px; }
.routes-table :deep(.column-metric) { width: 80px; }
.monitors-table :deep(.column-name) { width: 20%; }
.monitors-table :deep(.column-interface) { width: 96px; }
.monitors-table :deep(.column-health) { width: 96px; }
.monitors-table :deep(.column-loss) { width: 80px; }
.compact-interface-table :deep(.column-status) { width: 80px; }
.monitors-table :deep(.column-actions) { width: 96px; }
.nat-table :deep(.column-position) { width: 64px; }
.nat-table :deep(.column-family) { width: 112px; }
.nat-table :deep(.column-actions) { width: 128px; }
.monitors-table :deep(td) { vertical-align: middle; }
.compact-interface-table :deep(td:last-child .v-btn) { padding-inline: 8px; }
.physical-table :deep(td:last-child .v-btn__content),
.vlan-table :deep(td:last-child .v-btn__content),
.routes-table :deep(td:last-child .v-btn__content),
.nat-table :deep(td:last-child .v-btn__content),
.monitors-table :deep(td:last-child .v-btn__content) { white-space: nowrap; overflow-wrap: normal; letter-spacing: 0; }
@container (max-width: 860px) {
  .compact-interface-table :deep(table),
  .compact-interface-table :deep(tbody) { display: block; width: 100%; }
  .compact-interface-table :deep(thead) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .compact-interface-table :deep(tbody > tr) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .compact-interface-table :deep(.v-table__wrapper > table > tbody > tr > td) {
    min-width: 0;
    max-width: none;
    height: auto;
    padding: 4px 8px;
    border: 0;
  }
  .compact-interface-table :deep(td:last-child),
  .compact-interface-table :deep(.ipv4-cell),
  .compact-interface-table :deep(td[colspan]) { grid-column: 1 / -1; }
  .loopback-table :deep(.role-cell) { grid-column: 1 / -1; }
  .compact-interface-table :deep(.compact-cell-label) { display: block; margin-bottom: 2px; color: rgba(var(--v-theme-on-surface), 0.6); font-size: 12px; }
}
</style>