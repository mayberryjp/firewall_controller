<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { getDiscordStatus, uploadDiscordWebhook } from "@/services/netcontrol";
import { discordConfigSchema, discordDefaults, discordWebhookSchema, type DiscordStatus } from "@/services/discord";
import { isInitialLoad } from "@/services/datasets";

const store = useControllerStore();
const notificationCategories = [
  { key: "notify_broadcast", label: "Broadcast drop notifications", description: "Include newly seen IPv4 broadcast drops." },
  { key: "notify_tcp_closures", label: "TCP FIN/RST/empty ACK notifications", description: "Include newly seen TCP FIN, RST and ACK-only drops with known zero payload." },
] as const;
const selected = computed(() => store.draft ?? store.state.data?.desired);
const form = ref(discordDefaults()), webhook = ref("");
const initial = ref(""), error = ref(""), notice = ref(""), saving = ref(false);
const currentSettings = computed(() => stableJson(discordConfigSchema.parse(selected.value?.discord ?? discordDefaults())));
const dirty = computed(() => stableJson(form.value) !== initial.value || Boolean(webhook.value));
const changed = computed(() => currentSettings.value !== initial.value);
const status = ref<DiscordStatus | null>(null), statusLoading = ref(false), statusError = ref(""), statusStale = ref(true);
const deliveryStates: Record<DiscordStatus["state"], { label: string; color: string } | null> = {
  starting: { label: "Starting", color: "info" },
  disabled: null,
  simulated: { label: "Simulation only", color: "info" },
  unavailable: { label: "Unavailable", color: "warning" },
  paused: { label: "Paused", color: "warning" },
  ready: { label: "Active", color: "success" },
  error: { label: "Delivery error", color: "error" },
  stopped: { label: "Stopped", color: "secondary" },
};
const deliveryStatus = computed(() => {
  if (!status.value) return null;
  if (statusStale.value) return { label: "Stale", color: "warning" };
  if (status.value.state === "ready" && !status.value.enabled) return null;
  return deliveryStates[status.value.state];
});
const loading = computed(() => (!status.value && !statusError.value) || isInitialLoad(store.state));
const readError = computed(() => statusError.value || store.state.error);
const blockedReason = computed(() => {
  if (loading.value || readError.value) return "";
  if (statusStale.value || store.state.stale) return "Notification or configuration data is stale.";
  if (store.draftStale) return "Resolve the stale draft before editing notifications.";
  if (store.incompatible) return "Resolve incompatible configuration or transaction state first.";
  return store.readOnlyReason || store.operationBlockedReason;
});
const blocked = computed(() => saving.value || loading.value || Boolean(readError.value || blockedReason.value) ||
  !selected.value || !status.value || !store.connected || changed.value);
