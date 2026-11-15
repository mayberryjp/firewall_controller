<script setup lang="ts">
import { computed, useId } from "vue";
import DeviceIcon from "@/components/base/DeviceIcon.vue";
import { experienceColors, experienceLabel, experienceNumber, type ExperienceHistory, type ExperienceSample } from "@/services/networkExperience";
import { formatHostMetric, hostExperienceMetrics, hostMetricColor, type HostExperienceMetric } from "@/services/hostExperience";

const props = defineProps<{ host: ExperienceHistory["host"]; sample: ExperienceSample | null; stale: boolean; playing: boolean }>();
const id = useId();
const groups = [
  { key: "traffic", title: "Traffic & TCP", icon: "mdi-swap-vertical", metrics: ["download", "upload", "retrans_received", "retrans_sent"] },
  { key: "remote", title: "Remote Path", icon: "mdi-wan", metrics: ["remote_p50", "remote_p95", "unreplied"] },
  { key: "dns", title: "DNS Experience", icon: "mdi-dns-outline", metrics: ["dns_p95", "dns_unanswered", "dns_servfail"] },
  { key: "pressure", title: "Host Receive Pressure", icon: "mdi-gauge", metrics: ["host_p50", "host_min_window", "host_window_decreases", "host_zero_window"] },
  { key: "policy", title: "Connections & Firewall", icon: "mdi-shield-outline", metrics: ["connections", "established", "drops_received", "drops_sent"] },
] satisfies { key: string; title: string; icon: string; metrics: HostExperienceMetric[] }[];
const score = computed(() => props.sample?.experience.score ?? null);
const sameOwner = computed(() => !props.sample || props.sample.configured_host_id === props.host.configured_host_id);
const description = computed(() => sameOwner.value ? props.host.metadata.classification || "Host" : props.sample?.configured_name || "Previous Host");
const accent = computed(() => {
  if (props.stale || !props.sample) return "var(--text-muted)";
  return { excellent: "#34d399", good: "#a3e635", fair: "#facc15", poor: "#ff657e", unknown: "var(--text-muted)" }[props.sample.experience.level];
});
</script>

<template>
  <section
    class="host-signal-map"
    :style="{ '--host-accent': accent }"
    aria-label="Selected interval host signal map"
  >
    <svg
      class="signal-wires"
      viewBox="0 0 1040 360"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          :id="id"
          x1="0"
          y1="0"
          x2="1"
          y2="0"
        >
          <stop
            offset="0%"
            stop-color="#38bdf8"
          /><stop
            offset="50%"
            :stop-color="accent"
          /><stop
            offset="100%"
            stop-color="#a78bfa"
          />
        </linearGradient>
      </defs>
      <g
        :stroke="`url(#${id})`"
        :class="{ 'is-playing': playing && sample && !stale }"
      >
        <path d="M 300 80 H 390 Q 430 80 430 120 V 180 H 520" />
        <path d="M 300 260 H 390 Q 430 260 430 220 V 180 H 520" />
        <path d="M 740 80 H 650 Q 610 80 610 120 V 180 H 520" />
        <path d="M 740 260 H 650 Q 610 260 610 220 V 180 H 520" />
      </g>
    </svg>
    <article
      v-for="group in groups"
      :key="group.key"
      class="signal-card"
      :class="`signal-card--${group.key}`"
      :aria-label="group.title"
    >
      <h2>
        <v-icon
          :icon="group.icon"
          size="16"
        />{{ group.title }}
      </h2>
      <dl class="signal-readings">
        <div
          v-for="metric in group.metrics"
          :key="metric"
          :data-host-metric="metric"
        >
          <dt>{{ hostExperienceMetrics[metric].label }}</dt>
          <dd>
            <v-chip
              :color="hostMetricColor(sample, metric, stale)"
              variant="tonal"
              size="small"
            >
              {{ formatHostMetric(sample, metric) }}
            </v-chip>
          </dd>
        </div>
      </dl>
    </article>
    <div class="host-core">
      <div class="host-platform">
        <svg
          viewBox="0 0 240 160"
          aria-hidden="true"
        >
          <path
            d="M 20 89 L 120 139 L 220 89 L 220 103 L 120 153 L 20 103 Z"
            fill="var(--bg-elevated)"
            stroke="var(--border-light)"
          />
          <path
            d="M 20 75 L 120 25 L 220 75 L 120 125 Z"
            fill="var(--bg-secondary)"
            stroke="var(--host-accent)"
          />
          <path
            d="M 40 75 L 120 35 L 200 75 L 120 115 Z"
            fill="none"
            stroke="var(--host-accent)"
            stroke-opacity=".3"
          />
          <path
            d="M 40 93 V 106 M 55 100 V 113 M 70 108 V 121"
            stroke="var(--host-accent)"
            stroke-width="3"
          />
        </svg>
        <DeviceIcon
          :name="sameOwner ? host.metadata.icon : null"
          :score="score === null || stale || sample?.experience.level === 'unknown' ? null : Math.round(100 - score)"
          class="host-core-icon"
        />
      </div>
      <p class="host-core-address">
        {{ host.ip_address }}
      </p>
      <p
        class="host-core-description"
        :title="sameOwner ? host.metadata.error || (host.metadata.status === 'stale' ? 'Stale device metadata' : undefined) : 'This interval belongs to a previous configured host at this IP.'"
      >
        {{ description }}
      </p>
      <v-chip
        v-if="!sameOwner"
        size="x-small"
        variant="tonal"
        class="mb-2"
      >
        Previous Host Ownership
      </v-chip>
      <v-chip
        :color="stale || !sample ? 'default' : experienceColors[sample.experience.level]"
        variant="tonal"
      >
        {{ sample ? experienceLabel(sample.experience.level) : "No Observation" }}<span
          v-if="score !== null"
          class="ml-2"
        >{{ experienceNumber(score) }}/100</span>
      </v-chip>
      <p class="host-core-network">
        {{ sample?.interface?.name ?? "No observed network" }}<span v-if="sample"> · {{ experienceLabel(sample.activity) }}</span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.host-signal-map { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 240px minmax(0, 1fr); grid-template-areas: "traffic host remote" "dns host pressure" "policy policy policy"; gap: 20px 30px; padding: 20px 0; isolation: isolate; }
