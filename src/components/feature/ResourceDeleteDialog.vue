<script setup lang="ts">
import { record } from "@/types/forms";
import JsonPanel from "@/components/base/JsonPanel.vue";

defineProps<{ deletion: { index: number; value: unknown } | null; impacts: string[] }>();
defineEmits<{ cancel: []; stage: [] }>();
</script>

<template>
  <v-dialog
    :model-value="deletion !== null"
    max-width="620"
    @update:model-value="!$event && $emit('cancel')"
  >
    <v-card title="Stage deletion — no server write">
      <v-card-text>
        <p>No dependent resource is silently removed. Stage explicit reference updates/removals; invalid references block apply.</p>
        <v-alert
          v-if="record(deletion?.value).kind === 'ethernet'"
          type="warning"
          class="my-3"
        >
          Releasing this NIC also removes its configured DHCP client and resolver settings from the draft.
          Hardware is not deleted. OS DHCP is not restarted and persistent networkd exclusions remain.
          Keep console access and verify connectivity before confirming.
        </v-alert>
        <ul>
          <li
            v-for="impact in impacts"
            :key="impact"
          >
            {{ impact }}
          </li>
        </ul>
        <JsonPanel
          :value="deletion?.value"
          label="Resource to delete"
        />
      </v-card-text>
      <v-card-actions>
        <v-btn @click="$emit('cancel')">
          Cancel
        </v-btn>
        <v-btn
          color="error"
          @click="$emit('stage')"
        >
          Stage deletion
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>