import type { Page } from "@playwright/test";
import { z } from "zod";
import { config, runtime, statistics, transaction, gatewayStatistics, connections, healthSnapshot, mdnsStatus, udpRelayStatus, software } from "../fixtures";
import { bgpSchema, mdnsSchema } from "../../src/types/domain";
import { bgpStatus, bgpRoutes, bgpAdvertisedRoutes } from "../bgpFixtures";
import { mdnsInterfaces } from "../../src/services/mdns";
import type { Config, Transaction, GatewayStatistics, DiscoveredInterface, Statistics, RuntimeState, StateView } from "../../src/types/domain";
import { decodeJson, encodeJson } from "../../src/services/json";
import { defaultOverviewLayout, overviewLayoutSchema } from "../../src/services/overviewLayout";
import { firewallCounters } from "../firewallTelemetryFixtures";
import { normalize } from "../../src/services/configuration";

export async function mockBackend(page: Page, options: { observationFailed?: boolean; initialStatus?: string; lostSubmit?: boolean; normalizeCandidate?: boolean; applyError?: { message: string; outcome: "rolled_back" | "recovery_failed" }; initialConfig?: Config; serviceDenied?: boolean; gatewayRows?: GatewayStatistics[]; runtimeCapabilities?: RuntimeState["capabilities"]; invalidCredential?: boolean; discoveredInterfaces?: DiscoveredInterface[]; statistics?: Statistics; stateRuntime?: StateView["runtime"] } = {}) {
  let committed = { ...options.initialConfig ?? config(), software: options.initialConfig?.software ?? software() }, revision = "2026.10.29.1";
  let overviewLayout = defaultOverviewLayout();
  const transactions: Record<string, Transaction> = {};
  if (options.initialStatus) transactions["tx-test"] = transaction(options.initialStatus);
  const writes: Array<{ path: string; body: unknown }> = [];
  const activeConfig = () => Object.values(transactions).find(item => item.status === "pending_confirmation")?.candidate ?? committed;
  const relayStatus = () => (activeConfig().udp_broadcast_relay?.instances ?? []).map(instance => ({
    ...udpRelayStatus(), ...instance, instance_id: instance.id,
    enabled: Boolean(activeConfig().udp_broadcast_relay?.enabled && instance.enabled),
    state: activeConfig().udp_broadcast_relay?.enabled && instance.enabled ? "simulated" : "disabled",
  }));
  const routingStatus = () => {
    const settings = activeConfig().bgp;
    return {
      ...bgpStatus(), state: settings?.enabled ? "running" : "disabled",
      neighbors: settings?.enabled ? settings.neighbors.map(peer => ({
        ...bgpStatus().neighbors![0]!, name: peer.name, address: peer.address, interface: peer.interface,
      })) : [],
    };
  };
  const discoveryStatus = () => {
    const settings = activeConfig().mdns;
    return {
      ...mdnsStatus(), enabled: settings?.enabled ?? false, state: settings?.enabled ? "simulated" : "disabled",
      effective_interfaces: settings?.enabled ? mdnsInterfaces(activeConfig()) : [],
      effective_families: settings?.enabled ? [
        ...(settings.ipv4 ? ["ipv4"] : []),
        ...(settings.ipv6 && activeConfig().ipv6_enabled !== false ? ["ipv6"] : []),
      ] : [],
      reflection_enabled: Boolean(settings?.enabled && settings.reflection.enabled),
      publishing_enabled: Boolean(settings?.enabled && settings.publishing.enabled),
    };
  };
  const gatewayRows = () => options.gatewayRows ?? activeConfig().gateway_monitors.map(item => ({
    ...gatewayStatistics(), name: item.name, process_state: item.enabled ? "simulated" : "disabled", sample_status: item.enabled ? "simulated" : "disabled",
    health: "unknown", sent: 0, received: 0, lost: 0, pending: 0, variation_pairs: 0,
    loss_percent: null, rtt_min_ms: null, rtt_max_ms: null, rtt_avg_ms: null, rtt_stddev_ms: null, rtt_p50_ms: null, rtt_p95_ms: null, rtt_variation_ms: null,
  }));
  const runtimeState = () => {
    const stored = Object.values(transactions).find(item => item.status === "pending_confirmation")?.candidate ?? committed;
    return {
      ...runtime(), bgp: routingStatus(), capabilities: options.runtimeCapabilities,
      dhcp_relay: stored.interfaces.map(link => ({ interface: link.name, state: link.dhcp_relay.enabled ? "simulated" : "disabled" })),
      gateway_monitors: gatewayRows(),
      appliance_services: [...runtime().appliance_services.map(item => ({
        ...item, state: stored[item.name === "ntp" ? "ntp" : item.name === "syslog" ? "syslog" : "vnstat"].enabled ? "simulated" : "disabled",
        database_directory: item.name.startsWith("vnstat") ? `/test-diagnostic/${item.scope}` : undefined,
      })), discoveryStatus(), routingStatus(), ...relayStatus()],
    };
  };
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), url = new URL(request.url());
    let path = url.pathname.replace("/api/v1", "");
    const reply = (value: unknown, status = 200, extraHeaders: Record<string, string> = {}) => route.fulfill({
      status, contentType: "application/json", headers: {
        "Cache-Control": "no-store", "Access-Control-Allow-Origin": request.headers().origin ?? "*",
        "Access-Control-Allow-Credentials": "true",
        ...extraHeaders,
      }, body: encodeJson(value),
    });
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: {
        "Access-Control-Allow-Origin": request.headers().origin ?? "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      } });
    }
    if (url.port === "3031") {
      if (path === "/session" && request.method() === "POST") {
        return reply({ token: "registry-test-session", expires_in: 28800 }, 200, {
          "Set-Cookie": "registry_session=registry-test-session; Path=/api/v1/session; HttpOnly; SameSite=Strict; Max-Age=28800",
        });
      }
      if (path === "/session" && request.method() === "GET") {
        return request.headers().cookie?.includes("registry_session=registry-test-session")
          ? reply({ token: "registry-test-session", expires_in: 28000 })
          : reply({ error: "Registry login required" }, 401);
      }
      if (path === "/session/logout" && request.method() === "POST") {
        return reply({ deleted: true }, 200, {
          "Set-Cookie": "registry_session=; Path=/api/v1/session; HttpOnly; SameSite=Strict; Max-Age=0",
        });
      }
      if (request.headers().authorization !== "Bearer registry-test-session") {
        return reply({ error: "Registry login required" }, 401, { "X-Registry-Auth-Error": "true" });
      }
      if (path === "/preferences/overview") {
        if (request.method() === "POST") overviewLayout = overviewLayoutSchema.parse(request.postDataJSON());
        return reply(overviewLayout);
      }
      if (path === "/devices" && request.method() === "GET") {
        return reply({ devices: [{
          id: "11111111-1111-4111-8111-111111111111", name: "Test firewall",
          address: "http://192.0.2.1:8080", created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }] });
      }
      const proxy = path.match(/^\/devices\/[0-9a-f-]{36}\/proxy(\/.*)$/);
      if (!proxy) return reply({ error: "Unexpected registry endpoint" }, 404);
      path = proxy[1]!;
    } else {
      return reply({ error: "Firewall requests must be proxied through the controller" }, 404);
    }
    if (options.invalidCredential) return reply({ error: "Invalid device key", transaction: null }, 401);
    if (request.method() === "GET") {
      if (path === "/state") {
        if (options.observationFailed) return reply({ error: "Observation unavailable", transaction: null }, 503);
        return reply({ revision, desired: committed, observed: committed, drift: false, runtime: options.stateRuntime,
          active_transaction: Object.values(transactions).find(item => !["committed", "rolled_back"].includes(item.status)) });
      }
      if (path === "/runtime") return reply(runtimeState());
      if (path === "/services/udp-broadcast-relay") return reply(committed.udp_broadcast_relay ?? { enabled: false, instances: [] });
      if (path === "/services/udp-broadcast-relay/status") return reply({ instances: relayStatus(), error: "" });
      if (path === "/services/bgp") return reply(activeConfig().bgp ?? bgpSchema.parse({}));
      if (path === "/services/bgp/status") return reply(routingStatus());
      if (path === "/routes/bgp") return reply({ ...bgpRoutes(), state: routingStatus().state, routes: activeConfig().bgp?.enabled ? bgpRoutes().routes : [] });
      if (path === "/routes/bgp/advertised") return reply({ ...bgpAdvertisedRoutes(), state: routingStatus().state, routes: activeConfig().bgp?.enabled ? bgpAdvertisedRoutes().routes : [] });
      if (path === "/platform/status") return reply({
        process_health: { status: "healthy", healthy: true, stale: false, collected_at: "2026-10-27T01:02:03.987Z", components: [] },
        active_alerts: [],
      });
      if (path === "/system/upgrade") return reply({ enabled: false, repository: null, job: null, last_successful_version: null });
      if (path === "/interfaces/discovered") return reply(options.discoveredInterfaces ?? []);
      if (path === "/services/dhcp-relay/status") return reply({ interfaces: runtimeState().dhcp_relay, error: "" });
      if (path === "/services/mdns") return reply(committed.mdns ?? mdnsSchema.parse({}));
      if (path === "/services/mdns/status") return reply({ instances: [discoveryStatus()], error: "" });
      if (path === "/statistics") return reply(options.statistics ?? statistics());
      if (path === "/statistics/firewall") {
        const counters = firewallCounters(activeConfig());
        return reply({ ...counters, config_revision: revision, sample: { ...counters.sample, status: "simulated" }, rules: [], generation: null, ruleset_id: null });
      }
      if (path === "/firewall/deny-log") return reply({ error: "Deny capture unavailable in simulator" }, 503);
      if (path === "/statistics/vnstat") return reply({ error: "Native accounting unavailable in simulator" }, 503);
      if (path === "/statistics/host") {
        const sample = healthSnapshot(); sample.sample.status = "simulated"; sample.sample.scope = "simulator"; sample.sample.boot_id = null;
        for (const section of Object.values(sample.sections)) { section.status = "simulated"; section.data = null; section.error = "No physical host measurements in simulator"; }
        return reply(sample);
      }
      if (path === "/services/mqtt/status") return reply({ device_id: "a".repeat(32), enabled: committed.mqtt?.enabled ?? false, state: committed.mqtt?.enabled ? "simulated" : "disabled", error: null, last_published_at_unix: null,
        connection_attempts: 0, reconnect_count: 0, last_connected_at_unix: null, last_failure: null });
      if (path === "/statistics/connections") return reply({ ...connections(), connections: [], sample: { ...connections().sample, status: "simulated" }, summary: { total: null, matched: null, returned: 0, accounting_unavailable: null } });
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
    if (request.method() === "DELETE") {
      writes.push({ path, body: request.postData() ? decodeJson(request.postData()!) : undefined });
      if (path === "/connections" || /^\/connections\/\d+$/.test(path)) return reply({ status: path === "/connections" ? "flushed" : "deleted", scope: connections().sample.scope });
      if (path === "/firewall/hosts-and-rules") {
        const body = z.object({
          base_revision: z.string(), confirm_timeout_seconds: z.number().int().min(10).max(300),
          confirm: z.literal(true), description: z.string().optional(),
        }).strict().parse(request.postDataJSON());
        if (body.base_revision !== revision || Object.values(transactions).some(item => !["committed", "rolled_back"].includes(item.status))) {
          return reply({ error: "Stale revision or active transaction", transaction: null }, 409);
        }
        if (body.confirm !== true) return reply({ error: "Explicit confirmation required", transaction: null }, 400);
        const pending = transaction();
        pending.previous = committed;
        pending.base_revision = revision;
        pending.candidate = structuredClone(committed);
        pending.candidate.firewall.rules = [];
        if (pending.candidate.firewall.policies) {
          pending.candidate.firewall.policies.hosts = [];
          for (const policy of pending.candidate.firewall.policies.interfaces) policy.rules = [];
        }
        pending.description = body.description;
        pending.confirmation_deadline = new Date(Date.now() + body.confirm_timeout_seconds * 1000).toISOString();
        transactions[pending.id] = pending;
        if (options.applyError) {
          pending.status = options.applyError.outcome; pending.error = options.applyError.message;
          return reply({ error: options.applyError.message, transaction: pending }, 500);
        }
        if (options.lostSubmit) return route.abort("failed");
        return reply(pending, 202);
      }
    }
    if (request.method() === "POST") {
      const body: unknown = request.postData() ? decodeJson(request.postData()!) : undefined;
      writes.push({ path, body });
      if (path === "/services/mqtt/passwords") return reply({ password_ref: "a".repeat(32) }, 201);
      if (path === "/transactions" || path.endsWith("/restore")) {
        const parsed = body && typeof body === "object" ? body : {};
        const pending = transaction();
        pending.previous = committed;
        pending.base_revision = revision;
        pending.candidate = "config" in parsed ? parsed.config as Config : config();
        if (options.normalizeCandidate) pending.candidate = normalize(pending.candidate);
        if ("description" in parsed && typeof parsed.description === "string") pending.description = parsed.description;
        if (path.endsWith("/restore")) pending.restored_from_revision = path.split("/")[2];
        transactions[pending.id] = pending;
        if (options.applyError) {
          pending.status = options.applyError.outcome; pending.error = options.applyError.message;
          return reply({ error: options.applyError.message, transaction: pending }, 500);
        }
        if (options.lostSubmit) return route.abort("failed");
        return reply(pending, 202);
      }
      if (path.endsWith("/confirm") || path.endsWith("/rollback")) {
        const id = path.split("/")[2]!, pending = transactions[id];
        if (!pending) return reply({ error: "Not found", transaction: null }, 404);
        if (path.endsWith("/confirm")) {
          pending.status = "committed"; pending.committed_at = new Date().toISOString();
          revision = `2026.10.29.${Number(revision.split(".")[3]) + 1}`;
          pending.committed_revision = revision;
          committed = { ...pending.candidate, software: committed.software };
        } else pending.status = "rolled_back";
        return reply(pending);
      }
      if (/^\/services\/(softflowd|dhcp-relay|gateway-monitoring|ntp|syslog|vnstat|mdns|udp-broadcast-relay)\/reconcile$/.test(path)) {
        if (options.serviceDenied) return reply({ error: "interfaces.write permission required", transaction: null }, 403);
        return reply(runtimeState());
      }
    }
    return reply({ error: "Unexpected mocked endpoint", transaction: null }, 404);
  });
  return {
    writes,
    expireTransactions() {
      for (const pending of Object.values(transactions)) {
        if (pending.status === "pending_confirmation") {
          pending.status = "rolled_back";
          pending.confirmation_deadline = new Date(Date.now() - 1).toISOString();
        }
      }
    },
  };
}
