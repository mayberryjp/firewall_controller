import type { Page } from "@playwright/test";
import { config, runtime, statistics, transaction, gatewayStatistics } from "../fixtures";
import type { Config, Transaction, GatewayStatistics } from "../../src/types/domain";
import { decodeJson, encodeJson } from "../../src/services/json";

export async function mockBackend(page: Page, options: { observationFailed?: boolean; initialStatus?: string; lostSubmit?: boolean; initialConfig?: Config; serviceDenied?: boolean; gatewayRows?: GatewayStatistics[]; invalidCredential?: boolean } = {}) {
  let committed = options.initialConfig ?? config(), revision = "0";
  const transactions: Record<string, Transaction> = {};
  if (options.initialStatus) transactions["tx-test"] = transaction(options.initialStatus);
  const writes: Array<{ path: string; body: unknown }> = [];
  const activeConfig = () => Object.values(transactions).find(item => item.status === "pending_confirmation")?.candidate ?? committed;
  const gatewayRows = () => options.gatewayRows ?? activeConfig().gateway_monitors.map(item => ({
    ...gatewayStatistics(), name: item.name, process_state: item.enabled ? "simulated" : "disabled", sample_status: item.enabled ? "simulated" : "disabled",
    health: "unknown", sent: 0, received: 0, lost: 0, pending: 0, variation_pairs: 0,
    loss_percent: null, rtt_min_ms: null, rtt_max_ms: null, rtt_avg_ms: null, rtt_stddev_ms: null, rtt_p50_ms: null, rtt_p95_ms: null, rtt_variation_ms: null,
  }));
  const runtimeState = () => {
    const stored = Object.values(transactions).find(item => item.status === "pending_confirmation")?.candidate ?? committed;
    return {
      ...runtime(), dhcp_relay: stored.interfaces.map(link => ({ interface: link.name, state: link.dhcp_relay.enabled ? "simulated" : "disabled" })),
      gateway_monitors: gatewayRows(),
      appliance_services: runtime().appliance_services.map(item => ({
        ...item, state: stored[item.name === "ntp" ? "ntp" : item.name === "syslog" ? "syslog" : "vnstat"].enabled ? "simulated" : "disabled",
        database_directory: item.name.startsWith("vnstat") ? `/test-diagnostic/${item.scope}` : undefined,
      })),
    };
  };
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
    const reply = (value: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", headers: {
        "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*",
      }, body: encodeJson(value),
    });
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      } });
    }
    if (url.port === "3031") {
      if (path === "/session" && request.method() === "POST") {
        return reply({ token: "registry-test-session", expires_in: 28800 });
      }
      if (request.headers().authorization !== "Bearer registry-test-session") {
        return reply({ error: "Registry login required" }, 401);
      }
      if (path === "/devices" && request.method() === "GET") {
        return reply({ devices: [{
          id: "11111111-1111-4111-8111-111111111111", name: "Test firewall",
          address: `http://${url.hostname}:8080`, created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }] });
      }
      if (path.endsWith("/credential") && request.method() === "POST") {
        return reply({ credential: "browser-test-key" });
      }
      return reply({ error: "Unexpected registry endpoint" }, 404);
    }
    if (options.invalidCredential) return reply({ error: "Invalid credential", transaction: null }, 401);
    if (request.headers().authorization !== "Bearer browser-test-key") return reply({ error: "Invalid credential", transaction: null }, 401);
    if (request.method() === "GET") {
      if (path === "/state") {
        if (options.observationFailed) return reply({ error: "Observation unavailable", transaction: null }, 503);
        return reply({ revision, desired: committed, observed: committed, drift: false,
          active_transaction: Object.values(transactions).find(item => !["committed", "rolled_back"].includes(item.status)) });
      }
      if (path === "/runtime") return reply(runtimeState());
      if (path === "/services/dhcp-relay/status") return reply({ interfaces: runtimeState().dhcp_relay, error: "" });
      if (path === "/statistics") return reply(statistics());
      if (path === "/statistics/gateways") return reply({ sample: statistics().sample, monitors: gatewayRows() });
      if (path.startsWith("/statistics/gateways/")) {
        const row = gatewayRows().find(item => item.name === decodeURIComponent(path.split("/")[3] ?? ""));
        return row ? reply({ sample: statistics().sample, monitor: row }) : reply({ error: "gateway monitor not found", transaction: null }, 404);
      }
      if (path === "/transactions") return reply(transactions);
      if (path.startsWith("/transactions/")) return transactions[path.split("/")[2] ?? ""] ? reply(transactions[path.split("/")[2]!]) : reply({ error: "Not found", transaction: null }, 404);
      if (path === "/revisions") return reply({ revisions: [{ revision, current: true, submitted_at: null, committed_at: null }] });
      if (path.startsWith("/revisions/")) return reply({ revision: path.split("/")[2], current: true, submitted_at: null, committed_at: null, config: committed });
    }
    if (request.method() === "POST") {
      const body: unknown = request.postData() ? decodeJson(request.postData()!) : undefined;
      writes.push({ path, body });
      if (path === "/transactions" || path.endsWith("/restore")) {
        const parsed = body && typeof body === "object" ? body : {};
        const pending = transaction();
        pending.previous = committed;
        pending.candidate = "config" in parsed ? parsed.config as Config : config();
        if (path.endsWith("/restore")) pending.restored_from_revision = path.split("/")[2];
        transactions[pending.id] = pending;
        if (options.lostSubmit) return route.abort("failed");
        return reply(pending, 202);
      }
      if (path.endsWith("/confirm") || path.endsWith("/rollback")) {
        const id = path.split("/")[2]!, pending = transactions[id];
        if (!pending) return reply({ error: "Not found", transaction: null }, 404);
        if (path.endsWith("/confirm")) {
          pending.status = "committed"; pending.committed_at = new Date().toISOString();
          revision = String(BigInt(revision) + 1n); committed = pending.candidate;
        } else pending.status = "rolled_back";
        return reply(pending);
      }
      if (/^\/services\/(softflowd|dhcp-relay|gateway-monitoring|ntp|syslog|vnstat)\/reconcile$/.test(path)) {
        if (options.serviceDenied) return reply({ error: "interfaces.write permission required", transaction: null }, 403);
        return reply(runtimeState());
      }
    }
    return reply({ error: "Unexpected mocked endpoint", transaction: null }, 404);
  });
  return { writes };
}
