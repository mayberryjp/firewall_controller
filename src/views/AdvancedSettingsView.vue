<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useControllerStore } from "@/stores/controller";

const store = useControllerStore(), router = useRouter();
const open = ref(false), acknowledged = ref(false), submitting = ref(false), error = ref("");
const reviewedRevision = ref("");

function review(): void {
  acknowledged.value = false; error.value = "";
  reviewedRevision.value = store.state.data?.revision ?? "";
  open.value = true;
}
async function remove(): Promise<void> {
  error.value = "";
  if (!acknowledged.value) { error.value = "Acknowledge the deletion scope before proceeding."; return; }
  if (submitting.value) { error.value = "Deletion is already being submitted."; return; }
  submitting.value = true;
  try {
    const result = await store.deleteFirewallHostsAndRules(reviewedRevision.value, 120, "Clear reviewed firewall hosts and forwarding rules");
    if (!result) {
      error.value = store.actionError || "Deletion outcome could not be verified.";
      return;
    }
    open.value = false;
    await router.push({ name: "transaction-detail", params: { id: result.id } });
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to delete firewall hosts and rules."; }
  finally { submitting.value = false; }
}
</script>

<template>
  <section aria-label="Advanced settings">
    <h1 class="text-h6 mb-4">
      ADVANCED
    </h1>
    <div class="advanced-actions">
      <v-btn
        color="error"
        variant="tonal"
        prepend-icon="mdi-delete-forever"
        class="delete-action px-3 py-2"
        :disabled="submitting || Boolean(store.firewallDeletionBlockedReason)"
        :aria-describedby="store.firewallDeletionNotice ? 'advanced-blocked' : undefined"
        @click="review"
      >
        Delete all firewall hosts and forwarding rules
      </v-btn>
      <p
        v-if="store.firewallDeletionNotice"
        id="advanced-blocked"
        role="status"
      >
        {{ store.firewallDeletionNotice }}
        <router-link
          v-if="store.activeTransactions.length || store.uncertain || store.draft"
          to="/config/changes"
        >
          Review in SAVE
        </router-link>
      </p>
    </div>
    <v-dialog
      v-model="open"
      :persistent="submitting || store.busy"
      max-width="720"
      scrollable
      aria-labelledby="advanced-confirm-title"
      aria-describedby="advanced-confirm-warning"
    >
      <v-card>
        <v-card-title
          id="advanced-confirm-title"
          class="text-wrap"
        >
          Delete all firewall hosts and forwarding rules?
        </v-card-title>
        <v-card-text>
          <p class="mb-2">
            This deletes:
          </p>
          <ul class="pl-6 mb-4">
            <li>All configured firewall hosts, including their rules and defaults.</li>
            <li>All legacy and interface forwarding rules.</li>
          </ul>
          <p class="mb-4">
            NAT, management input rules, global firewall defaults and ICMP settings, interface-policy
            entries, Sando settings and discovery data, and unrelated configuration are preserved.
            Connections are not flushed. This is not a factory reset.
          </p>
          <v-alert
            id="advanced-confirm-warning"
            type="error"
            variant="tonal"
            class="mb-4"
          >
            Keeping a Drop default can stop forwarding. Removing Drop rules under an Accept default
            can broaden access. Keeping management input rules does not guarantee remote connectivity.
            Back up the configuration and keep another way to access the firewall.
          </v-alert>
          <p class="mb-4">
            Deletion applies immediately and provisionally. Test connectivity, then confirm the
            transaction within 120 seconds or the firewall will restore its previous configuration.
            Hosts are not automatically reimported from Sando.
          </p>
          <v-checkbox
            v-model="acknowledged"
            label="I understand that all firewall hosts and forwarding rules will be deleted."
            :disabled="submitting || store.busy"
            hide-details
          />
          <v-alert
            v-if="error"
            type="error"
            role="alert"
            class="mt-4"
          >
            {{ error }}
          </v-alert>
          <p
            v-if="store.firewallDeletionNotice"
            role="status"
            class="mt-4"
          >
            {{ store.firewallDeletionNotice }}
          </p>
          <p
            v-if="store.uncertain"
            class="mt-4"
          >
            The deletion outcome is uncertain. Do not retry.
            <router-link :to="store.uncertain.id ? `/config/commits/${encodeURIComponent(store.uncertain.id)}` : '/config/commits'">
              Inspect the transaction in Commits
            </router-link>
          </p>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn
            :disabled="submitting || store.busy"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            :disabled="submitting || !acknowledged || Boolean(store.firewallDeletionBlockedReason)"
            :loading="submitting || store.busy"
            class="confirm-delete"
            @click="remove"
          >
            Delete hosts and rules
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.advanced-actions { display: grid; gap: 24px; max-width: 560px; }
.delete-action { justify-self: start; max-width: 100%; height: auto; min-height: 36px; }
.delete-action :deep(.v-btn__content), .confirm-delete :deep(.v-btn__content) { white-space: normal; }
.confirm-delete { height: auto; min-height: 36px; }
</style>
