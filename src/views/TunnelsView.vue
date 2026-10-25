<script setup lang="ts">
import { computed, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, validateConfig } from "@/services/configuration";
import type { ManagedInterface } from "@/types/domain";

type Tunnel = Extract<ManagedInterface, { kind: "wireguard" }>;
interface TunnelForm { name: string; mtu: number; addresses: string; key_ref: string; listen_port: number }

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const tunnels = computed(() => (selected.value?.interfaces ?? []).flatMap((link, index) => link.kind === "wireguard" ? [{ link, index }] : []));
const types = [{ title: "WireGuard", value: "wireguard" }];
const editing = ref<string | null>(null), creating = ref(false), type = ref("wireguard");
const form = ref<TunnelForm>({ name: "", mtu: 1420, addresses: "", key_ref: "", listen_port: 51820 });
const error = ref("");
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value);

function open(tunnel?: Tunnel): void {
  error.value = ""; creating.value = !tunnel; editing.value = tunnel?.name ?? null;
  if (tunnel) {
    form.value = { name: tunnel.name, mtu: tunnel.mtu, addresses: tunnel.addresses.join(", "), key_ref: tunnel.wireguard.key_ref, listen_port: tunnel.wireguard.listen_port };
    return;
  }
  const names = new Set((selected.value?.interfaces ?? []).map(link => link.name));
  let number = 0;
  while (names.has(`tun_wg${number}`)) number++;
  const ports = tunnels.value.map(item => item.link.wireguard.listen_port);
  form.value = { name: `tun_wg${number}`, mtu: 1420, addresses: "", key_ref: "", listen_port: ports.length ? Math.min(Math.max(...ports) + 1, 65535) : 51820 };
}
function close(): void { creating.value = false; editing.value = null; error.value = ""; }
function peerCount(tunnel: Tunnel): number { return tunnel.wireguard.peers.length; }
function stage(): void {
  error.value = "";
  if (blocked.value || !selected.value) return;
  try {
    const candidate = cloneConfig(selected.value);
    const current = candidate.interfaces.find(link => link.name === editing.value);
    const existing = current?.kind === "wireguard" ? current : undefined;
    const entry: Tunnel = {
      ...(existing ?? { role: "unassigned", dhcp_relay: { enabled: false, servers: [] } }),
      name: form.value.name.trim(), kind: "wireguard", mtu: form.value.mtu, up: existing?.up ?? true,
      addresses: form.value.addresses.split(/[\s,]+/).filter(Boolean),
      wireguard: { ...existing?.wireguard, key_ref: form.value.key_ref.trim(), listen_port: form.value.listen_port, peers: existing?.wireguard.peers ?? [] },
    };
    const index = existing ? candidate.interfaces.indexOf(existing) : candidate.interfaces.length;
    candidate.interfaces[index] = entry;
    const issues = validateConfig(candidate, store.runtime.data?.parent_interfaces, store.state.data?.desired).filter(issue =>
      issue.path === `interfaces.${index}` || issue.path.startsWith(`interfaces.${index}.`));
    if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
    store.stage(candidate); close();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the tunnel"; }
}
function toggle(tunnel: Tunnel, up: boolean): void {
  error.value = "";
  if (blocked.value || !selected.value) return;
  try {
    const candidate = cloneConfig(selected.value);
    const link = candidate.interfaces.find(item => item.name === tunnel.name);
    if (link) link.up = up;
    store.stage(candidate);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the change"; }
}
function remove(tunnel: Tunnel): void {
  error.value = "";
  if (!selected.value) return;
  const config = selected.value;
  const users = [
    ...config.routes.filter(route => route.interface === tunnel.name).map(route => `route ${route.destination}`),
    ...config.firewall.nat.masquerade.filter(rule => rule.out_interface === tunnel.name).map(() => "a masquerade rule"),
    ...(config.firewall.input?.interfaces.filter(item => item.interface === tunnel.name).map(() => "host input rules") ?? []),
    ...config.softflowd.filter(item => item.interface === tunnel.name).map(item => `NetFlow/IPFIX ${item.name}`),
    ...config.gateway_monitors.filter(item => item.interface === tunnel.name).map(item => `gateway monitor ${item.name}`),
  ];
  if (users.length) { error.value = `${tunnel.name} is still used by ${users.join(", ")}. Remove those first.`; return; }
  try {
    const candidate = cloneConfig(config);
    candidate.interfaces = candidate.interfaces.filter(link => link.name !== tunnel.name);
    if (candidate.dns) delete candidate.dns[tunnel.name];
    if (candidate.dhcp_clients) delete candidate.dhcp_clients[tunnel.name];
    store.stage(candidate); if (editing.value === tunnel.name) close();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the change"; }
}
</script>

<template>
  <section aria-label="Tunnel interfaces">
    <div class="d-flex flex-wrap align-center ga-3 mb-5">
      <v-btn
        prepend-icon="mdi-plus"
        color="primary"
        :disabled="blocked"
        @click="open()"
      >
        Add tunnel
      </v-btn>
    </div>
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
    >
      {{ error }}
    </v-alert>
    <v-table class="tunnel-table">
      <thead>
        <tr>
          <th scope="col">
            Name
          </th>
          <th scope="col">
            Type
          </th>
          <th scope="col">
            Admin state
          </th>
          <th scope="col">
            MTU
          </th>
          <th scope="col">
            Addresses
          </th>
          <th scope="col">
            Listen port
          </th>
          <th scope="col">
            Peers
          </th>
          <th
            scope="col"
            class="column-actions"
          >
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="{ link } in tunnels"
          :key="link.name"
        >
          <th scope="row">
            {{ link.name }}
          </th>
          <td>WireGuard</td>
          <td>
            <v-switch
              :model-value="link.up"
              :aria-label="`Admin state for ${link.name}`"
              :title="link.up ? 'Up' : 'Down'"
              :disabled="blocked"
              density="compact"
              hide-details
              color="primary"
              @update:model-value="toggle(link, Boolean($event))"
            />
          </td>
          <td>{{ link.mtu }}</td>
          <td>{{ link.addresses.join(', ') || 'None' }}</td>
          <td>{{ link.wireguard.listen_port }}</td>
          <td>
            <router-link :to="`/wireguard/${encodeURIComponent(link.name)}`">
              {{ peerCount(link) }}
            </router-link>
          </td>
          <td>
            <v-btn
              icon="mdi-pencil-outline"
              :aria-label="`Edit ${link.name}`"
              :title="`Edit ${link.name}`"
              size="x-small"
              variant="text"
              :disabled="blocked"
              @click="open(link)"
            />
            <v-btn
              icon="mdi-delete-outline"
              :aria-label="`Delete ${link.name}`"
              :title="`Delete ${link.name}`"
              size="x-small"
              variant="text"
              color="error"
              :disabled="blocked"
              @click="remove(link)"
            />
          </td>
        </tr>
        <tr v-if="!tunnels.length">
          <td colspan="8">
            No tunnel interfaces.
          </td>
        </tr>
      </tbody>
    </v-table>
    <form
      v-if="creating || editing"
      class="tunnel-form"
      :aria-label="creating ? 'Add tunnel interface' : `Edit ${editing}`"
      @submit.prevent="stage"
    >
      <div class="tunnel-grid">
        <v-select
          v-model="type"
          label="Type"
          :items="types"
          :disabled="blocked || !creating"
          density="compact"
          hide-details="auto"
        />
        <v-text-field
          v-model="form.name"
          label="Name"
          :disabled="blocked || !creating"
          density="compact"
          hide-details="auto"
        />
        <v-text-field
          v-model="form.key_ref"
          label="Private Key"
          hint="Name of the key stored on the appliance, not the key itself"
          persistent-hint
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-number-input
          v-model="form.listen_port"
          label="Listen port"
          :min="1"
          :max="65535"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
          control-variant="stacked"
        />
        <v-text-field
          v-model="form.addresses"
          label="Addresses (comma separated)"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-number-input
          v-model="form.mtu"
          label="MTU"
          :min="1280"
          :max="65535"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
          control-variant="stacked"
        />
      </div>
      <div class="d-flex justify-end ga-2 mt-4">
        <v-btn
          variant="text"
          @click="close"
        >
          Cancel
        </v-btn>
        <v-btn
          type="submit"
          color="primary"
          prepend-icon="mdi-content-save-outline"
          :disabled="blocked"
        >
          Save
        </v-btn>
      </div>
    </form>
  </section>
</template>

<style scoped>
section { padding-bottom: 56px; }
.tunnel-table :deep(th), .tunnel-table :deep(td) { white-space: normal; overflow-wrap: anywhere; }
.tunnel-table :deep(.column-actions) { width: 96px; }
.tunnel-form { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-light); }
.tunnel-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; max-width: 900px; }
@media (max-width: 700px) {
  .tunnel-grid { grid-template-columns: 1fr; }
}
</style>
