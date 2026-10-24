<script setup lang="ts">
import { useRoute } from "vue-router";
import { useDisplay } from "vuetify";
import type { NavigationSection } from "@/constants/navigation";

defineProps<{ section: NavigationSection }>();
const route = useRoute();
const { lgAndUp } = useDisplay();
</script>

<template>
  <v-sheet
    class="section-layout"
    :class="{ 'section-layout--with-navigation': section.pages.length > 1 }"
    color="surface-card"
  >
    <nav
      v-if="section.pages.length > 1"
      class="section-navigation"
      :aria-label="`${section.title} pages`"
    >
      <v-tabs
        :model-value="route.meta.navigationPage ?? route.name"
        :direction="lgAndUp ? 'vertical' : 'horizontal'"
        :aria-orientation="lgAndUp ? 'vertical' : 'horizontal'"
        :aria-label="`${section.title} pages`"
        :show-arrows="!lgAndUp"
        color="primary"
      >
        <v-tab
          v-for="page in section.pages"
          :key="page.name"
          :value="page.name"
          :to="{ name: page.name }"
          :aria-current="(route.meta.navigationPage ?? route.name) === page.name ? 'page' : undefined"
        >
          {{ page.title }}
        </v-tab>
      </v-tabs>
    </nav>
    <div class="section-content">
      <router-view :key="route.path" />
    </div>
  </v-sheet>
</template>

<style scoped>
.section-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  min-width: 0;
}
.section-navigation,
.section-content {
  min-width: 0;
}
.section-layout--with-navigation > .section-content {
  padding: 8px 0 0;
}
.section-navigation :deep(.v-tab) {
  letter-spacing: 0;
}
@media (min-width: 1280px) {
  .section-layout--with-navigation {
    grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
  }
  .section-layout--with-navigation > .section-content {
    padding: 16px 0 0 16px;
  }
}
</style>