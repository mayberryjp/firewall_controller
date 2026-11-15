<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import NetworkExperienceHostGraphic from "@/components/feature/NetworkExperienceHostGraphic.vue";
import NetworkExperienceHostCharts from "@/components/feature/NetworkExperienceHostCharts.vue";
import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { useTimestamps } from "@/composables/useTimestamps";
import { useControllerStore } from "@/stores/controller";
import { experienceColors, experienceLabel, getNetworkExperienceHistory, type ExperienceHistory } from "@/services/networkExperience";
import { hostFindings, latestHostObservation } from "@/services/hostExperience";

const props = defineProps<{ address: string }>();
const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const { data, loading, error, stale } = useDiagnosticRead(signal => getNetworkExperienceHistory(props.address, signal), 10000, () => props.address);
const replay = shallowRef<ExperienceHistory | null>(null);
const selectedIndex = ref(359), followLatest = ref(true), playing = ref(false);
const now = ref(Date.now()), receivedAt = ref(Date.now());
let playback: ReturnType<typeof setInterval> | undefined;
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
const historical = computed(() => stale.value || data.value?.status === "stale" || data.value?.status === "unavailable" ||
  (data.value?.age_ms !== null && data.value?.age_ms !== undefined && data.value.age_ms + Math.max(0, now.value - receivedAt.value) > 30000));
watch(data, current => {
  receivedAt.value = Date.now();
  if (!current) { replay.value = null; playing.value = false; followLatest.value = true; return; }
  if (!replay.value || followLatest.value) { replay.value = current; selectedIndex.value = latestHostObservation(current); }
});
const slot = computed(() => replay.value?.samples[selectedIndex.value] ?? null);
const findings = computed(() => hostFindings(slot.value?.sample ?? null));
const timeline = computed(() => replay.value?.samples.map(entry => {
  const intervalFindings = hostFindings(entry.sample);
  return {
    slot: entry,
    color: historical.value || !entry.sample ? "default" : experienceColors[entry.sample.experience.level],
    height: entry.sample?.experience.score === null || !entry.sample ? 12 : Math.max(12, entry.sample.experience.score * .6),
    findings: intervalFindings,
    notable: intervalFindings.some(finding => !["info", "default"].includes(finding.color)),
  };
}) ?? []);
const findingIndices = computed(() => timeline.value.flatMap((entry, index) => entry.notable ? [index] : []));
function select(index: number): void {
  if (!replay.value) return;
  playing.value = false; followLatest.value = false;
  selectedIndex.value = Math.max(0, Math.min(replay.value.samples.length - 1, Math.round(index)));
}
function scrub(event: Event): void {
  if (event.target instanceof HTMLInputElement) select(Number(event.target.value));
}
function latest(): void {
  playing.value = false; followLatest.value = true;
  if (data.value) { replay.value = data.value; selectedIndex.value = latestHostObservation(data.value); }
}
function nextFinding(): void {
  const next = findingIndices.value.find(index => index > selectedIndex.value) ?? findingIndices.value[0];
  if (next !== undefined) select(next);
}
function togglePlayback(): void {
  if (!replay.value) return;
  followLatest.value = false;
  if (!playing.value && selectedIndex.value === replay.value.samples.length - 1) selectedIndex.value = 0;
  playing.value = !playing.value;
}
watch(playing, active => {
  clearInterval(playback); playback = undefined;
  if (active) playback = setInterval(() => {
    if (!replay.value || selectedIndex.value >= replay.value.samples.length - 1) { playing.value = false; return; }
    selectedIndex.value++;
  }, 250);
});
function visibilityChanged(): void { if (document.visibilityState === "hidden") playing.value = false; }
document.addEventListener("visibilitychange", visibilityChanged);
onBeforeUnmount(() => {
  clearInterval(playback); clearInterval(clock);
  document.removeEventListener("visibilitychange", visibilityChanged);
});
const intervalText = computed(() => slot.value ? `${formatTimestamp(slot.value.start_at)} – ${formatTimestamp(slot.value.end_at)} ${timeZone.value}` : "Unavailable");
</script>

