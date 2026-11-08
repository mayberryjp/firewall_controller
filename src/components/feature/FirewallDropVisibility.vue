<script setup lang="ts">
const hideBroadcast = defineModel<boolean>("hideBroadcast", { required: true });
const hideTcp = defineModel<boolean>("hideTcp", { required: true });
</script>

<template>
  <div class="d-flex flex-wrap align-center ga-4">
    <v-switch
      v-model="hideBroadcast"
      label="Hide broadcast drops"
      aria-label="Hide broadcast drops"
      density="compact"
      hide-details
      color="primary"
    />
    <v-switch
      v-model="hideTcp"
      label="Hide TCP FIN/RST drops"
      aria-label="Hide TCP FIN/RST drops"
      density="compact"
      hide-details
      color="primary"
    />
  </div>
</template>
