<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { eligibleMDNSInterface, mdnsInterfaces, mdnsPresets, normalizeMDNS, normalizeMDNSFilter } from "@/services/mdns";
import { mdnsSchema, type MDNSConfig, type MDNSFilterCounters } from "@/types/domain";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import { useTimestamps } from "@/composables/useTimestamps";
import { interfaceNameChoices } from "@/services/interfaceNames";

const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const editing = computed(() => store.draft ?? stored.value);
const form = ref<MDNSConfig>(mdnsSchema.parse({})), initial = ref(""), error = ref("");
const sourceSettings = ref("");
const snapshot = () => stableJson(form.value);
function reset(): void {
  form.value = mdnsSchema.parse(editing.value?.mdns ?? {});
  sourceSettings.value = stableJson(editing.value?.mdns);
  if (editing.value && form.value.interface_mode === "deny") form.value.interfaces = mdnsInterfaces(editing.value, form.value);
  form.value.interface_mode = "allow";
  initial.value = snapshot(); store.editorDirty = false; error.value = "";
}
watch(editing, () => { if (!store.editorDirty) reset(); }, { immediate: true });
watch(form, () => { store.editorDirty = snapshot() !== initial.value; }, { deep: true, flush: "sync" });
onMounted(() => { if (store.connected && document.visibilityState !== "hidden") void store.refreshMDNSStatus(); });
onUnmounted(() => { store.editorDirty = false; });
const blocked = computed(() => Boolean(store.readOnlyReason) || !editing.value);
const existingFilters = computed(() => new Set(form.value.reflection.filters.filter(value => value.trim()).map(normalizeMDNSFilter)));
function presetBlocked(value: string): boolean {
  return blocked.value || form.value.reflection.filters.length >= 64 || existingFilters.value.has(value);
}
function addPreset(value: string): void {
  if (!presetBlocked(value)) form.value.reflection.filters.push(value);
}
const choices = computed(() => (editing.value?.interfaces ?? [])
  .filter(link => eligibleMDNSInterface(editing.value!, link))
  .map(link => link.name));
