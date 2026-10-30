<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { isInitialLoad } from "@/services/datasets";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { uploadMqttPassword } from "@/services/netcontrol";
import { mqttSchema } from "@/types/domain";
import { useTimestamps } from "@/composables/useTimestamps";
const { formatTimestamp, timeZone } = useTimestamps();

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const form = ref(mqttSchema.parse({})), password = ref(""), error = ref(""), saving = ref(false);
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value || saving.value);
const interfaces = computed(() => (selected.value?.interfaces ?? []).filter(item => item.up).map(item => item.name));
let upload: AbortController | undefined, alive = true;
watch(() => stableJson(selected.value?.mqtt ?? mqttSchema.parse({})), () => {
  form.value = mqttSchema.parse(selected.value?.mqtt ?? {}); password.value = "";
}, { immediate: true });
watch(() => [store.connected, store.connecting], () => { upload?.abort(); password.value = ""; }, { flush: "sync" });
onMounted(() => { if (store.connected && document.visibilityState !== "hidden") void store.refreshMqttStatus(); });
onUnmounted(() => { alive = false; password.value = ""; upload?.abort(); });
const publisher = computed(() => store.mqttStatus.data);
const publisherColor = computed(() => store.mqttStatus.stale ? "default" : publisher.value?.state === "running" ? "success" : publisher.value?.state === "error" ? "error" : ["connecting", "reconnecting"].includes(publisher.value?.state ?? "") ? "warning" : "default");
async function stage(): Promise<void> {
  error.value = "";
  if (blocked.value || !selected.value) { password.value = ""; return; }
  saving.value = true; upload = new AbortController();
  const initialMqtt = stableJson(selected.value.mqtt ?? mqttSchema.parse({}));
  try {
    const candidate = cloneConfig(selected.value);
    candidate.mqtt = mqttSchema.parse(form.value);
    const issues = validateConfig(candidate).filter(issue => issue.path.startsWith("mqtt."));
    if (password.value && !candidate.mqtt.username) throw new Error("A replacement password requires a username");
    if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
    if (password.value) {
      const result = await uploadMqttPassword(password.value, upload.signal);
      if (!alive || upload.signal.aborted || !store.connected) return;
      candidate.mqtt.password_ref = result.password_ref;
    }
    if (!alive || upload.signal.aborted) return;
    const latest = selected.value;
    if (!latest || stableJson(latest.mqtt ?? mqttSchema.parse({})) !== initialMqtt) throw new Error("MQTT settings changed during password upload. Review the current settings before saving.");
    const merged = cloneConfig(latest); merged.mqtt = candidate.mqtt;
    store.stage(merged);
    form.value = mqttSchema.parse(candidate.mqtt);
  } catch (cause) {
    if (alive && !upload.signal.aborted) error.value = cause instanceof Error ? cause.message : "Unable to save Home Assistant settings";
  } finally { password.value = ""; saving.value = false; }
}
</script>

