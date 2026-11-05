<script setup lang="ts">
import { computed } from "vue";
import type { PathTestStatus } from "@/services/pathTests";

const props = defineProps<{ status: PathTestStatus }>();
const result = computed(() => props.status.result);
const udp = computed(() => result.value?.udp ??
  (props.status.progress?.phase === "udp_complete" ? props.status.progress.udp : null));
const directions = ["outbound", "inbound"] as const;
const value = (input: number | null | undefined, unit = "") => input == null ? "Unavailable" : `${input}${unit ? ` ${unit}` : ""}`;
const limits = computed(() => {
  const data = result.value?.limits;
  return data ? [
    ["Requested maximum", data.requested_maximum_mtu_bytes], ["Interface MTU", data.interface_mtu_bytes],
    ["Initial route MTU", data.initial_route_mtu_bytes], ["Final cached route MTU", data.final_cached_route_mtu_bytes],
    ["Local send cap", data.local_cap_bytes], ["Peer receive cap", data.peer_cap_bytes],
    ["Local receive cap", data.local_receive_cap_bytes], ["Peer send cap", data.peer_send_cap_bytes],
    ["Outbound tested cap", data.tested_cap_bytes], ["Inbound tested cap", data.inbound_tested_cap_bytes],
    ["IP/UDP overhead", data.ip_udp_overhead_bytes], ["IPv6 minimum MTU", data.ipv6_minimum_mtu_bytes],
    ["Conclusive path MTU", data.path_mtu_bytes],
  ] : [];
});
const tcpGroups = computed(() => {
  const tcp = result.value?.tcp;
  if (!tcp) return [];
  const outbound = (rows: typeof tcp.outbound_trials) => rows.map(row => ({
    ...row, sender_mss: row.effective_mss_bytes, receiver_mss: row.peer_effective_mss_bytes,
  }));
  return [
    { title: "Outbound TCP MSS trials", rows: outbound(tcp.outbound_trials) },
    { title: "Inbound TCP MSS trials", rows: tcp.inbound_trials.map(row => ({
      ...row, sender_mss: row.sender_effective_mss_bytes, receiver_mss: row.effective_mss_bytes,
      retransmits: row.sender_retransmits, error: null, connect_ms: null, authentication_rtt_ms: null,
    })) },
    ...(tcp.peer_sender_trials === null ? [] : [{ title: "Peer-reported TCP sender trials", rows: outbound(tcp.peer_sender_trials) }]),
  ];
});
</script>