.host-signal-map::before { content: ""; position: absolute; z-index: -2; inset: 0; background: radial-gradient(ellipse at 50% 40%, rgba(var(--v-theme-primary), .065), transparent 55%); }
.signal-wires { position: absolute; z-index: -1; inset: 20px 0 auto; width: 100%; height: calc(100% - 140px); opacity: .55; }
.signal-wires path { fill: none; stroke-width: 1.5; stroke-dasharray: 8 9; vector-effect: non-scaling-stroke; }
.signal-wires .is-playing path { animation: signal-replay 1.5s linear infinite; }
.signal-card { min-width: 0; align-self: center; padding: 15px; background: var(--bg-secondary); border: 1px solid var(--border-light); border-radius: 12px; box-shadow: 0 12px 30px #0002; }
.signal-card--traffic { grid-area: traffic; }.signal-card--remote { grid-area: remote; }.signal-card--dns { grid-area: dns; }.signal-card--pressure { grid-area: pressure; }.signal-card--policy { grid-area: policy; }
.signal-card h2 { display: flex; align-items: center; gap: 8px; margin-bottom: 13px; font-size: 10px; font-weight: 650; letter-spacing: 1.3px; text-transform: uppercase; color: var(--text-secondary); }
.signal-readings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 10px; }
.signal-card--policy .signal-readings { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.signal-readings dt { font-size: 10px; color: var(--text-muted); margin-bottom: 5px; }
.signal-readings dd { margin: 0; font-variant-numeric: tabular-nums; }
.signal-readings :deep(.v-chip) { max-width: 100%; height: auto; min-height: 28px; }
.signal-readings :deep(.v-chip__content) { white-space: normal; overflow-wrap: anywhere; }
.host-core { grid-area: host; align-self: center; text-align: center; min-width: 0; padding: 10px 0; }
.host-platform { position: relative; height: 155px; filter: drop-shadow(0 0 18px color-mix(in srgb, var(--host-accent) 15%, transparent)); }
.host-platform svg { width: 240px; max-width: 100%; height: 160px; }
.host-core-icon { position: absolute; width: 68px; height: 68px; left: 50%; top: 30px; transform: translateX(-50%); }
.host-core-address { font-size: 15px; font-weight: 650; overflow-wrap: anywhere; margin: 0 0 5px; }
.host-core-description { font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; overflow-wrap: anywhere; }
.host-core-network { margin-top: 10px; font-size: 10px; color: var(--text-muted); overflow-wrap: anywhere; }
@keyframes signal-replay { to { stroke-dashoffset: -34; } }
@media (max-width: 1000px) { .host-signal-map { grid-template-columns: minmax(0, 1fr) 200px minmax(0, 1fr); gap: 15px; }.signal-readings { grid-template-columns: 1fr; }.host-platform svg { width: 200px; } }
@media (max-width: 700px) { .host-signal-map { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-areas: "host host" "traffic remote" "dns pressure" "policy policy"; gap: 12px; }.host-core { padding: 0; }.host-platform { height: 140px; }.signal-wires { display: none; }.signal-card { align-self: stretch; padding: 12px; }.signal-card--policy .signal-readings { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: reduce) { .signal-wires .is-playing path { animation: none; } }
</style>