<template>
  <section aria-label="MQTT STREAMING settings">
    <h1 class="text-h6 mb-4">
      MQTT STREAMING
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
        <div class="setting-name">
          Publisher
        </div>
        <div class="setting-control">
          <v-chip
            v-if="!isInitialLoad(store.mqttStatus)"
            :color="publisherColor"
            size="small"
            variant="tonal"
          >
            {{ store.mqttStatus.stale ? (publisher ? 'Stale' : 'Unavailable') : publisher?.state ?? 'Unavailable' }}
          </v-chip>
          <p
            v-if="store.mqttStatus.error || publisher?.error"
            class="setting-desc"
          >
            {{ store.mqttStatus.error || publisher?.error }}
          </p>
          <p
            v-if="publisher?.last_published_at_unix != null"
            class="setting-desc"
          >
            Last broker acknowledgment ({{ timeZone }}): {{ formatTimestamp(publisher.last_published_at_unix * 1000) }}
          </p>
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="mqtt-enabled"
          class="setting-name"
        >Enable MQTT</label>
        <div class="setting-control">
          <v-switch
            id="mqtt-enabled"
            v-model="form.enabled"
            :disabled="blocked"
            density="compact"
            hide-details
            color="primary"
          />
          <p class="setting-desc">
            Publish telemetry and Home Assistant discovery after the configuration is confirmed. Entities cover interface counters, gateway health and host sensors
            (memory, load, CPU, temperatures, filesystems); sensor names are id-based, so rename them in Home Assistant.
          </p>
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="mqtt-endpoint"
          class="setting-name"
        >Broker URL</label>
        <div class="setting-control">
          <v-text-field
            id="mqtt-endpoint"
            v-model="form.endpoint"
            aria-label="Broker URL"
            placeholder="mqtts://broker.example.test:8883"
            :disabled="blocked"
            density="compact"
            hide-details
          />
          <p
            v-if="form.endpoint.startsWith('mqtt://')"
            class="setting-desc text-warning"
          >
            Unencrypted MQTT transmits credentials and telemetry in plaintext. Prefer mqtts://.
          </p>
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="mqtt-interface"
          class="setting-name"
        >Source interface</label>
        <div class="setting-control">
          <v-select
            id="mqtt-interface"
            v-model="form.source_interface"
            aria-label="Source interface"
            :items="interfaces"
            :disabled="blocked"
            density="compact"
            hide-details
          />
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="mqtt-username"
          class="setting-name"
        >Username</label>
        <div class="setting-control">
          <v-text-field
            id="mqtt-username"
            v-model="form.username"
            aria-label="Username"
            autocomplete="off"
            :disabled="blocked"
            density="compact"
            hide-details
          />
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="mqtt-password"
          class="setting-name"
        >Replacement password</label>
        <div class="setting-control">
          <v-text-field
            id="mqtt-password"
            v-model="password"
            aria-label="Replacement password"
            type="password"
            autocomplete="new-password"
            :disabled="blocked"
            density="compact"
            hide-details
          />
          <div class="password-status">
            <span class="setting-desc">{{ form.password_ref ? 'Stored password configured' : 'No stored password' }}</span>
            <v-btn
              v-if="form.password_ref"
              icon="mdi-lock-remove-outline"
              aria-label="Remove stored password"
              title="Remove stored password"
              size="x-small"
              variant="text"
              :disabled="blocked"
              @click="form.password_ref = ''"
            />
          </div>
          <p class="setting-desc">
            Leave blank to keep the stored password. Upload only over HTTPS or a trusted management channel. The appliance stores passwords privately, but unencrypted; discarded uploads still consume its 256-password capacity.
          </p>
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="mqtt-interval"
          class="setting-name"
        >Publish interval (seconds)</label>
        <div class="setting-control">
          <v-number-input
            id="mqtt-interval"
            v-model="form.interval_seconds"
            aria-label="Publish interval (seconds)"
            :min="10"
            :max="3600"
            :step="1"
            :disabled="blocked"
            density="compact"
            hide-details
            control-variant="stacked"
          />
        </div>
      </div>
      <v-divider />
      <div class="d-flex justify-end mt-6">
        <v-btn
          type="submit"
          prepend-icon="mdi-content-save-outline"
          color="primary"
          :disabled="blocked"
          :loading="saving"
        >
          Save
        </v-btn>
      </div>
    </form>
  </section>
</template>

<style scoped>
section { padding-bottom: 56px; }
.settings-head { padding: 0 4px 12px; font-size: .8125rem; font-weight: 600; letter-spacing: .02em; color: var(--text-muted); }
.setting-row { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start; padding: 18px 4px; }
.setting-name { padding-top: 6px; font-weight: 700; color: var(--text-primary); }
.setting-control { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; }
.setting-control > .v-input { width: 100%; max-width: 520px; }
.setting-control > .v-switch { width: auto; }
.setting-desc { margin: 0; max-width: 760px; font-size: .8125rem; line-height: 1.45; color: var(--text-muted); overflow-wrap: anywhere; }
.password-status { display: flex; align-items: center; gap: 8px; }
@media (max-width: 700px) {
  .setting-row { grid-template-columns: 1fr; gap: 10px; padding: 16px 4px; }
  .setting-name { padding-top: 0; }
}
</style>