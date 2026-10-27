<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { mdnsInterfaces, normalizeMDNS } from "@/services/mdns";
import { mdnsCounterNames, mdnsSchema, type MDNSConfig } from "@/types/domain";
import { formatTimestamp } from "@/services/timestamps";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import ServiceRepair from "@/components/feature/ServiceRepair.vue";

const store = useControllerStore();
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const editing = computed(() => store.draft ?? stored.value);
const form = ref<MDNSConfig>(mdnsSchema.parse({})), initial = ref(""), error = ref("");
const sourceSettings = ref("");
const filterText = ref(""), displayName = ref(""), description = ref("");
const snapshot = () => stableJson({ settings: form.value, filters: filterText.value, displayName: displayName.value, description: description.value });
function reset(): void {
  form.value = mdnsSchema.parse(editing.value?.mdns ?? {});
  sourceSettings.value = stableJson(editing.value?.mdns);
  filterText.value = form.value.reflection.filters.join("\n");
  displayName.value = form.value.metadata?.display_name ?? "";
  description.value = form.value.metadata?.description ?? "";
  initial.value = snapshot(); store.editorDirty = false; error.value = "";
}
watch(editing, () => { if (!store.editorDirty) reset(); }, { immediate: true });
watch([form, filterText, displayName, description], () => { store.editorDirty = snapshot() !== initial.value; }, { deep: true, flush: "sync" });
onMounted(() => { if (store.connected && document.visibilityState !== "hidden") void store.refreshMDNSStatus(); });
onUnmounted(() => { store.editorDirty = false; });
const blocked = computed(() => Boolean(store.readOnlyReason) || !editing.value);
const choices = computed(() => (editing.value?.interfaces ?? [])
  .filter(link => link.kind === "ethernet" || link.kind === "vlan")
  .filter(link => form.value.interface_mode === "deny" || (link.up && link.role === "lan"))
  .map(link => link.name));
