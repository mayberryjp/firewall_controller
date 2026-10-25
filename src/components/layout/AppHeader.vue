<script setup lang="ts">
import { useDisplay } from "vuetify";
import { useRoute } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import { primaryNavigationSections } from "@/constants/navigation";
import MobileCategoryMenu from "@/components/layout/MobileCategoryMenu.vue";
import ConnectionStatus from "@/components/layout/ConnectionStatus.vue";
const store = useControllerStore(), route = useRoute();
const { lgAndUp } = useDisplay();
const appName = import.meta.env.VITE_APP_NAME || "Firewall Controller";
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
        icon="mdi-wall"
        size="30"
        color="#2ec4a0"
        class="mr-3"
      />
      <span class="product-name text-subtitle-1 text-lg-h5">
        {{ appName }}
        <span class="product-bar tagline">|</span>
        <span class="tagline-text tagline">Know Your Network</span>
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
    <div class="d-flex align-center mr-2">
      <ConnectionStatus />
      <MobileCategoryMenu v-if="store.connected && !lgAndUp" />
    </div>
  </v-app-bar>
</template>