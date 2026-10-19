<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useDisplay } from "vuetify";
import { useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";
import { useControllerStore } from "@/stores/controller";
import { logoutRegistry } from "@/services/registry";
import SafetyBanner from "@/components/layout/SafetyBanner.vue";
const app = useAppStore(), store = useControllerStore(), router = useRouter();
const { navigationOpen } = storeToRefs(app);
const { mdAndUp } = useDisplay();
const disconnectDialog = ref(false);
const appName = import.meta.env.VITE_APP_NAME || "Firewall Controller";
const deployment = import.meta.env.VITE_DEPLOYMENT_LABEL || "Unknown";
const mode = import.meta.env.VITE_BACKEND_MODE || "Unknown";
const groups = [
  { title: "Overview", links: [["Overview", "/overview", "mdi-view-dashboard-outline"]] },
  { title: "Networking", links: [
    ["Interfaces", "/interfaces", "mdi-ethernet"], ["Adopted parents", "/parents", "mdi-lock-outline"],
    ["Routes", "/routes", "mdi-routes"], ["Source-policy rules", "/policy-rules", "mdi-source-branch"],
    ["Firewall forwarding", "/firewall", "mdi-shield-outline"], ["NAT masquerading", "/nat", "mdi-swap-horizontal"],
    ["WireGuard", "/wireguard", "mdi-vpn"],
    ["Gateway monitors", "/gateway-monitors", "mdi-access-point-network"],
  ] },
  { title: "Services", links: [
    ["softflowd", "/services/softflowd", "mdi-chart-timeline-variant"], ["DHCPv4 relay", "/services/dhcp-relay", "mdi-lan-connect"],
    ["Appliance NTP", "/services/ntp", "mdi-clock-outline"], ["Appliance syslog", "/services/syslog", "mdi-text-box-outline"],
    ["vnStat", "/services/vnstat", "mdi-chart-bar"],
  ] },
  { title: "Changes & history", links: [
    ["Review changes", "/changes", "mdi-file-compare"], ["Transactions", "/transactions", "mdi-history"],
    ["Committed revisions", "/history", "mdi-source-commit"],
  ] },
];
async function disconnect(): Promise<void> {
  store.disconnect(); logoutRegistry(); disconnectDialog.value = false; await router.replace("/connect");
}
</script>
<template>
  <v-app>
    <a
      class="skip-link"
      href="#main-content"
    >Skip to main content</a>
    <v-app-bar
      flat
      border="b"
    >
      <v-app-bar-nav-icon
        v-if="store.connected && !mdAndUp"
        aria-label="Toggle navigation"
        aria-controls="app-navigation"
        :aria-expanded="navigationOpen"
        @click="app.toggleNavigation"
      />
      <v-icon
        icon="mdi-shield-outline"
        color="primary"
        class="ml-4 mr-3"
      />
      <v-app-bar-title class="font-weight-bold">
        {{ appName }}
      </v-app-bar-title>
      <v-chip
        v-if="mdAndUp"
        class="mr-3"
        size="small"
      >
        {{ deployment }} · {{ mode }}
      </v-chip>
      <v-btn
        v-if="store.connected"
        :disabled="store.busy"
        @click="disconnectDialog = true"
      >
        Disconnect
      </v-btn>
      <v-chip
        v-else
        class="mr-4"
        size="small"
      >
        Disconnected
      </v-chip>
    </v-app-bar>
    <v-navigation-drawer
      v-if="store.connected"
      id="app-navigation"
      :model-value="mdAndUp || navigationOpen"
      :permanent="mdAndUp"
      :temporary="!mdAndUp"
      aria-label="Main navigation"
      @update:model-value="navigationOpen = $event"
    >
      <v-list
        nav
        aria-label="Pages"
      >
        <template
          v-for="group in groups"
          :key="group.title"
        >
          <v-list-subheader>{{ group.title }}</v-list-subheader>
          <v-list-item
            v-for="link in group.links"
            :key="link[1]"
            :to="link[1]"
            :title="link[0]"
            :prepend-icon="link[2]"
            color="primary"
            @click="navigationOpen = false"
          />
        </template>
      </v-list>
      <template #append>
        <div class="pa-4 text-caption text-medium-emphasis">
          Isolated lab control plane<br>Deployment: {{ deployment }}<br>Mode: {{ mode }} (operator supplied)
        </div>
      </template>
    </v-navigation-drawer>
    <v-main
      id="main-content"
      tabindex="-1"
    >
      <div class="app-content">
        <template v-if="store.connected">
          <div class="d-flex flex-wrap ga-3 align-center mb-4 text-caption">
            <span>{{ store.state.error ? "Observation unavailable" : "Connected" }}</span>
            <span>Committed revision {{ store.state.data?.revision ?? "Unknown" }}</span>
            <span>Last refresh {{ store.state.lastSuccess ? new Date(store.state.lastSuccess).toLocaleString() : "Unknown" }}</span>
            <v-btn
              size="small"
              variant="text"
              :loading="store.state.loading"
              @click="store.refresh"
            >
              Refresh
            </v-btn>
          </div>
          <v-alert
            v-if="store.draft"
            type="info"
            variant="tonal"
            class="mb-4"
          >
            Shared draft · {{ store.diff.length }} changed entities ·
            {{ store.validation.length ? `${store.validation.length} validation issues` : "Locally valid; server preflight still required" }}
            <v-btn
              variant="text"
              to="/changes"
            >
              Review changes
            </v-btn>
          </v-alert>
          <SafetyBanner />
        </template>
        <slot />
      </div>
    </v-main>
    <v-dialog
      v-model="disconnectDialog"
      max-width="560"
    >
      <v-card title="Disconnect and clear local state?">
        <v-card-text>
          This clears the credential, cached data, and any draft or unstaged input.
          It does not revoke the key, confirm a candidate, cancel durable intent, or reliably trigger immediate rollback.
          <p
            v-if="store.activeTransactions.length || store.uncertain"
            class="mt-3 text-warning"
          >
            An active or uncertain operation may require recovery after reconnecting.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-btn @click="disconnectDialog = false">
            Keep connected
          </v-btn><v-btn
            color="error"
            @click="disconnect"
          >
            Disconnect and clear
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>
