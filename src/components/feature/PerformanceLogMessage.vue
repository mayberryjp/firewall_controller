<script setup lang="ts">
import { computed } from "vue";
import { linkInterfaceSchema } from "@/services/linkDiagnostics";
import type { PerformanceLogEvent } from "@/services/logs";

const props = defineProps<{ event: PerformanceLogEvent | null; message: string }>();
type Chip = { label: string; value: string; color: string; title?: string };
type EvidenceRow = { title: string; color: string; resource: string; interface: string; target: string; chips: Chip[]; error?: string };
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function count(value: unknown): string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value) ? value :
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "";
}
function measurement(value: unknown, unit: string): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? `${value.toFixed(2)}${unit}` : "";
}
function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b[a-z]/g, letter => letter.toUpperCase());
}
function healthColor(value: unknown): string {
  return value === "up" ? "success" : value === "down" ? "error" : value === "degraded" ? "warning" : "default";
}
function describe(event: string, details: Record<string, unknown>): EvidenceRow | null {
  const chips: Chip[] = [];
  function chip(name: string, value: string, color = "default", title?: string): void {
    if (value) chips.push({ label: name, value, color, title });
  }
  const identity = { resource: text(details.name), interface: text(details.interface), target: text(details.target) };
  const window = object(details.window);
  function gatewayWindow(): void {
    chip("Window loss", measurement(window.loss_percent, "%"));
    chip("RTT avg", measurement(window.rtt_avg_ms, " ms"), "info");
  }
  switch (event) {
    case "gateway_probe_loss": {
      const lost = count(details.newly_lost);
      if (!lost || lost === "0") return null;
      chip("New timeouts", lost, "warning");
      gatewayWindow();
      return { title: "Probe timeout", color: "warning", ...identity, chips };
    }
    case "gateway_health_change": {
      const previous = text(details.previous_health), current = text(details.health);
      if (!previous || !current) return null;
      chip("Health", `${label(previous)} to ${label(current)}`, healthColor(current));
      chip("Window loss", measurement(window.loss_percent, "%"));
      chip("RTT avg", measurement(window.rtt_avg_ms, " ms"), "info");
      return { title: "Gateway health changed", color: healthColor(current), ...identity, chips };
    }
    case "gateway_unavailable":
    case "link_monitor_unavailable": {
      const error = text(details.error);
      if (!error) return null;
      return { title: event === "gateway_unavailable" ? "Gateway measurement unavailable" : "Link monitoring unavailable",
        color: "error", ...identity, chips, error };
    }
    case "link_monitor_recovered":
      return { title: "Link monitoring recovered", color: "success", ...identity, chips };
    case "qdisc_drops": {
      const queue = object(details.qdisc), delta = count(queue.drops_delta);
      if (!delta) return null;
      chip("New drops", delta, "warning");
      chip("Total", count(object(queue.queue).drops));
      chip("Handle", count(queue.handle)); chip("Parent", count(queue.parent));
      return { title: "Queue drops", color: "warning", resource: text(queue.kind),
        interface: text(queue.name) || `Index ${count(queue.index) || "unknown"}`, target: "", chips };
    }
    case "interface_errors_or_drops": {
      const parsed = linkInterfaceSchema.safeParse(details.interface);
      if (!parsed.success) return null;
      const link = parsed.data;
      for (const [key, name] of [
        ["rx_errors", "RX errors"], ["tx_errors", "TX errors"], ["rx_drops", "RX drops"], ["tx_drops", "TX drops"],
        ["rx_frame_errors", "RX frame errors"], ["rx_length_errors", "RX length errors"],
      ] as const) {
        const delta = link[`${key}_delta`];
        const subcategory = key === "rx_frame_errors" || key === "rx_length_errors";
        chip(`New ${name}`, delta ?? "Unavailable", delta !== null && delta !== "0" ? "warning" : "default",
          `Cumulative ${name}: ${link[key]}${subcategory ? ". Included in RX errors, not additional packet loss or proof of a WireGuard AllowedIPs mismatch." : ""}`);
      }
      return { title: "Interface errors / drops", color: "warning", resource: "",
        interface: link.name || `Index ${link.index}`, target: "", chips };
    }
    case "local_tcp_retransmissions": {
      const delta = count(object(details.local_tcp).retransmissions_delta);
      if (!delta) return null;
      chip("New retransmissions", delta, "warning");
      return { title: "TCP retransmissions", color: "warning", ...identity, resource: "Router-local TCP", chips };
    }
    case "diagnostic_capture_drops": {
      const delta = count(details.drops_delta);
      if (!delta) return null;
      chip("New capture drops", delta, "warning");
      return { title: "Monitoring coverage lost", color: "warning", ...identity, resource: "Diagnostic capture", chips };
    }
    default: return null;
  }
}
const row = computed(() => {
  const event = props.event, details = event?.details;
  if (!details || !event.event) return null;
  if (event.event === "link_observation") {
    if (!Array.isArray(details.evidence) || details.evidence.length !== 1) return null;
    const evidence = object(details.evidence[0]);
    return describe(text(evidence.event), evidence);
  }
  return describe(event.event, details);
});
</script>

<template>
  <template v-if="row">
    <td>
      <v-chip
        :color="row.color"
        size="small"
        variant="tonal"
        class="evidence-event"
      >
        {{ row.title }}
      </v-chip>
    </td>
    <td class="evidence-resource">
      {{ row.resource || "-" }}
    </td>
    <td class="evidence-interface">
      {{ row.interface || "-" }}
    </td>
    <td class="evidence-target">
      {{ row.target || "-" }}
    </td>
    <td>
      <div
        v-if="row.chips.length"
        class="evidence-metrics"
      >
        <v-chip
          v-for="chip in row.chips"
          :key="chip.label"
          :color="chip.color"
          :title="chip.title"
          size="small"
          variant="tonal"
        >
          {{ chip.label }}: {{ chip.value }}
        </v-chip>
      </div>
      <p
        v-if="row.error"
        class="text-error"
      >
        {{ row.error }}
      </p>
      <span v-if="!row.chips.length && !row.error">-</span>
    </td>
  </template>
  <template v-else>
    <td>{{ event?.event ? label(event.event) : "Unrecognized record" }}</td>
    <td>-</td><td>-</td><td>-</td>
    <td
      class="log-message opaque-message"
    >
      {{ message }}
    </td>
  </template>
</template>

<style scoped>
.evidence-metrics { display: flex; flex-wrap: nowrap; align-items: center; gap: 6px; }
.evidence-resource { font-weight: 600; }
.text-error { margin: 0; white-space: nowrap; }
.evidence-metrics :deep(.v-chip) { flex-shrink: 0; }
.opaque-message { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 640px; }
</style>