let upload: AbortController | undefined, alive = true;
let statusRequest: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, failures = 0;
async function readStatus(): Promise<void> {
  clearTimeout(timer);
  if (!alive || statusLoading.value || !store.connected || document.visibilityState === "hidden") return;
  const controller = new AbortController(), session = store.sessionVersion;
  statusRequest = controller; statusLoading.value = true;
  const current = () => alive && statusRequest === controller && session === store.sessionVersion;
  try {
    const result = await getDiscordStatus(controller.signal);
    if (!current()) return;
    status.value = result; statusError.value = ""; statusStale.value = false; failures = 0;
  } catch (failure) {
    if (!current()) return;
    statusError.value = failure instanceof Error ? failure.message : "Unable to read Discord status.";
    statusStale.value = true; failures++;
  } finally {
    if (current()) {
      statusLoading.value = false; statusRequest = undefined;
      timer = setTimeout(() => { void readStatus(); }, Math.min(60000, 7500 * 2 ** Math.min(failures, 3)));
    }
  }
}
function retry(): void {
  if (document.visibilityState === "hidden") return;
  void readStatus();
  if (store.state.error || store.state.stale) void store.refreshState();
}
function reset(): void {
  form.value = discordConfigSchema.parse(selected.value?.discord ?? discordDefaults());
  webhook.value = ""; initial.value = currentSettings.value;
  error.value = ""; notice.value = ""; store.editorDirty = false;
}
watch(currentSettings, () => { if (!dirty.value) reset(); }, { flush: "sync" });
watch(dirty, value => { store.editorDirty = value; }, { flush: "sync" });
watch(() => [store.connected, store.sessionVersion], () => {
  upload?.abort(); saving.value = false; reset();
  clearTimeout(timer); statusRequest?.abort(); statusRequest = undefined;
  status.value = null; statusError.value = ""; statusLoading.value = false; statusStale.value = true; failures = 0;
  void readStatus();
}, { immediate: true });
document.addEventListener("visibilitychange", retry);
window.addEventListener("online", retry);
onUnmounted(() => {
  alive = false; webhook.value = ""; upload?.abort(); statusRequest?.abort(); clearTimeout(timer); store.editorDirty = false;
  document.removeEventListener("visibilitychange", retry); window.removeEventListener("online", retry);
});
async function stage(): Promise<void> {
  error.value = ""; notice.value = "";
  if (blocked.value || !selected.value) {
    error.value = readError.value || blockedReason.value || "Wait for current notification settings, or reset conflicting edits before saving.";
    return;
  }
  saving.value = true;
  const session = store.sessionVersion, settingsBefore = currentSettings.value;
  const controller = new AbortController(); upload = controller;
  let uploaded = false;
  try {
    if (form.value.enabled && !form.value.webhook_ref && !webhook.value) throw new Error("Enter a webhook URL before enabling Discord notifications.");
    if (webhook.value) {
      if (!discordWebhookSchema.safeParse({ webhook_url: webhook.value }).success) throw new Error("Enter a canonical HTTPS discord.com webhook URL without a query, fragment or port.");
      const result = await uploadDiscordWebhook(webhook.value, controller.signal);
      if (!alive || controller.signal.aborted || session !== store.sessionVersion || !store.connected) return;
      webhook.value = "";
      form.value.webhook_ref = result.webhook_ref; uploaded = true;
    }
    if (!alive || controller.signal.aborted || session !== store.sessionVersion) return;
    if (currentSettings.value !== settingsBefore) throw new Error("Webhook stored, but notification settings changed during upload. Reset edits and review the current settings.");
    if (readError.value || blockedReason.value) throw new Error(readError.value || blockedReason.value);
    const latest = selected.value;
    if (!latest) throw new Error("Configuration is unavailable.");
    const candidate = cloneConfig(latest);
    candidate.discord = discordConfigSchema.parse(form.value);
    const issues = validateConfig(candidate).filter(issue => issue.path.startsWith("discord"));
    if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
    store.stage(candidate); reset();
    notice.value = uploaded ? "Webhook stored; notification changes staged." : "Notification changes staged.";
  } catch (failure) {
    if (alive && !controller.signal.aborted && session === store.sessionVersion) {
      error.value = failure instanceof Error ? failure.message : "Unable to save notification settings.";
    }
  } finally {
    if (session === store.sessionVersion && alive) { webhook.value = ""; saving.value = false; }
  }
}
</script>

