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
    NTP changes the whole appliance clock. Running does not confirm synchronization. Rollback restores settings, not past clock state.
  </v-alert>
  <v-alert
    v-if="!service || service === 'syslog'"
    type="warning"
    variant="tonal"
    class="mb-4"
  >
    Disabling or rolling back this logger can stop local system logging. TLS requires trusted certificates; UDP/TCP are unencrypted. Running does not confirm log delivery.
  </v-alert>
  <v-alert
    v-if="!service || service === 'vnstat'"
    type="info"
    variant="tonal"
    class="mb-4"
  >
    Host and managed scopes have separate databases. No HTTP historical metrics exist. Repair preserves stored history; namespace identity changes can select a new database.
  </v-alert>
</template>
