<script setup lang="ts">
import { computed } from "vue";
import { differences } from "@/services/configuration";
import type { ApplianceService, Config } from "@/types/domain";
import JsonPanel from "@/components/base/JsonPanel.vue";
import { record } from "@/types/forms";
import ApplianceWarnings from "@/components/feature/ApplianceWarnings.vue";
const props = defineProps<{ before: Config; after: Config }>();
const changes = computed(() => differences(props.before, props.after));
const changedServices = computed(() => (["ntp", "syslog", "vnstat"] as ApplianceService[]).filter(service => changes.value.some(item => item.area === service)));
const relayChanged = computed(() => changes.value.some(item => item.area === "interfaces" &&
  (record(record(item.before).dhcp_relay).enabled === true || record(record(item.after).dhcp_relay).enabled === true)));
</script>
<template>
  <ApplianceWarnings
    v-for="service in changedServices"
    :key="service"
    :service="service"
  />
  <v-alert
    v-if="changes.some(item => item.area === 'gateway_monitors')"
    type="info"
    variant="tonal"
    class="mb-4"
  >
    Gateway monitor settings persist, but affected configuration/network changes and repair/restart reset measurements. No automatic failover, routes or firewall exceptions are installed. Simulated data is not real reachability.
  </v-alert>
  <v-alert
    v-if="relayChanged"
    type="warning"
    variant="tonal"
    class="mb-4"
  >
    Review DHCP relay impact: enabled-interface, selected-address or server changes can restart the shared dnsmasq process and briefly disrupt relay on other interfaces. Every upstream receives requests; local readiness does not verify lease delivery.
  </v-alert>
  <v-alert
    v-if="changes.some(item => item.area === 'firewall-icmp')"
    type="warning"
    variant="tonal"
    class="mb-4"
  >
    The IPv4 ICMP exception precedes legacy/host/interface drops across input, output and forwarding on all namespace interfaces. ICMPv6 is unchanged; disabling removes exceptions, not a blanket block. An omitted flag means enabled; null is invalid.
  </v-alert>
  <p
    v-if="!changes.length"
    class="my-4"
  >
    No semantic changes.
  </p>
  <p
    v-else
    class="my-4"
  >
    {{ changes.length }} changes · {{ changes.filter(item => item.kind === "deleted").length }} removed.
  </p>
  <v-expansion-panels
    variant="accordion"
    class="mb-4"
  >
    <v-expansion-panel
      v-for="(item, index) in changes"
      :key="index"
    >
      <v-expansion-panel-title>
        {{ item.area }} · {{ item.kind }} · {{ item.identity }}
        <template v-if="item.area === 'interfaces' && record(item.before).role !== record(item.after).role">
          · Role {{ String(record(item.before).role ?? "None").toUpperCase() }} to {{ String(record(item.after).role ?? "None").toUpperCase() }} (metadata only)
        </template>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <JsonPanel
          :value="item.before"
          label="Before"
        />
        <JsonPanel
          :value="item.after"
          label="After"
        />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>
