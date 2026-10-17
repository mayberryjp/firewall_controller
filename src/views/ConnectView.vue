<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useControllerStore } from "@/stores/controller";
const store = useControllerStore(), router = useRouter();
const route = useRoute();
const credential = ref("");
async function connect(): Promise<void> {
  const value = credential.value;
  credential.value = "";
  const redirect = route.query.redirect;
  if (await store.connect(value)) await router.replace(typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/overview");
}
</script>
<template>
  <section
    class="connect-panel"
    aria-labelledby="connect-title"
  >
    <p class="text-overline text-primary mb-2">
      Isolated lab control plane
    </p>
    <h1
      id="connect-title"
      class="text-h4 mb-4"
    >
      Connect to Netcontrol
    </h1>
    <p class="mb-6">
      Use a networking bearer key for this trusted deployment. Device-account cookies do not authorize networking requests.
    </p>
    <v-card
      border
      class="pa-6"
    >
      <v-form @submit.prevent="connect">
        <v-text-field
          v-model="credential"
          type="password"
          label="Bearer credential"
          autocomplete="off"
          :disabled="store.connecting"
          hint="Memory only. Never saved in browser storage or URLs."
          persistent-hint
        />
        <v-alert
          v-if="store.authError"
          role="alert"
          type="error"
          class="my-4"
        >
          {{ store.authError }}
        </v-alert>
        <v-btn
          type="submit"
          color="primary"
          :loading="store.connecting"
          :disabled="!credential.trim()"
        >
          Connect
        </v-btn>
      </v-form>
    </v-card>
    <p class="text-caption text-medium-emphasis mt-5">
      Reload requires credential re-entry. Disconnecting does not revoke a key or cancel a pending transaction.
      Manage device onboarding and keys using the daemon's embedded website through your operator-provided device URL.
    </p>
  </section>
</template>
