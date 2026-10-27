# Modan モダン (Firewall Controller / Netcontrol)

Vue 3 + TypeScript + Vuetify administrative frontend for the **Netcontrol
firewall control plane**, following the
[frontend coding standards](https://github.com/mayberryjp/coding_standards/blob/main/FRONTEND_CODING_STANDARDS.md)
and [Netcontrol frontend specification](https://github.com/mayberryjp/firewall_backend/blob/main/FRONTEND_SPEC.md).

Backend contracts were checked against the October 25 and 27
[journals](https://github.com/mayberryjp/firewall_backend/tree/main/docs/journal)
and [frontend handoffs](https://github.com/mayberryjp/firewall_backend/tree/main/docs/frontend-handoffs),
including native mDNS, journald-only syslog, resilient supervision and platform health,
alongside the earlier source-policy removal, signed upgrades and connection-state deletion.
These backend features are Unreleased; local mock tests do not establish deployment or native acceptance.
Host-input filtering also follows the current
[input-firewall contract](https://github.com/mayberryjp/firewall_backend/blob/main/FRONTEND_SPEC.md#661-host-input-filtering):
optional input policies, managed ingress rules, DHCP-WAN allowances, and complete-package preservation.
The spec's React suggestion is optional;
this project retains the existing Vue/Vuetify stack.

## Run locally

Use Node.js 22+ and npm.

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
port 3031 and persists entries in a Docker volume. Stop other listeners on
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
at 5 seconds), and shows exact decimal counters, loss warnings and UTC sample times.
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
alerts, deduplicated by stable ID. First/last-seen times use UTC seconds. Unknown codes
remain readable; recovery removes resolved alerts. There is no dismiss, acknowledgement,
stored alert history or automatic repair. A cached health read expires locally after
15 seconds without a successful refresh, even if a request is still pending. Stale
aggregates retain their alerts without suppressing newer service-local failures.
Stale/unavailable data never implies healthy.
These observations never enter drafts or write requests, change desired settings,
block configuration operations, or trigger service/daemon restarts. Backend watchdog
deployment remains a separate operator-approved action; no backend deployment is made
by the frontend.

### Committed Configuration Download

Revision history provides **Download committed configuration**, using one read of
`GET /revisions/latest`, independently of live observation. It saves only the returned
`config` as `netcontrol-config-r<revision>.json`, preserving the exact uint64 revision.
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
| `/overview` | Customizable system, interface, gateway and WireGuard status widgets; exact interface counters with one interface per row |
| `/interfaces`, `/interfaces/:name` | Physical interfaces inventory and active IPv4/IPv6 addresses, excluding dummy/loopback links; inline NIC editing and explicit management/release |
| `/loopbacks` | Loopback creation, editing and explicit adoption; built-in `lo` and other system loopback links remain read-only |
| `/blackhole` | The single deviceless drop target (`config.blackhole`: name and drop/unreachable/prohibit action) that static routes can use as their interface; routes only, needs `routes.write`, no drop counters |
| `/vlans`, `/vlans/:name` | VLAN-only creation, behavior editing and deletion, parent/tag validation and dependency review |
| `/routes` | Static routes and managed-interface/table/metric validation; legacy `/policy-rules` redirects here |
| `/firewall` | Default forward policy and ordered accept/drop rules; existing host/ingress policies preserved read-only |
| `/settings`, `/settings/general` | Host name, cosmetic domain name, time zone, global IPv6 policy, IPv4 ICMP exception, and one DHCP DNS override control for all currently configured interfaces; settings join the shared draft |
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
| `/services/maintenance` | Explicit all-managed-services repair and signed self-upgrade with version/repository confirmation |
| `/config/changes` | Staged changes, unified diff, Commit & push |
| `/config/commits`, `/config/commits/:id` | Commits: independent recovery discovery and explicit lifecycle actions |
| `/config/revisions`, `/config/revisions/:revision` | Cursor-paginated committed archive, comparison/export/provisional restore |

Services labels the flow exporter **NetFlow/IPFIX**, under `/services/netflow`.
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

The top navbar selects Interfaces, Routing, Firewall, VPN, Services, or the Settings
gear. Routing uses a classic network-diagram router symbol; Firewall uses a brick wall.
Connection health appears in an icon-only floating bottom-right bubble; hover or
focus it for connection status, or open it for deployment
details and Disconnect. There is no profile/person button. Interfaces
contains Physical interfaces, Loopbacks and VLANs. Routing contains Static Routes
and Gateway monitors. The Modan モダン
brand links to Overview; there is no separate Overview navigation button. Firewall
contains forwarding, Host input, Connections and NAT; VPN contains WireGuard. The existing **Config rN**
revision box opens `/config`; there is no separate Config navigation button.
Each section exposes its own routed page tabs: a left rail on desktop and a
horizontal scrollable strip below 1280px when a section has multiple pages. `/networking` (Interfaces), `/routing`, `/vpn`, `/services`, and
`/config` open the first page in their section. Old `/activity`, `/changes`,
`/transactions` and `/history` URLs redirect to the corresponding Config pages,
including commit and revision detail links. Detail links retain their section and
selected parent tab, and browser back/forward navigates between pages. Commits is
the UI name for backend transactions; API endpoints and permissions are unchanged.

Operational pages show settings, records, and current status without repeated
read timestamps or deployment instructions. Errors and stale-data notices remain
visible. Detailed values use expandable labeled fields rather than JSON dumps;
small resource lists omit filter bars. Service-impact warnings appear in change
review and explicit repair/apply confirmations.

Tables use compact row density throughout the app, with reduced vertical cell and
action spacing. Wrapped content and inline editors can still grow to fit; narrow
screens retain their labeled, stacked layouts with tighter spacing.

NAT masquerading uses inline table rows for Add rule and editing, with Save/Cancel
and validation in place rather than popup forms or discard confirmations.
Save stages into the shared draft for the normal SAVE/apply review flow; it does
not write to the backend. Rule order and settings not changed in the editor are
preserved. The editor omits Labels (display name and description), retaining any
existing saved labels. Cancel or switching rows discards the current unstaged input.

Human-facing timestamps use `yyyy-mm-dd hh:mm:ss` in UTC, matching the supplied
containers' default timezone, not the browser's timezone. Table headings, detail
labels and tooltips identify UTC. Fractional seconds are omitted for display only;
API/storage timestamps, machine-readable HTML `datetime` attributes, exports and
deadline calculations retain their original precision and formats. DHCP lease
acquisition timestamps are converted from Unix seconds for display.

Each setting has one owning editor. Physical interfaces shows discovered non-loopback links, with
rows and **Active Addresses** from `GET /api/v1/interfaces/discovered` (`state.read`).
Managed configuration is joined by technical name for labels, roles and settings.
General settings includes an optional **Domain name** beside **Host name**, stored
as `system.domain` with the existing `system.write` permission. This is a cosmetic
label only, not a host-domain or DNS search-domain setting. Use lowercase labels
with no trailing dot (up to 253 characters, including the host name and separating
dot when both are set). Clear the field to remove it. The navigation bar shows the
committed `hostname.domain` in small text below the app title, or just the hostname
when the domain is empty; drafts do not rename the connected device before commit.
Long names are truncated visually with the full name available on hover.
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
New VLANs default to an unassigned role, admin down and no addresses.
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
`Display name (interface name)`, for example `WAN (eno1)`, or just the interface name
when no display name is set. Selections still save the interface name.
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

Configurable resources support optional shared metadata. Display names are empty or
up to 128 Unicode scalar values, with no controls or whitespace-only names;
descriptions allow up to 2048 scalars, including newline/tab. Empty annotations
are omitted. Labels never replace technical names, keys or selectors. Editors,
imports, exports, transaction review and revision restore preserve annotations;
existing read-only host/ingress policy summaries remain read-only. Annotation edits
use the resource's existing transaction permissions. These fields require the
backend's October 24 metadata contract.

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

### Signed self-upgrade

Service maintenance reads `GET /api/v1/system/upgrade` with `state.read` and submits
only `{"version":"1.2.3"}` via POST with `system.upgrade`. Canonical SemVer is limited
to 80 bytes, permits prereleases and excludes leading `v` and build metadata.
Confirmation identifies the exact version, configured repository and management/service
interruption risk. Disabled setup requires operator-managed repository/signing trust and
credentials; the browser never configures trust, URLs, tokens, paths or force flags.

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
  countdowns. Absolute times are displayed in container-default UTC. At expiry, confirmation is disabled
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
- Restore uses the historical restore endpoint (including revision 0), never
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
  `firewall.policies` are decoded, compared and preserved read-only; no implicit
  exception rows or host-policy editor are synthesized. Import cannot silently
  replace these preserved policies; historical restore remains server-authorized.
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
  never rewrites desired enabled settings.
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
  is displayed as zero. Revisions remain exact uint64 numeric tokens and kernel
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
- One vnStat toggle covers all host and managed interfaces, including loopback,
  unmanaged and dynamically created links. Separate instance/PID/database scopes
  are shown. Inventory/poll/update is 5 seconds, save/rescan 1 minute; manually
  inserted links may take up to a minute. Never sum overlapping physical/VLAN/
  veth/loopback links/scopes as device-wide traffic. No HTTP historical counters
  are exposed: paths/status are diagnostics, not traffic numbers. Graceful
  repair/restart preserves history; changed boot/namespace identity selects
  another database.
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

Install trusted operator-provided chronyd/syslog-ng/vnstatd/vnstat and configure
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
- `lossless-json` parses uint64 revisions/cursors/provenance into validated decimal
  strings and emits them as exact unquoted numeric tokens on requests.
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
open to show push progress. **Confirm changes** in that same dialog keeps the changes
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
Connections separately polls visible live snapshots every 5 seconds after each
completed read, with bounded backoff. Other pages, including transaction details,
do not poll for pending transactions, except the open push dialog: it reads only its
own active commit every 2 seconds after each read completes, backing off to 30 seconds
on failures. Reads pause while hidden and stop on close or final outcome. Reload the browser or use a page's refresh control to update
them. Reads performed on entry and fresh-state checks required by explicit writes
remain enabled. Deadline countdowns do not make network requests.
Overview polling pauses in hidden tabs and wakes on visibility/online events;
Connections also pauses in hidden tabs and refreshes on visibility when live;
these events do not trigger background state/runtime reads on other pages. Overview transport failures
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
| `REGISTRY_TLS_CERT` | Empty | Optional in-container TLS certificate path for the registry |
| `REGISTRY_TLS_KEY` | Empty | Optional in-container TLS private-key path for the registry |

`VITE_*` settings are public build-time settings. Do not put secrets in them.
The fetch adapter refuses controller redirects rather than forwarding
Authorization elsewhere; normal API calls omit cookies and set `cache: no-store`. Session login, restore, and sign-out include the registry cookie. Error
text redacts the registry session token.

### Overview layout

On Overview, select **Customize layout** to drag boxes within or between the two
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
Device names and addresses are stored in SQLite on the `registry-data`
volume. Device keys are encrypted at rest using `REGISTRY_ENCRYPTION_KEY`, never
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
To enable registry TLS, place certificate files in the ignored
`registry-certs` directory and set `REGISTRY_TLS_CERT=/certs/fullchain.pem` and
`REGISTRY_TLS_KEY=/certs/private-key.pem`. Set
`VITE_REGISTRY_API_URL` at frontend build time if the registry is not reachable
at the website hostname on port 3031. The container CSP permits registry
`connect-src` connections to `http:` and `https:` origins.

Nginx returns SPA fallback for browser routes. Hashed assets are
cached; the app document is revalidated. The document receives a CSP,
no-referrer and nosniff headers. Vuetify needs inline styles, not inline scripts.
Apply additional HTTPS/HSTS policy at ingress. No third-party analytics/CDNs are
used.

```powershell
docker compose pull
docker compose up -d --no-build
```

Compose uses the published Docker Hub images to start the static frontend and
the central registry without local builds or npm downloads. Node.js and npm are
not required for this Docker-only setup. Stop `npm run dev` before starting the
Compose frontend because both use port 3030. Set
`REGISTRY_ADMIN_PASSWORD` and generate `REGISTRY_ENCRYPTION_KEY` before starting,
as shown in the local setup commands above. The registry database persists in a
named Docker volume. Stop the stack with `docker compose down`; the named volume
is retained. There are no container healthchecks; orchestrator readiness is
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

Vitest covers transport/endpoint contracts, uint64 and quoted-statistics precision,
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