const selectedMembership = computed(() => editing.value ? mdnsInterfaces(editing.value, form.value) : []);
const committedMembership = computed(() => store.state.data ? mdnsInterfaces(store.state.data.desired) : []);
const pendingMembership = computed(() => stored.value ? mdnsInterfaces(stored.value) : []);
const status = computed(() => store.mdnsStatus.data?.instances[0]);
const provisional = computed(() => store.activeTransactions.some(item => item.status === "pending_confirmation"));
const publicationFlags = [
  { key: "addresses", label: "Publish addresses (A / AAAA)" },
  { key: "hinfo", label: "Publish HINFO (exposes Linux / architecture)" },
  { key: "workstation", label: "Publish workstation (_workstation._tcp, port 9)" },
  { key: "browse_domain", label: "Publish browse domain" },
  { key: "aaaa_on_ipv4", label: "Publish AAAA over IPv4" },
  { key: "a_on_ipv6", label: "Publish A over IPv6" },
] as const;
function stage(): void {
  error.value = "";
  try {
    if (blocked.value || !editing.value) throw new Error(store.readOnlyReason || "Committed configuration is unavailable.");
    if (stableJson(editing.value.mdns) !== sourceSettings.value) throw new Error("mDNS settings changed while editing. Cancel edits to load current settings before staging.");
    const candidate = cloneConfig(editing.value);
    candidate.mdns = mdnsSchema.parse({
      ...form.value,
      metadata: { display_name: displayName.value, description: description.value },
      reflection: { ...form.value.reflection, filters: filterText.value.split("\n").map(value => value.trim()).filter(Boolean) },
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
    <h1 class="text-h6 mb-4">
      mDNS / Discovery
    </h1>
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
      <fieldset
        :disabled="blocked"
        class="field-group mb-4"
      >
        <legend>Discovery settings</legend>
        <v-checkbox
          v-model="form.enabled"
          label="Enable mDNS"
          hide-details
        />
        <v-select
          v-model="form.interface_mode"
          label="Interface selection mode"
          :items="[{ title: 'Allow only listed LAN links', value: 'allow' }, { title: 'All eligible LAN links except listed', value: 'deny' }]"
          class="mt-3"
        />
        <v-select
          v-model="form.interfaces"
          :items="choices"
          label="Interface list"
          multiple
          chips
          closable-chips
          hint="Only configured, up Ethernet/VLAN LAN links participate. An empty allow list selects none."
          persistent-hint
        />
        <p class="my-3">
          Selected membership: {{ selectedMembership.join(', ') || 'None' }}
        </p>
        <v-alert
          v-if="form.interface_mode === 'deny'"
          type="warning"
          variant="tonal"
          class="mb-3"
        >
          Deny mode automatically includes newly eligible LAN links. Review membership in SAVE whenever interfaces change.
        </v-alert>
        <div class="d-flex flex-wrap ga-4">
          <v-checkbox
            v-model="form.ipv4"
            label="IPv4 transport"
            hide-details
          />
          <v-checkbox
            v-model="form.ipv6"
            label="IPv6 transport preference"
            hide-details
          />
        </div>
        <v-alert
          v-if="editing?.ipv6_enabled === false"
          type="info"
          variant="tonal"
          class="my-3"
        >
          IPv6 is disabled globally: IPv6 transport and all local AAAA publishing are suppressed, including AAAA over IPv4. Saved preferences are retained.
        </v-alert>
        <v-checkbox
          v-model="form.reflection.enabled"
          label="Reflect discovery between LAN links"
          hide-details
        />
        <v-textarea
          v-model="filterText"
          label="Discovery filters"
          hint="One absolute local service, subtype or provider name per line, e.g. _ipp._tcp.local. or printer.local. Empty means all services; no patterns."
          persistent-hint
          rows="3"
          auto-grow
          class="my-3"
        />
        <v-checkbox
          v-model="form.publishing.enabled"
          label="Publish appliance discovery records"
          hide-details
        />
        <p class="my-3">
          Publishing advertises the appliance, not remote devices. Only selected records are published; no SSH or management service is advertised.
        </p>
        <v-text-field
          v-model="form.publishing.hostname"
          label="Publishing hostname"
          hint="Empty uses the configured system hostname, never the ambient hostname."
          persistent-hint
        />
        <v-text-field
          v-model="form.publishing.domain"
          label="Publishing domain"
          hint="local. or an absolute subdomain of local. The cosmetic system domain is not used."
          persistent-hint
        />
        <v-checkbox
          v-for="flag in publicationFlags"
          :key="flag.key"
          v-model="form.publishing[flag.key]"
          :label="flag.label"
          hide-details
        />
        <details class="my-4">
          <summary>Labels and notes</summary>
          <v-text-field
            v-model="displayName"
            label="Display name"
            class="mt-3"
          />
          <v-textarea
            v-model="description"
            label="Description"
            rows="2"
          />
        </details>
        <div class="d-flex flex-wrap ga-3 mt-4">
          <v-btn
            type="submit"
            color="primary"
            :disabled="blocked"
          >
            Stage settings
          </v-btn>
          <v-btn
            :disabled="blocked || !store.editorDirty"
            @click="reset"
          >
            Cancel edits
          </v-btn>
        </div>
        <p class="text-caption mt-3">
          Stages the shared draft only. Review and apply in SAVE; changes require mdns.write.
        </p>
      </fieldset>
    </v-form>
    <p class="mb-4">
      Use one reflector per connected domain with exclusive local UDP 5353 ownership. Restrictive host-input policy needs explicit UDP 5353 permits. Discovery does not grant service access: routing and firewall rules for discovered devices remain separate. SSDP and multicast media routing are not supported.
    </p>
    <h2 class="text-subtitle-1 mb-3">
      Applied discovery status
    </h2>
    <DatasetStatus
      :query="store.mdnsStatus"
      label="mDNS status"
    />
    <v-alert
      v-if="store.mdnsStatus.data?.error || status?.error"
      type="warning"
      variant="tonal"
      class="mb-3"
    >
      {{ store.mdnsStatus.data?.error || status?.error }}
    </v-alert>
    <p class="mb-2">
      Committed configured membership: {{ committedMembership.join(', ') || 'None' }}
    </p>
    <p
      v-if="provisional"
      class="mb-2"
    >
      Pending-confirmation configured membership: {{ pendingMembership.join(', ') || 'None' }}
    </p>
    <template v-if="status">
      <p class="mb-2">
        {{ store.mdnsStatus.stale ? 'Stale last-known state' : 'State' }}: {{ status.state }}{{ provisional ? ' (provisional)' : '' }}.
        Applied membership: {{ status.effective_interfaces.join(', ') || 'None' }}.
        Applied families: {{ status.effective_families.join(', ') || 'None' }}.
      </p>
      <p class="mb-2">
        Applied reflection: {{ status.reflection_enabled ? 'On' : 'Off' }}.
        Applied publishing: {{ status.publishing_enabled ? 'On' : 'Off' }}.
        Running means local readiness, not verified discovery or delivery.
      </p>
      <v-alert
        v-for="warning in status.warnings.slice(0, 8)"
        :key="warning"
        type="warning"
        variant="tonal"
        class="mb-2"
      >
        {{ warning.slice(0, 512) }}
      </v-alert>
      <p v-if="status.warnings.length > 8">
        {{ status.warnings.length - 8 }} additional warnings.
      </p>
      <v-alert
        v-if="!status.statistics_complete"
        type="info"
        variant="tonal"
        class="my-3"
      >
        Statistics are incomplete or not measured. Counters reset when the worker starts; successful sends do not verify client receipt.
      </v-alert>
      <details class="my-4">
        <summary>Traffic counters and sample times</summary>
        <p class="my-3">
          Started (UTC): {{ formatTimestamp(status.started_at) }}.
          Collected (UTC): {{ formatTimestamp(status.collected_at) }}.
        </p>
        <v-table>
          <tbody>
            <tr
              v-for="counter in mdnsCounterNames"
              :key="counter"
            >
              <th scope="row">
                {{ counter.replaceAll('_', ' ') }}
              </th>
              <td>{{ status[counter] }}</td>
            </tr>
            <tr>
              <th scope="row">
                Kernel receive drops
              </th>
              <td>{{ status.receive_drops ?? 'Unavailable' }}</td>
            </tr>
          </tbody>
        </v-table>
      </details>
    </template>
    <p
      v-else
      class="mb-4"
    >
      mDNS status is unavailable.
    </p>
    <ServiceRepair service="mdns" />
  </section>
</template>
