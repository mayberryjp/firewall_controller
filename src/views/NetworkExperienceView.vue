<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import DeviceIcon from "@/components/base/DeviceIcon.vue";
import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { useTimestamps } from "@/composables/useTimestamps";
import { numericAddress } from "@/services/configuration";
import {
  experienceColors, experienceLabel, experienceNumber, experienceRate, experienceMetricColor,
  getNetworkExperienceSummary, sumExperienceCounters, type ExperienceSummaryHost,
} from "@/services/networkExperience";

const { formatTimestamp, timeZone } = useTimestamps();
const { data, loading, error, stale } = useDiagnosticRead(signal => getNetworkExperienceSummary(signal), 10000);
const search = ref(""), now = ref(Date.now()), receivedAt = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
onBeforeUnmount(() => clearInterval(clock));
watch(data, () => { receivedAt.value = Date.now(); });
const age = computed(() => data.value?.age_ms == null ? null : data.value.age_ms + Math.max(0, now.value - receivedAt.value));
const historical = computed(() => stale.value || data.value?.status === "stale" || data.value?.status === "unavailable" ||
  (age.value !== null && age.value > 30000));
const expired = computed(() => age.value !== null && age.value > 3600000);
const columns = computed(() => [
  { key: "ip", label: "IP Address" },
  { key: "description", label: "Local Description" },
  { key: "network", label: "Network" },
  { key: "experience", label: "Experience" },
  { key: "throughput", label: "Download / Upload" },
  { key: "dns_response_time", label: "DNS RTT" },
  { key: "dropped_sent_packets", label: "Firewall Drops" },
  { key: "total_connections", label: "Connections" },
  { key: "remote_rtt", label: "RTT Median" },
  { key: "tcp_retransmissions", label: "TCP Retrans" },
  { key: "last_seen", label: `Last Seen (${timeZone.value})` },
] as const);
type SortColumn = typeof columns.value[number]["key"];
type Summary = ExperienceSummaryHost["summary"];
type Ratio = Summary["dns"]["unanswered_ratio"];
type Counter = Summary["firewall"]["dropped_sent_packets"];
type SourceName = keyof Summary["sources"];
const sortColumn = ref<SortColumn>("total_connections"), sortDescending = ref(true);
const textOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const levels = ["excellent", "good", "fair", "poor"] as const;
function summary(host: ExperienceSummaryHost): Summary | null { return expired.value ? null : host.summary; }
function predominantLevel(host: ExperienceSummaryHost): typeof levels[number] | null {
  const experience = summary(host)?.experience;
  let selected: typeof levels[number] | null = null, longest = 0;
  for (const level of levels) {
    const seconds = experience?.rated_levels[level].seconds ?? 0;
    if (seconds > 0 && seconds >= longest) {
      selected = level;
      longest = seconds;
    }
  }
  return selected;
}
function ipOrder(host: ExperienceSummaryHost): bigint {
  const bytes = numericAddress(host.ip_address).toByteArray();
  return (BigInt(bytes.length) << 128n) + bytes.reduce((value, byte) => (value << 8n) + BigInt(byte), 0n);
}
function sortValue(host: ExperienceSummaryHost): string | number | bigint | null {
  const value = summary(host);
  switch (sortColumn.value) {
    case "ip": return ipOrder(host);
    case "description": return host.metadata.classification || null;
    case "network": return host.interface?.name ?? null;
    case "experience": {
      const level = predominantLevel(host);
      return level === null ? null : levels.indexOf(level);
    }
    case "throughput": {
      const received = value?.traffic.received_bps, sent = value?.traffic.sent_bps;
      return received == null || sent == null ? null : received + sent;
    }
    case "dns_response_time": return value?.dns.response_time_p50_ms ?? null;
    case "dropped_sent_packets": return value?.firewall.dropped_sent_packets.total == null ? null : BigInt(value.firewall.dropped_sent_packets.total);
    case "total_connections": {
      const total = currentConnections(host);
      return total === null ? null : BigInt(total);
    }
    case "remote_rtt": return value?.tcp.rtt_remote.p50_ms ?? null;
    case "tcp_retransmissions": {
      const total = sumExperienceCounters(value?.tcp.retransmission_observations_received.total, value?.tcp.retransmission_observations_sent.total);
      return total === null ? null : BigInt(total);
    }
    case "last_seen": return value?.last_seen_at ? Date.parse(value.last_seen_at) : null;
  }
}
function sort(column: SortColumn): void {
  sortDescending.value = sortColumn.value === column ? !sortDescending.value : false;
  sortColumn.value = column;
}
const hosts = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return (data.value?.hosts ?? []).filter(host => !query || [
    host.configured_name, host.ip_address, host.metadata.host_name, host.metadata.classification, host.interface?.name,
  ].some(value => value?.toLocaleLowerCase().includes(query)))
    .map(host => ({ host, value: sortValue(host), ip: ipOrder(host) }))
    .sort((first, second) => {
      if (first.value === null && second.value !== null) return 1;
      if (second.value === null && first.value !== null) return -1;
      const comparison = first.value === null || second.value === null ? 0 :
        typeof first.value === "string" && typeof second.value === "string" ? textOrder.compare(first.value, second.value) :
          first.value < second.value ? -1 : first.value > second.value ? 1 : 0;
      if (!comparison) return first.ip < second.ip ? -1 : first.ip > second.ip ? 1 : 0;
      return sortDescending.value ? -comparison : comparison;
    }).map(row => row.host);
});
function sourceTitle(host: ExperienceSummaryHost, name: SourceName): string {
  const value = summary(host)?.sources[name];
  return value ? [
    `${value.available_slots} available`, `${value.partial_slots} partial`,
    `${value.not_observed_slots} not observed`, `${value.unavailable_slots} unavailable`,
    `${value.observed_slots} observed / ${value.complete_slots} source-complete slots`,
  ].join(" · ") : "Retained observations have expired.";
}
function counterTitle(value: Counter | undefined): string {
  return value ? `${value.observed_slots} observed / ${value.complete_slots} source-complete slots · ${value.measured_duration_ms} ms measured` : "";
}
function dropColor(host: ExperienceSummaryHost): string {
  const total = summary(host)?.firewall.dropped_sent_packets.total;
  return experienceMetricColor(total == null ? null : BigInt(total), "drops", historical.value || expired.value);
}
function timingTitle(host: ExperienceSummaryHost, kind: "dns" | "host" | "remote"): string {
  const value = summary(host);
  if (!value) return "Retained observations have expired.";
  const timing = kind === "dns" ? value.dns : value.tcp[`rtt_${kind}`];
  const reason = "timing_unavailable_reason" in timing ? timing.timing_unavailable_reason : timing.percentile_unavailable_reason;
  return [
    "Approximate p50 (median) from pooled 32-bin histograms, not an exact raw-observation quantile.",
    `${timing.timing_samples} timing samples · ${timing.timing_observed_slots} observed timing slots · ${timing.timing_missing_slots} missing timing slots`,
    timing.timing_coverage_complete ? "Timing subset complete; does not establish full-hour or capture coverage." : "Partial timing evidence; eligible timing histograms are missing.",
    ...(reason ? [`Timing unavailable: ${experienceLabel(reason)}`] : []),
    ...(kind === "dns" ? [
      `Pair-weighted DNS variation: ${experienceNumber(value.dns.response_time_variation_mean_ms)} ms · ${value.dns.variation_pairs} pairs`,
      `Pooled unanswered: ${ratioLabel(value.dns.unanswered_ratio)} (${ratioBasis(value.dns.unanswered_ratio)})`,
      `Excluded observations: ${value.dns.excluded_observations.total ?? "Unavailable"} (not unanswered)`,
    ] : ["Passive ACK timing, not an active ping."]),
    sourceTitle(host, kind === "dns" ? "dns" : "tcp"), coverageTitle(host),
  ].join(" · ");
}
function ratioLabel(value: Ratio | undefined): string {
  return value?.percent == null ? "Unavailable" : `${experienceNumber(value.percent)}%`;
}
function ratioBasis(value: Ratio | undefined): string {
  return `${value?.numerator ?? "Unavailable"} / ${value?.denominator ?? "Unavailable"}`;
}
function lastRatedTitle(host: ExperienceSummaryHost): string {
  const value = summary(host)?.experience.last_rated;
  return value ? [
    `Last rated (${timeZone.value}): ${formatTimestamp(value.sample_at)}`,
    value.is_last_observed_slot ? "Last observed interval" : "Earlier interval; not the current state",
    ...(host.summary.identity_changed ? ["IP evidence spans identities; current metadata does not identify past owners"] : []),
    ...value.experience.reasons.map(experienceLabel),
  ].join(" · ") : "No rated observations in this hour.";
}
function coverageTitle(host: ExperienceSummaryHost): string {
  const value = summary(host);
  return value ? [
    `${value.observed_slots}/360 observed`, `${value.complete_slots}/360 complete`,
    `${360 - value.observed_slots}/360 missing`, `${value.observation_epochs} observation epochs`,
    `${value.epoch_discontinuities} epoch discontinuities`,
    ...Object.entries(value.experience.reason_frequencies).map(([reason, count]) => `${experienceLabel(reason)}: ${count}`),
    ...(value.experience.reason_frequencies_truncated ? ["Additional coverage reasons omitted by backend"] : []),
  ].join(" · ") : "Retained observations have expired.";
}
function experienceTitle(host: ExperienceSummaryHost): string {
  const value = summary(host);
  if (!value) return "Retained observations have expired.";
  return [
    "Predominant experience in the observed hour: the level with the most rated time; ties use the worse level. Unrated time is excluded; not a current or averaged score.",
    lastRatedTitle(host), coverageTitle(host),
    ...(value.identity_changed ? ["Hourly IP totals span identities or attachments; metadata describes the current host only."] : []),
    ...levels.filter(level => value.experience.rated_levels[level].seconds > 0)
      .map(level => `${experienceLabel(level)}: ${value.experience.rated_levels[level].seconds}s`),
    ...(["idle", "insufficient_data", "incomplete", "unavailable", "missing"] as const)
      .filter(state => value.experience[state].slots)
      .map(state => `${experienceLabel(state)}: ${value.experience[state].seconds}s`),
  ].join(" · ");
}
function currentConnections(host: ExperienceSummaryHost): string | null {
  const value = summary(host)?.connections.current;
  return value && ["available", "partial", "stale"].includes(value.status) ? value.total : null;
}
function currentConnectionsStale(host: ExperienceSummaryHost): boolean {
  const value = summary(host)?.connections.current;
  return historical.value || value?.status === "stale" ||
    (value?.age_ms != null && value.age_ms + Math.max(0, now.value - receivedAt.value) > 30000);
}
function currentConnectionsTitle(host: ExperienceSummaryHost): string {
  const value = summary(host)?.connections.current;
  if (!value) return "Retained observations have expired.";
  const age = value.age_ms === null ? null : value.age_ms + Math.max(0, now.value - receivedAt.value);
  return [
    "Current total tracked connections from the pinned latest collection, not an hourly sum.",
    `Observed (${timeZone.value}): ${formatTimestamp(value.observed_at)}`,
    `Age: ${age === null ? "Unavailable" : `${experienceNumber(age / 1000)}s`}`,
    `Acquisition: ${experienceNumber(value.measurement_duration_ms)} ms`,
    experienceLabel(currentConnectionsStale(host) ? "stale" : value.status), value.error,
  ].filter(Boolean).join(" · ");
}
function averageConnectionsTitle(host: ExperienceSummaryHost): string {
  const value = summary(host)?.connections.average;
  return value ? [
    "Mean total connections across available ten-second snapshots; missing/partial snapshots excluded, not zero.",
    `${value.observed_slots}/360 snapshots · ${value.coverage_seconds}s coverage`,
    `First observed (${timeZone.value}): ${formatTimestamp(value.first_observed_at)}`,
    `Last observed (${timeZone.value}): ${formatTimestamp(value.last_observed_at)}`,
    sourceTitle(host, "connections"),
  ].join(" · ") : "Retained observations have expired.";
}
</script>

