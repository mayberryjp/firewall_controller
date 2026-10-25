<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, ipv6Conflicts, validateConfig } from "@/services/configuration";
import { getTimezones } from "@/services/netcontrol";

const store = useControllerStore();
const selectedConfig = computed(() => store.draft ?? store.state.data?.desired);
const allowICMP = ref(true);
const enableIPv6 = ref(true);
const hostname = ref("");
const timezone = ref<string | null>(null);
const knownTimezones = ref<string[]>([]);
const timezoneItems = computed(() => timezone.value && !knownTimezones.value.includes(timezone.value) ? [timezone.value, ...knownTimezones.value] : knownTimezones.value);
const error = ref("");
const blocked = computed(() => Boolean(store.readOnlyReason) || !selectedConfig.value);
watch(() => selectedConfig.value?.firewall.allow_all_icmp, value => {
  if (value !== undefined) allowICMP.value = value;
}, { immediate: true });
watch(() => selectedConfig.value?.ipv6_enabled, value => { enableIPv6.value = value !== false; }, { immediate: true });
watch(() => selectedConfig.value?.system, value => {
  hostname.value = value?.hostname ?? ""; timezone.value = value?.timezone || null;
}, { immediate: true });
const timezoneRequest = new AbortController();
onMounted(async () => {
  try { knownTimezones.value = (await getTimezones(timezoneRequest.signal)).timezones; } catch { knownTimezones.value = []; }
});
onUnmounted(() => timezoneRequest.abort());

function stage(): void {
  error.value = "";
  if (blocked.value || !selectedConfig.value) {
    error.value = store.readOnlyReason || "Committed configuration is unavailable.";
    return;
  }
  try {
    const candidate = cloneConfig(selectedConfig.value);
    if (candidate.ipv6_enabled !== undefined || !enableIPv6.value) candidate.ipv6_enabled = enableIPv6.value;
    if (!enableIPv6.value) {
      const conflicts = ipv6Conflicts(candidate);
      if (conflicts.length) throw new Error(`Remove IPv6 settings before disabling IPv6: ${conflicts.join(", ")}.`);
    }
    candidate.firewall.allow_all_icmp = allowICMP.value;
    const system = { hostname: hostname.value.trim(), timezone: timezone.value ?? "" };
    if (candidate.system || system.hostname || system.timezone) candidate.system = system;
    const issues = validateConfig(candidate).filter(item => item.path.startsWith("system."));
    if (issues.length) throw new Error(issues.map(item => item.message).join(". "));
    store.stage(candidate);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to save general settings";
  }
}
</script>

<template>
  <section aria-label="General settings">
    <h1 class="text-h6 mb-4">
      General settings
    </h1>
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
    >
      {{ error }}
    </v-alert>
    <form @submit.prevent="stage">
      <div class="settings-head">
        Setting
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="general-hostname"
          class="setting-name"
        >
          Host name
        </label>
        <div class="setting-control">
          <v-text-field
            id="general-hostname"
            v-model="hostname"
            aria-describedby="general-hostname-description"
            placeholder="Unmanaged"
            :disabled="blocked"
            density="compact"
            hide-details
            class="setting-field"
          />
          <p
            id="general-hostname-description"
            class="setting-desc"
          >
            Lowercase letters, digits and hyphens. Leave empty to stop managing the host name; the current name is kept.
          </p>
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="general-timezone"
          class="setting-name"
        >
          Time zone
        </label>
        <div class="setting-control">
          <v-autocomplete
            id="general-timezone"
            v-model="timezone"
            aria-describedby="general-timezone-description"
            :items="timezoneItems"
            placeholder="Unmanaged"
            :disabled="blocked || !timezoneItems.length"
            density="compact"
            hide-details
            clearable
            class="setting-field"
          />
          <p
            id="general-timezone-description"
            class="setting-desc"
          >
            {{ timezoneItems.length ? 'Clear to stop managing the time zone; the current zone is kept. Running processes may keep the previous zone.' : 'The time zone list is unavailable.' }}
          </p>
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="general-ipv6"
          class="setting-name"
        >
          Enable IPv6
        </label>
        <div class="setting-control">
          <v-switch
            id="general-ipv6"
            v-model="enableIPv6"
            aria-describedby="general-ipv6-description"
            :disabled="blocked"
            density="compact"
            hide-details
            color="primary"
          />
          <p
            id="general-ipv6-description"
            class="setting-desc"
          >
            Enable IPv6 configuration across the firewall. Remove existing IPv6 settings before disabling.
          </p>
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="general-icmp"
          class="setting-name"
        >
          Allow all IPv4 ICMP
        </label>
        <div class="setting-control">
          <v-switch
            id="general-icmp"
            v-model="allowICMP"
            aria-describedby="general-icmp-description"
            :disabled="blocked"
            density="compact"
            hide-details
            color="primary"
          />
          <p
            id="general-icmp-description"
            class="setting-desc"
          >
            Allow IPv4 ICMP across all namespace interfaces before input, output and forwarding
            drop rules.
            <template v-if="store.ipv6Enabled">
              ICMPv6 is unchanged.
            </template>
            Disabling removes the exception, not a blanket block.
          </p>
        </div>
      </div>
      <v-divider />
      <div class="d-flex justify-end mt-6">
        <v-btn
          type="submit"
          prepend-icon="mdi-content-save-outline"
          color="primary"
          :disabled="blocked"
        >
          Save
        </v-btn>
      </div>
    </form>
  </section>
</template>

<style scoped>
.settings-head {
  padding: 0 4px 12px;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
}

.setting-row {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
  padding: 18px 4px;
}

.setting-name {
  padding-top: 6px;
  font-weight: 700;
  color: var(--text-primary);
}

.setting-control {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.setting-field {
  width: 100%;
  max-width: 360px;
}

.setting-desc {
  margin: 0;
  max-width: 760px;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--text-muted);
}

@media (max-width: 700px) {
  .setting-row {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 16px 4px;
  }

  .setting-name {
    padding-top: 0;
  }
}
</style>
