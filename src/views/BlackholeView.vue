<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, validateConfig } from "@/services/configuration";
import { blackholeSchema } from "@/types/domain";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const name = ref(""), action = ref<"blackhole" | "unreachable" | "prohibit">("blackhole"), error = ref("");
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value);
const users = computed(() => selected.value?.routes.filter(route => route.interface === selected.value?.blackhole?.name && route.interface) ?? []);
const actions = [
  { title: "Drop silently", value: "blackhole" },
  { title: "Reject: host unreachable", value: "unreachable" },
  { title: "Reject: administratively prohibited", value: "prohibit" },
];
watch(() => selected.value?.blackhole, value => {
  name.value = value?.name ?? ""; action.value = value?.action ?? "blackhole";
}, { immediate: true, deep: true });

function stage(): void {
  error.value = "";
  if (blocked.value || !selected.value) { error.value = store.readOnlyReason || "Committed configuration is unavailable."; return; }
  try {
    const candidate = cloneConfig(selected.value);
    candidate.blackhole = blackholeSchema.parse({ ...candidate.blackhole, name: name.value.trim(), action: action.value });
    const issues = validateConfig(candidate).filter(issue => issue.path.startsWith("blackhole") ||
      (issue.path.startsWith("routes.") && issue.path.endsWith(".interface") && users.value.length));
    if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
    store.stage(candidate);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to save blackhole settings";
  }
}
</script>

<template>
  <section aria-label="Blackhole interfaces">
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
          for="blackhole-name"
          class="setting-name"
        >Name</label>
        <div class="setting-control">
          <v-text-field
            id="blackhole-name"
            v-model="name"
            aria-label="Name"
            placeholder="blackhole0"
            :disabled="blocked || users.length > 0"
            density="compact"
            hide-details
          />
          <p class="setting-desc">
            <template v-if="users.length">
              {{ users.length }} static {{ users.length === 1 ? 'route uses' : 'routes use' }} this target. Remove or change them before renaming or clearing it.
            </template>
            <template v-else>
              Choose this name as the interface of a static route to discard its traffic. Leave it empty to turn the target off.
            </template>
          </p>
        </div>
      </div>
      <v-divider />
      <div class="setting-row">
        <label
          for="blackhole-action"
          class="setting-name"
        >Action</label>
        <div class="setting-control">
          <v-select
            id="blackhole-action"
            v-model="action"
            aria-label="Action"
            :items="actions"
            :disabled="blocked"
            density="compact"
            hide-details
          />
          <p class="setting-desc">
            Matching traffic is discarded during routing, before forwarding rules and NAT, including the appliance's own traffic to those destinations.
            The longest prefix or lowest metric wins. Drop counters are not available.
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
.settings-head { padding: 0 4px 12px; font-size: .8125rem; font-weight: 600; letter-spacing: .02em; color: var(--text-muted); }
.setting-row { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start; padding: 18px 4px; }
.setting-name { padding-top: 6px; font-weight: 700; color: var(--text-primary); }
.setting-control { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; }
.setting-control > .v-input { width: 100%; max-width: 520px; }
.setting-desc { margin: 0; max-width: 760px; font-size: .8125rem; line-height: 1.45; color: var(--text-muted); }
@media (max-width: 700px) {
  .setting-row { grid-template-columns: 1fr; gap: 10px; padding: 16px 4px; }
  .setting-name { padding-top: 0; }
}
</style>
