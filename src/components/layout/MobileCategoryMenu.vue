<script setup lang="ts">
import { ref } from "vue";
import { useRoute } from "vue-router";
import { navigationSections } from "@/constants/navigation";
const route = useRoute();
const open = ref(false);
</script>

<template>
  <v-menu
    v-model="open"
    location="bottom end"
    :offset="8"
  >
    <template #activator="{ props }">
      <v-app-bar-nav-icon
        v-bind="props"
        aria-label="Open navigation menu"
        title="Open navigation menu"
      />
    </template>
    <nav aria-label="Main navigation">
      <v-list
        class="navigation-menu"
        nav
      >
        <v-list-item
          v-for="section in navigationSections"
          :key="section.name"
          :to="{ name: section.pages[0]!.name }"
          :title="section.title"
          :prepend-icon="section.icon"
          :active="route.matched.some(record => record.name === section.name)"
          color="rose"
          @click="open = false"
        />
      </v-list>
    </nav>
  </v-menu>
</template>