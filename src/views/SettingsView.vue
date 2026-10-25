<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, ipv6Conflicts } from "@/services/configuration";

const store = useControllerStore();
const selectedConfig = computed(() => store.draft ?? store.state.data?.desired);
const allowICMP = ref(true);
const enableIPv6 = ref(true);
const error = ref("");
const blocked = computed(() => Boolean(store.readOnlyReason) || !selectedConfig.value);
watch(() => selectedConfig.value?.firewall.allow_all_icmp, value => {
  if (value !== undefined) allowICMP.value = value;
}, { immediate: true });
watch(() => selectedConfig.value?.ipv6_enabled, value => { enableIPv6.value = value !== false; }, { immediate: true });

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
          <div class="d-flex align-center ga-2 flex-wrap">
            <v-chip
              size="small"
              :color="store.runtime.stale || !store.runtime.data?.ipv6 ? 'warning' : store.runtime.data.ipv6.status === 'simulated' ? 'grey' : store.runtime.data.ipv6.drift ? 'warning' : 'success'"
            >
              {{ store.runtime.stale ? 'Stale runtime' : !store.runtime.data?.ipv6 ? 'Runtime unavailable' : store.runtime.data.ipv6.status === 'simulated' ? 'Simulated / unmeasured' : store.runtime.data.ipv6.drift ? 'IPv6 drift detected' : `Measured: ${store.runtime.data.ipv6.enabled ? 'enabled' : 'disabled'}` }}
            </v-chip>
            <v-btn
              icon="mdi-refresh"
              variant="text"
              size="small"
              aria-label="Refresh IPv6 runtime"
              title="Refresh IPv6 runtime"
              :disabled="!store.connected"
              :loading="store.runtime.loading"
              @click="store.refreshRuntime"
            />
          </div>
          <details v-if="store.runtime.data?.ipv6?.status === 'measured' && store.runtime.data.ipv6.disable_ipv6">
            <summary>Observed IPv6 controls</summary>
            <dl>
              <template
                v-for="(value, name) in store.runtime.data.ipv6.disable_ipv6"
                :key="name"
              >
                <dt class="mono">
                  {{ name }}
                </dt><dd>{{ value === '1' ? 'Disabled' : 'Enabled' }} ({{ value }})</dd>
              </template>
            </dl>
          </details>
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

.setting-desc {
  margin: 0;
  max-width: 760px;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.setting-control details { max-width: 100%; overflow-wrap: anywhere; }
.setting-control dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 16px; margin-top: 8px; }
.setting-control dd { margin: 0; }

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
