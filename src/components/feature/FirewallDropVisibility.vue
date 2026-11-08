<script setup lang="ts">
const includeBroadcast = defineModel<boolean>("includeBroadcast", { required: true });
const includeTcp = defineModel<boolean>("includeTcp", { required: true });
</script>

<template>
  <div class="d-flex flex-wrap align-center ga-4">
    <v-switch
      v-model="includeBroadcast"
      label="Include broadcast drops"
      aria-label="Include broadcast drops"
      density="compact"
      hide-details
      color="primary"
    />
    <v-switch
      v-model="includeTcp"
      label="Include TCP FIN/RST/empty ACK drops"
      aria-label="Include TCP FIN/RST/empty ACK drops"
      density="compact"
      hide-details
      color="primary"
    />
  </div>
</template>