<template>
  <section
    class="host-experience-replay"
    aria-label="Host experience replay"
  >
    <header class="replay-heading">
      <div>
        <RouterLink
          :to="{ name: 'network-experience' }"
          class="replay-back"
        >
          <v-icon
            icon="mdi-arrow-left"
            size="14"
          />Network Experience
        </RouterLink>
        <h1>Host Experience <span>{{ address }}</span></h1>
        <p>One-hour signal replay · 10-second intervals</p>
      </div>
      <v-btn
        v-if="replay"
        prepend-icon="mdi-clock-fast"
        :variant="followLatest ? 'tonal' : 'flat'"
        :aria-pressed="followLatest"
        @click="latest"
      >
        Latest Window
      </v-btn>
    </header>
    <p
      v-if="!store.connected"
      role="status"
    >
      Connect a firewall to read this host's experience.
    </p>
    <p
      v-else-if="loading && !data"
      role="status"
    >
      Loading host experience...
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
      v-for="failure in data?.collector.sources.filter(source => source.error) ?? []"
      :key="failure.name"
      role="alert"
      class="text-error mb-2"
    >
      Current collection · {{ experienceLabel(failure.name) }}: {{ failure.error }}
    </p>
    <p
      v-if="historical && replay"
      role="status"
      class="text-warning mb-3"
    >
      Stale history: this replay uses previously loaded observations, not current performance.
    </p>
    <template v-if="replay">
      <div class="replay-context">
        <v-chip
          size="small"
          variant="tonal"
          :color="slot?.sample && !historical ? 'info' : 'default'"
        >
          {{ slot?.sample ? "Observed Interval" : "No Observation" }}
        </v-chip>
        <v-chip
          v-if="!replay.coverage_complete"
          size="small"
          variant="tonal"
        >
          {{ replay.returned_samples }}/360 Observed
        </v-chip>
        <v-chip
          v-if="!replay.host.currently_protected"
          size="small"
          variant="tonal"
        >
          No Longer Protected
        </v-chip>
        <v-chip
          v-if="replay.clock_discontinuity"
          size="small"
          variant="tonal"
          color="warning"
        >
          Clock Changed · Order Preserved
        </v-chip>
        <span>Interval ({{ timeZone }}): <time
          v-if="slot"
          :datetime="slot.end_at"
        >{{ formatTimestamp(slot.end_at) }}</time></span>
      </div>
      <NetworkExperienceHostGraphic
        :host="replay.host"
        :sample="slot?.sample ?? null"
        :stale="historical"
        :playing="playing"
      />
      <section
        class="replay-timeline"
        aria-label="One-hour observation timeline"
      >
        <header>
          <div><h2>Replay The Hour</h2><p>{{ formatTimestamp(replay.window.start_at) }} — {{ formatTimestamp(replay.window.end_at) }} · {{ timeZone }}</p></div>
          <div class="timeline-actions">
            <v-btn
              :icon="playing ? 'mdi-pause' : 'mdi-play'"
              variant="tonal"
              size="small"
              :aria-label="playing ? 'Pause replay' : 'Play replay at 40 times real time'"
              @click="togglePlayback"
            />
            <v-btn
              variant="text"
              size="small"
              :disabled="selectedIndex === 0"
              aria-label="Previous interval"
              icon="mdi-chevron-left"
              @click="select(selectedIndex - 1)"
            />
            <v-btn
              variant="text"
              size="small"
              :disabled="selectedIndex >= replay.samples.length - 1"
              aria-label="Next interval"
              icon="mdi-chevron-right"
              @click="select(selectedIndex + 1)"
            />
            <v-btn
              variant="tonal"
              size="small"
              prepend-icon="mdi-skip-next"
              :disabled="!findingIndices.length"
              @click="nextFinding"
            >
              Next Finding
            </v-btn>
          </div>
        </header>
        <div class="interval-strip">
          <button
            v-for="(entry, index) in timeline"
            :key="index"
            type="button"
            tabindex="-1"
            class="interval-bar"
            :class="{ 'is-selected': index === selectedIndex, 'is-missing': !entry.slot.sample }"
            :style="{ height: `${entry.height}px` }"
            :title="`${formatTimestamp(entry.slot.end_at)} ${timeZone} · ${entry.slot.sample ? experienceLabel(entry.slot.sample.experience.level) : 'No observation'}${entry.findings.length ? ` · ${entry.findings.map(finding => finding.label).join(', ')}` : ''}`"
            :aria-label="`Select interval ${index + 1}`"
            @click="select(index)"
          >
            <span :class="`bg-${entry.color === 'default' ? 'surface-variant' : entry.color}`" />
            <i v-if="entry.notable && !historical" />
          </button>
        </div>
        <input
          type="range"
          min="0"
          :max="replay.samples.length - 1"
          step="1"
          :value="selectedIndex"
          :aria-valuetext="intervalText"
          aria-label="Host replay interval"
          @input="scrub"
        >
        <footer><span>{{ intervalText }}</span><span>{{ followLatest ? "Following Latest Observation" : playing ? "Replay · 40×" : "Pinned Replay Window" }}</span></footer>
      </section>
      <section
        class="replay-findings"
        aria-label="Selected interval findings"
      >
        <h2>In This Interval</h2>
        <p v-if="!slot?.sample">
          No sample was collected here. Missing evidence is not zero traffic or proof of a healthy host.
        </p>
        <p v-else-if="!findings.length">
          No highlighted findings in this observation. This is not a reachability guarantee.
        </p>
        <div
          v-else
          class="finding-list"
        >
          <article
            v-for="finding in findings"
            :key="finding.label"
          >
            <v-chip
              size="small"
              variant="tonal"
              :color="historical ? 'default' : finding.color"
            >
              {{ finding.label }}
            </v-chip><p>{{ finding.detail }}</p>
          </article>
        </div>
      </section>
      <NetworkExperienceHostCharts
        :history="replay"
        :selected-index="selectedIndex"
        :stale="historical"
        @select="select"
      />
    </template>
  </section>
