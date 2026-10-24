<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import type { Config } from "@/types/domain";
import JsonPanel from "@/components/base/JsonPanel.vue";

const props = defineProps<{ selectedConfig?: Config; showDraft: boolean }>();
const emit = defineEmits<{ staged: []; error: [message: string] }>();
const store = useControllerStore();
const editingConfig = computed(() => props.selectedConfig);
const policyMode = computed(() => Boolean(editingConfig.value?.firewall.policies));
const policy = ref<"accept" | "drop">("accept"), allowICMP = ref(true);
watch(() => editingConfig.value?.firewall.policy, value => { if (value) policy.value = value; }, { immediate: true });
watch(() => editingConfig.value?.firewall.allow_all_icmp, value => { if (value !== undefined) allowICMP.value = value; }, { immediate: true });
function stage(field: "policy" | "allow_all_icmp"): void {
  if (!editingConfig.value) return;
  try {
    const candidate = cloneConfig(editingConfig.value);
    if (field === "policy") candidate.firewall.policy = policy.value;
    else candidate.firewall.allow_all_icmp = allowICMP.value;
    store.stage(candidate); emit("staged");
  } catch (error) { emit("error", error instanceof Error ? error.message : "Unable to stage firewall setting"); }
}
</script>

<template>
  <div class="d-flex flex-wrap ga-3 align-center mb-4">
    <v-switch
      v-model="allowICMP"
      label="Allow all IPv4 ICMP"
      :disabled="Boolean(store.readOnlyReason)"
      hide-details
      color="primary"
    />
    <v-btn
      :disabled="Boolean(store.readOnlyReason)"
      @click="stage('allow_all_icmp')"
    >
      Stage ICMP change
    </v-btn>
  </div>
  <v-alert
    v-if="policyMode"
    type="info"
    variant="tonal"
    class="mb-4"
  >
    Host/interface policy mode is active. Policies are read-only; the ICMP setting remains editable.
  </v-alert>
  <JsonPanel
    v-if="policyMode"
    :value="selectedConfig?.firewall.policies"
    label="Preserved host / ingress policies"
  />
  <div class="d-flex flex-wrap ga-3 align-center mb-4">
    <v-select
      v-model="policy"
      label="Default policy"
      :items="['accept', 'drop']"
      hide-details
    />
    <v-btn
      :disabled="Boolean(store.readOnlyReason) || policyMode"
      @click="stage('policy')"
    >
      Stage policy change
    </v-btn>
  </div>
  <v-alert
    v-if="selectedConfig?.firewall.policy === 'drop' || selectedConfig?.firewall.rules.some(item => !item.source && !item.destination)"
    type="warning"
    class="mb-4"
  >
    Default drop or catch-all rules may block access. Review the rules before applying.
  </v-alert>
</template>