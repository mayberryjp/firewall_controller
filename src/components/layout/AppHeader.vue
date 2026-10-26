<script setup lang="ts">
import { computed } from "vue";
import { useDisplay } from "vuetify";
import { useRoute } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import { primaryNavigationSections } from "@/constants/navigation";
import MobileCategoryMenu from "@/components/layout/MobileCategoryMenu.vue";
import ConnectionStatus from "@/components/layout/ConnectionStatus.vue";
const store = useControllerStore(), route = useRoute();
const { lgAndUp } = useDisplay();
const appName = import.meta.env.VITE_APP_NAME || "Modan モダン";
const deviceName = computed(() => {
  const system = store.state.data?.desired.system;
  if (!store.connected || !system?.hostname) return "";
  return system.domain ? `${system.hostname}.${system.domain}` : system.hostname;
});
</script>

<template>
  <v-app-bar
    color="background-100"
    flat
    class="app-header"
    height="64"
  >
    <router-link
      :to="store.connected ? '/overview' : '/connect'"
      class="product-branding d-flex align-center text-decoration-none ms-2 ms-lg-8"
      :class="{ 'compact-branding': store.connected }"
      :aria-label="appName"
      :title="appName"
    >
      <v-icon
        icon="mdi-circle-double"
        size="30"
        color="#D5FF38"
        class="mr-3"
      />
      <span class="branding-copy">
        <span class="product-name text-subtitle-1 text-lg-h5">
          {{ appName }}
          <span class="product-bar tagline">|</span>
          <span class="tagline-text tagline">Know Your Network</span>
        </span>
      </span>
    </router-link>
    <v-spacer />
    <nav
      v-if="store.connected && lgAndUp"
      class="top-navigation d-flex align-center"
      aria-label="Main navigation"
    >
      <v-btn
        v-for="section in primaryNavigationSections"
        :key="section.name"
        :to="{ name: section.pages[0]!.name }"
        class="navigation-trigger mx-2"
        :class="{ 'is-active': route.matched.some(record => record.name === section.name) }"
        :color="route.matched.some(record => record.name === section.name) ? 'rose' : undefined"
        :icon="section.name === 'settings-section' ? true : undefined"
        :prepend-icon="section.name === 'settings-section' ? undefined : section.icon"
        :aria-label="section.title"
        variant="text"
        rounded
      >
        <v-icon
          v-if="section.name === 'settings-section'"
          :icon="section.icon"
        />
        <span v-else>{{ section.title }}</span>
      </v-btn>
    </nav>
    <div class="header-status d-flex flex-column align-end mr-2">
      <div class="d-flex align-center">
        <ConnectionStatus />
        <MobileCategoryMenu v-if="store.connected && !lgAndUp" />
      </div>
      <span
        v-if="deviceName"
        class="device-name"
        aria-label="Device name"
        :title="deviceName"
      >{{ deviceName }}</span>
    </div>
  </v-app-bar>
</template>

<style scoped>
.branding-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.device-name {
  max-width: min(280px, 40vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: end;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 16px;
}
</style>