# Firewall Controller

Frontend foundation for a firewall platform controlled through a REST API.
Built to the [frontend implementation standards](https://github.com/mayberryjp/coding_standards/blob/main/FRONTEND_CODING_STANDARDS.md).

## Get started

Use Node.js 22 or newer and npm.

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Open http://localhost:3030. The port is strict: another process on 3030 must be
stopped or a different port explicitly selected. No firewall backend is needed
to view the scaffold.

## Included

- Vue 3, strict TypeScript, Vite, Vuetify, Vue Router, and Pinia.
- Responsive dark application shell with keyboard skip navigation.
- Overview, not-found, and navigation-error pages.
- Shared Axios client and transport error classification.
- Vitest unit/component tests and Playwright desktop/mobile smoke tests.
- Multi-stage Docker build, Nginx SPA hosting, and configurable API proxy.
- GitHub Actions quality gates, container build, and GHCR publishing.

No firewall endpoints, domain models, authentication, credentials, mock metrics,
or mutation controls are assumed. The overview makes no API calls. Domain
services and async stores (with loading/error state), protected routes, and
login/CRUD E2E coverage will be added with the API specification. The existing
Pinia store only manages shared navigation state.

## Structure

```text
src/
  assets/styles/       Global styles and layout tokens
  components/layout/   Reusable application shell
  plugins/             Centralized Vuetify theme
  router/routes/       Public, private, and error route definitions
  services/            HTTP client and transport error mapping
  stores/              Shared state
  types/               Shared transport types
  views/               Route-level pages
tests/
  unit/                API client, error mapping, and store tests
  component/           View contract tests
  e2e/                 Desktop/mobile browser smoke tests
```

Create base/feature components, composables, domain types, and services as actual
features need them; there are no empty placeholder modules.
HTTP calls belong only in services; views invoke store actions, and reusable
leaf components receive typed props/emits. Data-driven screens must cover
loading, empty, error, and success states.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_APP_NAME` | `Firewall Controller` | Browser title and app header |
| `VITE_APP_ENV` | Vite mode | Environment badge |
| `VITE_API_BASE_URL` | Empty (same origin) | Origin/base path before `/api`; do not append `/api` |
| `API_PROXY_TARGET` | `http://localhost:8000` | Local Vite proxy destination only |
| `BUILD_SOURCEMAP` | `false` | Set to `true` to generate build sourcemaps |
| `API_UPSTREAM` | `http://firewall-api:8000` | Runtime Docker/Nginx API origin; no trailing slash/path |

`VITE_*` settings are public, build-time values, not runtime container settings.
Never put secrets in them. Local `.env` files are ignored and excluded from Docker
builds; the container defaults to same-origin `/api`. Both development and Nginx
proxies preserve the `/api` prefix and query string. This transport convention
can be adjusted once the firewall API contract is known.

Errors are classified without assuming a backend response envelope. Services
must propagate failures to stores, which expose an error for visible UI feedback.
No retries, authentication interceptors, or persistence are added prematurely.

The scaffold follows the standards' Vite 6/Vuetify 3 baseline, with Node 22 for
local/CI/container consistency, patched Vitest 4 for Vite 6 compatibility, and
`@playwright/test` for the Playwright test runner.

## Quality checks

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
```

E2E tests build the production app and start/stop their own preview server on
3030. Stop the dev server first. CI runs all checks, including desktop/mobile
E2E, for PRs, main, release branches, and version tags.

## Containers

```powershell
docker build -t firewall-controller:dev .
docker compose up -d
```

Open http://localhost:3030. Stop with `docker compose down`.
Compose references the already-built image and defines only the frontend.
There is no container healthcheck; readiness is the orchestrator's responsibility.

For API integration, set `API_UPSTREAM` to a real HTTP origin resolvable and
reachable from the container, connecting the frontend to the API's existing
Docker network where applicable. The default name `firewall-api` is a placeholder,
not a provisioned backend. Nginx starts without that host present; API requests
will fail with an upstream error until it is configured. Docker's embedded DNS
resolver is used for runtime upstream resolution. HTTPS upstreams and specific
authentication behavior should be configured after the API contract is supplied.

The publish workflow runs quality gates before publishing to
`ghcr.io/<owner>/<repository>:sha-<commit>` on version tags and release branches.
It uses the workflow's scoped `GITHUB_TOKEN` and never updates a mutable `latest`
tag. Configure repository/package permissions before the first publish.