</template>

<style scoped>
.host-experience-replay { min-width: 0; }
.replay-heading { display: flex; align-items: center; justify-content: space-between; gap: 15px; flex-wrap: wrap; margin-bottom: 18px; }
.replay-back { display: inline-flex; align-items: center; gap: 5px; color: var(--text-secondary); text-decoration: none; font-size: 11px; margin-bottom: 12px; }
.replay-back:hover { color: rgb(var(--v-theme-primary)); }
.replay-heading h1 { font-size: 20px; font-weight: 650; letter-spacing: -.3px; }
.replay-heading h1 span { margin-left: 10px; color: var(--text-secondary); font-size: 14px; font-weight: 400; overflow-wrap: anywhere; }
.replay-heading p { margin-top: 4px; color: var(--text-muted); font-size: 11px; }
.replay-context { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.replay-context > span { margin-left: auto; font-size: 11px; color: var(--text-secondary); }
.replay-timeline { padding: 18px 16px 12px; border: var(--app-border); border-radius: 12px; background: var(--bg-secondary); margin: 8px 0 20px; }
.replay-timeline header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.replay-timeline h2, .replay-findings h2 { font-size: 13px; font-weight: 600; }
.replay-timeline header p { margin-top: 4px; font-size: 10px; color: var(--text-muted); }
.timeline-actions { display: flex; align-items: center; gap: 4px; }
.interval-strip { display: flex; gap: 1px; align-items: end; height: 82px; margin-top: 10px; }
.interval-bar { position: relative; display: flex; flex: 1 1 0; min-width: 0; padding: 0; border: 0; background: transparent; }
.interval-bar > span { width: 100%; height: 100%; opacity: .65; border-radius: 2px 2px 0 0; }
.interval-bar.is-missing > span { opacity: .3; }
.interval-bar.is-selected > span { opacity: 1; box-shadow: 0 0 0 1px rgb(var(--v-theme-primary)); }
.interval-bar > i { position: absolute; top: -5px; width: 100%; height: 3px; background: #ffb25f; border-radius: 2px; }
.replay-timeline input { width: 100%; accent-color: rgb(var(--v-theme-primary)); cursor: pointer; margin: 8px 0; }
.replay-timeline footer { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; color: var(--text-muted); font-size: 10px; }
.replay-findings { margin-bottom: 20px; }
.replay-findings > p { font-size: 12px; color: var(--text-secondary); margin-top: 10px; }
.finding-list { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 10px; }
.finding-list article { flex: 1 1 230px; max-width: 450px; }
.finding-list p { margin-top: 7px; color: var(--text-secondary); font-size: 11px; }
@media (max-width: 700px) { .replay-heading h1 span { display: block; margin-left: 0; margin-top: 5px; }.replay-context > span { margin-left: 0; width: 100%; }.replay-timeline { padding: 14px 10px 10px; }.replay-timeline footer > span { overflow-wrap: anywhere; }.interval-strip { gap: 0; } }
</style>