<template>
  <div class="path-results">
    <template v-if="udp">
      <section
        v-for="direction in directions"
        :key="direction"
        :aria-label="`${direction} UDP evidence`"
      >
        <h3>{{ direction === 'outbound' ? 'Outbound' : 'Inbound' }} IP packet-size evidence</h3>
        <p>Largest verified IP packet: {{ value(udp[direction].largest_verified_ip_size_bytes, 'bytes') }}. RTT source: {{ udp[direction].rtt_origin }}.</p>
        <p>{{ udp[direction].delivery_evidence }}</p>
        <v-table density="compact">
          <caption class="d-sr-only">
            {{ direction }} UDP packet sizes
          </caption>
          <thead><tr><th>IP packet bytes</th><th>Delivered</th><th>Attempted</th><th>Sent</th><th>Loss</th><th>ACK timeouts</th><th>EMSGSIZE</th><th>Send errors</th><th>Mean RTT (ms)</th><th>Status</th></tr></thead>
          <tbody>
            <tr
              v-for="row in udp[direction].sizes"
              :key="row.ip_size_bytes"
            >
              <th scope="row">
                {{ row.ip_size_bytes }}
              </th>
              <td>{{ row.delivered }}</td><td>{{ value(row.attempted) }}</td><td>{{ value(row.sent) }}</td>
              <td>{{ row.loss_fraction === null ? 'Unavailable' : `${(row.loss_fraction * 100).toFixed(1)}%` }}</td>
              <td>{{ value(row.ack_timeouts) }}</td><td>{{ value(row.emsgsize) }}</td><td>{{ value(row.send_errors) }}</td>
              <td>{{ value(row.mean_rtt_ms) }}</td><td>{{ row.status }}</td>
            </tr>
          </tbody>
        </v-table>
      </section>
    </template>
    <template v-if="result">
      <p>{{ result.interface }}: {{ result.source_address }} to {{ result.peer_address }}; {{ result.role }}. Elapsed: {{ result.elapsed_ms }} ms.</p>
      <p>Authenticated peer report: {{ result.peer_report_received ? 'Received' : 'Unavailable' }}. Local report acknowledged: {{ result.local_report_acknowledged ? 'Yes' : 'No' }}.</p>
      <p v-if="!result.peer_report_received">
        Missing peer sender evidence is unavailable, not zero. Local receive evidence remains independent.
      </p>
      <section
        v-for="group in tcpGroups"
        :key="group.title"
        :aria-label="group.title"
      >
        <h3>{{ group.title }}</h3>
        <v-table density="compact">
          <caption class="d-sr-only">
            {{ group.title }}
          </caption>
          <thead><tr><th>Trial</th><th>Requested MSS (bytes)</th><th>Sender MSS (bytes)</th><th>Receiver MSS (bytes)</th><th>Delivered bytes</th><th>Goodput (bit/s)</th><th>Elapsed (ms)</th><th>Sender retransmits</th><th>Kernel RTT (ms)</th><th>Connect (ms)</th><th>Authentication RTT (ms)</th><th>Evidence / error</th></tr></thead>
          <tbody>
            <tr
              v-for="row in group.rows"
              :key="row.trial"
            >
              <th scope="row">
                {{ row.trial }} ({{ row.status }})
              </th><td>{{ row.requested_mss_bytes }}</td>
              <td>{{ value(row.sender_mss) }}</td><td>{{ value(row.receiver_mss) }}</td><td>{{ value(row.delivered_bytes) }}</td>
              <td>{{ value(row.goodput_bits_per_second) }}</td><td>{{ value(row.elapsed_ms) }}</td><td>{{ value(row.retransmits) }}</td>
              <td>{{ value(row.kernel_rtt_ms) }}</td><td>{{ value(row.connect_ms) }}</td><td>{{ value(row.authentication_rtt_ms) }}</td>
              <td>{{ row.error || row.delivery_evidence || 'Unavailable' }}</td>
            </tr>
            <tr v-if="!group.rows.length">
              <td colspan="12">
                No trials reported.
              </td>
            </tr>
          </tbody>
        </v-table>
      </section>
      <p>{{ result.tcp.mss_observation }}. Each trial is capped at {{ result.tcp.trial_byte_limit }} bytes and {{ result.tcp.rate_limit_bytes_per_second }} bytes/s.</p>
      <details>
        <summary>Interface, route and peer ceilings</summary>
        <p>These are ceilings, not verified path MTUs. Total IP packet bytes are different from TCP payload MSS.</p>
        <dl class="limits">
          <template
            v-for="[label, bytes] in limits"
            :key="String(label)"
          >
            <dt>{{ label }}</dt><dd>{{ bytes === null ? 'Unavailable' : `${bytes} bytes` }}</dd>
          </template>
        </dl>
        <p>Sampling: at most {{ result.limits.candidate_limit }} IP sizes, {{ result.limits.maximum_probes_per_size }} probes per size; measurements up to {{ result.limits.measurement_limit_seconds }} seconds.</p>
      </details>
      <p
        v-for="(count, name) in result.udp.receive_path_errors"
        :key="name"
      >
        Receive-path {{ name }}: {{ count }}
      </p>
      <ul>
        <li
          v-for="(limitation, index) in result.limitations"
          :key="index"
        >
          {{ limitation }}
        </li>
      </ul>
    </template>
    <p v-if="udp || result">
      Finite samples do not establish an ideal MTU. Loss and timeouts are inconclusive; inner delivery does not prove that outer tunnel packets were not fragmented. These rate-limited endpoint tests do not prove forwarded-LAN throughput or configure persistent MSS clamping.
    </p>
  </div>
</template>

<style scoped>
.path-results, .path-results section { min-width: 0; }
.path-results section { margin-block: 20px; }
.path-results :deep(th), .path-results :deep(td) { white-space: nowrap; }
.path-results :deep(td:last-child) { white-space: normal; min-width: 180px; }
.limits { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.limits dd { margin: 0; }
</style>