<template>
  <section aria-label="Network experience">
    <div class="experience-toolbar">
      <v-text-field
        v-model="search"
        aria-label="Search network experience"
        placeholder="Search hosts"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        hide-details
        clearable
        @click:clear="search = ''"
      />
      <span
        class="text-caption text-medium-emphasis"
        :title="data ? `Window (${timeZone}): ${formatTimestamp(data.window.start_at)} — ${formatTimestamp(data.window.end_at)}` : undefined"
      >1-hour observed experience</span>
    </div>
    <p
      v-if="!data && !error"
      role="status"
      class="my-3"
    >
      Loading network experience...
    </p>
    <v-alert
      v-if="error || data?.error"
      type="error"
      variant="tonal"
      role="alert"
      class="mb-3"
    >
      {{ error || data?.error }}
    </v-alert>
    <template v-if="data">
      <p
        v-for="failure in data.collector.sources.filter(source => source.error)"
        :key="failure.name"
        role="alert"
        class="text-error mb-2"
      >
        {{ experienceLabel(failure.name) }} (latest collection): {{ failure.error }}
      </p>
      <p
        v-if="historical"
        role="status"
        class="text-warning mb-3"
      >
        {{ expired ? "Retained measurements have expired." : data.status === "unavailable" ? "Current collection is unavailable; retained hourly evidence only." : "Retained hourly evidence is stale." }}
      </p>
      <p
        v-else-if="data.status === 'starting'"
        role="status"
        class="text-medium-emphasis mb-3"
      >
        Waiting for the first ten-second observation.
      </p>
      <p
        v-if="data.eligible_hosts > data.hosts.length || data.next_cursor"
        role="status"
        class="text-medium-emphasis mb-3"
      >
        Showing {{ data.hosts.length }} of {{ data.eligible_hosts }} eligible hosts. This view is limited to 256 hosts.
      </p>
    </template>
    <v-table
      v-if="data"
      density="compact"
      class="experience-table"
    >
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            :class="{ 'pinned-host': column.key === 'ip', 'compact-column': column.key === 'tcp_retransmissions' }"
            :aria-sort="sortColumn === column.key ? (sortDescending ? 'descending' : 'ascending') : 'none'"
          >
            <button
              type="button"
              class="experience-sort"
              :title="`Sort by ${column.label.toLowerCase()} ${sortColumn === column.key && !sortDescending ? 'descending' : 'ascending'}`"
              @click="sort(column.key)"
            >
              {{ column.label }}
              <v-icon
                :icon="sortColumn === column.key ? (sortDescending ? 'mdi-arrow-down' : 'mdi-arrow-up') : 'mdi-unfold-more-horizontal'"
                size="14"
                aria-hidden="true"
              />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="host in hosts"
          :key="host.ip_address"
          :data-host-address="host.ip_address"
          :class="{ 'host-not-rated': !expired && predominantLevel(host) === null }"
        >
          <td class="pinned-host">
            <RouterLink
              :to="{ name: 'network-experience-host', params: { address: host.ip_address } }"
              class="host-name"
              :aria-label="`View experience history for ${host.ip_address}`"
            >
              <DeviceIcon
                :name="host.metadata.icon"
                class="host-icon"
              />
              <span>{{ host.ip_address }}</span>
            </RouterLink>
          </td>
          <td
            class="host-description"
            :title="[host.metadata.classification, host.metadata.status === 'stale' ? 'Stale metadata' : '', host.metadata.error].filter(Boolean).join(' · ')"
          >
            {{ host.metadata.classification || "-" }}
            <v-chip
              v-if="host.metadata.status === 'stale'"
              size="x-small"
              color="warning"
              variant="tonal"
            >
              Stale
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              :color="host.interface ? 'info' : 'default'"
              variant="tonal"
            >
              {{ host.interface?.name || "Unmapped" }}
            </v-chip>
          </td>
          <td data-metric="experience">
            <v-chip
              v-if="!expired"
              size="small"
              variant="tonal"
              :color="historical || expired ? 'default' : experienceColors[predominantLevel(host) ?? 'unknown']"
              :title="experienceTitle(host)"
            >
              {{ experienceLabel(predominantLevel(host) ?? "Not Rated") }}
            </v-chip>
            <span
              v-else
              :title="experienceTitle(host)"
            >-</span>
          </td>
          <td data-metric="throughput">
            <div
              class="d-flex align-center flex-nowrap ga-1"
              :title="`Observed-hour rates use measured durations, not averages of interval rates. ${sourceTitle(host, 'traffic')}`"
            >
              <v-chip
                v-if="summary(host)?.traffic.received_bps != null"
                size="small"
                variant="tonal"
                :color="historical || summary(host)?.traffic.received_bps == null ? 'default' : 'info'"
              >
                ↓ {{ experienceRate(summary(host)?.traffic.received_bps, 0) }}
              </v-chip>
              <span
                v-else
                title="Download rate unavailable"
              >-</span>
              <v-chip
                v-if="summary(host)?.traffic.sent_bps != null"
                size="small"
                variant="tonal"
                :color="historical || summary(host)?.traffic.sent_bps == null ? 'default' : 'secondary'"
              >
                ↑ {{ experienceRate(summary(host)?.traffic.sent_bps, 0) }}
              </v-chip>
              <span
                v-else
                title="Upload rate unavailable"
              >-</span>
            </div>
          </td>
          <td data-metric="dns_response_time">
            <v-chip
              v-if="summary(host)?.dns.response_time_p50_ms != null"
              size="small"
              variant="tonal"
              :color="experienceMetricColor(summary(host)?.dns.response_time_p50_ms ?? null, 'dns', historical || expired)"
              :title="timingTitle(host, 'dns')"
            >
              {{ summary(host)?.dns.response_time_p50_ms == null ? "Unavailable" : `~${experienceNumber(host.summary.dns.response_time_p50_ms, false, 0)} ms` }}
              <v-icon
                v-if="!expired && host.summary.dns.response_time_p50_ms !== null && !host.summary.dns.timing_coverage_complete"
                icon="mdi-alert-circle-outline"
                size="12"
                class="ml-1"
                aria-label="Partial timing evidence"
              />
            </v-chip>
            <span
              v-else
              :title="timingTitle(host, 'dns')"
            >-</span>
          </td>
          <td data-metric="dropped_sent_packets">
            <v-chip
              v-if="summary(host)?.firewall.dropped_sent_packets.total != null"
              size="small"
              variant="tonal"
              :color="dropColor(host)"
              :title="`Observed-hour managed policy drops for sent packets; may be intentional and do not penalize experience. ${counterTitle(summary(host)?.firewall.dropped_sent_packets)} · ${sourceTitle(host, 'firewall')}`"
            >
              {{ summary(host)?.firewall.dropped_sent_packets.total ?? "Unavailable" }}
            </v-chip>
            <span
              v-else
              :title="sourceTitle(host, 'firewall')"
            >-</span>
          </td>
          <td data-metric="connections">
            <div class="d-flex align-center flex-nowrap ga-1">
              <div
                data-metric="total_connections"
                class="d-flex align-center ga-1"
              >
                <v-chip
                  v-if="currentConnections(host) !== null"
                  size="small"
                  variant="tonal"
                  :color="currentConnections(host) === null || currentConnectionsStale(host) ? 'default' : 'info'"
                  :title="currentConnectionsTitle(host)"
                >
                  Current {{ currentConnections(host) ?? "Unavailable" }}
                </v-chip>
                <span
                  v-else
                  :title="currentConnectionsTitle(host)"
                >-</span>
                <v-chip
                  v-if="currentConnections(host) !== null && currentConnectionsStale(host)"
                  size="x-small"
                  variant="tonal"
                  color="default"
                >
                  Stale
                </v-chip>
                <v-chip
                  v-else-if="currentConnections(host) !== null && summary(host)?.connections.current.status === 'partial'"
                  size="x-small"
                  variant="tonal"
                  color="warning"
                >
                  Partial
                </v-chip>
              </div>
              <div data-metric="average_connections">
                <v-chip
                  v-if="summary(host)?.connections.average.total != null"
                  size="small"
                  variant="tonal"
                  :color="historical || summary(host)?.connections.average.total == null ? 'default' : 'info'"
                  :title="averageConnectionsTitle(host)"
                >
                  Avg {{ experienceNumber(summary(host)?.connections.average.total, false, 0) }}
                </v-chip>
                <span
                  v-else
                  :title="averageConnectionsTitle(host)"
                >-</span>
              </div>
            </div>
          </td>
          <td data-metric="rtt_median">
            <div class="d-flex align-center flex-nowrap ga-1">
              <div
                v-for="side in (['host', 'remote'] as const)"
                :key="side"
                :data-metric="side === 'host' ? 'local_rtt' : 'remote_rtt'"
              >
                <v-chip
                  v-if="summary(host)?.tcp[`rtt_${side}`].p50_ms != null"
                  size="small"
                  variant="tonal"
                  :color="experienceMetricColor(summary(host)?.tcp[`rtt_${side}`].p50_ms ?? null, 'rtt', historical || expired)"
                  :title="timingTitle(host, side)"
                >
                  {{ side === "host" ? "Local" : "Remote" }} {{ summary(host)?.tcp[`rtt_${side}`].p50_ms == null ? "Unavailable" : `~${experienceNumber(host.summary.tcp[`rtt_${side}`].p50_ms, false, 0)} ms` }}
                  <v-icon
                    v-if="!expired && host.summary.tcp[`rtt_${side}`].p50_ms !== null && !host.summary.tcp[`rtt_${side}`].timing_coverage_complete"
                    icon="mdi-alert-circle-outline"
                    size="12"
                    class="ml-1"
                    aria-label="Partial timing evidence"
                  />
                </v-chip>
                <span
                  v-else
                  :title="timingTitle(host, side)"
                >-</span>
              </div>
            </div>
          </td>
          <td
            data-metric="tcp_retransmissions"
            class="compact-column"
          >
            <div class="d-flex align-center flex-nowrap ga-1">
              <div
                v-for="direction in (['received', 'sent'] as const)"
                :key="direction"
                :data-direction="direction"
              >
                <v-chip
                  v-if="summary(host)?.tcp[`retransmission_observations_${direction}`].total != null"
                  size="small"
                  variant="tonal"
                  :color="historical || summary(host)?.tcp[`retransmission_observations_${direction}`].total == null ? 'default' : direction === 'received' ? 'info' : 'secondary'"
                  :title="`Passive repeat observations, not confirmed packet loss. Pooled repeats: ${ratioLabel(summary(host)?.tcp[`retransmission_${direction}`])} (${ratioBasis(summary(host)?.tcp[`retransmission_${direction}`])} valid paired observations). ${counterTitle(summary(host)?.tcp[`retransmission_observations_${direction}`])} · ${sourceTitle(host, 'tcp')}`"
                >
                  {{ direction === "received" ? "↓" : "↑" }} {{ summary(host)?.tcp[`retransmission_observations_${direction}`].total ?? "Unavailable" }}
                </v-chip>
                <span
                  v-else
                  :title="`${direction === 'received' ? 'Download' : 'Upload'} TCP repeats unavailable · ${sourceTitle(host, 'tcp')}`"
                >-</span>
              </div>
            </div>
          </td>
          <td class="text-no-wrap">
            {{ formatTimestamp(summary(host)?.last_seen_at, "-") }}
          </td>
        </tr>
        <tr v-if="!hosts.length">
          <td :colspan="columns.length">
            {{ search ? "No matching hosts in the loaded summary." : "No configured protected hosts are attached to a managed LAN." }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-progress-linear
      v-if="loading && data"
      indeterminate
      aria-label="Updating network experience"
      class="mt-1"
    />
  </section>
</template>

<style scoped>
.experience-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.experience-toolbar :deep(.v-input) { max-width: 320px; }
.experience-table :deep(th), .experience-table :deep(td) { white-space: nowrap; padding: 6px 12px !important; height: 40px !important; }
.experience-table :deep(.compact-column) { width: 1%; }
.host-name { display: inline-flex; align-items: center; gap: 8px; color: rgb(var(--v-theme-primary)); text-align: left; text-decoration: none; }
.host-name:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.experience-sort { display: inline-flex; align-items: center; gap: 6px; color: inherit; font: inherit; text-align: left; }
.experience-sort:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; }
.host-icon { width: 18px; height: 18px; }
.host-description { max-width: 250px; overflow: hidden; text-overflow: ellipsis; }
.experience-table :deep(.pinned-host) { position: sticky; left: 0; z-index: 1; background: rgb(var(--v-theme-surface-card)); }
.host-not-rated { opacity: 0.18; }
.host-not-rated:hover, .host-not-rated:focus-within { opacity: 1; }
@media (max-width: 700px) {
  .experience-toolbar { align-items: stretch; flex-direction: column; gap: 8px; }
  .experience-toolbar :deep(.v-input) { max-width: none; }
}
</style>
