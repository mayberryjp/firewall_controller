# Firewall Controller / Netcontrol

Vue 3 + TypeScript + Vuetify administrative frontend for the **isolated lab
control plane**, following the
[frontend coding standards](https://github.com/mayberryjp/coding_standards/blob/main/FRONTEND_CODING_STANDARDS.md)
and [Netcontrol frontend specification](https://github.com/mayberryjp/firewall_backend/blob/main/FRONTEND_SPEC.md).

Backend contracts were checked against commit
`a411ff48e87eaf32bb5f4923d3488a07cd0bc145`, including the
[October 17 journal](https://github.com/mayberryjp/firewall_backend/blob/main/docs/journal/2026-10-17.md)
and [frontend handoff](https://github.com/mayberryjp/firewall_backend/blob/main/docs/frontend-handoffs/2026-10-17.md).
The spec's React suggestion is optional;
this project retains the existing Vue/Vuetify stack.

## Run locally

Use Node.js 22+ and npm.

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Open http://localhost:3030, enter a networking bearer key, and connect. The dev
proxy preserves `/api/v1` and forwards it to `http://127.0.0.1:8080`, the daemon's
default listener. Set `API_PROXY_TARGET` for a different deployment.
Port 3030 is strict; stop other listeners before starting.

The backend is not provisioned by this project. For simulator testing, run the
backend separately using its documented setup, for example from its checkout:

```powershell
go run .\cmd\netcontrold -backend simulator -listen 127.0.0.1:8080 -state lab-state.json
```

Complete initial account/key onboarding on the daemon's embedded website at
http://127.0.0.1:8080 before using its key here. An explicit legacy `-auth-file`
deployment is also supported by the backend. The dashboard's bearer credential
does not authorize `/auth/`, and device-account cookies do not authorize the
networking client. There is intentionally no duplicate account/key-management UI
or proxy dependency on `/auth/`.

Simulator success does **not** verify Linux networking, WireGuard key-file
availability, kernel permissions, softflowd collector delivery or DHCP lease delivery. Native tests
require an explicitly disposable Linux namespace and operator provisioning.

## Screens

| Browser route | Purpose |
| --- | --- |
| `/connect` | Memory-only bearer entry and independent read-access verification |
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
| `/changes` | Shared draft, semantic comparison, import/export, provisional apply |
| `/transactions`, `/transactions/:id` | Independent recovery discovery and explicit lifecycle actions |
| `/history`, `/history/:revision` | Cursor-paginated committed archive, comparison/export/provisional restore |

Deep links fall back to the SPA; reload requires credential re-entry. Unknown
routes show an application 404.

## Safety model

- Resource forms edit local values. **Stage changes** updates one complete
  in-memory draft cloned from committed desired configuration, never observation.
  Stage, reorder, delete, import, and discard make no mutation requests.
- Lists default to committed desired; use staged preview to inspect the shared
  draft. Cancel discards only unstaged form values. Route/reload warnings protect
  unsaved input. Drafts, credentials, and server caches are never written to
  local/session storage or service-worker caches.
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
is unavailable. Non-JSON proxy errors show bounded textual diagnostics.

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
| `VITE_API_BASE_URL` | `/api/v1` | Trusted same-origin full API path; do not append another `/api` |
| `API_PROXY_TARGET` | `http://127.0.0.1:8080` | Vite-only upstream |
| `BUILD_SOURCEMAP` | `false` | Explicit opt-in build sourcemaps |
| `API_UPSTREAM` | `http://firewall-api:8080` | Runtime Docker/Nginx upstream origin without path/trailing slash |

`VITE_*` settings are public build-time settings. Do not put secrets in them.
Cross-origin API bases, query strings, and fragments are rejected. The fetch
adapter refuses API redirects rather than forwarding Authorization elsewhere;
it omits cookies and sets `cache: no-store`. Error text redacts the current key.

Production requires one trusted **HTTPS** frontend/API origin. Terminate HTTPS at
the operator's trusted ingress; the static container listens internally on 80.
The backend requires native TLS for non-loopback listeners. For an HTTPS upstream,
configure `API_UPSTREAM=https://...` and provide an appropriate trusted CA bundle
to Nginx (`/etc/ssl/certs/ca-certificates.crt`); certificate verification and SNI are
enabled. Do not disable verification as a deployment workaround. Device-account
onboarding uses a separate operator-provided daemon URL with native TLS; `/auth/`
does not trust forwarded headers.

Nginx preserves `/api/v1` and query strings, disables upstream retries, allows
long operations, and returns SPA fallback for browser routes. Hashed assets are
cached; the app document is revalidated. The document receives a same-origin CSP,
no-referrer and nosniff headers. Vuetify needs inline styles, not inline scripts.
Apply additional HTTPS/HSTS policy at ingress. No third-party analytics/CDNs are
used.

```powershell
docker build -t firewall-controller:dev .
docker compose up -d
```

Compose references the already-built image and declares **only the frontend**.
Configure a resolvable/reachable upstream and join the API's existing container
network where applicable. `firewall-api` is a placeholder name, not a provisioned
backend. Docker embedded DNS resolves it at request time, so the UI can start
before the API; requests will fail honestly until it is configured. There are no
container healthchecks; orchestrator readiness is external. Stop this stack with
`docker compose down`.

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
WAN role/multi-server relay staging and forbidden bodyless relay repair.
These fixtures are **test-only**, never a production demo/
fallback backend. Run the same operator workflows against the simulator and a
disposable native environment before a release; mocked browser tests do not
certify backend/kernel integration.

October 17 validation: 239 unit/component tests and all 18 desktop/mobile
Playwright cases pass, along with lint, strict type-check and production build.
An isolated loopback-only instance of the real backend simulator also verified
the frontend response schemas, explicit ICMP false, WAN role, multi-server relay,
bodyless repair, confirmation, revision reads/restore, disable/rollback, restart
persistence, invalid-input status codes and denied edits/repairs. Live Linux
dnsmasq lifecycle, packet delivery and nftables behavior remain unverified.

CI requires lint, typecheck, unit/component tests, production build, desktop/mobile
E2E, and a Docker image build. Release branches/version tags publish to
`ghcr.io/<owner>/<repository>:sha-<commit>` only after quality gates, using the
workflow's scoped `GITHUB_TOKEN`. No mutable `latest` tag is published.

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
