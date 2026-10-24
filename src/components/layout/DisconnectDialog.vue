<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import { logoutRegistry } from "@/services/registry";
const open = defineModel<boolean>({ required: true });
const store = useControllerStore(), router = useRouter();
const signingOut = ref(false), error = ref("");
async function disconnect(): Promise<void> {
  signingOut.value = true; error.value = "";
  try {
    await logoutRegistry();
    store.disconnect(); open.value = false; await router.replace("/connect");
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to sign out"; }
  finally { signingOut.value = false; }
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="560"
  >
    <v-card title="Disconnect and clear local state?">
      <v-card-text>
        This clears the registry session, cached data, and any draft or unstaged input.
        It does not revoke the key, confirm a candidate, cancel durable intent, or reliably trigger immediate rollback.
        <v-alert
          v-if="error"
          type="error"
          role="alert"
          class="mt-3"
        >
          {{ error }}
        </v-alert>
        <p
          v-if="store.activeTransactions.length || store.uncertain"
          class="mt-3 text-warning"
        >
          An active or uncertain operation may require recovery after reconnecting.
        </p>
      </v-card-text>
      <v-card-actions>
        <v-btn
          :disabled="signingOut"
          @click="open = false"
        >
          Keep connected
        </v-btn>
        <v-btn
          color="error"
          :loading="signingOut"
          :disabled="signingOut"
          @click="disconnect"
        >
          Disconnect and clear
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>