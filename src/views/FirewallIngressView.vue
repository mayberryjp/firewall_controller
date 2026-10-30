<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { interfaceChoice } from "@/services/resourceCollections";
import FirewallRuleTable from "@/components/feature/FirewallRuleTable.vue";

const store = useControllerStore();
const selectedConfig = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const policies = computed(() => selectedConfig.value?.firewall.policies);
const interfaceOptions = computed(() => [...new Set([
  ...(policies.value?.interfaces.map(ingress => ingress.interface) ?? []),
  ...(selectedConfig.value?.interfaces.map(link => link.name) ?? []),
])].map(name => interfaceChoice(selectedConfig.value?.interfaces.find(link => link.name === name) ?? { name })));
const selectedInterfaceName = ref("");
watch(() => interfaceOptions.value.map(option => option.value), names => {
  if (!names.includes(selectedInterfaceName.value)) selectedInterfaceName.value = names[0] ?? "";
}, { immediate: true });
</script>

<template>
  <section aria-label="INTERFACE RULES">
    <v-progress-linear
      v-if="store.state.loading && !store.state.data"
      indeterminate
    />
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <v-select
      v-model="selectedInterfaceName"
      label="Interface"
      :items="interfaceOptions"
      :disabled="!policies || !interfaceOptions.length || store.editorDirty"
      variant="outlined"
      density="compact"
      hide-details
      class="mb-4"
    />
    <p v-if="selectedConfig && !policies">
      No interface ingress policies configured. Import hosts to enable host/interface policies.
    </p>
    <FirewallRuleTable
      v-else-if="selectedInterfaceName"
      :key="selectedInterfaceName"
      scope="interface"
      :owner="selectedInterfaceName"
    />
  </section>
</template>
