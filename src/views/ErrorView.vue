<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const isNotFound = computed(() => route.name === "not-found");
</script>

<template>
  <section
    aria-labelledby="error-title"
    class="py-12"
  >
    <v-icon
      icon="mdi-alert-circle-outline"
      color="warning"
      size="48"
      class="mb-4"
    />
    <h1
      id="error-title"
      class="text-h4 font-weight-bold mb-4"
    >
      {{ isNotFound ? "Page not found" : "Unable to open this page" }}
    </h1>
    <p
      role="alert"
      class="text-body-1 text-medium-emphasis mb-6"
    >
      {{ isNotFound
        ? "This address does not match a page in the controller."
        : "Navigation failed. Return to the overview, or reload the app to try again." }}
    </p>
    <v-btn
      :to="{ name: 'home' }"
      color="primary"
      prepend-icon="mdi-arrow-left"
    >
      Back to overview
    </v-btn>
  </section>
</template>