const status = computed(() => store.mdnsStatus.data?.instances[0]);
const usage = computed(() => form.value.reflection.filters.map(value => {
  const result: { counters?: MDNSFilterCounters; message: string } = { message: "" };
  if (!value.trim()) return result;
  const sample = status.value, applied = stored.value;
  if (!sample) {
    result.message = store.mdnsStatus.error || store.mdnsStatus.data?.error ? "Unavailable" : "Loading";
  } else if (!store.mdnsStatusCurrent) {
    result.message = store.mdnsStatus.error || store.mdnsStatus.data?.error ? "Unavailable" : "Stale";
  } else if (sample.state === "simulated") {
    result.message = "Simulated (unmeasured)";
  } else if (sample.state === "error" || sample.error) {
    result.message = "Unavailable";
  } else if (sample.retrying) {
    result.message = "Retrying (unmeasured)";
  } else if (!sample.enabled || !sample.reflection_enabled || sample.state === "disabled") {
    result.message = "Disabled (unmeasured)";
  } else if (sample.state !== "running") {
    result.message = "Stopped (unmeasured)";
  } else {
    const filter = normalizeMDNSFilter(value);
    const settings = applied?.mdns;
    const equalNames = (left: string[], right: string[]) => stableJson([...left].sort()) === stableJson([...right].sort());
    const families = settings ? [settings.ipv4 ? "ipv4" : "", settings.ipv6 && applied?.ipv6_enabled !== false ? "ipv6" : ""].filter(Boolean) : [];
    const appliedFilters = settings?.reflection.filters.map(normalizeMDNSFilter) ?? [];
    if (!applied || !settings?.enabled || !settings.reflection.enabled ||
      !equalNames(form.value.interfaces, mdnsInterfaces(applied)) ||
      !equalNames(sample.effective_interfaces, mdnsInterfaces(applied)) ||
      !equalNames(sample.effective_families, families) ||
      sample.publishing_enabled !== settings.publishing.enabled ||
      !equalNames(sample.filter_counters.map(row => row.filter), appliedFilters) ||
      !appliedFilters.includes(filter)) {
      result.message = "Not applied";
    } else {
      result.counters = sample.filter_counters.find(row => row.filter === filter);
      if (!result.counters) result.message = "Unavailable";
    }
  }
  return result;
}));
function stage(): void {
  error.value = "";
  try {
    if (blocked.value || !editing.value) throw new Error(store.readOnlyReason || "Committed configuration is unavailable.");
    if (stableJson(editing.value.mdns) !== sourceSettings.value) throw new Error("mDNS settings changed while editing. Cancel edits to load current settings before staging.");
    const candidate = cloneConfig(editing.value);
    const filters = form.value.reflection.filters.map(value => value.trim()).filter(Boolean).map(normalizeMDNSFilter);
    candidate.mdns = mdnsSchema.parse({
      ...form.value,
      enabled: filters.length > 0,
      interface_mode: "allow",
      ipv4: true,
      ipv6: candidate.ipv6_enabled !== false,
      reflection: { enabled: true, filters },
      publishing: { ...form.value.publishing, enabled: false, a_on_ipv6: candidate.ipv6_enabled !== false && form.value.publishing.a_on_ipv6 },
    });
    normalizeMDNS(candidate.mdns);
    const issues = validateConfig(candidate).filter(issue => issue.path.startsWith("mdns."));
    if (issues.length) throw new Error(issues.map(issue => issue.message).join(" "));
    store.stage(candidate);
    reset();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage mDNS settings."; }
}
</script>

<template>
  <section aria-label="mDNS / Discovery">
    <DatasetStatus
      :query="store.state"
      label="Committed configuration"
    />
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <DatasetStatus
      :query="store.mdnsStatus"
      label="Discovery usage"
    />
    <p
      v-if="store.mdnsStatus.data?.error || status?.error"
      role="status"
      class="text-error mb-3"
    >
      {{ store.mdnsStatus.data?.error || status?.error }}
    </p>
    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
      role="alert"
    >
      {{ error }}
    </v-alert>
    <v-form
      :disabled="blocked"
      @submit.prevent="stage"
    >
      <v-select
        v-model="form.interfaces"
        :items="interfaceNameChoices(choices)"
        label="LAN links"
        multiple
        chips
        closable-chips
        hide-details
        class="mb-4"
      />
      <div
        v-for="(_, index) in form.reflection.filters"
        :key="index"
        class="mdns-entry mb-3"
      >
        <v-text-field
          v-model="form.reflection.filters[index]"
          :label="`Service ${index + 1}`"
          hide-details
        />
        <div
          class="mdns-usage text-caption"
          :aria-label="`Usage for service ${index + 1}`"
        >
          <template v-if="usage[index]?.counters">
            <span>Matched: {{ usage[index]?.counters?.matched_packets }}</span>
            <span>Forwarded: {{ usage[index]?.counters?.transmitted_packets }}</span>
            <span>Last used ({{ timeZone }}): {{ formatTimestamp(usage[index]?.counters?.last_used_at, 'Not yet observed') }}</span>
          </template>
          <span v-else>{{ usage[index]?.message }}</span>
        </div>
        <v-btn
          icon="mdi-delete"
          color="error"
          :aria-label="`Delete service ${index + 1}`"
          :title="`Delete service ${index + 1}`"
          variant="text"
          :disabled="blocked"
          @click="form.reflection.filters.splice(index, 1)"
        />
      </div>
      <p
        v-if="form.reflection.filters.some(value => value.trim())"
        class="text-caption text-medium-emphasis mb-3"
      >
        Applied usage only, since the current worker started. Restarts reset counts; zero is not lifetime non-use.
        Matches can be queries, not discovered devices; forwarded packets do not prove delivery.
        <span v-if="usage.some(row => row.counters) && status?.statistics_complete === false">Receive loss is unknown; counts may be incomplete.</span>
      </p>
      <div class="d-flex flex-wrap ga-3 mt-4">
        <v-btn
          prepend-icon="mdi-plus"
          color="primary"
          :disabled="blocked || form.reflection.filters.length >= 64"
          @click="form.reflection.filters.push('')"
        >
          Add service
        </v-btn>
        <v-menu>
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              prepend-icon="mdi-playlist-plus"
              :disabled="blocked || form.reflection.filters.length >= 64"
            >
              Presets
            </v-btn>
          </template>

          <v-list density="compact">
            <v-list-item
              v-for="preset in mdnsPresets"
              :key="preset.value"
              :title="preset.title"
              :subtitle="preset.value"
              :disabled="presetBlocked(preset.value)"
              @click="addPreset(preset.value)"
            />
          </v-list>
        </v-menu>
        <v-btn
          type="submit"
          prepend-icon="mdi-check"
          color="primary"
          :disabled="blocked"
        >
          Stage changes
        </v-btn>
        <v-btn
          prepend-icon="mdi-close"
          :disabled="blocked || !store.editorDirty"
          @click="reset"
        >
          Cancel edits
        </v-btn>
      </div>
    </v-form>
  </section>
</template>

<style scoped>
.mdns-entry { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; }
.mdns-usage { display: flex; flex-direction: column; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .mdns-entry { grid-template-columns: minmax(0, 1fr) auto; }
  .mdns-entry > .mdns-usage { grid-column: 1; grid-row: 2; }
  .mdns-entry > .v-btn { grid-column: 2; grid-row: 1 / 3; }
}
</style>
