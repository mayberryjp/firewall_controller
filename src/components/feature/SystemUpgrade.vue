<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import { useTimestamps } from "@/composables/useTimestamps";
import { isInitialLoad } from "@/services/datasets";
const { formatTimestamp, timeZone } = useTimestamps();

const store = useControllerStore();
const software = computed(() => store.state.data?.desired.software);
const unavailable = computed(() => store.state.stale || Boolean(store.state.error) || !software.value);
const availability = computed(() => {
  if (isInitialLoad(store.state)) return "Loading...";
  const metadata = software.value;
  if (unavailable.value || !metadata) return "Unavailable";
  if (store.softwareCheckPending) return "Checking...";
  if (store.softwareCheckError || metadata.error !== null) return "Unable to check";
  if (!metadata.repository) return "Checks disabled";
  if (metadata.update_available === true) return `Update available${metadata.latest_version ? `: ${metadata.latest_version}` : ""}`;
  if (metadata.update_available === false) return "Up to date";
  return "Not checked";
});
const error = computed(() => {
  if (isInitialLoad(store.state)) return store.softwareCheckError;
  if (unavailable.value) return store.state.error || (store.state.data && !software.value
    ? "Update the appliance backend to enable upgrade checks."
    : "Software information is unavailable. Reconnect to try again.");
  if (store.softwareCheckPending) return "";
  return store.softwareCheckError || software.value?.error || "";
});
</script>

<template>
  <section
    aria-label="System upgrade"
    class="mt-4"
  >
    <dl class="upgrade-status mb-4">
      <dt>Current version</dt><dd>{{ software?.version ?? (isInitialLoad(store.state) ? 'Loading...' : 'Unavailable') }}</dd>
      <dt>New version</dt><dd role="status">
        {{ availability }}
      </dd>
      <dt>Last checked ({{ timeZone }})</dt><dd>{{ isInitialLoad(store.state) ? 'Loading...' : formatTimestamp(software?.last_checked_at) }}</dd>
    </dl>
    <v-btn
      variant="outlined"
      :loading="store.softwareCheckPending"
      :disabled="!store.connected || unavailable || !software?.repository || store.softwareCheckPending || store.softwareCheckDenied"
      @click="store.checkSoftwareRelease"
    >
      Check for upgrade
    </v-btn>
    <v-alert
      v-if="error"
      type="error"
      role="alert"
      class="mt-3"
    >
      {{ error }}
    </v-alert>
  </section>
</template>

<style scoped>
.upgrade-status { display: grid; grid-template-columns: minmax(100px, 180px) minmax(0, 1fr); gap: 8px 16px; }
.upgrade-status dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 480px) { .upgrade-status { grid-template-columns: 1fr; gap: 4px; } .upgrade-status dd { margin-bottom: 8px; } }
</style>
