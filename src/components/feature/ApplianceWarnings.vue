<script setup lang="ts">
import type { ApplianceService } from "@/types/domain";
defineProps<{ service?: ApplianceService }>();
</script>
<template>
  <v-alert
    v-if="!service || service === 'ntp'"
    type="warning"
    variant="tonal"
    class="mb-4"
  >
    NTP changes the whole appliance clock using host networking, slew-only client mode, no NTS. Running is not proof of synchronization; no offsets/sync metrics are exposed. Rollback restores settings, not past clock state.
  </v-alert>
  <v-alert
    v-if="!service || service === 'syslog'"
    type="warning"
    variant="tonal"
    class="mb-4"
  >
    Syslog owns whole-appliance system/kernel/internal/backend-file logging using host networking. Disabling or rolling back the managed logger can stop local system logging, not just remote forwarding; arrange an alternative logger.
    TLS requires trusted certificates. UDP/TCP are unencrypted, UDP is unacknowledged; no durable queue/delivery guarantee. DNS uses IPv4, canonical IPv6 literals select IPv6. Running does not verify capture or delivery.
  </v-alert>
  <v-alert
    v-if="!service || service === 'vnstat'"
    type="info"
    variant="tonal"
    class="mb-4"
  >
    vnStat covers all host and managed interfaces, including loopback, unmanaged and dynamic links, with separate PIDs/databases. Inventory/poll/update is 5 seconds; save/rescan 1 minute, so a new manually inserted link may take up to a minute.
    Never sum overlapping physical/VLAN/veth/loopback interfaces or scopes as device-wide traffic. No HTTP historical metrics exist; database paths are diagnostics, not traffic numbers.
    Graceful restart/repair preserves history; boot/managed-namespace identity changes select a different database.
  </v-alert>
</template>
