# Firewall Controller / Netcontrol

Vue 3 + TypeScript + Vuetify administrative frontend for the **isolated lab
control plane**, following the
[frontend coding standards](https://github.com/mayberryjp/coding_standards/blob/main/FRONTEND_CODING_STANDARDS.md)
and [Netcontrol frontend specification](https://github.com/mayberryjp/firewall_backend/blob/main/FRONTEND_SPEC.md).

Backend contracts were checked against commit
`4d416a2f318b1bce29de7149ccac138db4d9c41f`, including the
[October 17 journal](https://github.com/mayberryjp/firewall_backend/blob/main/docs/journal/2026-10-17.md)
and [frontend handoff](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-17.md).
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
docker compose up -d --build registry
npm run dev
```

Open http://localhost:3030, sign in with the registry password, then add a
firewall's name, API address and networking bearer key. The registry runs on
port 3031 and persists entries in a Docker volume. Stop other listeners on
ports 3030 and 3031 before starting. Keep the ignored `.env` file and back up
its encryption key securely; never regenerate the key for an existing registry
database. If `.env` already exists, add both registry settings without replacing
any existing encryption key.

For simulator testing, run the firewall backend separately using its documented
setup, for example from its checkout:

```powershell
go run .\cmd\netcontrold -backend simulator -listen 127.0.0.1:8080 -state lab-state.json
```

Complete initial account/key onboarding on the daemon's embedded website at
http://127.0.0.1:8080, then add its networking bearer key to the registry.
Device-account cookies do not authorize networking requests. The registry stores
device keys encrypted at rest; after sign-in, a selected key is loaded into
browser memory and sent directly to that device's API.

Simulator success does **not** verify Linux networking, WireGuard key-file
availability, kernel permissions, softflowd collector delivery or DHCP lease delivery. Native tests
require an explicitly disposable Linux namespace and operator provisioning.
Simulator results also do not verify gateway reachability, clock synchronization,
whole-appliance log capture/delivery or real vnStat history.

## Screens

| Browser route | Purpose |
| --- | --- |
| `/connect` | Registry sign-in, persistent firewall list, encrypted key storage and direct device connection |
| `/overview` | Committed/live state, drift, runtime, recent history, exact statistics |
| `/interfaces`, `/interfaces/:name` | Managed dummy/VLAN/WireGuard editors, required WAN/LAN roles, DHCPv4 relay |
| `/parents` | Protected adopted-parent diagnostics; no provisioning controls |
| `/routes` | Routes and managed-interface/table/metric validation |
| `/policy-rules` | Source-prefix routing with unique priorities |
| `/firewall` | Global IPv4 ICMP exception, default forward policy and ordered accept/drop rules; existing host/ingress policies preserved read-only |
| `/nat` | Ordered IPv4/IPv6 masquerading with family-correct egress |
| `/wireguard` | Same interface draft with nested peer/settings editor |
| `/services/softflowd`, `/services/softflowd/:name` | Staged instances, independent runtime, collective reconcile |
| `/services/dhcp-relay` | Per-interface stored/observed relay configuration, runtime and explicit collective repair |
| `/gateway-monitors` | Explicit dual-stack path/timing/health settings and independent cached gateway measurements |
| `/services/ntp`, `/services/syslog`, `/services/vnstat` | Shared draft appliance service editors, scoped runtime and collective repair |
| `/changes` | Shared draft, semantic comparison, import/export, provisional apply |
| `/transactions`, `/transactions/:id` | Independent recovery discovery and explicit lifecycle actions |
| `/history`, `/history/:revision` | Cursor-paginated committed archive, comparison/export/provisional restore |

Deep links fall back to the SPA; reload requires registry password re-entry.
Unknown routes show an application 404.

## Safety model

- Resource forms edit local values. **Stage changes** updates one complete
  in-memory draft cloned from committed desired configuration, never observation.
  Stage, reorder, delete, import, and discard make no mutation requests.
- Lists default to committed desired; use staged preview to inspect the shared
  draft. Cancel discards only unstaged form values. Route/reload warnings protect
  unsaved input. Drafts and device API keys are never written to browser storage
  or service-worker caches. Device addresses and encrypted keys are persisted in
  the central registry; a selected key is held in memory while connected.
- Apply validates the complete package, its cross-resource references, captured
  revision, fresh transaction discovery, drift, and actual serialized UTF-8 size.
  Pre-submit reads are UX checks, not a server concurrency guarantee.
- `202` is provisional, **not committed**. Frozen snapshots cannot be edited.
  Explicit confirm acknowledges operator connectivity checks; rollback is explicit
  recovery. Only server-verified outcomes establish commit/rollback.
- Deadlines use absolute server timestamps, with approximate browser-clock
  countdowns. UTC and local time are visible. At expiry, confirmation is disabled
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

- Every managed dummy/VLAN/WireGuard interface must explicitly select `role: "wan"`
  or `"lan"`. There is no default, name-based inference, inheritance or migration.
  Labels, filters and review summaries expose role changes. Roles are descriptive
  metadata, not independently observed link attributes, and do not configure
  firewall/NAT/routes. Protected adopted parents do not have editable roles.
- `firewall.allow_all_icmp` uses the backend's documented **nullish true default**:
  omitted/null values, including historical snapshots, enable it. Explicit false
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
  canonical numeric unicast IPv4 addresses, with no names, ports, prefixes, IPv6,
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

- `/gateway-monitors` stages explicit managed interface, source/gateway/target,
  routing table, timing and threshold settings. At most 64 named monitors,
  names 1..32 letters/digits/underscore/hyphen. Enabled monitors need an up
  interface with the configured source, matching route through the specified
  gateway/table and a source-policy rule. Canonical numeric addresses must share
  a family; IPv6 link-local gateway/target are scoped by the selected interface.
  Disabled monitors need valid settings but not live references.
- Interval and timeout: 100..60000 ms, timeout <=10 intervals. Window:
  1000..300000 ms, >=2 timeouts, >=3 intervals, <=1024 intervals.
  Mean RTT threshold: 1..60000 ms; loss threshold: 1..100%; variation threshold:
  0..60000 ms (0 disables); failure/recovery holds: 100..60000 ms.
  The backend's documented omitted/zero timing defaults normalize explicitly.
- Overview and monitor screens read `/statistics/gateways` independently of
  configuration observation. Visible polling is non-overlapping every 3 seconds,
  with existing hidden-tab pause/backoff. GETs read cached measurements, not new
  probes. Gateway runtime is also decoded from `/runtime`.
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
- Linux requires explicit `-gateway-monitoring`, raw-socket/namespace privileges,
  explicit source-policy routing and ICMP/ICMPv6 return paths. No dpinger,
  automatic firewall exceptions, routing changes or failover are provided.
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
- `ipaddr.js` validates numeric addresses/prefixes. Host bits are retained for
  interface addresses. Network selectors with host bits produce a correction
  suggestion that must be entered explicitly; they are never silently widened.
- Backend preflight remains authoritative. No local dry-run, permission discovery,
  key-file inventory, or connectivity verification endpoint is invented.

Imports accept complete config-only JSON, not request wrappers. Unknown fields,
trailing values, partial configs, invalid references, and oversized input are
rejected. Preview shows deletion impact before replacing the local draft. Exports
are config-only, operator initiated, and require a sensitivity acknowledgement.

## Refresh and error handling

State/runtime are independent single-flight datasets with loading, delayed-read,
error, last-success and stale indicators. Visible normal state/runtime refreshes
every 5 seconds; transaction discovery every 10 seconds. Active/uncertain
transactions increase state/discovery polling to 1 second **after completion**.
Visible overview/interface statistics refresh every 3 seconds in separate
ephemeral monitoring state. Background polling pauses in hidden tabs and wakes
on visibility/online events. Transport failures back off 1/2/5/10 seconds.

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
| `VITE_APP_NAME` | `Firewall Controller` | Header/browser title |
| `VITE_APP_ENV` | Vite mode | Available frontend deployment metadata |
| `VITE_DEPLOYMENT_LABEL` | `Unknown` | Operator-supplied lab/deployment label |
| `VITE_BACKEND_MODE` | `Unknown` | Operator-supplied mode label, not API-discovered capability |
| `VITE_API_BASE_URL` | `/api/v1` | API path appended to the selected device origin; do not append another `/api` |
| `VITE_REGISTRY_API_URL` | Same host, port `3031`, path `/api/v1` | Public central-registry URL compiled into the frontend; no secrets |
| `BUILD_SOURCEMAP` | `false` | Explicit opt-in build sourcemaps |
| `REGISTRY_ADMIN_PASSWORD` | Required | Registry administrator password (at least 16 characters) |
| `REGISTRY_ENCRYPTION_KEY` | Required | Fernet key used to encrypt stored device credentials |
| `REGISTRY_TLS_CERT` | Empty | Optional in-container TLS certificate path for the registry |
| `REGISTRY_TLS_KEY` | Empty | Optional in-container TLS private-key path for the registry |

`VITE_*` settings are public build-time settings. Do not put secrets in them.
Query strings and fragments in API URLs are rejected. The fetch adapter refuses
API redirects rather than forwarding Authorization elsewhere; it omits cookies
and sets `cache: no-store`. Error text redacts the current device key.

### Central registry, remote devices and CORS

The registry API is a separate service on port 3031; Nginx does not proxy
registry or device API calls. Registry access uses one operator-configured
administrator password and an eight-hour in-memory bearer session. Device names
and addresses are stored in SQLite on the `registry-data` volume. Device keys
are encrypted at rest using `REGISTRY_ENCRYPTION_KEY`, never returned in device
list responses, and decrypted only for an authenticated connect request.
Back up the encryption key separately from the database; without it, stored
keys cannot be recovered. Keep both the database and encryption key private.

The browser calls each selected firewall API directly using its saved origin
(for example `https://192.0.2.1:8080`) and key. The device API must allow CORS
from the website origin, including `Authorization`, `Content-Type`, `GET`,
`POST`, and preflight `OPTIONS`. This project’s firewall backend responds with
`Access-Control-Allow-Origin: *`; do not enable cookie-based CORS. The registry
also allows all origins and does not use cookies.

Use HTTPS for both the website and registry in a network deployment, and use
HTTPS device APIs when the site is served over HTTPS; browsers block mixed
content. To enable registry TLS, place certificate files in the ignored
`registry-certs` directory and set `REGISTRY_TLS_CERT=/certs/fullchain.pem` and
`REGISTRY_TLS_KEY=/certs/private-key.pem`. Set
`VITE_REGISTRY_API_URL` at frontend build time if the registry is not reachable
at the website hostname on port 3031. The container CSP permits direct
`connect-src` connections to `http:` and `https:` origins.

Nginx returns SPA fallback for browser routes. Hashed assets are
cached; the app document is revalidated. The document receives a CSP,
no-referrer and nosniff headers. Vuetify needs inline styles, not inline scripts.
Apply additional HTTPS/HSTS policy at ingress. No third-party analytics/CDNs are
used.

```powershell
docker build -t firewall-controller:dev .
docker compose up -d --build
```

Compose starts the static frontend and the central registry. Set
`REGISTRY_ADMIN_PASSWORD` and generate `REGISTRY_ENCRYPTION_KEY` before starting,
as shown in the local setup commands above. The registry database persists in a
named Docker volume. Stop the stack with `docker compose down`; the named volume
is retained. There are no container healthchecks; orchestrator readiness is
external.

## Tests and delivery

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
deployment. The local Compose setup above continues to use `firewall-controller:dev`.

## Layout

`src/services` owns HTTP and contract/validation helpers; `src/stores` owns shared
server/draft/lifecycle state; `src/views` contains route pages;
`src/components/base` and `src/components/feature` contain reusable fields,
status, comparison, and lifecycle UI; `src/components/layout` contains the shell
and safety banners. `src/composables` owns bounded polling and explicit exports.
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
