<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, validateConfig } from "@/services/configuration";
import { formatBytes } from "@/services/hostHealth";
import { handshakeChip as describeHandshake } from "@/services/wireguard";
import type { ManagedInterface } from "@/types/domain";

type Tunnel = Extract<ManagedInterface, { kind: "wireguard" }>;
const props = defineProps<{ name?: string }>();
const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const tunnels = computed(() => (selected.value?.interfaces ?? []).filter((link): link is Tunnel => link.kind === "wireguard"));
const filter = ref(props.name ?? "");
const live = computed(() => new Map((store.runtime.data?.wireguard ?? []).map(item => [item.interface, item])));
const peers = computed(() => tunnels.value.filter(tunnel => !filter.value || tunnel.name === filter.value)
  .flatMap(tunnel => tunnel.wireguard.peers.map((peer, index) => ({
    tunnel: tunnel.name, peer, index,
    stats: peer.enabled === false ? undefined : live.value.get(tunnel.name)?.peers.find(item => item.public_key === peer.public_key),
  }))));
const expanded = ref<string | null>(null);
const identity = (tunnel: string, key: string) => `${tunnel}/${key}`;
const handshakeChip = (seconds: number | null | undefined, keepalive: number) =>
  describeHandshake(seconds, keepalive, store.runtime.lastSuccess ?? Date.now());
const previous = new Map<string, { rx: bigint; tx: bigint }>();
const changes = ref(new Map<string, { rx: bigint; tx: bigint } | null>());
watch(() => store.runtime.data?.wireguard, value => {
  const next = new Map<string, { rx: bigint; tx: bigint } | null>(), seen = new Set<string>();
  for (const tunnel of value ?? []) for (const peer of tunnel.peers) {
    const key = identity(tunnel.interface, peer.public_key), now = { rx: BigInt(peer.rx_bytes), tx: BigInt(peer.tx_bytes) }, before = previous.get(key);
    seen.add(key); previous.set(key, now);
    next.set(key, before && now.rx >= before.rx && now.tx >= before.tx ? { rx: now.rx - before.rx, tx: now.tx - before.tx } : null);
  }
  for (const key of [...previous.keys()]) if (!seen.has(key)) previous.delete(key);
  changes.value = next;
}, { immediate: true });
watch(() => store.connected, () => { previous.clear(); changes.value = new Map(); });
const editing = ref<{ tunnel: string; index: number } | null>(null), adding = ref(false);
const form = ref({ tunnel: "", public_key: "", endpoint: "", allowed: "", keepalive: 0 });
const error = ref("");
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value);

