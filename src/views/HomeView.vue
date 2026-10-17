<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useControllerStore } from "@/stores/controller";
import { configSchema } from "@/types/domain";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
import StatisticsPanel from "@/components/feature/StatisticsPanel.vue";
const store = useControllerStore();
const observed = computed(() => configSchema.safeParse(store.state.data?.observed));
const expected = computed(() => store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const counts = computed(() => {
  const config = store.state.data?.desired;
  return config ? [
    ["Dummy interfaces", config.interfaces.filter(link => link.kind === "dummy").length],
    ["VLANs", config.interfaces.filter(link => link.kind === "vlan").length],
    ["WireGuard interfaces", config.interfaces.filter(link => link.kind === "wireguard").length],
    ["Routes", config.routes.length], ["Source-policy rules", config.policy_rules.length],
    ["Filter rules", config.firewall.rules.length], ["Masquerade rules", config.firewall.nat.masquerade.length],
    ["softflowd configured / enabled", `${config.softflowd.length} / ${config.softflowd.filter(item => item.enabled).length}`],
    ["DHCPv4 relay configured / enabled", `${config.interfaces.length} / ${config.interfaces.filter(item => item.dhcp_relay.enabled).length}`],
  ] : [];
});
onMounted(() => { void store.refreshRevisions(); });
</script>
<template>
  <section aria-labelledby="overview-title">
    <p class="text-overline text-primary">
      Isolated lab control plane
    </p>
    <h1
      id="overview-title"
      class="text-h4 mb-4"
    >
      Overview
    </h1>
    <DatasetStatus
      :query="store.state"
      label="Committed / observed configuration"
    />
    <template v-if="store.state.data">
      <p class="mb-4">
        Committed revision <router-link :to="`/history/${store.state.data.revision}`">
          {{ store.state.data.revision }}
        </router-link>.
        {{ store.state.data.drift ? "Modeled drift" : "Modeled agreement; not proof of connectivity" }}.
      </p>
      <v-row>
        <v-col
          v-for="[label, count] in counts"
          :key="String(label)"
          cols="12"
          sm="6"
          lg="3"
        >
          <v-card
            border
            class="pa-4"
          >
            <h2 class="text-subtitle-2 text-medium-emphasis">
              {{ label }}
            </h2><p class="text-h4 mt-2">
              {{ count }}
            </p>
          </v-card>
        </v-col>
      </v-row>
      <h2 class="text-h5 mt-8 mb-3">
        Expected live versus observed
      </h2>
      <ConfigDiff
        v-if="observed.success && expected"
        :before="expected"
        :after="observed.data"
      />
      <v-alert
        v-else
        type="warning"
      >
        Observed configuration contains an unsupported schema/kind. Read-only diagnostics are retained.
      </v-alert>
      <JsonPanel
        :value="store.state.data.observed"
        label="Observed diagnostics"
      />
    </template>
    <h2 class="text-h5 mt-8 mb-3">
      Runtime and protected parents
    </h2>
    <DatasetStatus
      :query="store.runtime"
      label="Runtime"
    />
    <v-alert
      v-if="store.runtime.data?.error"
      type="warning"
    >
      {{ store.runtime.data.error }}
    </v-alert>
    <p v-if="store.runtime.data">
      {{ store.runtime.data.parent_interfaces.filter(item => item.available).length }} / {{ store.runtime.data.parent_interfaces.length }} parents available.
      {{ store.runtime.data.softflowd.length }} service runtime records. Responsiveness is not collector delivery.
      {{ store.runtime.data.dhcp_relay.length }} DHCP relay runtime records; local readiness is not lease delivery.
    </p>
    <v-btn
      to="/parents"
      variant="text"
    >
      Inspect parents
    </v-btn><v-btn
      to="/services/softflowd"
      variant="text"
    >
      Inspect services
    </v-btn>
    <v-btn
      to="/services/dhcp-relay"
      variant="text"
    >
      Inspect DHCP relay
    </v-btn>
    <h2 class="text-h5 mt-8 mb-3">
      Recent transactions
    </h2>
    <DatasetStatus
      :query="store.transactions"
      label="Transaction discovery"
    />
    <v-list bg-color="transparent">
      <v-list-item
        v-for="item in store.sortedTransactions.slice(0, 5)"
        :key="item.id"
        :to="`/transactions/${encodeURIComponent(item.id)}`"
        :title="item.description || item.id"
        :subtitle="`${item.status} · ${item.submitted_at || 'Unknown (legacy record)'}`"
      />
    </v-list>
    <p v-if="store.transactions.data && !store.sortedTransactions.length">
      No transactions recorded.
    </p>
    <h2 class="text-h5 mt-8 mb-3">
      Recent committed revisions
    </h2>
    <DatasetStatus
      :query="store.revisions"
      label="Committed history"
    />
    <v-list bg-color="transparent">
      <v-list-item
        v-for="item in store.revisions.data?.slice(0, 5)"
        :key="item.revision"
        :to="`/history/${item.revision}`"
        :title="`Revision ${item.revision}${item.current ? ' · current' : ''}`"
        :subtitle="item.description || 'No description'"
      />
    </v-list>
    <StatisticsPanel />
    <v-alert
      type="info"
      variant="tonal"
      class="mt-8"
    >
      Owned isolated namespace only. Protected adopted parents are read-only.
      Forwarding, host setup, and out-of-band access are operator responsibilities. A package apply is not an atomic kernel transaction.
    </v-alert>
  </section>
</template>
