<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import DeviceIcon from "@/components/base/DeviceIcon.vue";
import NetworkExperienceHistory from "@/components/feature/NetworkExperienceHistory.vue";
import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { useTimestamps } from "@/composables/useTimestamps";
import { formatBytes } from "@/services/hostHealth";
import {
  experienceColors, experienceLabel, experienceRate, getNetworkExperience, sumExperienceCounters,
  type ExperienceHost,
} from "@/services/networkExperience";

const { formatTimestamp, timeZone } = useTimestamps();
const { data, loading, error, stale } = useDiagnosticRead(signal => getNetworkExperience(signal), 10000);
const search = ref(""), selected = ref(""), now = ref(Date.now()), receivedAt = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
onBeforeUnmount(() => clearInterval(clock));
watch(data, value => {
  receivedAt.value = Date.now();
  if (!value) selected.value = "";
});
const age = computed(() => data.value?.age_ms == null ? null : data.value.age_ms + Math.max(0, now.value - receivedAt.value));
const historical = computed(() => stale.value || data.value?.status === "stale" || (age.value !== null && age.value > 30000));
const expired = computed(() => age.value !== null && age.value > 3600000);
const hosts = computed(() => {
  const query = search.value?.trim().toLocaleLowerCase();
  return (data.value?.hosts ?? []).filter(host => !query || [
    host.configured_name, host.ip_address, host.metadata.host_name, host.metadata.classification, host.interface?.name,
  ].some(value => value?.toLocaleLowerCase().includes(query)));
});
const selectedHost = computed(() => data.value?.hosts.find(host => host.ip_address === selected.value));
function sample(host: ExperienceHost) { return expired.value ? null : host.sample; }
function scoreLabel(host: ExperienceHost): string {
  const value = sample(host)?.experience;
  if (!value) return expired.value ? "Expired" : "Waiting";
  const level = experienceLabel(value.level);
  return `${historical.value ? "Stale · " : ""}${level}${value.score === null ? "" : ` · ${value.score}`}`;
}
function scoreTitle(host: ExperienceHost): string {
  const value = sample(host)?.experience;
  if (!value) return "Waiting for a completed observation.";
  return [experienceLabel(value.status), `${value.basis_seconds}s evidence`,
    ...value.reasons.map(experienceLabel)].join(" · ");
}
function traffic(host: ExperienceHost, direction: "sent_bps" | "received_bps"): number | null {
  const value = sample(host)?.traffic;
  return value && ["available", "partial"].includes(value.status) ? value[direction] : null;
}
function activity(host: ExperienceHost): string {
  const value = sample(host);
  if (!value) return "Unknown";
  if (value.activity !== "active") return experienceLabel(value.activity);
  const sent = traffic(host, "sent_bps"), received = traffic(host, "received_bps");
  return sent === null || received === null ? "Active" : experienceRate(sent + received);
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
        v-if="data"
        class="text-caption text-medium-emphasis"
      >Collected ({{ timeZone }}): {{ formatTimestamp(data.collected_at) }}</span>
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
    <p
      v-if="data && (historical || data.status === 'unavailable')"
      role="status"
      class="text-warning mb-3"
    >
      {{ expired ? "Retained measurements have expired." : historical ? "Historical observations only; current measurements are stale." : "Current measurements are unavailable." }}
    </p>
    <p
      v-else-if="data?.status === 'starting'"
      role="status"
      class="text-medium-emphasis mb-3"
    >
      Waiting for the first ten-second observation.
    </p>
    <v-table
      v-if="data"
      density="compact"
      class="experience-table"
    >
      <thead>
        <tr>
          <th>Name</th><th>Local description</th><th>Network</th><th>IP address</th>
          <th>Experience</th><th>Activity</th><th>Download</th><th>Upload</th>
          <th>1-hour observed usage</th><th>Last seen ({{ timeZone }})</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="host in hosts"
          :key="host.ip_address"
          :class="{ 'selected-host': selected === host.ip_address }"
          :data-host-address="host.ip_address"
        >
          <td>
            <button
              type="button"
              class="host-name"
              :aria-label="`View experience history for ${host.configured_name} (${host.ip_address})`"
              :aria-pressed="selected === host.ip_address"
              @click="selected = selected === host.ip_address ? '' : host.ip_address"
            >
              <DeviceIcon
                :name="host.metadata.icon"
                class="host-icon"
              />
              <span>{{ host.configured_name || host.metadata.host_name || host.ip_address }}</span>
            </button>
          </td>
          <td
            class="host-description"
            :title="[host.metadata.classification, host.metadata.status === 'stale' ? 'Stale metadata' : '', host.metadata.error].filter(Boolean).join(' · ')"
          >
            {{ host.metadata.classification || "Unavailable" }}
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
          <td class="text-no-wrap">
            {{ host.ip_address }}
          </td>
          <td>
            <div class="d-flex align-center ga-1 flex-nowrap">
              <v-chip
                size="small"
                variant="tonal"
                :color="historical || !sample(host) ? 'default' : experienceColors[sample(host)!.experience.level]"
                :title="scoreTitle(host)"
              >
                {{ scoreLabel(host) }}
              </v-chip>
              <v-chip
                v-if="sample(host)"
                size="x-small"
                variant="tonal"
                :color="sample(host)!.experience.confidence === 'high' && !historical ? 'info' : 'default'"
                :title="scoreTitle(host)"
              >
                {{ experienceLabel(sample(host)!.experience.confidence) }} confidence
              </v-chip>
              <v-chip
                v-if="sample(host) && !sample(host)!.coverage.complete"
                size="x-small"
                variant="tonal"
                :color="historical ? 'default' : 'warning'"
                :title="sample(host)!.coverage.reasons.map(experienceLabel).join(' · ')"
              >
                Incomplete
              </v-chip>
            </div>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="historical || sample(host)?.activity !== 'active' ? 'default' : 'info'"
            >
              {{ activity(host) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="historical || traffic(host, 'received_bps') === null ? 'default' : 'info'"
            >
              ↓ {{ experienceRate(traffic(host, "received_bps")) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="historical || traffic(host, 'sent_bps') === null ? 'default' : 'secondary'"
            >
              ↑ {{ experienceRate(traffic(host, "sent_bps")) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :title="`${host.retained_usage.coverage_seconds}s observed of 3600s; download ${host.retained_usage.received_bytes ?? 'unavailable'} bytes; upload ${host.retained_usage.sent_bytes ?? 'unavailable'} bytes`"
              :color="host.retained_usage.complete && !historical ? 'info' : 'default'"
            >
              {{ expired ? "Unavailable" : formatBytes(sumExperienceCounters(host.retained_usage.sent_bytes, host.retained_usage.received_bytes)) }}{{ !expired && !host.retained_usage.complete ? " · Partial" : "" }}
            </v-chip>
          </td>
          <td class="text-no-wrap">
            {{ formatTimestamp(sample(host)?.last_seen_at) }}
          </td>
        </tr>
        <tr v-if="!hosts.length">
          <td colspan="10">
            {{ search ? "No matching hosts." : "No configured protected hosts are attached to a managed LAN." }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <NetworkExperienceHistory
      v-if="selected"
      :address="selected"
      :latest-host="selectedHost"
      @close="selected = ''"
    />
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
.host-name { display: inline-flex; align-items: center; gap: 8px; color: rgb(var(--v-theme-primary)); text-align: left; }
.host-name:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.host-icon { width: 18px; height: 18px; }
.host-description { max-width: 250px; overflow: hidden; text-overflow: ellipsis; }
.selected-host { background: rgba(var(--v-theme-primary), 0.08); }
@media (max-width: 700px) {
  .experience-toolbar { align-items: stretch; flex-direction: column; gap: 8px; }
  .experience-toolbar :deep(.v-input) { max-width: none; }
}
</style>
