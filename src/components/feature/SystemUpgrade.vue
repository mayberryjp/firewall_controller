<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { upgradeVersionSchema } from "@/types/domain";
import { formatTimestamp } from "@/services/timestamps";

const store = useControllerStore();
const version = ref(""), error = ref(""), dialog = ref(false), confirmedVersion = ref(""), confirmedRepository = ref("");
const invalidVersion = computed(() => !upgradeVersionSchema.safeParse(version.value).success);
const blocked = computed(() => !store.connected || !store.upgrade.data?.enabled || !store.upgrade.data.repository || store.upgrade.stale ||
  store.upgradePending || Boolean(store.upgradeBlockedReason) || store.busy || Boolean(store.uncertain || store.submitted) || store.activeTransactions.length > 0);
async function review(): Promise<void> {
  error.value = "";
  await store.refreshUpgrade();
  if (blocked.value || invalidVersion.value) return;
  confirmedVersion.value = version.value; confirmedRepository.value = store.upgrade.data?.repository ?? ""; dialog.value = true;
}
async function install(): Promise<void> {
  error.value = "";
  try {
    await store.refreshUpgrade();
    if (store.upgrade.data?.repository !== confirmedRepository.value) throw new Error("Configured repository changed. Review the upgrade again.");
    await store.startUpgrade(confirmedVersion.value, confirmedRepository.value); dialog.value = false;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : "Upgrade request failed";
    if (store.upgradeUncertain) dialog.value = false;
  }
}
onMounted(() => { void store.refreshUpgrade(); });
</script>

<template>
  <section
    aria-label="System upgrade"
    class="mt-6"
  >
    <div class="d-flex align-center ga-2 mb-3">
      <h2 class="text-h6">
        System upgrade
      </h2>
      <v-btn
        icon="mdi-refresh"
        variant="text"
        size="small"
        aria-label="Refresh upgrade status"
        title="Refresh upgrade status"
        :loading="store.upgrade.loading"
        :disabled="!store.connected"
        @click="store.refreshUpgrade"
      />
    </div>
    <v-alert
      v-if="store.upgrade.error || error"
      type="error"
      role="alert"
      class="mb-3"
    >
      {{ error || store.upgrade.error }}
    </v-alert>
    <v-alert
      v-if="store.upgradeBlockedReason"
      type="warning"
      role="status"
      class="mb-3"
    >
      {{ store.upgradeBlockedReason }}
    </v-alert>
    <v-alert
      v-if="store.upgradeNotice"
      type="warning"
      class="mb-3"
    >
      {{ store.upgradeNotice }}
    </v-alert>
    <p
      v-if="store.upgrade.data && !store.upgrade.data.enabled"
      class="mb-3"
    >
      Self-upgrade is disabled. Repository, signing trust and credentials require operator setup on the appliance.
    </p>
    <dl
      v-if="store.upgrade.data"
      class="upgrade-status mb-4"
    >
      <dt>Repository</dt><dd class="mono">
        {{ store.upgrade.data.repository ?? 'Not configured' }}
      </dd>
      <dt>Last successful upgrade</dt><dd>{{ store.upgrade.data.last_successful_version ?? 'None recorded' }} (historical, not the running version)</dd>
      <template v-if="store.upgrade.data.job">
        <dt>Latest job</dt><dd class="mono">
          {{ store.upgrade.data.job.id }}
        </dd>
        <dt>Version / status</dt><dd>{{ store.upgrade.data.job.version }} / {{ store.upgrade.data.job.status }}</dd>
        <dt>Updated</dt><dd>{{ formatTimestamp(store.upgrade.data.job.updated_at) }} UTC</dd>
        <dt v-if="store.upgrade.data.job.error">
          Error
        </dt><dd
          v-if="store.upgrade.data.job.error"
          role="alert"
        >
          {{ store.upgrade.data.job.error }}
        </dd>
      </template>
    </dl>
    <form
      class="upgrade-form"
      @submit.prevent="review"
    >
      <v-text-field
        v-model="version"
        label="Version"
        placeholder="1.2.3"
        autocomplete="off"
        variant="outlined"
        density="compact"
        hide-details="auto"
        :error-messages="version && invalidVersion ? 'Use 1.2.3 or 1.2.3-rc.1, without v or build metadata.' : undefined"
        :disabled="store.upgradePending"
      />
      <v-btn
        prepend-icon="mdi-update"
        :disabled="blocked || invalidVersion"
        @click="review"
      >
        Upgrade
      </v-btn>
    </form>
    <v-dialog
      v-model="dialog"
      max-width="600"
      :persistent="store.upgradePending"
    >
      <v-card
        :title="`Upgrade to ${confirmedVersion}?`"
        class="upgrade-confirmation"
      >
        <v-card-text>
          <p>Repository: <span class="mono">{{ confirmedRepository }}</span></p>
          <p class="mt-3">
            Requires system.upgrade. Installation can interrupt management connectivity and appliance services. No cancel or undo is available here. A disconnect does not establish success or failure; do not resubmit.
          </p>
          <p class="mt-3">
            Local configuration changes are retained. Writes remain blocked while the upgrade is active; recovery_required requires console recovery.
          </p>
          <v-alert
            v-if="error"
            type="error"
            role="alert"
            class="mt-3"
          >
            {{ error }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn
            :disabled="store.upgradePending"
            @click="dialog = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="warning"
            prepend-icon="mdi-update"
            :loading="store.upgradePending"
            :disabled="blocked"
            @click="install"
          >
            Install upgrade
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.upgrade-form { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; max-width: 520px; }
.upgrade-form > .v-input { min-width: 180px; }
.upgrade-status { display: grid; grid-template-columns: minmax(100px, 180px) minmax(0, 1fr); gap: 8px 16px; }
.upgrade-status dd { margin: 0; overflow-wrap: anywhere; }
.upgrade-confirmation :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.upgrade-confirmation :deep(.v-card-text) { overflow-wrap: anywhere; }
@media (max-width: 480px) { .upgrade-status { grid-template-columns: 1fr; gap: 4px; } .upgrade-status dd { margin-bottom: 8px; } }
</style>