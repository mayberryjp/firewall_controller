<script setup lang="ts">
import { computed, useId } from "vue";
import { structuredPatch } from "diff";
import { differenceContext, differences, normalize, stableJson } from "@/services/configuration";
import type { ApplianceService, Config } from "@/types/domain";
import { record } from "@/types/forms";
import ApplianceWarnings from "@/components/feature/ApplianceWarnings.vue";
import { mdnsInterfaces } from "@/services/mdns";
const props = defineProps<{ before: Config; after: Config }>();
const diffID = useId();
const changes = computed(() => differences(props.before, props.after));
const changedServices = computed(() => (["ntp", "syslog", "vnstat"] as ApplianceService[]).filter(service => changes.value.some(item => item.area === service)));
const relayChanged = computed(() => changes.value.some(item => item.area === "interfaces" &&
  (record(record(item.before).dhcp_relay).enabled === true || record(record(item.after).dhcp_relay).enabled === true)));
const mdnsAddedLinks = computed(() => props.after.mdns?.interface_mode === "deny"
  ? mdnsInterfaces(props.after).filter(name => !mdnsInterfaces(props.before).includes(name)) : []);
const hasWarnings = computed(() => changedServices.value.length || relayChanged.value || changes.value.some(item =>
  ["gateway_monitors", "firewall-icmp", "firewall-input", "mdns"].includes(item.area)) || mdnsAddedLinks.value.length);