<template>
  <section aria-label="Notification settings">
    <h1 class="text-h6 mb-4">
      Firewall drop notifications
    </h1>
    <p
      v-if="loading"
      role="status"
      class="mb-4"
    >
      Loading notifications...
    </p>
    <v-alert
      v-if="readError || error"
      type="error"
      role="alert"
      class="mb-4"
    >
      {{ readError || error }}
      <v-btn
        v-if="readError"
        variant="text"
        :disabled="statusLoading || !store.connected"
        @click="retry"
      >
        Retry
      </v-btn>
    </v-alert>
    <v-alert
      v-if="blockedReason || (dirty && changed)"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ dirty && changed ? "Notification settings changed while editing." : blockedReason }}
      <v-btn
        v-if="dirty && changed"
        variant="text"
        :disabled="saving"
        @click="reset"
      >
        Reset edits
      </v-btn>
    </v-alert>
    <form @submit.prevent="stage">
      <div class="settings-head">
        Setting
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="notifications-discord-enabled"
          class="setting-name"
        >
          Enable firewall drop notifications
        </label>
        <div class="setting-control">
          <v-switch
            id="notifications-discord-enabled"
            v-model="form.enabled"
            aria-label="Enable firewall drop notifications"
            aria-describedby="notifications-discord-description"
            :disabled="blocked"
            density="compact"
            hide-details
            color="primary"
            @update:model-value="notice = ''; error = ''"
          />
          <p
            id="notifications-discord-description"
            class="setting-desc"
          >
            Send Discord alerts for newly seen firewall drops, identified by source IP, destination IP, destination port and protocol.
          </p>
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="notifications-discord-webhook"
          class="setting-name"
        >
          {{ form.webhook_ref ? "Replacement webhook URL" : "Webhook URL" }}
        </label>
        <div class="setting-control">
          <v-text-field
            id="notifications-discord-webhook"
            v-model="webhook"
            type="password"
            aria-label="Discord webhook URL"
            :placeholder="form.webhook_ref ? 'Leave blank to keep stored webhook' : 'https://discord.com/api/webhooks/...'"
            autocomplete="new-password"
            :spellcheck="false"
            :disabled="blocked"
            density="compact"
            hide-details
            class="setting-field"
            @update:model-value="notice = ''; error = ''"
          />
        </div>
      </div>
      <v-divider />
      <template
        v-for="category in notificationCategories"
        :key="category.key"
      >
        <div class="setting-row">
          <label
            :for="`notifications-${category.key}`"
            class="setting-name"
          >
            {{ category.label }}
          </label>
          <div class="setting-control">
            <v-switch
              :id="`notifications-${category.key}`"
              v-model="form[category.key]"
              :aria-label="category.label"
              :aria-describedby="`notifications-${category.key}-description`"
              :disabled="blocked"
              density="compact"
              hide-details
              color="primary"
              @update:model-value="notice = ''; error = ''"
            />
            <p
              :id="`notifications-${category.key}-description`"
              class="setting-desc"
            >
              {{ category.description }} Requires firewall drop logging and notifications to be enabled.
              Overlapping broadcast and TCP categories require both switches. Enabling later does not
              send alerts for previously seen drops.
            </p>
          </div>
        </div>
        <v-divider />
      </template>
      <div
        v-if="status"
        class="setting-row"
      >
        <div class="setting-name">
          Notification status
        </div>
        <div class="setting-control">
          <v-chip
            v-if="deliveryStatus"
            :color="deliveryStatus.color"
            variant="tonal"
            size="small"
          >
            {{ deliveryStatus.label }}
          </v-chip>
          <div
            role="group"
            aria-label="Delivery statistics"
            class="d-flex flex-wrap ga-2"
          >
            <v-chip
              color="success"
              variant="tonal"
              size="small"
            >
              Delivered: {{ status.delivered }}
            </v-chip>
            <v-chip
              color="error"
              variant="tonal"
              size="small"
            >
              Failed: {{ status.failed }}
            </v-chip>
          </div>
          <p
            v-if="status.error"
            role="alert"
            class="setting-desc text-error"
          >
            {{ status.error }}
          </p>
        </div>
      </div>
      <v-divider v-if="status" />
      <p
        v-if="notice"
        role="status"
        class="mt-4"
      >
        {{ notice }}
      </p>
      <div class="d-flex justify-end mt-6">
        <v-btn
          type="submit"
          prepend-icon="mdi-content-save-outline"
          color="primary"
          :loading="saving"
          :disabled="blocked || !dirty"
        >
          Save
        </v-btn>
      </div>
    </form>
  </section>
</template>

<style scoped>
.settings-head { padding: 0 4px 12px; font-size: 0.8125rem; font-weight: 600; letter-spacing: 0.02em; color: var(--text-muted); }
.setting-row { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start; padding: 18px 4px; }
.setting-name { padding-top: 6px; font-weight: 700; color: var(--text-primary); }
.setting-control { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; }
.setting-field { width: 100%; }
.setting-desc { margin: 0; max-width: 760px; font-size: 0.8125rem; line-height: 1.45; color: var(--text-muted); }
@media (max-width: 700px) {
  .setting-row { grid-template-columns: 1fr; gap: 10px; padding: 16px 4px; }
  .setting-name { padding-top: 0; }
}
</style>