function open(target?: { tunnel: string; index: number }): void {
  error.value = ""; editing.value = target ?? null; adding.value = !target;
  const tunnel = tunnels.value.find(item => item.name === (target?.tunnel ?? (filter.value || tunnels.value[0]?.name)));
  const peer = target ? tunnel?.wireguard.peers[target.index] : undefined;
  form.value = {
    tunnel: tunnel?.name ?? "", public_key: peer?.public_key ?? "", endpoint: peer?.endpoint ?? "",
    allowed: peer?.allowed_ips.join(", ") ?? "", keepalive: peer?.persistent_keepalive_seconds ?? 0,
  };
}
function close(): void { adding.value = false; editing.value = null; error.value = ""; }
function change(edit: (tunnel: Tunnel) => number | void, tunnelName: string, wholeTunnel = false): void {
  if (!selected.value) return;
  const candidate = cloneConfig(selected.value);
  const index = candidate.interfaces.findIndex(link => link.name === tunnelName && link.kind === "wireguard");
  const tunnel = candidate.interfaces[index];
  if (tunnel?.kind !== "wireguard") throw new Error("Select a tunnel interface");
  const peerIndex = edit(tunnel);
  const prefix = typeof peerIndex === "number" ? `interfaces.${index}.wireguard.peers${wholeTunnel ? "" : `.${peerIndex}`}` : "";
  const issues = prefix ? validateConfig(candidate, store.runtime.data?.parent_interfaces, store.state.data?.desired)
    .filter(issue => issue.path === prefix || issue.path.startsWith(`${prefix}.`)) : [];
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
  store.stage(candidate, true);
}
function stage(): void {
  error.value = "";
  if (blocked.value) return;
  try {
    change(tunnel => {
      const existing = editing.value ? tunnel.wireguard.peers[editing.value.index] : undefined;
      const peer = {
        ...existing, public_key: form.value.public_key.trim(), allowed_ips: form.value.allowed.split(/[\s,]+/).filter(Boolean),
        persistent_keepalive_seconds: form.value.keepalive, endpoint: form.value.endpoint.trim() || undefined, enabled: existing?.enabled ?? true,
      };
      if (!peer.endpoint) delete peer.endpoint;
      const index = editing.value?.index ?? tunnel.wireguard.peers.length;
      tunnel.wireguard.peers[index] = peer;
      return index;
    }, editing.value?.tunnel ?? form.value.tunnel);
    close();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the peer"; }
}
function remove(target: { tunnel: string; index: number }): void {
  error.value = "";
  try { change(tunnel => { tunnel.wireguard.peers.splice(target.index, 1); }, target.tunnel); close(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the change"; }
}
const versions = ref<Record<string, number>>({});
function toggle(target: { tunnel: string; index: number; peer: { public_key: string } }, enabled: boolean): void {
  error.value = "";
  const key = identity(target.tunnel, target.peer.public_key);
  try { change(tunnel => { tunnel.wireguard.peers[target.index]!.enabled = enabled; return target.index; }, target.tunnel, true); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the change"; }
  versions.value[key] = (versions.value[key] ?? 0) + 1;
}
const short = (key: string) => key.length > 14 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
</script>

<template>
  <section aria-label="WireGuard peers">
    <div class="d-flex flex-wrap align-center ga-3 mb-5">
      <v-btn
        prepend-icon="mdi-plus"
        color="primary"
        :disabled="blocked || !tunnels.length"
        @click="open()"
      >
        Add peer
      </v-btn>
      <v-select
        v-if="tunnels.length > 1"
        v-model="filter"
        aria-label="Tunnel"
        class="tunnel-filter"
        :items="[{ title: 'All tunnels', value: '' }, ...tunnels.map(item => ({ title: item.name, value: item.name }))]"
        density="compact"
        hide-details
      />
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
    <p
      v-if="!tunnels.length"
      class="mb-4"
    >
      Peers belong to a tunnel interface. <router-link to="/tunnels">
        Add a tunnel interface
      </router-link> first.
    </p>
    <v-table class="peer-table">
      <thead>
        <tr>
          <th scope="col">
            Tunnel
          </th>
          <th scope="col">
            Public key
          </th>
          <th scope="col">
            Endpoint
          </th>
          <th scope="col">
            Keepalive
          </th>
          <th scope="col">
            Last handshake
          </th>
          <th scope="col">
            Received
          </th>
          <th scope="col">
            Sent
          </th>
          <th
            scope="col"
            class="column-status"
          >
            Status
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
        <template
          v-for="item in peers"
          :key="`${item.tunnel}/${item.peer.public_key}`"
        >
          <tr :class="{ 'peer-disabled': item.peer.enabled === false }">
            <th scope="row">
              <v-btn
                :icon="expanded === `${item.tunnel}/${item.peer.public_key}` ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                :aria-label="`Details for ${item.tunnel} peer ${short(item.peer.public_key)}`"
                :aria-expanded="expanded === `${item.tunnel}/${item.peer.public_key}`"
                :title="`Details for ${item.tunnel} peer ${short(item.peer.public_key)}`"
                size="x-small"
                variant="text"
                @click="expanded = expanded === `${item.tunnel}/${item.peer.public_key}` ? null : `${item.tunnel}/${item.peer.public_key}`"
              />
              {{ item.tunnel }}
            </th>
            <td
              class="mono"
              :title="item.peer.public_key"
            >
              {{ short(item.peer.public_key) }}
            </td>
            <td>{{ item.peer.endpoint || item.stats?.endpoint || '—' }}</td>
            <td>{{ item.peer.persistent_keepalive_seconds ? `${item.peer.persistent_keepalive_seconds}s` : 'Off' }}</td>
            <td>
              <template v-if="item.stats">
                <v-chip
                  :color="handshakeChip(item.stats.last_handshake_unix_seconds, item.peer.persistent_keepalive_seconds).color"
                  :title="handshakeChip(item.stats.last_handshake_unix_seconds, item.peer.persistent_keepalive_seconds).title"
                  size="small"
                  variant="tonal"
                >
                  {{ handshakeChip(item.stats.last_handshake_unix_seconds, item.peer.persistent_keepalive_seconds).label }}
                </v-chip>
              </template>
              <template v-else>
                —
              </template>
            </td>
            <td :title="item.stats?.rx_bytes">
              {{ item.stats ? formatBytes(item.stats.rx_bytes) : '—' }}
              <v-chip
                v-if="changes.get(identity(item.tunnel, item.peer.public_key))"
                :color="changes.get(identity(item.tunnel, item.peer.public_key))!.rx > 0n ? 'green' : 'default'"
                title="Change since the previous sample"
                size="x-small"
                variant="tonal"
                class="ml-1"
              >
                +{{ formatBytes(String(changes.get(identity(item.tunnel, item.peer.public_key))!.rx)) }}
              </v-chip>
            </td>
            <td :title="item.stats?.tx_bytes">
              {{ item.stats ? formatBytes(item.stats.tx_bytes) : '—' }}
              <v-chip
                v-if="changes.get(identity(item.tunnel, item.peer.public_key))"
                :color="changes.get(identity(item.tunnel, item.peer.public_key))!.tx > 0n ? 'green' : 'default'"
                title="Change since the previous sample"
                size="x-small"
                variant="tonal"
                class="ml-1"
              >
                +{{ formatBytes(String(changes.get(identity(item.tunnel, item.peer.public_key))!.tx)) }}
              </v-chip>
            </td>
            <td class="peer-status">
              <v-switch
                :key="versions[identity(item.tunnel, item.peer.public_key)] ?? 0"
                :model-value="item.peer.enabled !== false"
                :aria-label="`Peer enabled for ${short(item.peer.public_key)}`"
                :title="item.peer.enabled === false ? 'Disabled' : 'Enabled'"
                :disabled="blocked"
                density="compact"
                hide-details
                color="primary"
                @update:model-value="toggle(item, Boolean($event))"
              />
            </td>
            <td>
              <v-btn
                icon="mdi-pencil-outline"
                :aria-label="`Edit peer ${short(item.peer.public_key)}`"
                :title="`Edit peer ${short(item.peer.public_key)}`"
                size="x-small"
                variant="text"
                :disabled="blocked"
                @click="open(item)"
              />
              <v-btn
                icon="mdi-delete-outline"
                :aria-label="`Delete peer ${short(item.peer.public_key)}`"
                :title="`Delete peer ${short(item.peer.public_key)}`"
                size="x-small"
                variant="text"
                color="error"
                :disabled="blocked"
                @click="remove(item)"
              />
            </td>
          </tr>
          <tr
            v-if="expanded === `${item.tunnel}/${item.peer.public_key}`"
            class="peer-details"
          >
            <td colspan="9">
              <dl class="detail-list">
                <div>
                  <dt>Allowed networks</dt>
                  <dd>{{ item.peer.allowed_ips.join(', ') || 'None' }}</dd>
                </div>
                <div>
                  <dt>Tunnel public key</dt>
                  <dd class="mono">
                    {{ live.get(item.tunnel)?.public_key ?? '—' }}
                  </dd>
                </div>
                <div>
                  <dt>Listen port</dt>
                  <dd>{{ live.get(item.tunnel)?.listen_port ?? '—' }}</dd>
                </div>
                <div>
                  <dt>Peer public key</dt>
                  <dd class="mono">
                    {{ item.peer.public_key }}
                  </dd>
                </div>
              </dl>
            </td>
          </tr>
        </template>
        <tr v-if="!peers.length">
          <td colspan="9">
            No peers.
          </td>
        </tr>
      </tbody>
    </v-table>
    <form
      v-if="adding || editing"
      class="peer-form"
      :aria-label="adding ? 'Add peer' : 'Edit peer'"
      @submit.prevent="stage"
    >
      <div class="peer-grid">
        <v-select
          v-model="form.tunnel"
          label="Tunnel"
          :items="tunnels.map(item => item.name)"
          :disabled="blocked || !adding"
          density="compact"
          hide-details="auto"
        />
        <v-text-field
          v-model="form.public_key"
          label="Public key"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-text-field
          v-model="form.endpoint"
          label="Endpoint (optional, IP:port)"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-number-input
          v-model="form.keepalive"
          label="Keepalive seconds (0 = off)"
          :min="0"
          :max="65535"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
          control-variant="stacked"
        />
        <v-text-field
          v-model="form.allowed"
          class="peer-wide"
          label="Allowed networks (comma separated)"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
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
.tunnel-filter { max-width: 200px; }
.peer-table :deep(th), .peer-table :deep(td) { white-space: normal; overflow-wrap: anywhere; }
.peer-table :deep(.column-actions) { width: 96px; }
.peer-table :deep(.column-status) { width: 80px; }
.peer-disabled > :not(.peer-status):last-child, .peer-disabled > :not(.peer-status) { opacity: 0.55; }
.peer-disabled > :last-child { opacity: 1; }
.detail-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 12px 16px; margin: 0; }
.detail-list dt { font-size: .75rem; color: var(--text-muted); }
.detail-list dd { margin: 0; }
.peer-form { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-light); }
.peer-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; max-width: 900px; }
.peer-wide { grid-column: 1 / -1; }
@media (max-width: 700px) {
  .peer-grid { grid-template-columns: 1fr; }
}
</style>