function source(value: unknown): string {
  return value === undefined ? "" : `${JSON.stringify(JSON.parse(stableJson(value)), null, 2)}\n`;
}
const files = computed(() => {
  const old = normalize(props.before), next = normalize(props.after);
  return changes.value.map(item => {
  const context = differenceContext(old, next, item);
  const patch = structuredPatch(item.area, item.area, source(context.before), source(context.after), undefined, undefined, { context: 12 });
  const hunks = patch.hunks.map(hunk => {
    let oldLine = hunk.oldStart, newLine = hunk.newStart;
    return { ...hunk, rows: hunk.lines.filter(line => !line.startsWith("\\")).map(line => ({
      sign: line[0]!, text: line.slice(1),
      kind: line[0] === "+" ? "addition" : line[0] === "-" ? "deletion" : "context",
      oldLine: line[0] === "+" ? null : oldLine++,
      newLine: line[0] === "-" ? null : newLine++,
    })) };
  });
  return { ...item, hunks,
    additions: hunks.reduce((count, hunk) => count + hunk.rows.filter(row => row.kind === "addition").length, 0),
    deletions: hunks.reduce((count, hunk) => count + hunk.rows.filter(row => row.kind === "deletion").length, 0),
  };
  });
});
const totals = computed(() => files.value.reduce((total, file) => ({
  additions: total.additions + file.additions, deletions: total.deletions + file.deletions,
}), { additions: 0, deletions: 0 }));
</script>
<template>
  <v-alert
    v-if="mdnsAddedLinks.length"
    type="warning"
    variant="tonal"
    class="mb-4"
  >
    mDNS deny-mode membership expands to: {{ mdnsAddedLinks.join(', ') }}. Review discovery exposure on these LAN links before applying.
  </v-alert>
  <details
    v-if="hasWarnings"
    class="diff-warnings"
  >
    <summary>Operational warnings</summary>
    <ApplianceWarnings
      v-for="service in changedServices"
      :key="service"
      :service="service"
    />
    <v-alert
      v-if="changes.some(item => item.area === 'mdns')"
      type="info"
      variant="tonal"
      class="mb-4"
    >
      mDNS needs exclusive UDP 5353 ownership and explicit input permits under restrictive policy. Reflection grants no unicast service access. Publishing exposes only selected appliance records; HINFO exposes Linux/architecture. Global IPv6 off suppresses all local AAAA records without deleting preferences.
    </v-alert>
    <v-alert
      v-if="changes.some(item => item.area === 'gateway_monitors')"
      type="info"
      variant="tonal"
      class="mb-4"
    >
      Explicit monitors install backend-managed exact-source routing rules affecting all traffic from that source, not only probes; enabled explicit monitors sharing a source must use the same table. DHCP monitors follow only the selected interface's IPv4 lease using private marked probe paths, without redirecting unmarked traffic or falling back to another WAN. Missing leases wait with Unknown health; changed paths restart warmup. No automatic failover or firewall exceptions are created. Review management reachability; simulated data is not real reachability.
    </v-alert>
    <v-alert
      v-if="relayChanged"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      Review DHCP relay impact: enabled-interface, selected-address or server changes can restart the shared dnsmasq process and briefly disrupt relay on other interfaces. Every upstream receives requests; local readiness does not verify lease delivery.
    </v-alert>
    <v-alert
      v-if="changes.some(item => item.area === 'firewall-icmp')"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      The IPv4 ICMP exception precedes legacy/host/interface drops across input, output and forwarding on all namespace interfaces. ICMPv6 is unchanged; disabling removes exceptions, not a blanket block. An omitted flag means enabled; null is invalid.
    </v-alert>
    <v-alert
      v-if="changes.some(item => item.area === 'firewall-input')"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      <template v-if="before.firewall.input && !after.firewall.input">
        Removing input filtering removes host protection, including WAN protection.
      </template>
      <template v-else>
        Host input changes can block management access or DHCP renewal. Verify LAN access and WAN UDP port 68 allowances. Loopback and established/related acceptance remain implicit.
      </template>
    </v-alert>
  </details>
  <p
    v-if="!changes.length"
    class="my-4"
  >
    No semantic changes.
  </p>
  <p
    v-else
    class="my-4"
  >
    {{ files.length }} changed resources
    <span class="addition-count">+{{ totals.additions }}</span>
    <span class="deletion-count">−{{ totals.deletions }}</span>
  </p>
  <section
    v-for="(file, fileIndex) in files"
    :key="`${file.area}/${file.identity}/${file.kind}`"
    :aria-labelledby="`diff-${diffID}-${fileIndex}`"
    class="diff-file"
  >
    <header class="diff-header">
      <h3 :id="`diff-${diffID}-${fileIndex}`">
        {{ file.area }} / {{ file.identity }}
      </h3>
      <span class="diff-kind">{{ file.kind }}</span>
      <span class="diff-counts"><span class="addition-count">+{{ file.additions }}</span> <span class="deletion-count">−{{ file.deletions }}</span></span>
      <span
        v-if="file.area === 'interfaces' && record(file.before).role !== record(file.after).role"
        class="diff-role"
      >Role {{ String(record(file.before).role ?? "None").toUpperCase() }} to {{ String(record(file.after).role ?? "None").toUpperCase() }} (metadata only)</span>
    </header>
    <div
      v-if="file.hunks.length"
      class="diff-scroll"
      tabindex="0"
      :aria-label="`Diff for ${file.area} / ${file.identity}`"
      role="region"
    >
      <table
        class="diff-table"
        :aria-label="`Changes to ${file.area} / ${file.identity}`"
      >
        <tbody
          v-for="(hunk, hunkIndex) in file.hunks"
          :key="hunkIndex"
        >
          <tr class="diff-hunk">
            <td colspan="4">
              @@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{ hunk.newStart }},{{ hunk.newLines }} @@
            </td>
          </tr>
          <tr
            v-for="(line, lineIndex) in hunk.rows"
            :key="lineIndex"
            :class="['diff-line', line.kind]"
          >
            <td
              class="line-number"
              aria-label="Old line"
            >
              {{ line.oldLine }}
            </td>
            <td
              class="line-number"
              aria-label="New line"
            >
              {{ line.newLine }}
            </td>
            <td
              class="line-sign"
              :aria-label="line.kind"
            >
              {{ line.sign }}
            </td>
            <td class="line-code">
              {{ line.text }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p
      v-else
      class="diff-move"
    >
      Order changed: {{ file.identity }}
    </p>
  </section>
</template>
<style scoped>
.diff-file { min-width: 0; margin-bottom: 16px; border: 1px solid var(--border-light); border-radius: 6px; overflow: hidden; }
.diff-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px; background: var(--bg-elevated); border-bottom: 1px solid var(--border-light); }
.diff-header h3 { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.diff-kind { font-size: 12px; color: var(--text-secondary); }
.diff-counts { margin-left: auto; white-space: nowrap; }
.addition-count { color: #7ee787; margin-left: 8px; }
.deletion-count { color: #ff9492; margin-left: 8px; }
.diff-role { flex-basis: 100%; color: var(--text-secondary); font-size: 12px; }
.diff-scroll { max-width: 100%; overflow-x: auto; }
.diff-table { width: 100%; border-collapse: collapse; font-family: ui-monospace, Consolas, monospace; font-size: 13px; line-height: 22px; table-layout: auto; }
.diff-table td { padding: 0; border: 0; white-space: pre; word-break: normal; overflow-wrap: normal; }
.diff-table .line-number { min-width: 44px; width: 44px; padding: 0 8px; text-align: right; color: var(--text-muted); user-select: none; }
.diff-table .line-sign { min-width: 24px; width: 24px; text-align: center; user-select: none; }
.diff-table .line-code { width: 100%; padding-right: 16px; }
.diff-table .diff-hunk td { padding: 4px 12px; color: #a5cfff; background: #162336; }
.addition { background: #122c1e; color: #aff5b4; }
.deletion { background: #351c23; color: #ffdcd7; }
.diff-warnings { margin-bottom: 12px; }
.diff-warnings summary { cursor: pointer; color: var(--text-secondary); margin-bottom: 8px; }
.diff-move { padding: 12px; margin: 0; }
</style>
