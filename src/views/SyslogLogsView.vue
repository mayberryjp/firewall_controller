<script setup lang="ts">
import { ref } from "vue";
import PersistentLogStream from "@/components/feature/PersistentLogStream.vue";
import type { LogSource } from "@/services/logs";

const source = ref<LogSource>("syslog");
</script>

<template>
  <section aria-label="Persistent logs">
    <h1 class="text-h6 mb-4">
      Syslog
    </h1>
    <div
      role="tablist"
      aria-label="Log source"
      class="d-flex ga-2 mb-4"
    >
      <v-btn
        id="syslog-tab"
        role="tab"
        :aria-selected="source === 'syslog'"
        aria-controls="syslog-panel"
        :variant="source === 'syslog' ? 'tonal' : 'text'"
        @click="source = 'syslog'"
      >
        Syslog
      </v-btn>
      <v-btn
        id="netcontrol-tab"
        role="tab"
        :aria-selected="source === 'netcontrol'"
        aria-controls="netcontrol-panel"
        :variant="source === 'netcontrol' ? 'tonal' : 'text'"
        @click="source = 'netcontrol'"
      >
        Netcontrol
      </v-btn>
    </div>
    <div
      v-show="source === 'syslog'"
      id="syslog-panel"
      role="tabpanel"
      aria-labelledby="syslog-tab"
    >
      <PersistentLogStream
        source="syslog"
        :active="source === 'syslog'"
      />
    </div>
    <div
      v-show="source === 'netcontrol'"
      id="netcontrol-panel"
      role="tabpanel"
      aria-labelledby="netcontrol-tab"
    >
      <PersistentLogStream
        source="netcontrol"
        :active="source === 'netcontrol'"
      />
    </div>
  </section>
</template>
