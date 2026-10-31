# Modan モダン (Firewall Controller / Netcontrol)

Vue 3 + TypeScript + Vuetify administrative frontend for the **Netcontrol
firewall control plane**, following the
[frontend coding standards](https://github.com/mayberryjp/coding_standards/blob/main/FRONTEND_CODING_STANDARDS.md)
and [Netcontrol frontend specification](https://github.com/mayberryjp/firewall_backend/blob/main/FRONTEND_SPEC.md).

Backend contracts were checked against the October 25 and 27
[journals](https://github.com/mayberryjp/firewall_backend/tree/main/docs/journal)
and [frontend handoffs](https://github.com/mayberryjp/firewall_backend/tree/main/docs/frontend-handoffs),
including native mDNS, journald-only syslog, resilient supervision and platform health,
alongside the earlier source-policy removal, self-upgrades and connection-state deletion.
These backend features are Unreleased; local mock tests do not establish deployment or native acceptance.
The [October 28 operational handoff](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-28.md)
adds targeted process restart and timed DNS testing; the October 27 link-diagnostics
handoff adds read-only link telemetry. These controls require a matching backend.
Host-input filtering also follows the current
[input-firewall contract](https://github.com/mayberryjp/firewall_backend/blob/main/FRONTEND_SPEC.md#661-host-input-filtering):
optional input policies, managed ingress rules, DHCP-WAN allowances, and complete-package preservation.
The spec's React suggestion is optional;
this project retains the existing Vue/Vuetify stack.

## Run locally

Use Node.js 22+ and npm.

The supplied Compose file targets a Linux Docker host. Prepare
`/docker/modan/registry-data` using the deployment instructions below before
starting the registry.

```powershell
npm ci
if (-not (Test-Path .env)) {
  $securePassword = Read-Host "Registry admin password (minimum 16 characters)" -AsSecureString
  $adminPassword = [System.Net.NetworkCredential]::new("", $securePassword).Password
  $encryptionKey = python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
  @(
    "REGISTRY_ADMIN_PASSWORD=$adminPassword"
    "REGISTRY_ENCRYPTION_KEY=$encryptionKey"
  ) | Set-Content .env
}
docker compose pull registry
docker compose up -d --no-build registry
npm run dev
```

Open http://localhost:3030, sign in with the registry password, then add a
firewall's name, API address and networking API key. The registry runs on
port 3031 and persists entries under `/docker/modan/registry-data`. Stop other listeners on
ports 3030 and 3031 before starting. Keep the ignored `.env` file and back up
its encryption key securely; never regenerate the key for an existing registry
database. If `.env` already exists, add both registry settings without replacing
any existing encryption key.

For simulator testing, run the firewall backend separately using its documented
setup, for example from its checkout:

```powershell
cargo run -p netcontrold -- --backend simulator --listen 127.0.0.1:8080 --state lab-state.json --credential-db credentials.json
```

Complete initial account/key onboarding on the daemon's embedded website at
http://127.0.0.1:8080, then add its networking API key to the registry.
Device-account cookies do not authorize networking requests. When the registry
runs in Compose, the simulator must listen on an address reachable from its
container; `127.0.0.1` inside that container refers to the registry itself.
The registry stores device keys encrypted at rest. After sign-in, the browser
selects a saved firewall; the controller decrypts its key server-side and
proxies firewall API requests without returning that key to the browser.

Simulator success does **not** verify Linux networking, WireGuard key-file
availability, kernel permissions, softflowd collector delivery or DHCP lease delivery. Native tests
require an explicitly disposable Linux namespace and operator provisioning.
Simulator results also do not verify gateway reachability, clock synchronization,
whole-appliance log capture/delivery or real vnStat history. Native host mode
can take ownership of physical NICs on first start; keep console access and
review the backend's networkd/resolved and persistent-state prerequisites.

### UDP Broadcast Relay

Services > **UDP BROADCAST RELAY** (`/services/udp-broadcast-relay`) follows the
[October 28 relay handoff](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-28.md#2026-10-28-06-native-udp-broadcast-relay).
The compact instance editor stages global/instance enable, ID, UDP port,
explicit interface selection, optional IPv4 multicast group, source mode and
service/instance metadata through the existing SAVE, confirmation and rollback flow.
Govee and ECHONET Lite presets populate an unsent, disabled instance with an
unused ID; they never enable the service, push changes or create firewall rules.
Only configured up Ethernet/VLAN links with IPv4 prefix <=30 or DHCP qualify.
Loopback, dummy, WireGuard and IPv6 transport are not supported.

Configuration changes require `udp_broadcast_relay.write` plus
`transactions.write`; shared-service repair also requires the relay permission
whenever it is globally enabled. Status uses `state.read`, polls only on this
page, and keys rows by numeric instance ID. Expand a row for exact decimal
counters, system-timezone sample times, unknown receive loss, retries and retained errors.
Confirmed instance restart uses `system.restart` and `udp-broadcast-relay:ID`;
it resets counters, not saved configuration. Runtime failures do not lock editing.
Complete config/history/export packages preserve the section; older backends
that omit it keep relay editing unavailable.

Deploy the matching native backend first; the feature remains **Unreleased**.
Provide native host-service/CAP_NET_RAW access, exclusive UDP ports, explicit
firewall permits and routed replies. Govee requires LAN Control and separate
UDP 4002 replies/4003 commands; ECHONET Lite uses UDP 3610. Packets must fit the
egress MTU. Local browser mocks do not establish native or appliance acceptance.

### Native mDNS / Discovery

Services > mDNS / Discovery (`/services/mdns`) follows the
[October 25 mDNS handoff](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-25.md#2026-10-25-17-native-mdns-implementation).
It stages allow/deny LAN membership, IPv4/IPv6 preferences, reflection filters,
explicit appliance publishing choices and metadata in the shared draft. Apply,
confirm, rollback and revision restore use the existing SAVE workflow; mDNS
changes, including metadata, require `mdns.write`. Config/import/export/history
retain disabled preferences. Older backends may omit the section; the controller
does not synthesize it until mDNS settings are staged.

Only configured, up Ethernet/VLAN LAN links participate. Allow mode selects only
listed links; deny mode includes all eligible links except those listed, including
newly eligible links. SAVE highlights membership expansion. Reflection requires
2..32 effective links; publishing alone requires 1..32. Filters are unique absolute
local service/subtype/provider names (up to 64), with trailing dots and no patterns.
Publishing is separate and opt-in; HINFO exposes Linux/architecture and workstation
publishing uses port 9. Empty publishing hostname uses configured `system.hostname`,
not ambient host state. Global IPv6 off suppresses IPv6 and all local AAAA publishing
while retaining preferences.

The page separates configured/draft membership from applied/provisional status,
polls status without overlapping requests every 3 seconds (failure backoff capped
at 5 seconds), and shows exact decimal counters, loss warnings and system-timezone sample times.
Status failures retain local edits and do not globally lock configuration.
Repair uses committed/pending settings, never the draft, and requires `mdns.write`
for enabled mDNS even through another service's aggregate repair endpoint.

Service recovery follows the [October 27 handoff](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-27.md).
Optional `retrying`, `restart_count`, and `last_error` fields are retained for NTP,
syslog, vnStat, mDNS, DHCP relay, flow export, and gateway workers. Explicit retrying
status displays **Recovering**; its tooltip preserves restart count and last failure
after recovery. Missing fields remain compatible with older backends. Service pages
poll runtime every five seconds without overlapping reads; gateway/mDNS reads use
three-second intervals with failure backoff capped at five seconds. Desired settings
and unsaved edits are not changed by recovery. Manual reconciliation remains optional,
not required to retry a worker. A matching rebuilt backend is required for automatic
recovery; these backend changes remain **Unreleased**.

Native syslog receives only systemd/journald-forwarded records through the inherited
`/run/systemd/journal/syslog` socket. Optional `source` and `host_source` status fields
are preserved; the Syslog page shows the reported source with the socket path in a
tooltip. It does not read `/dev/log`, `/dev/kmsg` or tail a backend log file directly.
Deploy the backend's reviewed Ubuntu installer/full-source-upgrade logging units and
journald configuration before enabling native forwarding. Direct/OpenRC launches lack
the required systemd socket activation; signed API/package upgrades do not provision
these host files. Disabling native syslog stops remote forwarding, not local journal
capture. Bounded queued input may forward on later enable, but loss and restart can
discard records; missed destination sends are not replayed.

Syslog delivery conditions appear in the consolidated issues panel even while its worker
is running. Failed sends are not replayed, and successful writes are not delivery receipts. Stale samples
remain identified as stale; recovering NTP workers do not present retained measurements
as current synchronization, and recovering gateway workers do not receive fresh health
or metric ratings.

### Consolidated Health And Issues

The fixed-size, icon-only connection bubble is the single on-demand location for
passive health warnings and configuration-recovery issues. It never expands, opens
automatically, or places repeated yellow/red banners above pages. Service rows retain
compact factual status; form validation and explicit operation failures remain inline.

The [October 27 platform handoff](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-27.md#2026-10-27-02-watchdog-process-health-and-active-alerts)
adds optional `process_health` and `active_alerts` to state/runtime plus cached
`GET /platform/status`. Cached health polls every three seconds, non-overlapping,
with a five-second maximum failure backoff and hidden/disconnected-tab pause. It stays
available independently of configuration observation. Unsupported or forbidden cached
endpoints stop polling for the session; existing service status remains compatible.
The panel shows backend-reported aggregate/component states, freshness and active
alerts, deduplicated by stable ID. First/last-seen times use system-timezone seconds. Unknown codes
remain readable; recovery removes resolved alerts. There is no dismiss, acknowledgement,
stored alert history or automatic repair. A cached health read expires locally after
15 seconds without a successful refresh, even if a request is still pending. Stale
aggregates retain their alerts without suppressing newer service-local failures.
Stale/unavailable data never implies healthy.
These observations never enter drafts or write requests, change desired settings,
block configuration operations, or trigger service/daemon restarts. Backend watchdog
deployment remains a separate operator-approved action; no backend deployment is made
by the frontend.

### BGP And Destination Rewrite

Routing > **BGP PROCESS** (`/routing/bgp`) stages the local ASN/router ID, enable
switch, timers, and global prefix limit, with all options visible. Routing >
**BGP PEERS** (`/routing/bgp/peers`) owns inline peer add/edit/delete controls.
Both use the shared SAVE/apply flow. For initial setup, save the process identity
while disabled, add a peer, then enable BGP. Peer rows show colored applied session
states and sent/received route counts; uncommitted changes show Not applied, and
unavailable or expired observations are neutral with unknown counts. Neighbor
failures do not lock unrelated edits. Routing > **BGP ROUTES**
(`/routing/bgp/routes`, with `/diagnostics/bgp-routes` redirecting here) has separate Received and Advertised views with a
client-side neighbor filter. Received routes keep selected and installed paths
distinct, with AS paths and actionable rejection/install reasons. Advertised
rows use `GET /api/v1/routes/bgp/advertised` and show only prefix, peer, interface
and local next hop, keyed by neighbor/prefix. They represent UPDATEs queued to
established sessions, not remote receipt, acceptance or installation. Connected
candidates and peer counts are never used to invent advertised rows. Empty,
stale, unavailable and stopped-worker results do not retain exports as current.
Both reads use `state.read`; deploy the matching Unreleased backend before
using Advertised. Learned routes and WireGuard AllowedIPs are never copied into
desired configuration.

WireGuard peer details label configured Allowed IPs separately from read-only
BGP-learned additions. These use successfully installed, selected received routes,
matched to the applied neighbor's tunnel and WireGuard public key; rejected,
withdrawn, stale and statically covered prefixes are not shown as additions.
The peer editor and generated static routes contain configured Allowed IPs only.
The current backend does not expose a complete kernel AllowedIPs inventory or
provenance for additions made by other tools, so those cannot be displayed yet.

The **BGP peers** overview box uses applied configuration, not the draft. It is
included in new/default layouts; existing customized layouts are preserved and
can add it through Customize layout. Status is polled on BGP PROCESS, BGP PEERS, or
while its overview box is visible; full route rows are fetched only for the
visible Received or Advertised view on BGP ROUTES.
Both use non-overlapping three-second reads with bounded failure backoff and
neutralize measurements after 15 seconds. Process health supports the existing
confirmed, icon-only `bgp` restart, warning that routes are withdrawn/relearned.
BGP changes require `bgp.write`; enabled BGP also requires that permission for
aggregate service repair. Default-route import opt-ins appear in SAVE review.

Firewall/NAT > **DNAT** (`/firewall/nat/dnat`) is an ordered destination rewrite
table with inline add/edit/delete and drag-to-reorder controls. WAN, TCP/UDP, exact port, LAN
and target address are the only required fields; optional Labels retain metadata.
Rules preserve existing masquerade and all unrelated settings and require
`nat.write`. Validation checks interface roles/up state, target subnet/family,
firewall-owned/network/broadcast addresses, duplicates and collection limits.
SAVE review explains source-preserving return routing, target upstream loops,
normal forwarding filters and new-connections-only changes; no implicit accepts,
routes, source NAT or connection flushes are added.

These features follow the
[October 28 backend handoff](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-28.md)
and remain **Unreleased** upstream. Deploy the matching backend first. The DNAT
editor remains disabled when committed NAT reads lack `destination_rewrite`;
unsupported BGP endpoints report an actionable error without locking other pages.
Native peering/interoperability, bootstrap routing and Linux DNAT forwarding
require separate real-appliance acceptance; mocked UI tests do not prove forwarding.

### Firewall Drop History And Rule Counters

Diagnostics > **FIREWALL DROPS** (`/diagnostics/firewall-drops`) reads
`GET /api/v1/firewall/deny-log` with the independent `firewall.logs.read`
permission. It supports address, numeric IP protocol, chain and inclusive system-timezone
time filters, manual refresh and exact exclusive-cursor pagination. Desktop section
navigation starts collapsed and can be expanded from the hamburger button, as on
Connections. The compact toolbar keeps system-timezone bounds behind **More filters**;
protocols, ports, chains and drop reasons use colored chips. Tables stack on mobile.
Records stay
in server ID order even if the clock changes. Retention gaps, unhealthy capture,
unsupported backends and permission errors are explicit. Overlapping daemon-session
loss indicators are never summed into an exact lost-packet count. Historical
interface names are not inferred from current indexes. The table has no Details
expander and does not display compiled positions or historical ruleset hashes.
Addresses and history remain in component memory only: no browser persistence,
exports, analytics or capture-management writes.

Packet/byte totals appear on host, interface, host-input, legacy forwarding,
masquerade and DNAT rules using `GET /api/v1/statistics/firewall` (`state.read`).
Exact decimal strings preserve uint128 totals; missing, failed and simulated
measurements show dashes, not measured zero. Default policies, ICMP exceptions and
generated bypasses are listed separately where applicable. Host, interface and
host-input rule lists use one compact table in evaluation order: **System Rules**
bypasses, **User Rules**, then **Default Rules**, separated by slim divider rows.
Host tables also include all **Interface Overrides** between system bypasses
and **Host Rules**, with an Ingress column identifying their applicability.
Overrides retain their original ownership and exact, shared per-interface
counters; they are read-only here and edited on INTERFACE RULES.
System entries are read-only and use short, single-line names; tooltips retain
loopback-ingress and connection-state match details without extra descriptions.
System-rule definitions remain visible when counters
are unavailable; their measurements still show dashes. Counts are attributed
only when revision, pending applied transaction and firewall configuration match;
unapplied or reordered firewall drafts hide them. NAT counters count initial
mapping evaluations, not all established packets. Totals reset whenever the
ruleset is replaced, including apply, rollback, repair and daemon restart.
Visible rule pages use single-flight five-second polling with bounded failure
backoff and abort on hide/unmount; samples are not persisted.

Deploy a backend supporting the October 29 deny-log/counter handoffs. Native
collection requires `nf_tables`, `nfnetlink_log` and `nft_log`, NFLOG group 100,
and the backend's network-namespace permissions. Counter expressions are provided
by `nf_tables`; no separate `nft_counter` module is required. Reads do not start capture.
History is bounded (up to 4096 retained records), not a retention-time guarantee;
empty history does not prove that no drops occurred. Mocked UI checks do not
validate actual kernel collection.

### Process Restart, DNS Testing And Link Diagnostics

Diagnostics > Process health provides an icon-only restart control on each process
row, with an accessible label and an explicit review/confirmation dialog. Supported
targets use `POST /processes/restart` and require `system.restart`; unsupported or
inactive native observations have disabled controls with explanatory tooltips.
Per-interface DHCP relay rows restart the shared relay worker; DHCP-derived gateway
rows restart their shared manager. Async acknowledgements are not completion tokens.
No restart request is automatically repeated. Full-daemon restart is offered only
when the health snapshot reports watchdog supervision; the backend verifies the
native host-mode deployment. Temporary HTTP/SSH management loss is expected.
The controller preserves drafts and checks management connectivity with bounded
backoff (eight checks, each bounded to five seconds). Connectivity does not prove a
completed restart. Unknown outcomes and exhausted reconnect attempts remain explicit.
Restart may reset caches/counters, reacquire DHCP leases or interrupt syslog delivery;
desired configuration, revisions and persistent accounting databases are unchanged.

Services > Remote DNS has **Domain**, **Test**, **RTT**, and **Result** columns on each server
row. Enter an ASCII domain and press Test (or Enter) to measure that server's DNS
RTT, displayed as whole milliseconds with no decimals (rounded, not truncated).
API timing values retain full precision. The request sends that server's IP, an
A query, and a 2000 ms timeout, without
forcing an interface. Native UDP and TCP fallback sockets remain unbound to a
device, so normal kernel routing in the managed namespace chooses the path to
that destination. New or edited server rows can be tested before applying them;
tests use the currently applied routing and IPv6 policy, not draft network changes.
Tests do not stage configuration or repeat continuously.
Result shows every returned address, or a DNS response code such as NXDOMAIN,
SERVFAIL or REFUSED. An empty successful response shows No answers (NOERROR);
simulation is explicitly identified. Negative DNS answers retain measured RTT;
failed/simulated timing is unavailable, not zero. Errors appear inline in Result.

`POST /diagnostics/dns-lookup` requires `diagnostics.run`. Its request contract now
accepts nullable optional `server` and `interface` fields alongside `hostname`,
`record_type`, and `timeout_ms`. At least one of `interface` or `server` must be
nonnull; an empty interface string is invalid.
Row tests always send `server` and omit `interface`, for example:
`{"server":"192.0.2.53","hostname":"example.test","record_type":"A","timeout_ms":2000}`.
An explicit server is queried exclusively on port 53 with no configured/DHCP
fallback. It needs no saved DNS settings or configured interfaces. Without a
requested interface, both UDP and TCP use normal kernel routing; the frontend
does not guess an interface from configuration order or table IDs. Exchange
failures, including routing errors, return a `200` failed result with an explicit
attempt error and unavailable RTT. Preparation failures such as a missing/down
requested interface or globally disabled IPv6 transport return `503`. Loopback
resolvers retain native loopback routing.
Explicit-interface callers keep the existing pinned-interface semantics and
validation; omitting `server` still requires `interface` and preserves its
configured/DHCP resolver selection. Response `interface` is the requested
interface string, or `null` when omitted/null, including simulator responses.
It is not a measured egress interface; the UI does not invent or display one.
`server` and every attempt must identify the requested resolver (a null top-level
server is allowed for failed/simulated lookups). The UI rejects mismatched resolvers
and displays unsupported-endpoint/field errors rather than falling back.
Deploy a backend supporting
[explicit servers](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-28.md#2026-10-28-04-explicit-dns-diagnostic-server)
and [optional interfaces](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-28.md#2026-10-28-05-optional-dns-diagnostic-interface)
before using per-server tests. These backend changes remain Unreleased.
Frontend tests verify unpinned requests and nullable responses, not real kernel
route selection or appliance deployment.

Diagnostics provides four focused, compact tables with colored chips:

- **Interface drops** (`/diagnostics/interface-drops`): RX + TX error/drop totals
  and per-sample deltas. Error/drop counts use green chips for measured zero,
  amber for positive values, and neutral for unavailable/historical values.
  Cumulative totals are not current alarms; tooltips distinguish them from deltas.
- **QDISCS** (`/diagnostics/qdiscs`): separate queue rows, sample availability,
  backlog/growth, drops, requeues and overlimits. Parent/child qdiscs must not be
  summed; backlog is occupancy, not delay, and overlimits do not necessarily mean loss.
- **TCP WINDOWING** (`/diagnostics/tcp-windowing`): plaintext ingress TCP ACKs and
  raw window observations, including forwarded traffic. Capture completeness is
  visible as a chip with a link to the separate **Capture details** page.
  Requeues, overlimits, window decreases, zero-window events and capture-loss
  counts also use amber chips for observed events. Zero TCP/capture counters
  stay neutral when capture is incomplete, rather than suggesting complete absence.
  Traffic counts, queue occupancy and raw window extrema use informational chips,
  without invented congestion thresholds.
  Windows are raw 16-bit fields, not scaled bytes or forwarded cwnd. Receiver
  pressure does not establish link failure. Router-local TCP is not displayed.
- **Capture details** (`/diagnostics/capture-details`): measurement quality for
  TCP window monitoring, with tracked directions, tracking capacity, kernel drops,
  rejected headers, capacity rejections and capture gaps. These counters describe
  missed or interrupted monitoring observations, not necessarily firewall traffic
  drops. Header tooltips explain each metric. This table is no longer embedded in
  TCP WINDOWING.

All four share `GET /statistics/link-diagnostics` with `state.read`, polling every
three seconds only while a relevant page is visible, without overlapping reads,
and with failure backoff capped at five seconds. The former
`/diagnostics/link-diagnostics` URL redirects to Interface drops. Exact counters
remain lossless; null values never become measured zero. Samples expire after five
seconds; retained measurements/evidence are explicitly historical with neutral
measurement colors. VLAN/tunnel observations must not be summed as unique traffic.
These runtime-only observations never enter drafts or lock configuration editing.

These APIs remain **Unreleased** upstream. Mock/browser checks do not qualify real
DNS routing, kernel capture prerequisites, daemon systemd recovery or native restart
effects. Deploy the matching backend and scoped permissions before operational use;
unsupported endpoints and backend authorization/conflict errors remain visible.

### Raw Configuration Editor

**Config → Config editor** edits the desired configuration as JSON, including the
shared draft. **Save** validates JSON, schema and configuration references, then
stages changes without writing to the firewall. Use **SAVE → Commit & push** for
the existing review, confirmation and rollback flow. Read-only software release
metadata is excluded; unknown top-level configuration sections are preserved.
The editor accepts up to 1 MiB of UTF-8 JSON.

Polling does not overwrite typed edits. If the revision or shared configuration
changes during editing, copy your edits, use **Reset editor**, and merge them into
the latest configuration before saving. Reset discards only unstaged editor text,
not the shared draft.

### Committed Configuration Download

Revision history provides **Download committed configuration**, using one read of
`GET /revisions/latest`, independently of live observation. It saves only the returned
`config` as `netcontrol-config-r<revision>.json`, preserving the exact date-version revision.
Historical revision exports remain available. A pending candidate may be running
instead of the committed configuration. The existing export confirmation covers
sensitive topology and key references; this is not a full-device backup and excludes
external secret files, accounts/API keys and runtime state. Download errors remain
inline and do not alter drafts. Older backends without this endpoint report an error;
the controller does not substitute an empty configuration or restore anything.

### Embedded SSH Deployment Default

The October 25 backend installer and full source upgrade enable the embedded
configuration SSH listener through `NETCONTROL_SSH_LISTEN=0.0.0.0:2222`. Manual daemon
launches still default off; an explicit `--ssh-listen` takes precedence. The username
is `apikey`, authenticated with a networking API key, not an account password. This
is not an OS shell or separate SSH daemon. Review host-input policy before deployment:
wildcard binding adds neither a firewall permit nor a protective WAN deny.
Operators can override the address in `/etc/netcontrol/appliance.env` or opt out with
a systemd drop-in containing `UnsetEnvironment=NETCONTROL_SSH_LISTEN`, also removing
any explicit listener argument. Preserve the SSH host key and independent OS SSH or
console access; restarting the backend interrupts its embedded SSH session.

### Native mDNS Deployment

Deploy a matching rebuilt backend: native mDNS remains **Unreleased**. Linux
namespace/host-service opt-in, usable local addresses, exclusive UDP 5353 ownership,
and one reflector per connected domain are required. No competing daemon is
disabled. Restrictive host-input policy needs explicit UDP 5353 permits; no firewall
rules, NAT or service access are added automatically. This is not SSDP or multicast
media routing, and IPv6 link-local addresses do not become routable. Running means
local readiness, not verified discovery. Frontend mock/browser tests do not establish
VLAN/nftables/MLD paths, Apple/Windows/printer/Avahi interoperability, load, reboot
or appliance acceptance.

## Screens

| Browser route | Purpose |
| --- | --- |
| `/connect` | Registry sign-in, persistent firewall list, encrypted key storage and controller-proxied device connection |
| `/overview` | Customizable system, interface, gateway and WireGuard status widgets; exact interface counters with one interface per row. WireGuard shows Peer, Last handshake, Received and Sent with one row per enabled peer, using the WireGuard page's handshake colors. The Peer column shows the configured endpoint or falls back to the runtime endpoint, with a dash if neither is known. Missing peer samples show Unavailable without hiding other peers' metrics; tunnels without enabled peers produce no rows. Stale runtime samples are labeled and use neutral handshake colors. |
| `/interfaces`, `/interfaces/:name` | Physical interfaces inventory and active IPv4/IPv6 addresses, excluding dummy/loopback links; inline NIC editing and explicit management/release |
| `/loopbacks` | Loopback creation, editing and explicit adoption; built-in `lo` and other system loopback links remain read-only |
| `/blackhole` | The single deviceless drop target (`config.blackhole`: name and drop/unreachable/prohibit action) that static routes can use as their interface; routes only, needs `routes.write`, no drop counters |
| `/vlans`, `/vlans/:name` | VLAN-only creation, behavior editing and deletion, parent/tag validation and dependency review |
| `/routes` | Static routes and managed-interface/table/metric validation; legacy `/policy-rules` redirects here |
| `/firewall` | PROTECTED HOSTS: searchable host navigation beside ordered outbound rules/default action; legacy forwarding editor when host policies are absent |
| `/firewall/ingress` | INTERFACE RULES: first Firewall/NAT page, with an interface selector and ordered ingress override rules |
| `/settings`, `/settings/general` | Host name, domain label, time zone, global IPv6 policy, IPv4 ICMP exception, and one DHCP DNS override control for all currently configured interfaces; settings join the shared draft |
| `/settings/sando` | Sando endpoint, automatic host/threat-score sync toggle, and one-time host and approved-connection imports into the shared draft |
| `/config/upgrade` | Current version, update availability, Check for upgrade and last checked; old `/settings/upgrade` links redirect here |
| `/settings/mqtt-streaming` | MQTT STREAMING (old `/settings/home-assistant` redirects here): MQTT broker, source interface, publish interval and write-only password replacement; shared draft and confirmed publisher status |
| `/connections` | Live conntrack snapshots, filters/paging, exact nullable counters and explicitly confirmed state deletion |
| `/nat` | Ordered IPv4/IPv6 masquerading with family-correct egress |
| `/tunnels` | Tunnel interfaces: pick a type (WireGuard for now) and create e.g. `tun_wg0` with private key (the name of a key stored on the appliance), listen port, MTU, addresses and admin state; several tunnels are supported and peers are kept when a tunnel is edited |
| `/wireguard`, `/wireguard/:name` | Peers across all tunnel interfaces (optionally one tunnel): add, edit and delete peers, each belonging to a tunnel chosen when it is added; a Status toggle disables a peer without deleting it (disabled peers aren't installed, show no handshake or counters, and may reuse an allowed network that an enabled peer uses). Handshake-age chips are green through 5x the keepalive interval, yellow through 10x, orange through 15x, and red beyond; never-handshaken peers are red, and keepalive-off peers use a neutral color. |
| `/firewall/input` | Host-input policy and ordered managed-ingress rules, separate from forwarding |
| `/services/netflow`, `/services/netflow/:name` | NetFlow/IPFIX: staged flow-export instances (**Add export**, inline Status enable/disable toggle) and independent runtime; instance names are plain text, with editing through the row action |
| `/services/dhcp-relay` | Sole editor for per-interface relay enablement/upstream servers, with stored/observed configuration and runtime |
| `/services/remote-dns` | Inline Add DNS server, edit and delete actions stage the server list to `dns[interface].servers` for every current LAN/WAN interface; existing per-interface servers are combined into one list. Preserves domains, DHCP settings and unassigned interfaces. Not a DNS server for LAN clients. Review through SAVE and Commit & push; future interfaces require staging again. |
| `/gateway-monitors` | Explicit dual-stack path/timing/health settings and independent cached gateway measurements |
| `/services/ntp`, `/services/syslog`, `/services/vnstat` | Shared draft appliance service editors and scoped runtime |
| `/services/maintenance` | Explicit all-managed-services repair and a link to Config / Upgrade |
| `/diagnostics`, `/diagnostics/traffic` | REAL TIME TRAFFIC: live bytes/second and packets/second ApexCharts, with one combined inbound + outbound line per interface |
| `/diagnostics/process-health` | Read-only daemon/component health, recovery states, collection freshness and active alerts |
| `/config/changes` | Staged changes, unified diff, Commit & push |
| `/config/commits`, `/config/commits/:id` | Commits: independent recovery discovery and explicit lifecycle actions |
| `/config/revisions`, `/config/revisions/:revision` | Cursor-paginated committed archive, comparison/export/provisional restore |

Services labels the flow exporter **NetFlow/IPFIX**, under `/services/netflow`.
Its Status enable/disable toggle is immediately to the left of Actions.
The backend API paths, `softflowd` configuration key and API permissions are unchanged. It controls
Netcontrol's in-process Rust exporter, not an external softflowd daemon. Native capture drops
do not stop export: when supplied by the backend, cumulative `dropped_packets`
and `statistics_complete: false` produce an inline warning that flow totals may
undercount traffic. Loss remains recorded until that worker restarts. Missing
statistics are unknown, not evidence of loss-free capture; running does not
verify collector delivery.

Deep links fall back to the SPA; reload restores an unexpired registry session
and reconnects the remembered firewall.
Unknown routes show an application 404.

Diagnostics has left-side page navigation like Services. Real Time Traffic shows
both graphs by default; use Watch interface to drill down, or Show graphs to show
only bytes or packets. It reuses `/statistics` every three seconds while the page
is visible, retains the latest 120 samples in memory, and calculates rates using
the API's collection timestamps. All interfaces shows a separate named line for
each interface, summing its inbound and outbound rates. Selecting an interface
shows only that interface's combined line, using the same color in both graphs.
Missing or failed counters and counter resets leave gaps, not fabricated zeroes;
the API's per-request `started_at` is a collection timestamp, not a counter-reset
identifier. Simulated samples are not shown as measured traffic. Leaving the page stops its
traffic polling and discards its chart history. Chart times use the saved system timezone.

The Overview System stats box starts with host uptime from aggregate statistics
`uptime.data.uptime_seconds` and the current appliance version from
`desired.software.version`. Initial reads show loading; missing readings show
Unavailable, and failed refreshes retain the last known value with the read
error in its tooltip. Uptime uses existing statistics polling, accepts zero
and fractional seconds, and never substitutes daemon uptime or simulated
host measurements. Deploy a backend supporting the required aggregate
`uptime` object; the separate host-health API still supplies resource metrics.

On Overview, click a system metric name to open its inline live ApexChart
(CPU, memory, swap, load, temperature or fan); uptime and filesystem remain
plain text. Charts retain the latest 120 host-health samples while the widget
is mounted and use system-timezone timestamps. Click the metric again or Close live view
to collapse the chart. The Interface counters heading opens Real Time Traffic;
an interface name opens it with that interface selected. These links retain
the surrounding text styling.

Diagnostics also includes Process health, using the existing authenticated
`/platform/status` cache and shared three-second polling. It shows aggregate,
daemon and component states, recovery, collection times and active alerts.
Stale observations are marked unknown rather than healthy; native collection
failures and retained alerts remain visible. Health timestamps use system-timezone seconds.
This is local process health, not verification of remote delivery or forwarding.
Viewing the page does not modify configuration, disturb drafts or restart workers.

The top navbar selects Interfaces, Routing, Firewall, VPN, Services, Diagnostics, or the Settings
gear. Hover over the Settings gear to see the committed hostname.domain; when only
one is configured, the tooltip shows that value. Routing uses a classic
network-diagram router symbol; Firewall uses a brick wall.
Connection health appears in an icon-only floating bottom-right bubble; hover or
focus it for connection status, or open it for deployment
details and Disconnect. There is no profile/person button. Interfaces
contains Physical interfaces, Loopbacks and VLANs. Routing contains Static Routes
Gateway monitors and BGP. The Modan モダン
brand links to Overview; there is no separate Overview navigation button. Firewall
contains forwarding, Firewall destined, Connections, NAT and DNAT; VPN contains WireGuard. The existing **Config rN**
revision box opens `/config`; there is no separate Config navigation button.
Each section exposes its own routed page tabs: a left rail on desktop and a
horizontal scrollable strip below 1280px when a section has multiple pages. `/networking` (Interfaces), `/routing`, `/vpn`, `/services`, and
`/config` open the first page in their section. Old `/activity`, `/changes`,
`/transactions` and `/history` URLs redirect to the corresponding Config pages,
including commit and revision detail links. Detail links retain their section and
selected parent tab, and browser back/forward navigates between pages. Commits is
the UI name for backend transactions; API endpoints and permissions are unchanged.

The overview Interfaces widget separates Admin state (`admin_up`) from the
kernel's Operational state (`oper_state`). Enabled WireGuard, loopback and dummy
interfaces can correctly show Admin Up with Operational `-` for kernel `UNKNOWN`;
the tooltip retains the original state. Unknown interface modes also display `-`.
This does not by itself indicate a broken
link. Stale, failed or missing observations remain
Unknown in both columns, and simulated samples remain explicitly Simulated.
Both overview interface tables show the applied interface role alongside the
device name and its configured display name beneath it. Long names and addresses
are ellipsized with full values on hover, keeping the tables within their widgets
without wrapping labels or adding columns.
On narrow widgets, counters pair in/out values vertically in each metric column
so the values remain readable without horizontal scrolling.

The DHCP relay table keeps the interface name, role, and configured display name
on one line in the Interface column. Long display names are ellipsized with the
full value available on hover.

Operational pages show settings, records, and current status without repeated
read timestamps or deployment instructions. Errors and stale-data notices remain
visible. Detailed values use expandable labeled fields rather than JSON dumps;
small resource lists omit filter bars. Service-impact warnings appear in change
review and explicit repair/apply confirmations.

Tables use the Interface counters' 34px baseline row and header height throughout
the app, with reduced vertical cell and action spacing and no alternating row
bands. Wrapped content and inline editors can still grow to fit; narrow
screens retain their labeled, stacked layouts with tighter spacing.

NAT masquerading uses inline table rows for Add rule and editing, with Save/Cancel
and validation in place rather than popup forms or discard confirmations.
Save stages into the shared draft for the normal SAVE/apply review flow; it does
not write to the backend. Rule order and settings not changed in the editor are
preserved. The editor omits Labels (display name and description), retaining any
existing saved labels. Cancel or switching rows discards the current unstaged input.

Human-facing timestamps use `yyyy-mm-dd hh:mm:ss` in the saved General settings
**Time zone** (`system.timezone`), not the browser's timezone. UTC is used when
no timezone is configured; unsaved drafts do not affect displayed times.
Table headings, detail labels, chart axes and tooltips identify that timezone
and update when the saved setting changes. Firewall-drop time filters use the
same timezone; nonexistent or ambiguous clock-change times produce inline errors.
Fractional seconds are omitted for display only;
API/storage timestamps, machine-readable HTML `datetime` attributes, exports and
deadline calculations retain their original precision and formats. DHCP lease
acquisition timestamps are converted from Unix seconds for display.

Each setting has one owning editor. Physical interfaces shows discovered non-loopback links, with
rows and **Active Addresses** from `GET /api/v1/interfaces/discovered` (`state.read`).
Managed configuration is joined by technical name for labels, roles and settings.
General settings includes an optional **Domain name** beside **Host name**, stored
as `system.domain` with the existing `system.write` permission. This is a
display/reporting label, not an OS host-domain or DNS search-domain setting. Use lowercase labels
with no trailing dot (up to 253 characters, including the host name and separating
dot when both are set). Clear the field to remove it. Host name and domain remain
configuration controls in General settings; the navigation bar shows only
`R<revision>` without a CONFIG prefix or hostname/domain line. The revision label stays unchanged
when edits are pending, pulsing from orange to bright yellow over four seconds.
Reduced-motion preferences disable the pulse while keeping the orange highlight.
General settings owns the single **Ignore DHCP-provided DNS servers** control.
Changing it and saving writes `dns[interface].override_dhcp_dns` for every currently
configured interface, including down and unassigned links, without changing servers
or search domains. Mixed existing values remain unchanged until the control is used.
This is a frontend-wide control, not a backend global policy: DHCP DNS is still used
on interfaces without configured DNS servers, even when the control is on. When off,
the backend merges configured and DHCP servers. An omitted field defaults to on.
After adding interfaces, set the control again and save to include them; interfaces
added outside the UI are not automatically covered. Changes use the normal shared
draft and SAVE/apply flow and require `interfaces.write`.
The inventory table shows only active addresses; configured static addresses remain in
the interface editor. DHCP/IPv6 assignments stay visible even with an empty static list,
and live addresses never enter configuration drafts. Interface type, management state,
role and admin state use colored chips (green Up, red Down).
Unmanaged/down links and unsupported kinds remain visible; unsupported kinds are
read-only. There is no interface visibility dropdown. Interfaces > Loopbacks contains
managed loopback interfaces and built-in loopback links such as `lo`, which is always read-only.
Discovery supplies required nullable `role` and `addressing_type` fields. Actual kernel
loopbacks show the fixed **Loopback** role and **Static** mode in Overview and the
Loopbacks inventory, even when down or addressless, and cannot be adopted, edited or
deleted. Classification follows the backend's kind/ownership, not the interface name.
Other discovered links return null metadata; their configured role and addressing
remain authoritative. Loopback is not a managed role or an editable addressing option.
This requires the rebuilt backend's
[loopback discovery contract](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-30.md#2026-10-30-09-fixed-loopback-role-and-static-addressing).
Loopback creation, edits, adoption and deletion stage into the shared draft; discovered
addresses are never copied into saved settings. Configured loopback interfaces remain
listed even if not yet discovered. The loopback editor cannot manage `lo` or change kind.
Add loopback, editing and adoption use inline table rows with Save/Cancel, like
VLANs. The IPv4 field accepts comma-separated addresses with prefixes; existing
IPv6 and hidden settings are preserved. New loopbacks start administratively up
with an unassigned role and no addresses. Loopback rows omit type and ownership;
the inline editor uses a compact Admin state toggle. New loopbacks default to MTU
65535. MTU is shown read-only; editing and adoption preserve existing MTUs.
The Role selector has a dedicated wider column and spans the full row on narrow screens.
Inventory is fetched independently of configuration/runtime; failed discovery shows
unavailable state or retains stale rows rather than reporting a successful empty table.
VLAN creation and editing live under Interfaces > VLANs. Add VLAN inserts an inline
table row with interface name, compact VLAN ID and MTU fields, parent interface,
admin state, and IPv4 addresses/prefixes. The Admin state column uses green Up
and red Down chips; the inline editor stages admin-state changes with Save.
IPv4 addresses can also be added or changed after
creation by editing the VLAN row; IPv6 and other hidden settings are preserved.
The parent dropdown offers only physical Ethernet interfaces from the current
configuration and available adopted parents, not VLANs, loopbacks or tunnels.
The IPv4 cell accepts comma-separated static addresses with prefixes; DHCP clients
are supported only on physical Ethernet interfaces.
New VLANs inherit their parent's role and default to admin down and no addresses.
Each VLAN's saved role appears in smaller, muted text beneath its name.
Existing VLAN settings not shown in the row are preserved; committed parent/ID
values remain immutable and renames require dependency acknowledgement. VLANs
are excluded from the Physical Interfaces inventory, including unmanaged VLANs.
Physical NIC edits replace the display row with controls in each corresponding table
cell, without a popup. The compact table groups display name under hardware name and
uses dropdowns for role, admin state and DHCP/static IPv4 mode. MTU, static IPv4
addresses and IPv6 addresses can be edited directly. DHCP IPv4 shows the discovered
address read-only (or `DHCP` while no address is available); live addresses are never
copied into saved static settings. There is no separate Active Addresses column.
Hardware identity and ownership remain read-only.
Stage changes saves the row into the shared draft; hidden DNS and relay settings are preserved. Interfaces
use optional `metadata.display_name` for friendly labels. Interface dropdowns show
`Interface name (display name)`, for example `eno1 (LAN)`, or just the interface name
when no display name is set. This includes INTERFACE RULES, PROTECTED HOSTS, Firewall destined,
NAT and DNAT selectors. Selections still save the interface name.
Description is not shown in the
interface table or editor; existing `metadata.description` values are preserved when editing.
Existing virtual-interface
detail links remain supported. Interface edits preserve relay/tunnel
settings, relay edits preserve link settings, and WireGuard edits preserve
addresses, DHCP clients and DNS. Tunnel creation collects required initial link
values only; subsequent link changes and deletion belong to Interfaces.
Read-only summaries can still appear elsewhere. Navbar **Save** leads to
**Review changes**, the single place for apply options and provisional submission.
If apply is disabled, the review page and apply dialog identify the blocking
condition. **Commit & push** automatically refreshes committed configuration
without discarding the draft or waiting for runtime and service diagnostics.
Refreshing does not rebase a draft onto a newer committed revision.
Input and forwarding default policies remain separate because they control
different traffic paths.

### Advanced settings

Settings > ADVANCED provides one compact solid red **Delete all firewall hosts and
forwarding rules** button, matching the backend's combined
`DELETE /api/v1/firewall/hosts-and-rules` operation. Its Vue dialog previews the
removed and preserved scope, warns about connectivity and broader access, and
requires explicit acknowledgement. NAT, management input, global defaults/ICMP,
interface-policy entries and Sando data are preserved; connections are not flushed.
Local drafts/unstaged input, active or uncertain transactions, drift, restarts,
upgrades and unavailable/incompatible state block deletion. Fresh state and
transaction reads must still match the reviewed calendar-version revision.
The API requires `transactions.write` and `firewall.write`. Deletion is applied
provisionally with a 120-second rollback window, then opens the normal commit
detail page for explicit confirmation or rollback. Nothing is auto-confirmed,
uncertain writes are never automatically retried, and rollback does not stage a
new deletion draft. Configured hosts are distinct from preserved Sando discovery
metadata and are not automatically reimported.

### Sando synchronization and one-time imports

Settings > SANDO IMPORT accepts an HTTP(S) server URL or `/api` base URL. The browser
calls Sando directly, with no registry/firewall credentials. Sando must be reachable
from the browser, allow its origin through CORS, and use HTTPS when required by
the frontend's HTTPS origin. The base URL is staged as `config.sando.api_url`
through the normal SAVE flow (`sando.write`). Complete `/api/localhosts` device
records remain only in page memory, never in the appliance configuration.
**Automatic host and threat-score sync** stages `config.sando.sync_enabled`
(default false) through SAVE, independently of manual imports. Enabling requires
a saved endpoint. Only committed settings drive the daemon's hourly metadata
worker; pending or rolled-back changes do not start or stop it. Disabling cancels
automatic acquisition without removing imported hosts or rules. Automatic
Protected Hosts metadata lookups also follow the committed flag and source.
Sync never automatically changes firewall hosts, rules or verdicts.
**Import hosts** and **Import rules** remain available when sync is disabled.
Each successful or partial import stages a separate host/rule report with its
source URL, counts and UTC timestamp alongside its firewall changes
(`firewall.write`). While automatic sync is enabled, a small chip beside its toggle
shows the latest host/rule import timestamp in the saved system timezone
(`yyyy-mm-dd hh:mm:ss`, falling back to UTC when unset), or
"No imports yet" when neither report exists. Full reports remain in configuration
without a historical report section. The page shows endpoint/import controls, immediate staging feedback,
and actionable errors or skipped entries, without historical report sections.
Failed/canceled attempts do not replace saved reports. Repeated attempts before confirmation
share one pending operation count; a rule replacement reports its latest
replacement rather than accumulating removed rules. Changing/clearing the URL retains report provenance.
Older backends without saved Sando support show an inline upgrade requirement.

**Import hosts** adds IP-based hosts to `firewall.policies.hosts`. Choose the
outbound default for new hosts explicitly; the safe initial selection is drop.
Existing names, addresses, defaults, rules,
ingress overrides, NAT and unrelated draft edits remain unchanged. Identical
hosts/rules are skipped; conflicting ownership and unsupported entries are
reported inline. IPv4 and optional IPv6 addresses are retained together; invalid
or globally disabled IPv6 prevents importing that device rather than silently
dropping its address.

**Import rules** also fetches `/api/ignorelist/ip/<encoded-IP>` for each inventory
host and imports missing hosts. Connection IDs (`ignorelist_id`) are optional;
ID-less candidates are deduplicated by source, destination, protocol and port.
Skipped ID-less candidates are identified by those traffic fields.
Rules retain their explicit source-to-destination direction even when returned by
the destination's lookup. A valid rule source missing from inventory is added as
an IP-named host with the selected new-host default; existing source hosts retain
their names, defaults and non-Sando rules. Invalid rules do not create fallback hosts, and
failed inventory-device validation is not bypassed. These are Sando detection exceptions,
not proof that traffic should be authorized. Exact source IPs, destination IPs or
explicit `*` destinations, protocol 6 (TCP) or 17 (UDP), and destination ports
1..65535 or explicit `*` ports are translated into outbound accept candidates.
Protocol 1 (ICMP) and 58 (ICMPv6) candidates are also supported when their
addresses match the protocol family and their destination port is explicit `*`.
ICMPv6 requires global IPv6 enabled.
Destination wildcards become `0.0.0.0/0` or `::/0` according to the source IP,
so they do not enable the other address family on a dual-stack host. Port
wildcards omit the port constraint while retaining the selected protocol.
Missing or malformed ports, wildcard sources, CIDRs and other protocols are
reported rather than widened. Earlier manual drops/catch-alls and ingress
overrides can shadow imported rules.

Rule origins (`manual`, `import`, `system`, `inherited`) and nullable
`import_source` are preserved across forwarding, host/interface/input and NAT
rules, unrelated edits, exports, revisions and transactions. Imported rules require
a provider ID such as `sando`, never a URL; other origins have no provider.
The rule tables show compact Origin labels; generated counter rows are System.
Unlabeled legacy rules display as Manual without guessing ownership from host
IDs or past import reports. New editor-created rules are manual/null. Labels are
descriptive, not permissions or verified upstream identity; interface rules keep
their saved ownership rather than persisting inherited duplicates on hosts.
Ownership-only edits do not invalidate otherwise matching packet/byte totals.

Rule imports automatically stage their results in the shared draft, with no
separate replacement review or staging acknowledgement. Review and apply the
changes through **SAVE**. Only host-forwarding rules with both `origin: "import"` and
`import_source: "sando"` are replaced, including old targets absent from the new
source. Manual rules retain their relative order first, other retained rules keep
their relative order, and new Sando rules follow in source order. Host inventory,
defaults, interface policy, input and NAT are not deleted or recreated.
Successful empty or partial replacements are staged automatically, with skipped
entries reported inline; all-invalid sources and failed acquisition retain prior
rules and reports. Imports merge into the latest shared draft after acquisition.
Nothing is applied until the normal **SAVE** flow completes.

Deploy the October 30 label-capable backend before using ownership-bearing writes.
SAVE verifies that the accepted candidate retains requested labels, matching host
groups by host ID and interface groups by interface name rather than their array
positions. Backend normalization may reorder these groups; rule order within each
group remains significant. If an older
backend prunes them, the operation is reported as an incompatible, uncertain write
with its provisional transaction retained for review/rollback; it is never
automatically retried or confirmed. Historical drop records do not acquire current
rule labels.

Legacy forwarding rules cannot coexist with host policies; imports never delete
or translate legacy rules. Remove them deliberately in the shared draft first.
Entering host/interface policy mode requires an inline acknowledgement because it
introduces stateful return traffic. Review the full difference in **SAVE** before
applying. Backend host-policy limits, address uniqueness, references, family
compatibility, port limits, expansion limits and metadata size are validated.
Nothing is applied automatically.

Configurable resources support optional shared metadata. Display names are empty or
up to 128 Unicode scalar values, with no controls or whitespace-only names;
descriptions allow up to 2048 scalars, including newline/tab. Empty annotations
are omitted. Labels never replace technical names, keys or selectors. Editors,
imports, exports, transaction review and revision restore preserve annotations;
host identities can be added manually or through additive Sando imports. PROTECTED HOSTS
collapses the Firewall/NAT page menu on desktop (reopen it with the menu button)
and shows a searchable, alphabetically sorted uppercase host list beside the
selected host's ordered outbound rules and default action. The blue **+ ADD HOST**
button below the host list opens an inline IP-address row. Choose the host's default
action (initially **drop**) and click **Add** to stage it in the shared draft, or
**Cancel** to leave configuration unchanged. New hosts use their IP address as their
name, start without rules, and are selected automatically. Canonical unicast IPv4
and enabled IPv6 addresses are supported; invalid or duplicate addresses show inline
errors. Use **SAVE** to review and apply the staged host.
Rule actions use labeled green accept/red drop chips with matching row accents; protocols, ports and egress
interfaces use compact chips. Wildcards remain muted text, and the final default
rule is visually separated and its action can be edited. PROTECTED HOSTS, INTERFACE
RULES, and host-input rules stay in compact table rows on desktop, with horizontal
scrolling inside the table when space is limited; only phone-sized viewports use
stacked cards. They support inline add/edit/delete and drag-to-reorder.
Drag the handle to move a rule using a mouse or touch screen; there are no up/down
reordering buttons. Legacy forwarding, masquerade and DNAT tables also use drag
handles. Ordering is scoped to the selected host or ingress
interface; the host default stays last. Changes stage into the shared draft for
the existing **SAVE** review/apply flow, never apply automatically, and show
validation errors inline. Host-input policy settings also expand inline.
Desktop rule rows stay single-line with bounded horizontal scrolling; long values
wrap in mobile cards. Browsing alone never
changes rule order or stages configuration. Host rows match
[Sando's HostList](https://github.com/mayberryjp/sando-website/blob/a6364b6ff7fde4e4d353b2604ae8e84b327f9c08/src/components/dashboard/HostList.vue):
single-line uppercase descriptions, 8px/16px row padding, a 40px icon column with
the original 24px device SVG, and a blue selected-row background/3px left border.
Device icons use Sando's threat-score colors: green for 0, yellow for 1–24,
orange for 25–50, red for 51–75, and crimson above 75. Missing or invalid scores
use neutral gray (`#b1b8c0`); unknown icons use the bundled DEFAULT artwork. The scrolling host list
uses Sando's thin, transparent-track scrollbar with a 10%-white thumb, 6px WebKit
dimensions and 3px thumb radius. On desktop, the host panel fills the available
page height, including for short or filtered lists, and resizes with the window.
The host list and rules scroll independently. The panel scrolls as a whole with
a sticky search field, whose outline uses Sando's 0.3 opacity.
The row label uses Sando `local_description`; full names and IP addresses remain
in its accessible label/tooltip and the selected-host heading. Configured display names/names are used
when no description is available; inventory errors appear inline without hiding
the configured rules. Search matches names, addresses and device types. On small
screens the bounded host list sits above the rules.
The adapted host-list styling and bundled SVG artwork are from Sando revision
`a6364b6ff7fde4e4d353b2604ae8e84b327f9c08`, under its
[MIT license](src/assets/deviceicons/LICENSE). No Sando risk headers or alert bars
are added to the firewall rule navigation.
Destination-host references display host names;
ingress-interface overrides are shown before source-host rules in the same table,
in configuration order and labeled by ingress interface. They remain independently
editable on INTERFACE RULES, the first Firewall/NAT page. Its interface dropdown selects configured ingress policies and
the table shows their ordered rules; empty policies show an explicit empty state.
Firewall destined uses the same interface selector and compact rule table, with
inline Add/Edit/Delete and drag ordering. **Edit input policy** changes only
filtering and its global default; it does not contain a separate nested rule editor
or replace interface rules. All edits stage through the existing SAVE review.
Neither selector stages changes. Selection
does not stage changes, and shared draft/pending rules take precedence over
committed rules. The legacy forwarding editor remains available when host
policies are absent. Annotation edits
use the resource's existing transaction permissions. These fields require the
backend's October 24 metadata contract.

Forwarding uses first-matching-verdict precedence, not cumulative allow layers:
optional IPv4 ICMP acceptance, established/related acceptance, ingress-interface
overrides, then the source host's ordered rules and default. An interface allow
overrides a host deny, and an interface deny overrides a host allow; an interface
catch-all prevents host evaluation for traffic on that ingress interface.
The destination host's outbound policy is not evaluated. The table labels the
global default **Global**; it is for unknown source hosts, not another check after
a known host's default. Existing connections may survive new blocks until
connection state expires or is explicitly deleted.

Host, interface, Firewall destined and legacy forwarding filters support **Any**,
**TCP**, **UDP**, **ICMP** and **ICMPv6**. Any covers every IP protocol. ICMP
matches all IPv4 types/codes; ICMPv6 matches all IPv6 types/codes and requires
global IPv6 enabled. Explicit networks and host address pairs must match the
protocol family; dual-stack hosts expand only compatible pairs.
Destination ports are TCP/UDP-only: at most 32 unique individual ports in
1..65535, without ranges. Switching to Any/ICMP/ICMPv6 clears and disables the
port control. Legacy rules preserve the same protocol/port fields and order,
with a maximum of 4096 port-expanded entries. Editors show inline guidance that
the global IPv4 ICMP exception precedes ICMP drops and that blocking ICMPv6 can
break neighbor discovery and IPv6 error reporting. NAT remains TCP/UDP-only.

Committed, administratively up DHCP interfaces have a **Reload DHCP** action in
their table row. It calls `POST /interfaces/{name}/dhcp/retry` with no body and
requires `interfaces.write`, without changing the shared draft or revisions.
Active/recovery transactions block the action. A `202 retrying` response means
worker initialization, not a new lease or connectivity success. The UI inspects
runtime and observes lease acquisition/error updates every five seconds for up to
one minute; `state.read` is needed to observe them. Errors remain inline. It never
automatically repeats the POST; inspect runtime before retrying after a timeout.

## Safety model

Service health is informational, not a configuration permission gate. Failed NTP
or other services, drift, unknown transaction statuses, and unavailable runtime,
transaction-list, or upgrade-status reads do not lock configuration editing or
push review when committed configuration remains readable. Observation metadata
is optional; desired configuration and revision are still validated. The backend
decides whether to accept a write. Polling failures never automatically stop,
restart, reconcile, roll back, or upgrade services. Authentication, configuration
validation, revision conflicts, and an outstanding submitted or uncertain write
still protect configuration operations from accidental loss or duplicate writes.

Firewall > Connections reads `GET /api/v1/statistics/connections` with `state.read`.
Opening Connections collapses the desktop section navigation to a hamburger-only
rail; expanding it restores text page links. Other pages restore their normal navigation. The compact table shows source,
destination, protocol/state chips, separate sent/received packets and bytes, and timeout, without expandable
row details or a Reply column. Byte totals
use compact units with exact decimal values in tooltips; unavailable is
never zero. Advanced filters are behind More filters; mobile uses stacked rows.
The State dropdown filters the loaded page immediately using observed states; All
states clears it. Selection survives refreshes and paging. State is not a server
filter, so other pages may contain additional matching connections.
Column headers toggle ascending/descending sorting of the loaded page, preserving
the selection through refreshes. Counters sort exactly; unavailable values stay last.
Snapshots stay in page memory and are cleared on disconnect/navigation; no automatic
export, persistence, reverse DNS, connection writes or draft changes are performed merely by viewing or filtering.
Visible live views poll five seconds after each completed read, without overlap;
failures back off up to one minute, retaining an explicitly stale snapshot. Permanent
permission/unsupported-endpoint errors pause automatic reads. Filters reset paging.
Each page is a fresh kernel dump, not a retained snapshot or history.

Original/reply counters are exact decimal strings; null is unavailable, not zero.
Conntrack accounting may require operator-enabled `net.netfilter.nf_conntrack_acct=1`
before new connections are created. The UI never enables it or flushes connections automatically.
The view includes the daemon namespace's local/unmanaged traffic, not only managed
forwarded traffic. Conntrack state does not prove current firewall permission, and
there are no per-rule hit counts, connection closing, blocking or packet logs.
This requires the backend's Unreleased connection-statistics API (handoff
2026-10-24-05), kernel support and netfilter read privileges; native Linux acceptance
and deployment must be verified separately.

The registry proxy forwards connection query parameters unchanged. If this endpoint
returns `400` with `statistics endpoints do not accept query parameters` and returns
`404` without query parameters, the selected firewall is running a backend without
the connection-statistics API. Upgrade/restart that firewall's backend or select the
correct saved device; removing the valid pagination parameters is not a fix.

### Explicit connection-state deletion

Row deletion uses `DELETE /api/v1/connections/{id}` with only the snapshot's family,
protocol, zone and original tuple. Null IDs, incomplete/unsupported tuples and differing
directional zones disable row deletion; malformed identity never falls back to a flush.
The separate whole-namespace action sends exactly `{"confirm":true}` to
`DELETE /api/v1/connections`, without query filters. It removes all IPv4/IPv6 zones,
including management, NAT, local and unmanaged traffic in the daemon namespace.

Both actions require `connections.delete` and explicit destructive confirmation;
`state.read` alone does not grant deletion. There is no permission-discovery API,
so the backend authorizes the write and permission errors stay visible. Management/NAT
can be interrupted. State deletion does not send resets, close sockets or block traffic;
entries may immediately reappear. There is no undo or revision rollback.
Active transactions/upgrades block deletion. Drafts are retained; successful or expired
selectors refresh the snapshot. Timeouts/disconnects can leave partial or unknown results:
refresh and inspect, never automatically retry. The registry forwards authenticated
DELETE JSON and permits DELETE preflight. Native TCP/NAT/IPv6 acceptance needs a
disposable appliance, not a production management session.

### Home Assistant And System Stats

Home Assistant settings use the normal shared draft, SAVE review and confirmed
transaction flow. MQTT changes require `mqtt.write` and `transactions.write`;
status and host-health reads require `state.read`. Deploy a backend with the MQTT
and `netcontrol-host-health/v1` APIs. Only confirmed settings publish. A broker
acknowledgment is not proof of Home Assistant ingestion. The publisher also sends
host-health sensors (memory, load, CPU, temperatures, filesystems); CPU percent is
unknown until the second sample and a failed sensor is unknown, never zero.

Replacement passwords upload once via `/services/mqtt/passwords`; only the
immutable reference enters configuration, exports and history. The form clears
plaintext after save/error or dismissal and never automatically retries an upload.
Upload over HTTPS or a trusted management channel. Appliance password files are
private but unencrypted; discarded uploads still count toward the 256-reference
limit. Prefer `mqtts://` with a trusted broker certificate.

The Publisher row shows only the current state and actionable errors. Broker
timestamps, attempt/retry counters and retained failure history are not displayed.
Recovery clears the current error without marking a running publisher unhealthy.
Error messages remain plain text. Broker logs may still be needed to establish
the cause of resets or missing acknowledgments.

Overview polls `/statistics/host` independently every three seconds while visible;
the settings page polls confirmed MQTT status every 7.5 seconds. Reads do not
overlap and failures back off. System stats describe the daemon-visible host, not
cgroup limits. CPU usage needs two samples and exact tick deltas, excludes guest
double counting, and resets on boot/scope/CPU changes or counter/time regressions.
Capacity usage chips are green below 70%, amber from 70%, red from 90%; stale
readings are neutral. Load and hardware sensors have no invented alarm thresholds.
Root-filesystem usage is not a sum of mounts; available space excludes reserved
blocks. Missing, partial and simulated readings remain explicit. Verification
uses synthetic data; physical hardware, broker TLS and Home Assistant ingestion
require appliance acceptance.

### WireGuard DNS endpoints

WireGuard endpoints accept optional canonical `IPv4:port`,
`[IPv6]:port` or lowercase DNS `hostname:port` endpoints, for example
`vpn.example.test:51820`. Ports are mandatory decimal 1..65535 without leading
zeroes. DNS labels allow letters, digits and internal hyphens, at most 63 bytes
per label and 253 bytes overall; URLs, trailing dots, underscores and zones are
not accepted. Empty/omitted endpoints retain roaming behavior.

Deploy the updated backend before using DNS endpoints. Resolution happens in
the backend's managed namespace, never the browser. Underlay DNS must work
independently of the tunnel. The backend refreshes immediately and then after
each 60-second wait; IPv6 disabled permits only IPv4 answers/resolvers. Initial
uncached resolution must succeed. Later failures retain the persisted last-good
selection and report errors; disabled peers are not resolved.

The peer table retains the configured hostname and shows DNS errors inline.
Expanded peer details group connection measurements, allowed networks, and
keys/tunnel settings in separate columns that stack on narrow screens.
Connection measurements distinguish the cached DNS selection, actual roaming
endpoint and last DNS success (UTC). Worker errors remain separate from
handshake/traffic; absent native measurements are Unavailable, not success.
Existing state/runtime reads supply these details without browser DNS, new
refresh controls, configuration flags or interval settings. Drafts, full-package
SAVE, exports, history and restores retain the configured hostname. Endpoint
refresh does not change revisions, keys, keepalive or static/BGP AllowedIPs.

### WireGuard Allowed IP routes

Saving a WireGuard peer or tunnel stages a static route for every Allowed IP
network, including existing peers. Routes use the peer's parent tunnel interface,
main table 254, metric 1, and no gateway. IPv4 and IPv6 networks are supported.
Generated routes follow peer enable/disable changes (a shared network on the same
tunnel remains enabled while any peer using it is enabled). Removing an Allowed IP,
peer, or tunnel removes its generated routes. These changes remain in the shared
draft for the normal SAVE/apply review; opening a page does not change configuration.

Generated routes carry the metadata description
`Automatically managed from WireGuard Allowed IPs.`; retain that description for
automatic synchronization across sessions and exports. Other manual routes are
preserved. A matching direct manual main-table route with the required enabled
state is reused without modification. Conflicting manual routes at metric 1, or
the same Allowed IP network on different tunnels, produce an inline error instead
of overwriting a route. Peer edits that change routes also require `routes.write`.

### DHCP-dependent static routes

An enabled IPv4 static route on a DHCP-managed interface is not installed by the
backend while that interface has no valid lease, and is restored after the lease
routes. `enabled` stays configured intent: the Static Routes table shows a **Waiting
for DHCP** chip (with the lease error on hover) instead of changing the toggle or
the route, and the page reads runtime every 5 seconds while it is visible. IPv6,
disabled and other-interface routes are not affected. A lease alone does not prove
the route's pinned gateway is reachable.

### Unknown fields and Azure Dynamic DNS

The backend now drops unknown keys inside a submitted `config` instead of rejecting
them and lists them as `ignored_fields` on the submit response. The push dialog shows
that list as a warning; those settings are not applied. The list is not stored.

Responses from a newer backend no longer fail on keys this client doesn't know:
unknown keys are dropped before validation, except unknown top-level `config`
sections, which are kept unchanged in drafts so saving doesn't reset them. Imports
still reject unknown keys, and wrong types, missing fields and the retired
`policy_rules` field remain incompatible.

`config.dynamic_dns` (Azure public DNS A records) is decoded strictly, preserved
through drafts, imports, history and restores, and needs `dynamic_dns.write` in
addition to `transactions.write`. Settings > Dynamic DNS lists entries with an inline
Status toggle and an add/edit form. The Azure client secret is uploaded once via
`/services/dynamic-dns/secrets`; only the returned reference enters the draft, the
field is cleared after save, error or dismissal, and uploads are never retried
automatically. Entry state, address and last update come from
`/services/dynamic-dns/status`, polled every 7.5 seconds while that page is visible;
`current` means Azure accepted the record, not that DNS has propagated. Disabling or
deleting an entry does not delete the Azure record, and rollback cannot undo DNS
writes already made. Deployment needs an Azure DNS Zone Contributor service
principal; secrets are stored unencrypted on the appliance.

### Upgrade checks

Config / Upgrade (`/config/upgrade`) reads running software and release-check
results from `GET /api/v1/state` at `desired.software`. The page shows only the
current version, whether a new version is available (including its version),
a **Check for upgrade** button, and the last-check time in the saved system timezone. Errors stay inline;
there are no installation controls, repository/job details or status refresh controls.
It distinguishes up-to-date (including older published releases), pending,
disabled, failed and unavailable checks. From backend build `2026.10.30.4`,
release checking defaults to `mayberryjp/firewall_backend`, even when installation
support is disabled or unconfigured. `--disable-release-checks` is the explicit
opt-out; the frontend uses the backend's `software.repository` (null when checks
are disabled), never installation's `enabled`, to gate checking. Older backends'
reported settings remain authoritative; the browser does not invent a repository.
Appliances check GitHub's latest stable release at startup and every 24 hours;
normal state polling observes results. **Check for upgrade** sends an entirely empty
`POST /api/v1/system/upgrade/check` (`system.upgrade`) and waits for a changed
saved `last_checked_at` (`state.read`), not merely the 202 queued acknowledgement.
A 409 joins an existing check without resubmitting. Prior results remain labeled
as previous while waiting; an unchanged result after 60 seconds is uncertain and
requires an explicit retry. Permissions, unavailable workers and older unsupported
backends are reported inline. Checking does not allocate a revision, change the
draft, alter the daily schedule or install software. Discovery does not validate
installation assets or establish installation success.

The API client retains Ubuntu self-upgrade support for backend integrations, but this
page does not submit installations. Canonical versions
use a real Gregorian date and iteration: `yyyy.mm.dd.iteration`, year 0001..9999,
iteration 1..4294967295, with no leading `v`, prerelease or build suffix.
Versions compare numeric components (`.10` is newer than `.9`). Installation
requires a version newer than both the running and last-successful versions.
Ubuntu self-upgrades trust the configured GitHub repository over HTTPS, without
independent publisher signatures. Same-source SHA-256 verifies consistency, not
publisher identity. Separate signed `.ncpkg` packages are unchanged.
Standard Ubuntu install/source-upgrade scripts bootstrap private
`/etc/netcontrol/updates.json` and the managed `NETCONTROL_UPGRADE_CONFIG`
environment. Valid custom repository/token settings are preserved; private
repositories still require an operator-provisioned private token file. Retired
`public_key` settings must be removed explicitly before deployment, after active
workers are finished/recovered with their matching binary.
Installation requires an explicitly published stable `v<version>` release with
`netcontrold-ubuntu-amd64` and `netcontrol-ubuntu-amd64.json` assets, not a `.sig`.
Build-only does not configure services, and CI artifacts are not published
releases. The browser never supplies repository, token, signing, force or
unsigned-request overrides. See the backend
[upgrade handoff](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-29.md#2026-10-29-05-automatic-github-https-upgrades).

The shared store retains accepted job identity across transient failures and polls
without overlap, with backoff. Only `succeeded`, `failed` and `rolled_back` are terminal;
`recovery_required` and unknown statuses remain write-blocking and require console
investigation. A disconnect is not an outcome; submissions are never automatically
repeated. Superseded job IDs are reported without inventing the earlier result.
Configuration writes, service repair, DHCP retry and connection deletion are gated.
Drafts remain intact, and committed state/revision is refreshed before later submission.
Last successful version is historical, not a claim about the running version. There
are no browser cancel, force, reset or reboot actions. No real upgrade was executed
as part of frontend verification.

Configuration revisions independently use the same canonical date-version string
format. Requests, responses, history cursors, restore URLs and exports preserve
those strings; transaction result links use the server's nullable
`committed_revision`, never base plus one. Software metadata is daemon-managed:
it remains visible in committed exports but is omitted from imports into editable
drafts and transaction submissions. Daily check changes do not stale a draft or
appear as configuration changes.

The frontend supports deployed numeric-revision backends as well as the October 29
date-version contract. Legacy uint64 revisions remain exact internal decimal strings
and are sent back as numeric JSON tokens; date revisions stay quoted strings.
Older transaction responses may omit `committed_revision`; the UI does not invent a
result-revision link. Backends without `desired.software` remain usable for
configuration but cannot provide the new software/release-check display.

The updated backend uses `netcontrol-rust-state-v2` journals. Coordinate its
deployment separately: that backend refuses numeric v1 journals unchanged.
Never delete/reset them or automatically
convert existing appliance data. Existing appliances require a separately reviewed
operator deployment plan and private backup.

### Breaking source-policy removal

Public `policy_rules`, `/api/v1/policy-rules` and `policy.write` are retired.
Complete configuration schemas reject the field, even `[]` or null, rather than
silently dropping it from imports, revisions or transactions. Private monitor-owned
state is never exposed or emitted as public configuration. Deploy a matching backend;
the browser does not reset, migrate or rewrite old appliance state.

For eligible empty retired arrays only, operators can review the backend's
[offline conversion and recovery guide](https://github.com/mayberryjp/firewall_backend/blob/main/docs/BUILD_AND_INSTALL.md#offline-policy-rule-state-conversion).
This is a separate stopped-daemon, console-access operation requiring preview,
explicit confirmation and private backups. Nonempty rules/history need separate
review; never delete history to force startup. No conversion tool was run here.

Host-input settings are preserved through resource edits, imports, exports, and
transaction/history reads. Input changes require `firewall.write` and
`transactions.write`; review warns about management/DHCP reachability and removal
of WAN protection. The Push changes button is the explicit confirmation; there are
no required risk attestations. IPv4 NAT permits configured DHCP-client egress without
copying a leased address into static configuration; IPv6 still needs an address.

- Resource forms edit local values. **Stage changes** updates one complete
  in-memory draft cloned from committed desired configuration, never observation.
  Stage, reorder, delete, import, and discard make no mutation requests.
- Configuration lists and service forms show the shared draft automatically,
  otherwise the active candidate or committed desired settings. Runtime health
  continues to reflect active settings, not unsaved edits. Cancel discards only
  unstaged form values. Route/reload warnings protect
  unsaved input. Device API keys are never returned to the browser or written to
  browser storage or service-worker caches. Device addresses and encrypted keys
  are persisted in the central registry; the controller attaches the selected
  key when proxying requests to the firewall.
- Apply validates the complete package, its cross-resource references, captured
  revision against freshly read configuration, and actual serialized UTF-8 size.
  Pre-submit reads are UX checks, not a server concurrency guarantee.
- `202` is provisional, **not committed**. Frozen snapshots cannot be edited.
  Confirm changes is an explicit action in the same push dialog, without another
  popup or connectivity attestation. Rollback is explicit recovery. Only
  server-verified outcomes establish commit/rollback.
- Deadlines use absolute server timestamps, with approximate browser-clock
  countdowns. Absolute times are displayed in the saved system timezone. At expiry, confirmation is disabled
  while the application awaits server outcome. There is no automatic confirm.
- Timeouts/disconnects/operational write failures freeze the outcome as unknown.
  Known IDs are read directly; new transaction records are correlation hints,
  never idempotency keys or proof of ownership. Writes are never replayed
  automatically. Operator acknowledgement requires fresh server reads and no
  active transaction before releasing an ambiguous frozen candidate.
- Failed recovery remains globally visible with retry rollback. Transaction reads
  and lifecycle controls remain separate from failing live observation.
- External revision changes make the draft stale. Export/compare and explicitly
  restart; the app never silently rebases. Confirmed submitted drafts clear only
  after fresh server outcome; rolled-back candidates are retained.
- Reconcile services is a distinct bodyless, explicitly confirmed action using
  stored configuration, not the draft. It creates no revision, does not replay
  networking, and may lose flow caches or briefly disrupt DHCP relay on other interfaces.
- Restore uses the historical date-revision restore endpoint, never
  ordinary package submission. It requires no local draft, shows full impact,
  and follows the same provisional lifecycle.

### Backend/spec difference: native parent runtime

The Rust native backend inspected at `582458e` returns adopted-parent runtime
under `parents`, while the simulator and frontend spec use `parent_interfaces`.
The controller accepts either name and validates the rows; the documented field
takes precedence if both are present. Disappeared native parents may contain only
name, availability and error; missing link details display as Unknown. Missing
parent datasets and malformed rows still fail validation rather than appearing
as an empty inventory.

### October 23 host networking, DHCP and DNS

- The Interfaces screen shows read-only discovered NICs independently of managed
  configuration. Eligible unmanaged Ethernet/veth NICs have an explicit Manage
  action; loopback, unsupported kinds and protected parents cannot be adopted
  through it. Live addresses are never copied into the static draft.
- Managed Ethernet supports WAN, LAN and Unassigned roles without inference,
  static IPv4 or DHCPv4, optional static IPv6, DHCP client ID/hostname/metric,
  dynamic-MTU/domain policy and per-interface DNS servers/routing domains.
  DHCPv4 cannot coexist with static IPv4 or an enabled relay on that NIC.
- DHCP and DNS maps are preserved in complete packages, imports, exports,
  transaction snapshots and historical restores. Map-only changes appear in
  review and require interfaces.write, as do shared repairs when either map is
  configured. Empty-map omission is semantically equivalent to an empty map.
- Native leases, errors, expiry (Unix seconds), dynamic routes and resolver data
  are separate from static configuration. Missing runtime support is shown as
  unsupported/simulated, never fabricated as a successful lease.
- Routes and monitors accept main table 254 or 10000..19999 at the API boundary;
  the inline editors use main table 254. Public policy rules are no longer supported.
  Static routes default to enabled when omitted. Their Status toggle stages only
  the enabled flag, preserving the route path and metadata; SAVE applies the full
  configuration through the normal confirmed transaction. Disabled routes remain
  configurable and validated but are not installed. Route toggles stage directly
  without warning popups; enabled explicit monitors still need an enabled
  matching route, so disable or repoint dependent monitors in the same draft.
  Deploy the route-toggle backend before using disable controls. Gateway monitor
  enable switches also have a dedicated Status column, separate from Actions.
  Ethernet is eligible for
  VLAN parenting and DHCP relay. NAT still requires an address of its family
  in the configured static egress, matching the current backend validator.
- Interfaces and WireGuard use manual configuration/runtime refresh when idle;
  discovery loads once and has its own Refresh inventory action. Pending or
  uncertain transactions retain safety polling. Monitoring elsewhere is unchanged.
- Physical-NIC changes can disconnect management. Releasing management does not
  delete hardware, restart OS DHCP or remove persistent networkd exclusions.
  Native forwarding remains an operator prerequisite; no forwarding toggle or
  automatic NAT/firewall setup is supplied. Resolver publication requires native
  host mode and systemd-resolved. Deploy a matching backend and retain console
  access; real Linux handover, leases and rollback need operator acceptance.

These changes supersede the earlier role-only and isolated-lab restrictions.
The current Rust contract defaults an omitted allow_all_icmp to true but rejects
null; the older nullish behavior described in prior handoffs is not supported.

### Backend/spec difference: kernel settings

The inspected backend adds `Config.kernel` with `namespace` and `host` string
maps, plus optional transaction `kernel_before`/`kernel_after`. The supplied
frontend spec does not define editing these settings. They are decoded,
preserved unchanged in drafts/packages, shown in comparisons/exports, and imports
that would drop/change them are rejected. Historical restore can include them;
review the full comparison and operator permissions. This avoids a route-only
edit accidentally deleting newer backend state. Other unknown configuration
fields are rejected as incompatible rather than silently stripped.

### October 17 backend features

- Every managed interface supports explicit `role: "wan"`, `"lan"` or
  `"unassigned"`. There is no name-based WAN/LAN inference.
  Labels, filters and review summaries expose role changes. Roles are descriptive
  metadata, not independently observed link attributes, and do not configure
  firewall/NAT/routes.
- `firewall.allow_all_icmp` uses the current backend's **omitted true default**:
  omitted values, including historical snapshots, enable it; null is invalid. Explicit false
  survives unrelated edits/import/export/transactions. When enabled, protocol 1
  (all IPv4 ICMP types/codes) is accepted across every namespace interface for
  input/output/forwarding, before legacy or host/interface drops. ICMPv6 protocol
  58 is unchanged; other nftables tables can still drop traffic. Disabling removes
  exceptions rather than blocking ICMP. Backend startup automatically enables
  older saved configurations, even those with previous ICMP drops.
  The toggle works in both legacy and host/interface policy modes. Existing
  `firewall.policies` are decoded, compared and preserved; no implicit
  exception rows are synthesized. Sando imports add hosts/rules without replacing
  existing entries; historical restore remains server-authorized.
- Each interface has `dhcp_relay: { enabled, servers }`, default disabled/empty.
  Disabled server lists remain preserved and validated. Entries must be distinct
  canonical unicast IPv4 addresses, with no names, ports, prefixes, IPv6,
  loopback, link-local, multicast, unspecified or broadcast. All servers receive
  requests, not ordered failover. Enabled relay requires an administratively up
  dummy/VLAN link, servers and a configured unicast IPv4 address. The selected
  address/subnet is the first eligible canonical prefix in lexicographic order;
  enabled interfaces must have distinct selected relay addresses.
- Runtime comes from the independently polled `/runtime` dataset, including
  `dhcp_relay` rows and top-level errors. Missing rows are Unknown, not disabled;
  simulated is explicitly not real relay activity. Running is local process/socket
  readiness only, not proof of leases or server reachability. Observed failure
  never rewrites desired enabled settings. The DHCPv4 relay table separates the
  configured Enabled toggle from runtime Status chips.
- Enabled links share one dnsmasq PID. Server/selected-address/enabled-set changes
  can restart this process and briefly disrupt other interfaces. Explicit repair
  is a bodyless `/services/dhcp-relay/reconcile` POST. Both service repair entry
  points affect all enabled services using stored committed/pending settings,
  never the draft, and never retry automatically. A forbidden repair leaves its
  error visible and retains the draft.

Configuration changes require `transactions.write` plus `firewall.write` for
the ICMP flag or `interfaces.write` for role/relay edits. Lifecycle/restore actions
require their existing change permissions. Relay repair requires `state.read`,
`transactions.write`, `interfaces.write`, and `softflowd.write` if softflowd is
enabled. Softflowd repair additionally requires `interfaces.write` when relay is
enabled. Permission lists are hints based on stored settings, not claims about
the credential: the API has no permission-discovery endpoint and authorizes
every write under its engine lock. HTTP 403 is displayed without replay.

#### Relay operator setup

Install trusted relay-capable dnsmasq on the backend host. Configure
`-dhcp-relay-binary`, `-dhcp-relay-runtime-dir`, `-dhcp-relay-uid` and
`-dhcp-relay-gid`; the account/group must exist and be non-root. Meet the backend's
[binary/runtime ownership and namespace/procfs prerequisites](https://github.com/mayberryjp/firewall_backend#relay-operator-setup).
Do not launch a second DHCP service on UDP 67 in that namespace. Operators supply
upstream routes, server return paths and other firewalls' UDP 67/68 permissions.
WAN/LAN role does not select upstream links or limit relay enablement.
There is no DHCP server, DHCPv6, DNS, automatic firewall/NAT/routes, daemon
installation or service-identity editor in the controller.

Before release, verify simulator confirmation/rollback/restart/history and run
the handoff's isolated Linux packet acceptance: a request must reach both servers
and an offer return to the client. Mocked frontend tests cannot establish this.

### Gateway monitoring and appliance services

The October 17 handoffs 05/06 add `gateway_monitors`, `ntp`, `syslog`, and
`vnstat` to every complete configuration. These fields are preserved across
unrelated edits, imports/exports, transactions and historical comparisons.
Normalized monitor identity is its case-sensitive name; NTP/syslog server
ordering is semantically insignificant. Disabled settings remain retained and
validated; no WAN/source/route is inferred and no service is toggled on navigation.

#### Native gateway monitoring

- Probe timing and health thresholds are hidden by default when adding or editing
  a monitor. Use **Show advanced** to reveal them and **Hide advanced** to collapse
  them without discarding values. Validation errors in these settings reveal them
  automatically.
- The interface is the probe egress, not just a physical-link check.
  Explicit mode requires a configured source address and explicit route.
  IPv4 probes automatically follow DHCP when the selected managed interface is
  DHCP-configured; other probes use configured static paths, including IPv6 on
  interfaces with DHCP IPv4. There is no monitor mode selector. Saving DHCP probes
  requires fresh `/runtime` capabilities advertising both `dhcp` monitor mode and
  the `ipv4` DHCP-monitor address family. Imported DHCP drafts cannot bypass this
  gate. The October 24-12 backend implementation is unreleased and was not deployed
  as part of this frontend work; older backends can still save static probes.
  Neither mode copies live lease data into static configuration.
- `/gateway-monitors` stages explicit managed interface, source/gateway/target,
  inferred configured source/gateway, main-table routing, timing and threshold settings.
  The interface and probe target determine the serialized variant without copying
  live lease values. At most 64 named monitors, names 1..32 letters/digits/underscore/hyphen.
  Enabled explicit monitors need an up
  interface with the configured source, matching route through the specified
  gateway/table. The backend installs exact-source routing rules: all traffic from
  that source is affected, not only probes. Enabled monitors sharing a source must
  use the same table. No public source-policy record is required or accepted.
  Canonical IP addresses must share
  a family; IPv6 link-local gateway/target are scoped by the selected interface.
  Disabled explicit monitors need valid settings but not live references.
- DHCP monitors require a managed DHCP-configured interface even when disabled,
  and an up interface when enabled. The target must be a unicast IPv4 address.
  Saving requires no current lease, static address or configured route, and emits
  no `source_address`, `gateway` or `routing_table`. The backend resolves only the
  selected interface's lease and route, never another WAN. Private marked probe
  paths do not redirect unmarked application traffic. Missing leases display
  **Waiting for DHCP** with Unknown health; resolution/probe errors also remain
  Unknown with their reason. Resolved source/gateway/table are read-only runtime
  details; a null gateway with a resolved source/table means a direct route.
  Path changes restart warmup; unchanged renewals preserve measurements.
- Interval and timeout: 100..60000 ms, timeout <=10 intervals. Window:
  1000..300000 ms, >=2 timeouts, >=3 intervals, <=1024 intervals.
  Mean RTT threshold: 1..60000 ms; loss threshold: 1..100%; variation threshold:
  0..60000 ms (0 disables); failure/recovery holds: 100..60000 ms.
  The backend's documented omitted/zero timing defaults normalize explicitly.
- Overview and monitor screens read `/statistics/gateways` independently of
  configuration observation. Visible polling is non-overlapping every 3 seconds,
  with existing hidden-tab pause/backoff. GETs read cached measurements, not new
  probes. Gateway runtime is also decoded from `/runtime`.
  Monitor rows show a colored health chip, loss, mean RTT, standard deviation,
  and RTT variation in separate table columns, with the enable/disable switch
  beside its edit/delete actions. Expanding a row reveals the probe target,
  sample state, sent/received/lost/pending counts, complete measurements and
  resolved-path details. Narrow screens wrap the inline statistics within the
  same monitor record.
- A compact, 200px-high ApexCharts Mean RTT graph plots one line per
  gateway monitor in milliseconds, with system-timezone timestamps. It retains the latest
  120 samples per monitor while the page is open, ignores duplicate cached
  readings, and shows unavailable measurements as gaps rather than zero latency.
  Simulated measurements are not plotted.
- Probe metrics use green/yellow/orange/red chips with these display-only bands:

  | Metric | Green | Yellow | Orange | Red |
  | --- | --- | --- | --- | --- |
  | Packet loss | <1% | 1 to <3% | 3 to <5% | >=5% |
  | Mean RTT | <100 ms | 100 to <150 ms | 150 to <300 ms | >=300 ms |
  | RTT stddev / variation | <10 ms | 10 to <20 ms | 20 to <30 ms | >=30 ms |

  Tooltips explain each rating and its bands; unavailable, stale, warming-up,
  disabled, simulated, or errored samples remain neutral. Numeric ratings use
  unrounded measurements. These bands do not change configured health thresholds.
  There is no universal four-color ICMP quality standard: these are practical
  UI heuristics informed by real-time media guidance.
  [Microsoft Teams CQD](https://learn.microsoft.com/en-us/microsoftteams/stream-classification-in-call-quality-dashboard)
  classifies average media jitter above 30 ms as poor; its 500 ms RTT poor boundary
  is not this UI's more conservative 300 ms boundary.
  [Microsoft network performance guidance](https://learn.microsoft.com/en-us/previous-versions/skypeforbusiness/optimizing-your-network/media-quality-and-network-connectivity-performance)
  also distinguishes optimal from poor latency, jitter, and loss. Those media
  thresholds are not universal ICMP SLAs. RTT variation and population stddev
  are not one-way/RTP jitter; applying the same spread bands is a display
  heuristic, not a claim of standards compliance.
  The Overview gateway widget uses the same RTT, standard deviation, and loss
  chip bands, plus a colored status chip. Retained last-measured status keeps
  its existing explanation; old numeric samples remain visible but neutral
  while awaiting fresh measurements.
- Worker lifecycle, sample availability and health are separate. Stale after
  max(1 second, 3 probe intervals), errors, warmup and simulated/no-data results
  are Unknown, not current reachability or remote Down. Per-row measurement
  timestamps are distinct from envelope retrieval timestamps.
- Fractional loss/RTT values are JSON numbers; null is unavailable, genuine zero
  is displayed as zero. Revisions remain exact date-version JSON strings and kernel
  counters remain exact quoted decimal strings. Loss excludes pending probes.
  RTT standard deviation is population deviation; p50/p95 are nearest-rank.
  **RTT variation** is mean absolute RTT difference between adjacent transmitted
  probes that both replied, never bridging lost/pending probes; it is not
  one-way/RTP jitter. Window counts are not lifetime counters or traffic rates.
- Defaults: full-window 30-second warmup, 100% finalized loss Down; 20% loss or
  150 ms mean RTT Degraded; optional variation threshold off. Failure/recovery
  holds are 3/5 seconds and rolling-window effects add delay. Last success is
  since worker start and can predate the current window.
- Host Linux monitoring requires both `--allow-host-services` and
  `--gateway-monitoring`; `--appliance` alone is insufficient and the shipped
  systemd unit enables neither opt-in. The operator must review other configured
  host services, preserve custom startup flags, retain independent OS SSH/console
  access, and restart only without an active transaction or upgrade. Verify
  connectivity and refresh committed state/revision before explicitly retrying.
  Failed pushes involving enabled monitors offer these prerequisites in the push
  dialog. Full structured apply/rollback errors and transaction outcomes remain
  available without truncation; drafts are retained and writes are never retried
  automatically. Missing opt-ins are not repaired by disabling monitors, adding
  static DHCP routes, resetting state, or automatically editing service units.
  Linux also requires raw-socket/namespace privileges,
  matching configured routes for explicit mode or a usable IPv4 lease route for
  DHCP mode, plus ICMP/ICMPv6 return paths. Exact-source rules for explicit mode
  and private marked paths for DHCP mode are backend-managed; no dpinger,
  automatic desired routes, firewall exceptions or failover are provided.
  Affected networking/config changes, repair and restart reset measurements;
  health never rewrites desired enabled or creates modeled configuration drift.

#### Appliance NTP, syslog and vnStat

- NTP/syslog accept 0..8 unique destinations disabled and 1..8 enabled.
  Hosts are canonical unicast/private/ULA/loopback IPs or lowercase ASCII DNS
  labels (1..63 characters each, total <=253), without URIs, embedded ports,
  zones, mapped addresses, whitespace or trailing dots. Syslog requires explicit
  `udp`/`tcp`/`tls` and port 1..65535; uniqueness is transport+host+port.
- NTP uses host networking and changes the **whole appliance clock**, slew-only,
  client-only and without NTS. Running is not proof of synchronization; no
  offset/sync metrics exist. Rollback restores settings, not past clock state.
- Syslog owns whole-appliance system/kernel/internal/backend-file logging.
  Disabling/rolling back the managed logger can stop **local system logging**,
  not only remote forwarding; an alternative logger is an operator responsibility.
  TLS needs trusted certificates; UDP/TCP are unencrypted and UDP unacknowledged.
  DNS destinations use IPv4, canonical IPv6 literals choose IPv6. Running does
  not verify complete capture or delivery; no durable queue/ack guarantee exists.
- vnStat uses one host-wide native worker, covering loopback, unmanaged and
  dynamically created interfaces. The owning service page stages a single
  collector row with inline Add/Edit and a saved-row enabled toggle. New rows
  start disabled; the toggle controls accounting and reporting together.
  The nullable collector is one literal `IP:port` or `[IPv6]:port` destination;
  null keeps accounting without reporting. Destinations are validated even
  when disabled, and IPv6 destinations require global IPv6 enabled. Existing
  metadata is preserved without adding label controls. Configuration uses the
  existing SAVE review, transaction confirmation and rollback flow.
- Daily UDP reports use committed `system.hostname` and `system.domain` as
  `hostname.domain`, or hostname alone when the domain is empty, with vnStat-compatible
  oneline format in the host's local 23:59 minute. Pending or rolled-back identity
  changes do not affect reports. Coordinate collector identity/history queries
  when changing these values; the qualified name can create a different collector
  identity without deleting existing history. UDP has no delivery acknowledgement;
  reporting errors are local, non-blocking warnings. No cron, external vnStat
  binary or automatic firewall permit is installed. Restart targets `vnstat`,
  not the retired host/managed names. Never sum overlapping physical/VLAN/veth/
  loopback counters as device-wide traffic. Coordinate frontend/backend rollout
  for handoff `2026-10-28-10`; real collector interoperability remains unverified.
- The vnStat page reads `/statistics/vnstat` independently and shows Last report,
  Sent and Failed columns in the collector's existing table row, with any
  non-blocking reporting error inline. Tooltips explain attempt and UDP-delivery
  semantics without a separate reporting panel. `last_report_date` is an appliance-local
  `YYYY-MM-DD` calendar date, not a timestamp; it is displayed without inventing
  a time or converting it to UTC. Failed sends can advance it. Neither this date
  nor `sent_datagrams` proves delivery; there is no last-successful-upload
  timestamp or collector acknowledgment. Unavailable statistics do not block
  collector editing and are never replaced with fabricated zero counts.
- Status uses the independently polled `/runtime` dataset. Missing rows are
  Unknown; disabled/simulated/error states stay distinct, including top-level
  and per-row failures in HTTP 200. Simulation changes no clock and creates no
  real history. Failures never overwrite desired enabled settings.

All six service repair entry points repair **all enabled services** using stored
committed/pending settings under the backend lock, never the draft. Gateway
changes require `gateway_monitors.write`; appliance changes require `ntp.write`,
`syslog.write` or `vnstat.write`, alongside `transactions.write`. Repair requires
`state.read`, `transactions.write`, its endpoint write permission and permissions
for every enabled service (gateway monitoring, appliance services, softflowd,
DHCP relay). Confirmation/rollback/restore require the relevant change permissions.
Hints do not imply credential capabilities; 403 stays visible without replay.

Install trusted operator-provided chronyd/syslog-ng and configure
binary paths, explicit `-allow-host-services`, exclusive host ownership,
namespace/clock/kernel-log privileges, backend log source, trust bundle and host
DNS/routes. Stop competing clock/logging daemons first. The frontend exposes no
host commands, package installation or OpenRC management.
See the backend [operator guide](https://github.com/mayberryjp/firewall_backend#appliance-time-remote-logging-and-vnstat)
and [Alpine build/install guide](https://github.com/mayberryjp/firewall_backend/blob/main/docs/BUILD_AND_INSTALL.md).
Package installation defaults to loopback simulator mode; it does not establish
native readiness or native reboot recovery. Deployment labels stay explicit.

### Validation and representation

- Strict Zod runtime decoding rejects missing/incompatible desired configuration.
  Documented nil collections normalize to empty arrays; missing sections do not.
  Unknown observed kinds remain read-only diagnostic data.
- Revisions/cursors/provenance support canonical date-version JSON strings and
  legacy uint64 numeric tokens. `lossless-json` preserves legacy precision as
  internal decimal strings and serializes the original revision format on writes,
  while continuing to guard other numeric values against precision loss.
- Statistics counters/protocol values remain **quoted decimal strings**, including
  values above the JS safe-integer limit and gauges such as `Tcp.MaxConn = "-1"`.
  Missing counters/groups are unavailable, not zero.
- Overview packet totals below 100,000 use full grouped numbers. Larger totals use
  compact K/M/B/T suffixes with two decimal places; hover for the exact total.
  Packet-in/out chips show the change since the previous fresh poll, not a
  per-second rate (including `+0` when unchanged). Large deltas use the same
  formatting and retain their exact value in a tooltip. Chips require two valid
  samples and reset after stale/failed/simulated reads, missing counters, changed
  interface identity or scope, non-increasing sample times, or decreasing counters.
- `ipaddr.js` validates IP addresses/prefixes. Host bits are retained for
  interface addresses. Network selectors with host bits produce a correction
  suggestion that must be entered explicitly; they are never silently widened.
- Backend preflight remains authoritative. No local dry-run, permission discovery,
  key-file inventory, or connectivity verification endpoint is invented.

Staged Changes shows the unified diff and **Commit & push**. There are no import,
draft export or refresh controls. Commit & push checks the latest firewall state
before opening the push dialog; no write occurs until **Push changes** is confirmed.
The dialog accepts a commit message and an automatic rollback deadline, then stays
open to show push progress, without showing pre-submit blockers while the request
is in flight. An empty draft is a neutral no-changes state, not a push warning.
**Confirm changes** in that same dialog keeps the changes
and records the new revision, with no separate confirmation banner, popup or
connectivity checkbox. Otherwise the firewall rolls back at the deadline. This is a combined commit/push
workflow, not a separate local Git commit or an immediate permanent network change.

Resource lists automatically show the shared unsaved configuration when present,
otherwise the active candidate or committed configuration. There is no draft-preview
toggle. Interface lists combine configured interfaces and eligible unmanaged hardware
in one table, without filters or duplicate lease/discovery panels. Values are formatted
as readable fields rather than JSON; apply review and safety confirmations are unchanged.

## Refresh and error handling

State/runtime are independent single-flight datasets with loading, delayed-read,
error, last-success and stale indicators. Automatic state/runtime refresh runs on
Overview: state/runtime every 5 seconds, transaction discovery every 10 seconds,
and interface/gateway statistics every 3 seconds. Active/uncertain transactions
increase Overview state/discovery polling to 1 second after each read completes.
Advanced settings and transaction details also poll state/discovery at these
intervals, so provisional deletions and server rollback outcomes remain visible;
they do not poll runtime or operational measurements. Connections separately polls
visible live snapshots every 5 seconds after each completed read, with bounded
backoff. Other configuration pages remain manual even during pending transactions,
except the open push dialog: it reads only its own active commit every 2 seconds
after each read completes, backing off to 30 seconds on failures. Dialog reads pause
while hidden and stop on close or final outcome. Reload the browser or use a page's
refresh control to update manual pages. Reads performed on entry and fresh-state checks required by explicit writes
remain enabled. Deadline countdowns do not make network requests.
Overview polling pauses in hidden tabs and wakes on visibility/online events;
Connections also pauses in hidden tabs and refreshes on visibility when live;
these events do not trigger background state/runtime reads on manual pages. Overview transport failures
back off 1/2/5/10 seconds.

Reads time out after 80 seconds, writes after 90. Reads delayed over 3 seconds are
labelled; no overlapping request storm or invented progress is shown. Old read
results are discarded after mutation/disconnect/refetch. A `401` stops background
network requests and asks for a new key while preserving an in-memory draft until
explicit disconnect. A `403` remains an action-level error; permission discovery
is unavailable. Non-JSON API errors show bounded textual diagnostics.

No client-derived rate charts, summed traffic totals, CPU/RAM figures, tunnel
handshake status, per-flow data, or collector-delivery claims are fabricated.
Statistics display collection windows and source-level partial/unavailable/
simulated states. There is no offline mutation queue.

## Environment / deployment inputs

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_APP_NAME` | `Modan モダン` | Header/browser title |
| `VITE_APP_ENV` | Vite mode | Available frontend deployment metadata |
| `VITE_DEPLOYMENT_LABEL` | `Unknown` | Operator-supplied lab/deployment label |
| `VITE_BACKEND_MODE` | `Unknown` | Operator-supplied mode label, not API-discovered capability |
| `VITE_REGISTRY_API_URL` | Same host, port `3031`, path `/api/v1` | Public central-registry URL compiled into the frontend; no secrets |
| `BUILD_SOURCEMAP` | `false` | Explicit opt-in build sourcemaps |
| `REGISTRY_ADMIN_PASSWORD` | Required | Registry administrator password (at least 16 characters) |
| `REGISTRY_ENCRYPTION_KEY` | Required | Fernet key used to encrypt stored device credentials |
| `REGISTRY_UI_ORIGINS` | `http://localhost:3030,http://127.0.0.1:3030` | Comma-separated trusted frontend origins for session cookies; use the exact public UI origin in network deployments |
| `REGISTRY_TLS_CERT` | Empty | Optional registry-process TLS certificate path; not passed by the supplied HTTP Compose file |
| `REGISTRY_TLS_KEY` | Empty | Optional registry-process TLS private-key path; not passed by the supplied HTTP Compose file |

`VITE_*` settings are public build-time settings. Do not put secrets in them.
For the published-image Compose setup, only `REGISTRY_ADMIN_PASSWORD` and
`REGISTRY_ENCRYPTION_KEY` are unconditionally required. Set `REGISTRY_UI_ORIGINS`
to the exact public frontend origin when not using the localhost defaults.
The images already define the registry database path and listen port; no frontend
runtime environment variables are required.
The fetch adapter refuses controller redirects rather than forwarding
Authorization elsewhere; normal API calls omit cookies and set `cache: no-store`. Session login, restore, and sign-out include the registry cookie. Error
text redacts the registry session token.

### Overview layout

On Overview, select the pencil button (**Customize layout**) below the boxes at the bottom right to open the layout editor and drag boxes within or between the two
columns. Move buttons provide keyboard and touch alternatives. Hide unwanted
boxes, use **Show** to restore them, or **Reset layout** to restore the default
arrangement. On narrow screens the left column appears above the right column.
**Save layout** persists the arrangement and hidden boxes in the registry's SQLite
database; **Cancel** discards unsaved changes. Hiding a box does not change firewall
configuration or the overview's background polling.

The layout is shared by all browsers, devices, and administrators using the same
registry, not stored per browser or firewall. It loads when Overview opens; the
last successful save wins if multiple browsers edit at once. Loading or saving
failures are shown explicitly and can be retried. The authenticated registry
endpoints are `GET /api/v1/preferences/overview` and
`POST /api/v1/preferences/overview`, with a version-1 body containing two ordered
`columns` arrays of unique widget IDs (`interfaces`, `gateways`, `wireguard`,
`system`, `counters`). Omitted IDs are hidden; empty columns are allowed.

### Central registry, remote devices and CORS

The registry/controller API is a separate service on port 3031; Nginx does not
proxy registry or firewall API calls. Registry access uses one
operator-configured administrator password and an eight-hour registry session.
An HttpOnly, SameSite=Strict cookie restores the session after a reload without saving
the password or bearer token in web storage. HTTPS cookies are Secure. The browser
remembers only the selected device ID and reconnects it when reloading a protected
page. Explicit sign-out clears the cookie and remembered device. Drafts and unstaged
input remain in memory only; pending transactions are rediscovered from the server.
Device names and addresses are stored in `/docker/modan/registry-data/registry.sqlite3`
on the Docker host. Device keys are encrypted at rest using `REGISTRY_ENCRYPTION_KEY`, never
returned to the browser, and decrypted server-side only while proxying an
authenticated request to the selected firewall. Back up the encryption key
separately from the database; without it, stored keys cannot be recovered. Keep
both the database and encryption key private.

The browser sends firewall API requests to the registry/controller service,
which attaches the saved device key and relays requests to the firewall. The
controller must be able to reach the saved firewall address over the network.
Firewall CORS is not required because browsers never call firewalls directly.
Bearer-authenticated registry/proxy calls allow all origins. Cookie-based session
endpoints allow credentials only from `REGISTRY_UI_ORIGINS` or the registry's own
origin. Configure the exact frontend origin before using a different hostname,
port, or HTTPS. Keep the UI and registry on the same site for SameSite cookies;
restrict controller access and use strong administrator credentials.

Use HTTPS for both the website and registry in a network deployment. The
controller verifies certificates when connecting to HTTPS firewall APIs.
The supplied Compose stack uses HTTP internally and omits built-in registry TLS
settings and certificate mounts. Terminate HTTPS at an external reverse proxy
for network deployments; do not expose the HTTP ports directly to untrusted networks. Set
`VITE_REGISTRY_API_URL` at frontend build time if the registry is not reachable
at the website hostname on port 3031. The container CSP permits registry
`connect-src` connections to `http:` and `https:` origins.

Nginx returns SPA fallback for browser routes. Hashed assets are
cached; the app document is revalidated. The document receives a CSP,
no-referrer and nosniff headers. Vuetify needs inline styles, not inline scripts.
Apply additional HTTPS/HSTS policy at ingress. No third-party analytics/CDNs are
used.

Prepare storage on the Linux Docker host. The registry runs as UID/GID `10001`;
the bind mount must exist and be writable by that account:

```sh
sudo install -d -m 0700 -o 10001 -g 10001 /docker/modan/registry-data
```

If upgrading from the previous `registry-data` named volume, stop the registry
and copy its entire contents into this directory before starting the updated
stack. Preserve UID/GID `10001` ownership and the existing encryption key; do not
delete the old volume until the migrated registry has been verified.

```powershell
docker compose pull
docker compose up -d --no-build
```

Compose uses the published Docker Hub images to start the static frontend and
the central registry without local builds or npm downloads. Node.js and npm are
not required for this Docker-only setup. Stop `npm run dev` before starting the
Compose frontend because both use port 3030. Set
`REGISTRY_ADMIN_PASSWORD` and generate `REGISTRY_ENCRYPTION_KEY` before starting,
as shown in the local setup commands above. Persistent storage is the explicit
`/docker/modan/registry-data` bind mount, not a Docker-managed named volume.
Pre-create the directory with the ownership above rather than relying on Docker's
automatic directory creation. The registry retains
its read-only root filesystem, in-memory `/tmp` and no-new-privileges restriction.
Stop the stack with `docker compose down`; the host data directory is retained.
There are no container healthchecks; orchestrator readiness is
external.

## Tests and delivery

### Fast local iteration

Keep `npm run dev` running for hot reload. Routine edits do not require a
production build or the full test suite. Use a file-related test run for the
smallest relevant check:

```powershell
npm run test:related -- src/views/ConnectView.vue
```

For affected-test selection based on uncommitted Git changes, or a persistent
watch session:

```powershell
npm run test:changed
npm run test:watch
```

Changed mode includes staged and unstaged tracked changes, plus untracked files.
If the worktree contains many accumulated edits or shared dependencies changed,
it can legitimately select most tests. Use `test:related` with explicit source
files or `npm run test:unit -- tests/component/HomeView.spec.ts` to stay focused.
Changes to configuration, assets, or dynamically resolved dependencies may need
an explicit check because dependency-based selection is not complete coverage.
Optional continuous type checking runs separately with `npm run typecheck:watch`.
Lint individual edited files with `npx eslint src/views/ConnectView.vue`.

### Full validation

Use the complete checks before delivery, for broad shared-behavior changes, or
when explicitly needed, rather than after every small edit:

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest covers transport/endpoint contracts, date revisions and quoted-statistics precision,
schema/import behavior, IP parsing, numeric/UTF-8 bounds, shared drafts,
dependencies, fresh-state gating, unknown outcomes, explicit lifecycle actions,
recovery without observation, and restore/reconcile semantics. Component tests
cover connection messaging and multi-line editor values.

Playwright builds the production app and starts/stops its own preview server on
3030. Stop any dev/preview server first. Deterministic API fixtures cover invalid
credentials, independent recovery, route-only complete-package apply/confirm,
unknown write outcome, reconnect discovery, statistics, mobile overflow, and
keyboard navigation, plus ICMP preservation in host/interface policy mode,
WAN role/multi-server relay staging, explicit gateway creation, fractional/null/
stale measurements, shared appliance-service staging and forbidden bodyless repairs.
These fixtures are **test-only**, never a production demo/
fallback backend. Run the same operator workflows against the simulator and a
disposable native environment before a release; mocked browser tests do not
certify backend/kernel integration.

October 18 validation: 316 unit/component tests and all 26 desktop/mobile
Playwright cases pass, along with lint, strict type-check and production build.
An isolated loopback-only instance of the real backend simulator also verified
all new configuration/runtime/statistics/status response schemas, bodyless repairs,
confirmation, revision reads/restore, disable/rollback, disabled-server retention,
restart persistence, invalid-host rejection, unknown-monitor 404 and cross-service
403 from every repair endpoint. Earlier ICMP/role/relay checks remain covered.
Live Linux raw ICMP, dnsmasq/nftables behavior, clock discipline, whole-appliance
logging/delivery and vnStat packet/history collection remain unverified here.

CI requires lint, typecheck, frontend unit/component tests, registry service tests,
production build, desktop/mobile E2E, and Docker builds for both images.

### Docker Hub publishing

Pushes to `main` and manual runs of the **Build and publish Docker image** workflow
publish both images to Docker Hub after lint, typecheck, frontend and registry
tests, and desktop/mobile E2E pass. The frontend Docker build also runs the
production build. Release branches and
version tags still run CI, but no longer trigger image publishing.

Configure these GitHub Actions repository secrets before publishing:

- `DOCKERHUB_USERNAME`: a Docker Hub account with write access to
  `mayberry4477/firewall-controller` and
  `mayberry4477/firewall-controller-registry`.
- `DOCKERHUB_TOKEN`: that account's Docker Hub access token with write permission
  to both image repositories.

Each run builds without Docker layer caching and pushes both tags:

- `mayberry4477/firewall-controller:latest`
- `mayberry4477/firewall-controller:<full-commit-sha>`
- `mayberry4477/firewall-controller-registry:latest`
- `mayberry4477/firewall-controller-registry:<full-commit-sha>`

New runs cancel any in-progress publish run. GHCR publishing and its
`packages: write` permission are no longer used. To download a published image:

```powershell
docker pull mayberry4477/firewall-controller:latest
docker pull mayberry4477/firewall-controller-registry:latest
```

Use the commit-SHA tag to select a specific build. Pulling an image does not
update running containers; recreate them using the selected image in your
deployment. The Compose setup above uses the published `latest` tags.

## Layout

`src/services` owns HTTP and contract/validation helpers; `src/stores` owns shared
server/draft/lifecycle state; `src/views` contains route pages;
`src/components/base` and `src/components/feature` contain reusable fields,
status, comparison, and lifecycle UI; `src/components/layout` contains the shell
and safety banners. `src/composables` owns bounded polling and explicit exports.
Navigation categories and page destinations live in `src/constants/navigation.ts`.
`SectionLayout.vue` renders the section tabs and a nested router outlet. Every
subpage and detail route has its own lazy-loaded Vue view; views configure shared
components explicitly rather than inspecting URL prefixes to choose a page.
Resource pages compose filters, runtime, table, firewall controls, and edit/delete
dialogs. Draft editing and collection filtering live in `useResourceEditor` and
`useResourceCollection`; the app shell composes separate header, session,
connection-status, and disconnect components.
Theme colors are centralized in `src/plugins/vuetify.ts`. Global CSS enters only
through `src/main.ts`.

## Operational limitations

- No physical provisioning, parent adoption, DHCP server/DHCPv6/DNS, unsupported firewall/NAT
  selectors, private-key generation/upload, arbitrary commands, or general drift
  repair controls.
- Existing interface kind and VLAN identity are immutable. Renames are
  delete/create; dependency deletion is explicit, never silently cascaded.
- Permission hints are not inferred. The API authorizes each action, including
  confirmation/recovery of another operator's transaction.
- Browser time is approximate and background tabs may throttle countdowns. An
  expired local clock or closed browser cannot establish server rollback.
- A successful rollback restores modeled configuration, not lost connections,
  packets, handshakes, flow caches, interface identity indices, or external state.
- Transaction history is an unpaginated server map with client filtering/paging;
  large journals have backend scaling limits. Revision pagination uses exact
  server-provided exclusive cursors.
