import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import api, { ApiFailure, inspectApiPath, onMutationCheck, onUnauthorized, request, setApiDevice } from "@/services/api";
import { registryApiBaseUrl, setRegistrySessionToken } from "@/services/registry";
import * as net from "@/services/netcontrol";
import { useConfigExport } from "@/composables/useConfigExport";
import { z } from "zod";
import { decodeJson, encodeJson } from "@/services/json";
import { differences, normalize, requiredPermissions } from "@/services/configuration";
import { ruleOwnershipEntries } from "@/services/ruleOwnership";
import { gatewayMonitorSchema, upgradeVersionSchema, mdnsSchema, adoptVlanRequestSchema } from "@/types/domain";
import { config, hostPolicyConfig, state, runtime, transaction, statistics, gatewayStatistics, connections, mdnsStatus, vnstatReporting, mqttStatus } from "../fixtures";
import { dnsResponse, linkDiagnostics, interfaceCapabilitySnapshot, rpsDiagnostics } from "../diagnosticsFixtures";
import { bgpConfig, bgpStatus, bgpRoutes, bgpAdvertisedRoutes, dnatRule } from "../bgpFixtures";
import { firewallCounters, firewallDenyPage } from "../firewallTelemetryFixtures";
import { pathTestRequest, pathTestStatus } from "../pathTestFixtures";
import { conntrackCatalog, conntrackSnapshot } from "../conntrackFixtures";
import { discordStatus, webhookReference, webhookUrl } from "../discordFixtures";
import { discordDefaults } from "@/services/discord";

const deviceId = "11111111-1111-4111-8111-111111111111";
let status = 200, body = "{}", captured: InternalAxiosRequestConfig | undefined, responseHeaders = new AxiosHeaders();
const adapter = vi.fn(async (input: InternalAxiosRequestConfig) => {
  captured = input;
  return { status, data: body, statusText: "", headers: responseHeaders, config: input };
});
beforeEach(() => {
  vi.clearAllMocks(); status = 200; body = "{}"; captured = undefined; responseHeaders = new AxiosHeaders();
  api.defaults.adapter = adapter; setRegistrySessionToken("registry-test-session"); setApiDevice(deviceId);
  onMutationCheck(() => "");
});
describe("controller-proxied API boundary", () => {
  it.each(["disabled", "loose", "strict"] as const)("preserves %s RPF through state, submission, confirmation and rollback", async mode => {
    const candidate = config(); candidate.firewall.rpf_mode = mode;
    body = encodeJson({ ...state(), desired: candidate, observed: candidate });
    expect((await net.getState()).desired.firewall.rpf_mode).toBe(mode);
    const pending = transaction(); pending.candidate = candidate;
    pending.previous.firewall.rpf_mode = mode === "disabled" ? "strict" : "disabled";
    body = encodeJson(pending); status = 202;
    expect((await net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 })).candidate.firewall.rpf_mode).toBe(mode);
    expect(decodeJson(String(captured?.data))).toMatchObject({ config: { firewall: { rpf_mode: mode } } });
    expect(String(captured?.data)).not.toContain("spoof_block");
    expect(String(captured?.data)).not.toContain("system_policies");
    body = encodeJson({ ...pending, status: "committed" }); status = 200;
    expect((await net.confirmTransaction(pending.id)).candidate.firewall.rpf_mode).toBe(mode);
    body = encodeJson({ ...pending, status: "rolled_back" });
    expect((await net.rollbackTransaction(pending.id)).previous.firewall.rpf_mode).toBe(pending.previous.firewall.rpf_mode);
    body = encodeJson({ revision: state().revision, current: true, submitted_at: null, committed_at: null, config: candidate });
    expect((await net.getRevision(state().revision)).config.firewall.rpf_mode).toBe(mode);
  });
  it.each(["loose", "strict"] as const)("rejects an accepted response that drops the requested %s RPF mode", async mode => {
    const candidate = config(); candidate.firewall.rpf_mode = mode;
    const pending = transaction();
    body = encodeJson(pending); status = 202;
    await expect(net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ uncertain: true, incompatible: true, transaction: { id: pending.id }, message: expect.stringContaining("RPF mode") });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it.each(["spoof_block", "system_policies"] as const)("does not silently prune removed %s from backend configuration", async field => {
    const current = state();
    body = encodeJson({ ...current, desired: { ...current.desired, firewall: {
      ...current.desired.firewall, [field]: field === "spoof_block" ? false : [],
    } } });
    await expect(net.getState()).rejects.toMatchObject({ incompatible: true, message: expect.stringContaining(field) });
  });
  it("preserves measured RPF observations separately from configuration, including zero and drift", async () => {
    const rpf = { mode: "strict", family: "ipv4", status: "measured", rp_filter: { all: "1", default: "1", wan0: "0", lo: "1" }, drift: true };
    body = encodeJson({ ...runtime(), rpf });
    expect((await net.getRuntime()).rpf).toEqual(rpf);
    expect(captured).toMatchObject({ method: "get", url: "/runtime" });
    expect(captured?.data).toBeUndefined();
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it.each(["disabled", "loose", "strict"] as const)("keeps simulated %s RPF unmeasured", async mode => {
    const rpf = { mode, family: "ipv4", status: "simulated", rp_filter: null, drift: null };
    body = encodeJson({ ...runtime(), rpf });
    expect((await net.getRuntime()).rpf).toEqual(rpf);
  });
  it.each([
    { status: "measured", rp_filter: null, drift: false },
    { status: "measured", rp_filter: { wan0: "3" }, drift: false },
    { status: "simulated", rp_filter: { wan0: "1" }, drift: null },
    { status: "simulated", rp_filter: null, drift: false },
  ])("rejects malformed or fabricated RPF observations %j", fields => {
    body = encodeJson({ ...runtime(), rpf: { mode: "disabled", family: "ipv4", ...fields } });
    return expect(net.getRuntime()).rejects.toMatchObject({ incompatible: true });
  });
  it("uploads a private Discord webhook and returns only its reference", async () => {
    status = 201; body = encodeJson({ webhook_ref: webhookReference });
    expect(await net.uploadDiscordWebhook(webhookUrl)).toEqual({ webhook_ref: webhookReference });
    expect(captured).toMatchObject({ method: "post", url: "/services/discord/webhooks" });
    expect(decodeJson(String(captured?.data))).toEqual({ webhook_url: webhookUrl });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it.each([400, 403, 409, 422, 503])("keeps HTTP %i upload errors credential-free without retries", async code => {
    status = code; body = encodeJson({ error: `Invalid webhook ${webhookUrl}` });
    try { await net.uploadDiscordWebhook(webhookUrl); expect.fail("Expected upload failure"); }
    catch (error) {
      expect(error).toMatchObject({ status: code });
      expect(error instanceof Error && error.message).not.toContain(webhookUrl);
      expect(error instanceof Error && error.message).not.toContain("abcdefghijklmnop");
    }
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it("reads exact Discord entry totals and never returns webhook credentials in status errors", async () => {
    body = encodeJson({ ...discordStatus(), delivered: "18446744073709551615", error: `Failure at ${webhookUrl}` });
    const sample = await net.getDiscordStatus();
    expect(sample.delivered).toBe("18446744073709551615");
    expect(sample.error).toBe("Failure at [redacted webhook]");
    expect(captured).toMatchObject({ method: "get", url: "/services/discord/status" });
    expect(captured?.data).toBeUndefined();
    status = 403; body = encodeJson({ error: webhookUrl });
    await expect(net.getDiscordStatus()).rejects.toMatchObject({ status: 403, message: expect.not.stringContaining(webhookUrl) });
  });
  it("preserves private references in complete confirmed packages and refuses to confirm dropped Discord settings", async () => {
    const candidate = config();
    candidate.discord = { ...discordDefaults(), enabled: true, webhook_ref: webhookReference };
    const pending = transaction(); pending.candidate = candidate;
    status = 202; body = encodeJson(pending);
    expect((await net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 })).candidate.discord)
      .toEqual(candidate.discord);
    expect(String(captured?.data)).not.toContain("discord.com");
    body = encodeJson(transaction());
    await expect(net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ uncertain: true, incompatible: true, transaction: expect.objectContaining({ id: pending.id }) });
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("reads the kernel catalog and exact runtime maps without a request body", async () => {
    body = encodeJson(conntrackCatalog());
    expect(await net.getKernelTunablesCatalog()).toEqual(conntrackCatalog());
    expect(captured).toMatchObject({ method: "get", url: "/kernel/tunables/catalog" });
    expect(captured?.data).toBeUndefined();
    body = encodeJson(conntrackSnapshot());
    expect(await net.getKernelTunables()).toEqual(conntrackSnapshot());
    expect(captured).toMatchObject({ method: "get", url: "/kernel/tunables" });
    expect(captured?.data).toBeUndefined();
  });
  it("preserves string conntrack values in complete transactions and treats dropped settings as uncertain", async () => {
    const candidate = config();
    candidate.kernel = { host: { "net.netfilter.nf_conntrack_max": "2048" }, namespace: {} };
    const pending = transaction(); pending.candidate = candidate;
    body = encodeJson(pending); status = 202;
    await net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 });
    expect(decodeJson(String(captured?.data))).toMatchObject({ config: candidate, confirm_timeout_seconds: 120 });
    body = encodeJson(transaction());
    await expect(net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ uncertain: true, incompatible: true, transaction: expect.objectContaining({ id: pending.id }) });
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("reads local null-deadline transactions and takeover receipts without converting them to remote confirmation", async () => {
    const local = { ...transaction("applying_local"), confirmation_deadline: null };
    body = encodeJson({ [local.id]: local });
    expect((await net.getTransactions())[local.id]).toEqual(local);
    body = encodeJson(local);
    expect(await net.getTransaction(local.id)).toEqual(local);
    body = encodeJson({ ...state(), active_transaction: local });
    expect((await net.getState()).active_transaction?.confirmation_deadline).toBeNull();
    const receipt = {
      mode: "console", phase: "failed", error: "Takeover interrupted",
      connectivity_confirmation_required: false,
      items: [{ resource: "bridge0", disposition: "disabled", reason: "Unsupported bridge" }],
    };
    body = encodeJson({ ...runtime(), host_takeover: receipt });
    expect((await net.getRuntime()).host_takeover).toEqual(receipt);
  });
  it("rejects an unexpected untimed remote submission as uncertain without retrying", async () => {
    body = encodeJson({ ...transaction("applying_local"), confirmation_deadline: null }); status = 202;
    await expect(net.submitPackage({ base_revision: state().revision, config: config(), confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ uncertain: true, incompatible: true });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  describe("explicit VLAN adoption", () => {
    const input = { name: "vlan30", parent: "eth0", id: 30 };
    const result = () => ({ revision: "2026.11.06.9", interface: {
      ...config().interfaces[0]!, name: input.name, kind: "vlan", role: "unassigned",
      vlan: { parent: input.parent, id: input.id }, mtu: 1450, up: false, addresses: ["192.0.2.3/24"],
    } });
    it("sends one strict authenticated POST without a query and preserves captured settings", async () => {
      body = encodeJson(result());
      const controller = new AbortController();
      expect(await net.adoptVlan(input, controller.signal)).toEqual(result());
      expect(captured).toMatchObject({ method: "post", url: "/interfaces/adopt-vlan", signal: controller.signal });
      expect(captured?.params).toBeUndefined();
      expect(decodeJson(String(captured?.data))).toEqual(input);
      expect(captured?.headers.get("Authorization")).toBe("Bearer registry-test-session");
      expect(adapter).toHaveBeenCalledTimes(1);
    });
    it.each([
      {}, { ...input, name: null }, { ...input, parent: "" }, { ...input, name: "lo" },
      { ...input, parent: "." }, { ...input, parent: ".." }, { ...input, name: "éth0" },
      { ...input, name: "x".repeat(16) }, { ...input, name: "bad/name" }, { ...input, name: "bad name" },
      { ...input, name: "eth0" }, { ...input, id: 0 }, { ...input, id: 4095 }, { ...input, id: 1.5 },
      { ...input, id: "30" }, { ...input, extra: true },
    ])("rejects malformed or unknown request fields %j", value => {
      expect(adoptVlanRequestSchema.safeParse(value).success).toBe(false);
      expect(adapter).not.toHaveBeenCalled();
    });
    it("accepts boundary IDs and mixed-case names without rewriting identities", () => {
      for (const id of [1, 4094]) {
        expect(adoptVlanRequestSchema.parse({ name: "Vlan_30.1-test", parent: "Eth0", id }))
          .toEqual({ name: "Vlan_30.1-test", parent: "Eth0", id });
      }
      expect(() => net.adoptVlan({ ...input, id: 0 })).toThrow();
      expect(adapter).not.toHaveBeenCalled();
    });
    it.each([400, 401, 403, 405, 409, 422, 500, 503])("preserves HTTP %i server detail without resubmitting", async code => {
      status = code; body = '{"error":"networkd ownership recovery is pending"}';
      await expect(net.adoptVlan(input)).rejects.toMatchObject({
        status: code, message: `HTTP ${code}: networkd ownership recovery is pending`,
      });
      expect(adapter).toHaveBeenCalledTimes(1);
    });
    it.each(["revision", "name", "kind", "role", "parent", "id"] as const)("rejects an incompatible adoption %s", async field => {
      const response = result();
      if (field === "revision") response.revision = "invalid";
      else if (field === "name") response.interface.name = "different0";
      else if (field === "kind") response.interface.kind = "ethernet";
      else if (field === "role") response.interface.role = "lan";
      else if (field === "parent") response.interface.vlan.parent = "other0";
      else response.interface.vlan.id++;
      body = JSON.stringify(response);
      await expect(net.adoptVlan(input)).rejects.toMatchObject({ incompatible: true, uncertain: true });
      expect(adapter).toHaveBeenCalledTimes(1);
    });
    it("honors the existing mutation guard", async () => {
      onMutationCheck(() => "Path-test restoration owns networking");
      await expect(net.adoptVlan(input)).rejects.toMatchObject({ status: 409 });
      expect(adapter).not.toHaveBeenCalled();
    });
  });
  it("uses bodyless status GET and explicit typed start/cancel POSTs without automatic retries", async () => {
    body = encodeJson(pathTestStatus());
    await net.getPathTests();
    expect(captured?.method).toBe("get"); expect(captured?.url).toBe("/diagnostics/path-tests");
    expect(captured?.data).toBeUndefined(); expect(captured?.params).toBeUndefined();
    status = 202; body = encodeJson(pathTestStatus(true));
    await net.startPathTest(pathTestRequest());
    expect(captured?.method).toBe("post"); expect(captured?.url).toBe("/diagnostics/path-tests");
    expect(decodeJson(String(captured?.data))).toEqual(pathTestRequest());
    status = 200;
    await net.cancelPathTest("a".repeat(32));
    expect(captured?.url).toBe(`/diagnostics/path-tests/${"a".repeat(32)}/cancel`);
    expect(captured?.data).toBeUndefined(); expect(captured?.params).toBeUndefined();
    expect(adapter).toHaveBeenCalledTimes(3);
    expect(() => net.cancelPathTest("protocol-identity")).toThrow("native");
  });
  it("never exposes an echoed pairing secret in a start error and rejects success-shaped idle responses", async () => {
    const secret = pathTestRequest().pairing_secret;
    status = 503; body = encodeJson({ error: `Configured DHCP client prevents stable ownership; rejected ${secret}` });
    const failure = await net.startPathTest(pathTestRequest()).catch(error => error);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure.message).not.toContain(secret);
    expect(failure.message).toContain("Configured DHCP client prevents stable ownership");
    expect(failure.uncertain).toBe(true);
    status = 202; body = encodeJson(pathTestStatus());
    await expect(net.startPathTest(pathTestRequest())).rejects.toMatchObject({ uncertain: true, incompatible: true });
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("blocks all conflicting API writes and scan/save GETs while leaving status and native cancellation available", async () => {
    onMutationCheck(() => "Path-test restoration owns networking");
    await expect(net.refreshInterfaceCapabilities()).rejects.toThrow("restoration");
    await expect(net.uploadMqttPassword("synthetic-test-password")).rejects.toMatchObject({ status: 409 });
    await expect(net.retryDHCP("vlan100")).rejects.toThrow("restoration");
    await expect(net.startPathTest(pathTestRequest())).rejects.toMatchObject({ status: 409 });
    await expect(inspectApiPath("/api/v1/interface-capabilities/refresh")).rejects.toThrow("restoration");
    expect(adapter).not.toHaveBeenCalled();
    body = encodeJson(pathTestStatus(true));
    await net.getPathTests(); await net.cancelPathTest("a".repeat(32));
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("reads RPS prerequisites as a bodyless uncached GET and propagates permissions without retries", async () => {
    const expected = rpsDiagnostics(), controller = new AbortController();
    body = JSON.stringify(expected);
    expect(await net.getRpsDiagnostics(controller.signal)).toEqual(expected);
    expect(captured?.method).toBe("get"); expect(captured?.url).toBe("/statistics/performance");
    expect(captured?.data).toBeUndefined(); expect(captured?.params).toBeUndefined();
    expect(captured?.signal).toBe(controller.signal);
    expect(captured?.fetchOptions).toMatchObject({ cache: "no-store" });
    status = 403; body = '{"error":"state.read required"}';
    await expect(net.getRpsDiagnostics()).rejects.toMatchObject({ status: 403 });
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("preserves complete RPS settings in actual state reads and transaction submissions", async () => {
    const candidate = config();
    candidate.interfaces[0] = { ...candidate.interfaces[0]!, kind: "ethernet" };
    candidate.kernel!.rps = { "lab0/rx-0": "c", "lab0/rx-1": "0" };
    body = encodeJson({ ...state(), desired: candidate, observed: candidate });
    expect((await net.getState()).desired.kernel?.rps).toEqual(candidate.kernel!.rps);
    const pending = { ...transaction(), candidate, previous: candidate };
    body = encodeJson(pending); status = 202;
    expect((await net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 })).candidate.kernel?.rps).toEqual(candidate.kernel!.rps);
    expect(decodeJson(String(captured?.data))).toMatchObject({ config: { kernel: { rps: candidate.kernel!.rps } } });
    const pruned = { ...pending, candidate: { ...candidate, kernel: { ...candidate.kernel!, rps: {} } } };
    body = encodeJson(pruned);
    await expect(net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ uncertain: true, incompatible: true, transaction: { id: pending.id } });
  });
  it("preserves complete RFS and offload settings through state and transaction API boundaries", async () => {
    const candidate = config();
    candidate.kernel!.rfs = { sock_flow_entries: 0, queues: { "lab0/rx-0": 0 } };
    candidate.kernel!.offloads = { lab0: { "rx-checksum": true, "rx-lro": false } };
    body = encodeJson({ ...state(), desired: candidate, observed: candidate });
    expect((await net.getState()).desired.kernel).toEqual(candidate.kernel);
    const pending = { ...transaction(), candidate, previous: candidate };
    body = encodeJson(pending); status = 202;
    expect((await net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 })).candidate.kernel).toEqual(candidate.kernel);
    expect(decodeJson(String(captured?.data))).toMatchObject({ config: { kernel: candidate.kernel } });
  });
  it.each(["rfs", "offloads"] as const)("retains provisional evidence and rejects a successful-looking response that prunes %s", async feature => {
    const candidate = config();
    candidate.kernel!.rfs = { sock_flow_entries: 0, queues: {} };
    candidate.kernel!.offloads = { lab0: { "rx-checksum": false } };
    const pruned = config(); pruned.kernel = { ...candidate.kernel! }; delete pruned.kernel[feature];
    const pending = { ...transaction(), candidate: pruned };
    status = 202; body = encodeJson(pending);
    await expect(net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ uncertain: true, incompatible: true, transaction: { id: pending.id } });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it.each([
    [net.getInterfaceCapabilities, "/interface-capabilities"],
    [net.refreshInterfaceCapabilities, "/interface-capabilities/refresh"],
  ] as const)("reads typed capability snapshots through %s as uncached bodyless GETs", async (read, path) => {
    const snapshot = interfaceCapabilitySnapshot(), controller = new AbortController();
    body = JSON.stringify(snapshot);
    expect(await read(controller.signal)).toEqual(snapshot);
    expect(captured?.method).toBe("get"); expect(captured?.url).toBe(path);
    expect(captured?.data).toBeUndefined(); expect(captured?.params).toBeUndefined();
    expect(captured?.signal).toBe(controller.signal);
    expect(captured?.fetchOptions).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
    await read(controller.signal);
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("accepts a completed null saved snapshot but rejects a null scan result", async () => {
    body = "null";
    expect(await net.getInterfaceCapabilities()).toBeNull();
    await expect(net.refreshInterfaceCapabilities()).rejects.toMatchObject({ incompatible: true });
  });
  it.each([403, 409, 500, 503])("surfaces typed capability failures without retrying HTTP %s", async code => {
    status = code; body = '{"error":"Capability scan failed"}';
    await expect(net.refreshInterfaceCapabilities()).rejects.toMatchObject({ status: code, message: `HTTP ${code}: Capability scan failed` });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it.each(["0", "1", "9007199254740991", "9007199254740993", "18446744073709551615"])("reads exact MQTT uint64 counters %s", async count => {
    body = JSON.stringify({ ...mqttStatus(), connection_attempts: 0, reconnect_count: 0 })
      .replace('"connection_attempts":0', `"connection_attempts":${count}`)
      .replace('"reconnect_count":0', `"reconnect_count":${count}`);
    const controller = new AbortController();
    expect(await net.getMqttStatus(controller.signal)).toEqual({ ...mqttStatus(), connection_attempts: count, reconnect_count: count });
    expect(captured?.method).toBe("get"); expect(captured?.url).toBe("/services/mqtt/status");
    expect(captured?.data).toBeUndefined(); expect(captured?.signal).toBe(controller.signal);
  });
  it.each(["connection_attempts", "reconnect_count"])("rejects malformed or missing MQTT %s without inventing zero", async field => {
    for (const token of ["null", "-1", "1.5", '"3"', "18446744073709551616", "true"]) {
      body = JSON.stringify({ ...mqttStatus(), connection_attempts: 0, reconnect_count: 0 })
        .replace(`"${field}":0`, `"${field}":${token}`);
      await expect(net.getMqttStatus()).rejects.toMatchObject({ incompatible: true });
    }
    const wire: Record<string, unknown> = { ...mqttStatus(), connection_attempts: 0, reconnect_count: 0 };
    delete wire[field]; body = JSON.stringify(wire);
    await expect(net.getMqttStatus()).rejects.toMatchObject({ incompatible: true });
  });
  it("preserves current and historical safe MQTT reasons and nullable OS codes", async () => {
    const failure = { category: "future_transport_issue", message: "MQTT connection reset by peer", os_error_code: null, at_unix: 1792800060 };
    body = JSON.stringify({ ...mqttStatus(), state: "running", connection_attempts: 3, reconnect_count: 2,
      last_connected_at_unix: 1792800000, last_failure: failure });
    expect(await net.getMqttStatus()).toMatchObject({ state: "running", error: null, last_failure: failure, last_connected_at_unix: 1792800000 });
    for (const code of [0, -104, 104]) {
      body = JSON.stringify({ ...mqttStatus(), state: "reconnecting", error: failure.message, connection_attempts: 4, reconnect_count: 3,
        last_failure: { ...failure, os_error_code: code } });
      expect(await net.getMqttStatus()).toMatchObject({ error: failure.message, last_failure: { ...failure, os_error_code: code } });
    }
  });
  it.each([null, -1, 0.1, "1792800060"])("rejects invalid MQTT failure observation time %j", async at_unix => {
    body = JSON.stringify({ ...mqttStatus(), connection_attempts: 0, reconnect_count: 0,
      last_failure: { category: "network", message: "Network unavailable", os_error_code: null, at_unix } });
    await expect(net.getMqttStatus()).rejects.toMatchObject({ incompatible: true });
  });
  it("does not change ordinary JSON numbers that share MQTT counter names", () => {
    expect(decodeJson('{"metadata":{"connection_attempts":3,"reconnect_count":2}}')).toEqual({ metadata: { connection_attempts: 3, reconnect_count: 2 } });
    expect(() => decodeJson('{"connection_attempts":18446744073709551615}')).toThrow("Unsafe numeric value");
  });
  it("keeps denied MQTT status access visible", async () => {
    status = 403; body = '{"error":"state.read required"}';
    await expect(net.getMqttStatus()).rejects.toMatchObject({ status: 403, message: "HTTP 403: state.read required" });
  });
  it("accepts preserved ownership when the backend canonicalizes host group order", async () => {
    const candidate = hostPolicyConfig(), pending = transaction();
    for (const rule of ruleOwnershipEntries(candidate).values()) Object.assign(rule, { origin: "import", import_source: "sando" });
    pending.candidate = normalize(candidate);
    status = 202; body = encodeJson(pending);
    const result = await net.submitPackage({ base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 });
    expect(result.id).toBe(pending.id);
    expect(result.candidate.firewall.policies!.hosts.map(host => host.id)).toEqual(["desk", "phone", "server"]);
    expect(candidate.firewall.policies!.hosts.map(host => host.id)).toEqual(["desk", "server", "phone"]);
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("preserves returned ownership and freezes an accepted write if the backend prunes requested labels", async () => {
    const pending = transaction(), candidate = config();
    Object.assign(candidate.firewall.rules[0]!, { origin: "import", import_source: "sando" });
    pending.candidate = candidate;
    status = 202; body = encodeJson(pending);
    const payload = { base_revision: state().revision, config: candidate, confirm_timeout_seconds: 120 };
    expect((await net.submitPackage(payload)).candidate.firewall.rules[0]).toMatchObject({ origin: "import", import_source: "sando" });
    const pruned = transaction(); pruned.candidate = config(); body = encodeJson(pruned);
    await expect(net.submitPackage(payload)).rejects.toMatchObject({ uncertain: true, incompatible: true, transaction: { id: pruned.id } });
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("reads exact firewall totals without query or body", async () => {
    body = JSON.stringify(firewallCounters());
    const controller = new AbortController();
    expect(await net.getFirewallCounters(controller.signal)).toEqual(firewallCounters());
    expect(captured?.method).toBe("get"); expect(captured?.url).toBe("/statistics/firewall");
    expect(captured?.data).toBeUndefined(); expect(captured?.params).toBeUndefined();
    expect(captured?.signal).toBe(controller.signal);
  });
  it("reads historical drops using the exact exclusive cursor and AND filters", async () => {
    body = JSON.stringify(firewallDenyPage());
    expect(await net.getFirewallDenyLog({ limit: 100, before_id: "18446744073709551614", address: "2001:db8::1", protocol: 0, chain: "input", since_ms: 0, until_ms: 1, include_broadcast: true, include_tcp_closures: false })).toEqual(firewallDenyPage());
    expect(captured?.method).toBe("get"); expect(captured?.data).toBeUndefined();
    const url = new URL(captured!.url!, "https://test.invalid");
    expect(url.pathname).toBe("/firewall/deny-log");
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "100", before_id: "18446744073709551614", address: "2001:db8::1", protocol: "0", chain: "input", since_ms: "0", until_ms: "1", include_broadcast: "true", include_tcp_closures: "false" });
    expect(() => net.getFirewallDenyLog({ protocol: 256 })).toThrow();
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it.each([[false, false], [false, true], [true, false], [true, true]])("serializes each category combination as lowercase boolean strings (%s, %s)", async (broadcast, tcp) => {
    body = JSON.stringify(firewallDenyPage());
    await net.getFirewallDenyLog({ include_broadcast: broadcast, include_tcp_closures: tcp });
    const url = new URL(captured!.url!, "https://test.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      include_broadcast: String(broadcast), include_tcp_closures: String(tcp),
    });
    expect(captured?.method).toBe("get"); expect(captured?.data).toBeUndefined();
  });
  it.each([403, 503])("surfaces telemetry HTTP %s instead of returning measured zeros or empty history", async code => {
    status = code; body = '{"error":"Telemetry unavailable"}';
    await expect(net.getFirewallCounters()).rejects.toMatchObject({ status: code });
    await expect(net.getFirewallDenyLog()).rejects.toMatchObject({ status: code });
  });
  it("deletes only the combined firewall scope with a canonical revision and explicit confirmation", async () => {
    const pending = transaction();
    status = 202; body = encodeJson(pending);
    const request = { base_revision: "2026.10.29.1", confirm_timeout_seconds: 120, confirm: true as const, description: "Clear reviewed firewall hosts and forwarding rules" };
    expect(await net.deleteFirewallHostsAndRules(request)).toEqual(pending);
    expect(captured?.method).toBe("delete");
    expect(captured?.url).toBe("/firewall/hosts-and-rules");
    expect(captured?.params).toBeUndefined();
    expect(decodeJson(String(captured?.data))).toEqual(request);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(() => net.deleteFirewallHostsAndRules({ ...request, base_revision: "79" })).toThrow();
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it("never retries an uncertain bulk firewall deletion", async () => {
    adapter.mockRejectedValueOnce(new AxiosError("timeout", "ETIMEDOUT"));
    await expect(net.deleteFirewallHostsAndRules({
      base_revision: "2026.10.29.1", confirm_timeout_seconds: 120, confirm: true,
    })).rejects.toMatchObject({ uncertain: true });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it("reads vnStat reporting metadata from the host-wide database without rounding counters or converting dates", async () => {
    body = JSON.stringify({ ...vnstatReporting(), interfaces: {}, history: [] });
    const controller = new AbortController();
    expect(await net.getVnStatReporting(controller.signal)).toEqual(vnstatReporting());
    expect(captured?.method).toBe("get"); expect(captured?.url).toBe("/statistics/vnstat");
    expect(captured?.params).toBeUndefined(); expect(captured?.data).toBeUndefined();
    expect(captured?.signal).toBe(controller.signal);
  });
  it.each(["2026-02-30", "2026-10-29T23:59:00Z", "2026-1-2"])("rejects incompatible vnStat calendar date %s", async date => {
    body = JSON.stringify({ ...vnstatReporting(), last_report_date: date });
    await expect(net.getVnStatReporting()).rejects.toMatchObject({ incompatible: true });
  });
  it("does not turn unavailable vnStat reporting into empty measured data", async () => {
    status = 503; body = '{"error":"Native accounting unavailable"}';
    await expect(net.getVnStatReporting()).rejects.toMatchObject({ status: 503 });
  });
  it("requests a software check with an entirely empty POST and no overrides", async () => {
    status = 202; body = '{"status":"check_requested"}';
    const controller = new AbortController();
    expect(await net.checkSoftwareRelease(controller.signal)).toEqual({ status: "check_requested" });
    expect(captured?.method).toBe("post"); expect(captured?.url).toBe("/system/upgrade/check");
    expect(captured?.data).toBeUndefined(); expect(captured?.params).toBeUndefined();
    expect(captured?.signal).toBe(controller.signal);
  });
  it("reads a deployed numeric-revision backend and preserves its transaction wire format", async () => {
    body = JSON.stringify({ ...state(), revision: 79, desired: config() });
    const saved = await net.getState();
    expect(saved.revision).toBe("79");
    expect(saved.desired.software).toBeUndefined();
    const legacy = { ...transaction(), base_revision: "79", committed_revision: undefined };
    body = encodeJson(legacy);
    const pending = await net.submitPackage({ base_revision: saved.revision, config: saved.desired, confirm_timeout_seconds: 120 });
    expect(pending.base_revision).toBe("79"); expect(pending.committed_revision).toBeNull();
    expect(JSON.parse(String(captured?.data))).toEqual({ base_revision: 79, config: config(), confirm_timeout_seconds: 120 });
    body = encodeJson({ revision: "79", current: true, submitted_at: null, committed_at: null, config: config() });
    expect((await net.getRevision("79")).revision).toBe("79");
    expect(captured?.url).toBe("/revisions/79");
    body = encodeJson({ revisions: [], next_before_revision: "78" });
    expect((await net.getRevisions("79")).next_before_revision).toBe("78");
    expect(captured?.url).toBe("/revisions?limit=50&before_revision=79");
  });
  it("explains decoding errors without dumping the saved configuration", async () => {
    body = JSON.stringify({ ...state(), revision: "invalid-revision", desired: { ...config(), operator_note: "do-not-dump-config" } });
    await expect(net.getState()).rejects.toThrow("HTTP 200: non-JSON or incompatible response.");
    await expect(net.getState()).rejects.not.toThrow("do-not-dump-config");
  });
  it("inspects appliance GET responses without schema pruning or loss of precision", async () => {
    body = '{"counter":18446744073709551615,"future_field":true}';
    expect(await inspectApiPath(" /api/v1/services/vnstat/status ")).toEqual({ status: 200, body });
    expect(captured?.url).toBe("/services/vnstat/status");
    expect(captured?.method).toBe("get"); expect(captured?.data).toBeUndefined();
    expect(captured?.headers.get("Authorization")).toBe("Bearer registry-test-session");
    status = 503; body = '{"error":"Retained accounting state requires archival"}';
    expect(await inspectApiPath("/api/v1/statistics/vnstat?limit=10")).toEqual({ status: 503, body });
    expect(captured?.url).toBe("/statistics/vnstat?limit=10");
    status = 502; body = "Upstream unavailable";
    expect(await inspectApiPath("/api/v1/runtime")).toEqual({ status: 502, body });
  });
  it.each(["https://example.com/api/v1/state", "//example.com/api/v1/state", "/api/v1/../session", "/api/v1/%2e%2e/session", "/api/v1/state#fragment", "/api/v1/\\state", "/api/v1//state", "/state", ""])("rejects unsafe API explorer path %s before sending credentials", async path => {
    await expect(inspectApiPath(path)).rejects.toThrow("Enter an appliance path");
    expect(adapter).not.toHaveBeenCalled();
  });
  it.each(["/interface-capabilities", "/interface-capabilities/refresh"])("sends explicit %s requests as uncached GETs without a body or query", async path => {
    body = path.endsWith("/refresh") ? '{"scope":"simulator","inventory":{"status":"simulated"}}' : "null";
    await inspectApiPath(`/api/v1${path}`);
    expect(captured?.method).toBe("get");
    expect(captured?.url).toBe(path);
    expect(captured?.data).toBeUndefined();
    expect(captured?.params).toBeUndefined();
    expect(captured?.fetchOptions).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
    await inspectApiPath(`/api/v1${path}`);
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it.each([...Array.from({ length: 32 }, (_, code) => code), 127])("rejects API explorer query control character %i before sending credentials", async code => {
    await expect(inspectApiPath(`/api/v1/state?filter=a${String.fromCharCode(code)}b`)).rejects.toThrow("Enter an appliance path");
    expect(adapter).not.toHaveBeenCalled();
  });
  it("preserves DNAT and BGP in actual API reads and reads BGP status/routes separately", async () => {
    const candidate = bgpConfig(); candidate.firewall.nat.destination_rewrite = [dnatRule()];
    body = encodeJson({ ...state(), desired: candidate, observed: candidate });
    expect((await net.getState()).desired).toEqual(candidate);
    body = encodeJson(candidate.bgp);
    expect(await net.getBGPConfig()).toEqual(candidate.bgp);
    expect(captured?.url).toBe("/services/bgp");
    body = encodeJson(bgpStatus());
    expect(await net.getBGPStatus()).toEqual(bgpStatus());
    expect(captured?.url).toBe("/services/bgp/status");
    body = encodeJson(bgpRoutes());
    expect(await net.getBGPRoutes()).toEqual(bgpRoutes());
    expect(captured?.url).toBe("/routes/bgp");
    expect(captured?.method).toBe("get"); expect(captured?.data).toBeUndefined();
    status = 503; body = encodeJson({ error: "Worker unavailable" });
    await expect(net.getBGPStatus()).rejects.toThrow("HTTP 503");
  });
  it("reads advertised paths through the separate bodyless and queryless endpoint", async () => {
    body = encodeJson(bgpAdvertisedRoutes());
    expect(await net.getBGPAdvertisedRoutes()).toEqual(bgpAdvertisedRoutes());
    expect(captured?.url).toBe("/routes/bgp/advertised");
    expect(captured?.method).toBe("get"); expect(captured?.data).toBeUndefined();
    expect(captured?.params).toBeUndefined();
    status = 404; body = encodeJson({ error: "Unknown endpoint" });
    await expect(net.getBGPAdvertisedRoutes()).rejects.toThrow("HTTP 404");
  });
  it("uses the operational POST contracts without revisions or extra request fields", async () => {
    body = encodeJson(dnsResponse("lab0"));
    const lookup = await net.lookupDNS({ interface: "lab0", hostname: "Example.TEST." });
    expect(captured?.method).toBe("post"); expect(captured?.url).toBe("/diagnostics/dns-lookup");
    expect(decodeJson(String(captured?.data))).toEqual({ interface: "lab0", hostname: "example.test", record_type: "A", timeout_ms: 2000 });
    expect(lookup.revision).toBe("2026.10.29.4294967294"); expect(lookup.rtt_ms).toBe(12.5);
    status = 202; body = encodeJson({ target: "mqtt", status: "restart_requested", generation: 1 });
    expect((await net.restartProcess("mqtt")).status).toBe("restart_requested");
    expect(captured?.url).toBe("/processes/restart"); expect(decodeJson(String(captured?.data))).toEqual({ target: "mqtt" });
    body = encodeJson({ target: "ntp", status: "restarted", worker: {} });
    await expect(net.restartProcess("mqtt")).rejects.toThrow("target differs");
  });
  it("reads exact link diagnostics and reports unsupported endpoints without empty success fallbacks", async () => {
    body = encodeJson(linkDiagnostics());
    const result = await net.getLinkDiagnostics();
    expect(captured?.method).toBe("get"); expect(captured?.url).toBe("/statistics/link-diagnostics");
    expect(captured?.data).toBeUndefined(); expect(result.interfaces![0]!.drops).toBe("18446744073709551615");
    status = 404; body = encodeJson({ error: "Unknown endpoint" });
    await expect(net.getLinkDiagnostics()).rejects.toThrow("HTTP 404");
  });
  it("targets a specific DNS server and rejects fallback resolver results", async () => {
    body = encodeJson(dnsResponse("lab0"));
    await net.lookupDNS({ interface: "lab0", hostname: "example.test", server: "192.0.2.53" });
    expect(decodeJson(String(captured?.data))).toEqual({ interface: "lab0", hostname: "example.test", server: "192.0.2.53", record_type: "A", timeout_ms: 2000 });
    await expect(net.lookupDNS({ interface: "lab0", hostname: "example.test", server: "1.1.1.1" })).rejects.toThrow("resolver differs");
    body = encodeJson({ ...dnsResponse(), attempts: [{ ...dnsResponse().attempts[0], server: "1.1.1.1" }] });
    await expect(net.lookupDNS({ interface: "lab0", hostname: "example.test", server: "192.0.2.53" })).rejects.toThrow("resolver differs");
    status = 400; body = encodeJson({ error: "Unknown field: server" });
    await expect(net.lookupDNS({ interface: "lab0", hostname: "example.test", server: "192.0.2.53" })).rejects.toThrow("HTTP 400");
  });
  it("omits interface for kernel-routed per-server lookups and preserves the null response interface", async () => {
    body = encodeJson(dnsResponse());
    const result = await net.lookupDNS({ server: "192.0.2.53", hostname: "example.test" });
    expect(decodeJson(String(captured?.data))).toEqual({ server: "192.0.2.53", hostname: "example.test", record_type: "A", timeout_ms: 2000 });
    expect(result.interface).toBeNull();
    status = 503; body = encodeJson({ error: "IPv6 DNS server requires global IPv6 to be enabled" });
    await expect(net.lookupDNS({ server: "2001:db8::53", hostname: "example.test" })).rejects.toThrow("requires global IPv6");
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("preserves explicit null request fields for automatic routing and configured-resolver selection", async () => {
    body = encodeJson(dnsResponse());
    expect((await net.lookupDNS({ interface: null, server: "192.0.2.53", hostname: "example.test" })).interface).toBeNull();
    expect(decodeJson(String(captured?.data))).toEqual({ interface: null, server: "192.0.2.53", hostname: "example.test", record_type: "A", timeout_ms: 2000 });
    body = encodeJson(dnsResponse("lab0"));
    expect((await net.lookupDNS({ interface: "lab0", server: null, hostname: "example.test" })).interface).toBe("lab0");
    expect(decodeJson(String(captured?.data))).toEqual({ interface: "lab0", server: null, hostname: "example.test", record_type: "A", timeout_ms: 2000 });
  });
  it("retains a failed kernel-routed exchange and its single attempt without fallback", async () => {
    body = encodeJson({ ...dnsResponse(), status: "failed", server: null, transport: null, rcode: null, addresses: [], rtt_ms: null,
      attempts: [{ server: "192.0.2.53", status: "failed", rtt_ms: null, error: "No route to DNS server" }],
    });
    const result = await net.lookupDNS({ server: "192.0.2.53", hostname: "example.test" });
    expect(result).toMatchObject({ interface: null, status: "failed", rtt_ms: null, attempts: [{ error: "No route to DNS server" }] });
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("downloads only committed config and surfaces archive failures without exporting an empty fallback", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:committed"), revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const filenames: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const committed = config();
      body = encodeJson({ revision: "2026.10.29.4294967295", current: true, submitted_at: null, committed_at: null, config: committed });
      const download = useConfigExport();
      await download.downloadCommittedConfig();
      expect(filenames).toEqual(["netcontrol-config-r2026.10.29.4294967295.json"]);
      expect(confirm).not.toHaveBeenCalled();
      const blob = createObjectURL.mock.calls[0]![0] as unknown as Blob;
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob);
      });
      expect(JSON.parse(text)).toEqual(committed);
      status = 503; body = encodeJson({ error: "Archive unavailable", transaction: null });
      await download.downloadCommittedConfig();
      expect(download.exportError.value).toContain("Archive unavailable");
      expect(download.downloading.value).toBe(false);
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(adapter).toHaveBeenCalledTimes(2);
    } finally {
      await vi.runOnlyPendingTimersAsync(); vi.useRealTimers();
      click.mockRestore(); confirm.mockRestore(); vi.unstubAllGlobals();
    }
  });
  it("reads the latest committed date revision in one request", async () => {
    body = encodeJson({ revision: "2026.10.29.4294967295", current: true, submitted_at: null, committed_at: null, config: config() });
    const revision = await net.getLatestRevision();
    expect(revision.revision).toBe("2026.10.29.4294967295");
    expect(revision.config).toEqual(config());
    expect(captured?.url).toBe("/revisions/latest");
    expect(captured?.method).toBe("get"); expect(captured?.data).toBeUndefined();
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("reads mDNS config/status without queries and sends bodyless repair, preserving heterogeneous runtime counters", async () => {
    const mdns = mdnsSchema.parse({ metadata: { display_name: "Discovery", description: "Preserved" } });
    body = encodeJson(mdns);
    expect(await net.getMDNSConfig()).toEqual(mdns); expect(captured?.url).toBe("/services/mdns"); expect(captured?.data).toBeUndefined();
    const row = mdnsStatus();
    body = encodeJson({ instances: [row], error: "" });
    expect((await net.getMDNSStatus()).instances[0]).toEqual(row); expect(captured?.url).toBe("/services/mdns/status");
    body = encodeJson({ ...runtime(), appliance_services: [...runtime().appliance_services, row] });
    expect((await net.reconcileServices("mdns")).appliance_services.at(-1)).toEqual(row);
    expect(captured?.url).toBe("/services/mdns/reconcile"); expect(captured?.method).toBe("post"); expect(captured?.data).toBeUndefined();
  });
  it.each([401, 403, 409, 422, 503])("surfaces mDNS status/repair HTTP %s without retries", async code => {
    status = code; body = encodeJson({ error: "mDNS operation rejected", transaction: null });
    await expect(net.getMDNSStatus()).rejects.toMatchObject({ status: code });
    await expect(net.reconcileServices("mdns")).rejects.toMatchObject({ status: code, uncertain: code >= 500 });
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("does not decode malformed mDNS runtime rows as generic appliance services", async () => {
    body = encodeJson({ ...runtime(), appliance_services: [{ ...mdnsStatus(), received_packets: 42 }] });
    await expect(net.getRuntime()).rejects.toMatchObject({ incompatible: true });
  });
  it("preserves mDNS through complete package submission including ignored-field warnings", async () => {
    const candidate = config();
    candidate.mdns = mdnsSchema.parse({ enabled: false, interfaces: ["lan0"], metadata: { display_name: "Discovery", description: "Disabled preferences" } });
    body = encodeJson({ ...transaction(), candidate, ignored_fields: ["/config/mdns/future_option"] }); status = 202;
    const result = await net.submitPackage({ base_revision: "2026.10.29.1", config: candidate, confirm_timeout_seconds: 120 });
    expect(result.candidate.mdns).toEqual(candidate.mdns);
    expect(result.ignored_fields).toEqual(["/config/mdns/future_option"]);
    expect(decodeJson(String(captured?.data))).toMatchObject({ config: { mdns: candidate.mdns } });
  });
  it("tolerates unknown response keys, keeping unknown config sections intact for later submits", async () => {
    const pending = { ...transaction(), future_field: true, candidate: { ...config(), future_section: { enabled: true } }, previous: config() };
    pending.candidate.routes = [{ ...pending.candidate.routes[0]!, future_route_option: 1 }] as never;
    body = encodeJson({ [pending.id]: pending });
    const result = (await net.getTransactions())[pending.id]!;
    expect(result).not.toHaveProperty("future_field");
    expect(result.candidate).toHaveProperty("future_section", { enabled: true });
    expect(result.candidate.routes[0]).not.toHaveProperty("future_route_option");
    body = encodeJson({ ...runtime(), future_runtime: [] });
    expect((await net.getRuntime()).parent_interfaces).toEqual([]);
  });
  it("accepts ignored_fields on submit and preserves Dynamic DNS settings with their own write permission", async () => {
    const candidate = config();
    candidate.dynamic_dns = [{ name: "azure-wan", enabled: true, source_interface: "lab0", address_source: "public_ip", tenant_id: "11111111-1111-4111-8111-111111111111",
      client_id: "22222222-2222-4222-8222-222222222222", secret_ref: "a".repeat(32), zone_resource_id: "/subscriptions/x/dnszones/example.com", record_name: "home", ttl_seconds: 300, interval_seconds: 60 }];
    status = 202; body = encodeJson({ ...transaction(), candidate, ignored_fields: ["/config/future_option"] });
    const result = await net.submitPackage({ base_revision: "2026.10.29.1", config: candidate, confirm_timeout_seconds: 120 });
    expect(result.ignored_fields).toEqual(["/config/future_option"]); expect(result.candidate.dynamic_dns).toEqual(candidate.dynamic_dns);
    expect(requiredPermissions(differences(config(), candidate))).toEqual(["transactions.write", "dynamic_dns.write"]);
  });
  it("uploads MQTT passwords once and returns only the immutable reference", async () => {
    status = 201; body = encodeJson({ password_ref: "a".repeat(32) });
    expect(await net.uploadMqttPassword("synthetic-password")).toEqual({ password_ref: "a".repeat(32) });
    expect(captured?.url).toBe("/services/mqtt/passwords");
    expect(decodeJson(String(captured?.data))).toEqual({ password: "synthetic-password" });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it("never exposes echoed password text or automatically retries upload failures", async () => {
    status = 503; body = encodeJson({ error: "synthetic-password exposed by backend", transaction: null });
    await expect(net.uploadMqttPassword("synthetic-password")).rejects.toThrow("Password storage failed (HTTP 503)");
    expect(adapter).toHaveBeenCalledTimes(1);
    adapter.mockRejectedValueOnce(new AxiosError("synthetic-password", "ETIMEDOUT"));
    await expect(net.uploadMqttPassword("synthetic-password")).rejects.toThrow("Password upload outcome is unknown");
    expect(adapter).toHaveBeenCalledTimes(2);
    await expect(net.uploadMqttPassword("\0")).rejects.toThrow("without NUL");
    expect(adapter).toHaveBeenCalledTimes(2);
  });
  it("preserves DHCP monitor variants through full state, transaction reads and package writes without lease pins", async () => {
    const candidate = config();
    candidate.interfaces[0]!.kind = "ethernet"; candidate.interfaces[0]!.addresses = []; candidate.routes = [];
    candidate.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    candidate.gateway_monitors = [gatewayMonitorSchema.parse({ name: "wan-health", enabled: true, mode: "dhcp", interface: "lab0", target: "1.1.1.1" })];
    const pending = { ...transaction(), candidate, previous: candidate };
    body = encodeJson({ ...state(), desired: candidate, active_transaction: pending });
    expect((await net.getState()).active_transaction?.candidate).toEqual(candidate);
    body = encodeJson({ [pending.id]: pending });
    expect((await net.getTransactions())[pending.id]?.previous.gateway_monitors).toEqual(candidate.gateway_monitors);
    body = encodeJson(pending);
    expect((await net.submitPackage({ base_revision: "2026.10.29.1", config: candidate, confirm_timeout_seconds: 120 })).candidate).toEqual(candidate);
    const sent = decodeJson(String(captured?.data)) as { config: { gateway_monitors: unknown[] } };
    expect(sent.config.gateway_monitors).toEqual(candidate.gateway_monitors);
    for (const key of ["source_address", "gateway", "routing_table"]) expect(sent.config.gateway_monitors[0]).not.toHaveProperty(key);
  });
  it("deletes only a complete projected connection identity and never falls back to a flush", async () => {
    const row = connections().connections[0]!;
    row.id = "123"; row.zone = 0; row.original.zone = null; row.reply.zone = null;
    body = encodeJson({ status: "deleted", scope: "host" });
    await net.deleteConnection(row);
    expect(captured?.url).toBe("/connections/123"); expect(captured?.method).toBe("delete");
    expect(decodeJson(String(captured?.data))).toEqual({ family: row.family, protocol: row.protocol, zone: row.zone, original: row.original });
    expect(net.connectionSelector({ ...row, id: null })).toBeNull();
    expect(net.connectionSelector({ ...row, id: "01" })).toBeNull();
    expect(net.connectionSelector({ ...row, protocol: 255 })).toBeNull();
    expect(() => net.deleteConnection({ ...row, id: null })).toThrow("complete deletion identity");
    expect(adapter).toHaveBeenCalledTimes(1);
    body = encodeJson({ status: "flushed", scope: "host" }); await net.deleteAllConnections();
    expect(captured?.url).toBe("/connections"); expect(decodeJson(String(captured?.data))).toEqual({ confirm: true });
  });
  it("treats uncertain DELETE outcomes as writes without retrying", async () => {
    adapter.mockRejectedValueOnce(new AxiosError("timeout", "ETIMEDOUT"));
    await expect(net.deleteAllConnections()).rejects.toMatchObject({ uncertain: true });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
  it("reads disabled self-upgrade setup and submits only an explicit canonical version", async () => {
    body = encodeJson({ enabled: false, repository: null, job: null, last_successful_version: null });
    expect((await net.getSystemUpgrade()).enabled).toBe(false);
    status = 202;
    body = encodeJson({ id: "upgrade-1", version: "2026.10.29.2", status: "queued", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", error: null, last_successful_version: null });
    const accepted = await net.startSystemUpgrade("2026.10.29.2"); expect(accepted.id).toBe("upgrade-1");
    expect(captured?.url).toBe("/system/upgrade"); expect(decodeJson(String(captured?.data))).toEqual({ version: "2026.10.29.2" });
    for (const version of ["v1.2.3", "01.2.3", "1.2.3+build", "1.2.3-01", "https://example.test"]) expect(upgradeVersionSchema.safeParse(version).success).toBe(false);
    expect(upgradeVersionSchema.safeParse("1.2.3-rc.1").success).toBe(false);
    expect(upgradeVersionSchema.safeParse("2026.10.29.10").success).toBe(true);
    body = encodeJson({ ...accepted, version: "2.0.0" });
    await expect(net.startSystemUpgrade("2026.10.29.2")).rejects.toMatchObject({ uncertain: true, incompatible: true });
  });
  it("reads filtered connection snapshots with exact nullable counters and strict schema", async () => {
    body = encodeJson(connections());
    const result = await net.getConnections({ address: "2001:db8::1", protocol: "tcp", port: 0, zone: 0, limit: 100, offset: 0 });
    expect(captured?.method).toBe("get"); expect(captured?.data).toBeUndefined();
    expect(captured?.url).toBe("/statistics/connections?address=2001%3Adb8%3A%3A1&protocol=tcp&port=0&zone=0&limit=100&offset=0");
    expect(result.connections[0]!.original_counters?.bytes).toBe("18446744073709551615");
    expect(result.connections[0]!.reply_counters).toBeNull();
    body = encodeJson({ ...connections(), schema: "unsupported" });
    await expect(net.getConnections()).rejects.toThrow("Incompatible API response");
  });
  it("retries one DHCP interface with a bodyless POST and strict accepted response", async () => {
    status = 202; body = encodeJson({ interface: "wan.10", status: "retrying" });
    expect(await net.retryDHCP("wan.10")).toEqual({ interface: "wan.10", status: "retrying" });
    expect(captured?.url).toBe("/interfaces/wan.10/dhcp/retry");
    expect(captured?.method).toBe("post"); expect(captured?.data).toBeUndefined();
    body = encodeJson({ interface: "wan.10", status: "leased" });
    await expect(net.retryDHCP("wan.10")).rejects.toThrow("Incompatible API response");
  });
  it("reads backend input policies in transaction maps and full state", async () => {
    const pending = transaction(), current = state();
    pending.candidate.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ action: "accept" }] }] };
    body = encodeJson({ [pending.id]: pending });
    expect((await net.getTransactions())[pending.id]?.candidate.firewall.input).toEqual(pending.candidate.firewall.input);
    current.desired.firewall.input = pending.candidate.firewall.input;
    current.active_transaction = pending;
    body = encodeJson(current);
    expect((await net.getState()).active_transaction?.candidate.firewall.input).toEqual(pending.candidate.firewall.input);
  });
  it("preserves host-input and forwarding policies in full-package submissions", async () => {
    const candidate = config(); candidate.firewall.rules = [];
    candidate.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ protocol: "udp", destination_ports: [68], action: "accept" }] }] };
    candidate.firewall.policies = { hosts: [], interfaces: [{ interface: "lab0", rules: [{ out_interface: "lab0", action: "accept" }] }] };
    const pending = transaction(); pending.candidate = candidate; body = encodeJson(pending);
    const result = await net.submitPackage({ base_revision: "2026.10.29.1", config: candidate, confirm_timeout_seconds: 120 });
    expect(decodeJson(String(captured?.data))).toMatchObject({ config: { firewall: candidate.firewall } });
    expect(result.candidate.firewall).toEqual(candidate.firewall);
  });
  it("reads discovered NICs without converting null simulator identity or hiding errors", async () => {
    const inventory = [{ name: "eth0", kind: "ethernet", index: null, mac: null, mtu: 1500, up: true, addresses: [], ownership: "unmanaged", role: null, addressing_type: null }];
    body = encodeJson(inventory);
    expect(await net.getDiscoveredInterfaces()).toEqual(inventory);
    expect(captured?.url).toBe("/interfaces/discovered");
    expect(captured?.method).toBe("get");
    body = "null";
    await expect(net.getDiscoveredInterfaces()).rejects.toThrow(/Incompatible API response/);
  });
  it("preserves fixed loopback discovery metadata independently of names, addresses and link state", async () => {
    const inventory = [{ name: "kernel0", kind: "loopback", index: 1, mac: null, mtu: 65536, up: false, addresses: [], ownership: "loopback", role: "loopback", addressing_type: "static" }];
    body = encodeJson(inventory);
    expect(await net.getDiscoveredInterfaces()).toEqual(inventory);
  });
  it.each([
    ["role", undefined], ["addressing_type", undefined],
    ["role", "wan"], ["addressing_type", "dhcp"],
  ])("rejects invalid discovery metadata %s=%s explicitly", async (field, value) => {
    body = encodeJson([{ name: "eth0", kind: "ethernet", index: 2, mac: null, mtu: 1500, up: true, addresses: [], ownership: "unmanaged", role: null, addressing_type: null, [String(field)]: value }]);
    await expect(net.getDiscoveredInterfaces()).rejects.toThrow(/Incompatible API response/);
  });
  it("targets the selected device through the registry with no cache/cookies or redirects", () => {
    expect(api.defaults.baseURL).toBe(`${registryApiBaseUrl}/devices/${deviceId}/proxy`);
    expect(api.defaults.timeout).toBe(80_000);
    expect(api.defaults.fetchOptions).toEqual({ redirect: "error", credentials: "omit", cache: "no-store" });
  });
  it("selects only a saved device ID and restores the registry base when disconnected", () => {
    const otherId = "22222222-2222-4222-8222-222222222222";
    setApiDevice(otherId);
    expect(api.defaults.baseURL).toBe(`${registryApiBaseUrl}/devices/${otherId}/proxy`);
    expect(() => setApiDevice("https://device.example")).toThrow(/saved firewall/);
    setApiDevice("");
    expect(api.defaults.baseURL).toBe(registryApiBaseUrl);
  });
  it("sends the registry session without persisting a firewall key or leaking tokens in URLs", async () => {
    body = encodeJson(state());
    await net.getState();
    expect(captured?.headers.Authorization).toBe("Bearer registry-test-session");
    expect(captured?.url).toBe("/state");
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    expect(location.href).not.toContain("registry-test-session");
    expect(JSON.stringify(config())).not.toContain("registry-test-session");
  });
  it.each([
    ["state", "/state"], ["runtime", "/runtime"], ["transactions", "/transactions"], ["statistics", "/statistics"],
  ])("reads the exact %s endpoint", async (resource, path) => {
    const actions = {
      state: () => net.getState(), runtime: () => net.getRuntime(), transactions: () => net.getTransactions(), statistics: () => net.getStatistics(),
    };
    const data = { state: state(), runtime: runtime(), transactions: { "tx-test": transaction() }, statistics: statistics() };
    if (!(resource in actions)) throw new Error("Unknown test resource");
    const key = resource as keyof typeof actions;
    body = encodeJson(data[key]); await actions[key]();
    expect(captured?.url).toBe(path); expect(captured?.method).toBe("get");
  });
  it("serializes the exact base revision as a JSON string and preserves editable config", async () => {
    body = encodeJson(transaction());
    const configValue = config();
    await net.submitPackage({ base_revision: "2026.10.29.4294967295", confirm_timeout_seconds: 120, config: configValue });
    expect(captured?.url).toBe("/transactions"); expect(captured?.method).toBe("post");
    expect(captured?.timeout).toBe(90_000);
    expect(captured?.data).toContain('"base_revision":"2026.10.29.4294967295"');
    expect(captured?.data).toContain('"kernel"');
    expect(captured?.headers["Content-Type"]).toBe("application/json");
  });
  it("omits daemon-managed software from a submitted configuration", async () => {
    body = encodeJson(transaction());
    await net.submitPackage({ base_revision: state().revision, config: state().desired, confirm_timeout_seconds: 120 });
    expect(decodeJson(String(captured?.data))).toEqual({
      base_revision: state().revision, config: config(), confirm_timeout_seconds: 120,
    });
    expect(state().desired).toHaveProperty("software");
  });
  it.each(["confirm", "rollback"] as const)("uses a bodyless encoded %s POST", async action => {
    body = encodeJson(transaction());
    if (action === "confirm") await net.confirmTransaction("tx /1"); else await net.rollbackTransaction("tx /1");
    expect(captured?.url).toBe(`/transactions/tx%20%2F1/${action}`);
    expect(captured?.data).toBeUndefined();
  });
  it("uses the date revision restore endpoint, not a package submit", async () => {
    body = encodeJson(transaction());
    await net.restoreRevision("2026.10.29.1", { base_revision: "2026.10.29.1", confirm_timeout_seconds: 120 });
    expect(captured?.url).toBe("/revisions/2026.10.29.1/restore"); expect(captured?.data).not.toContain('"config"');
  });
  it("reconciles services bodylessly", async () => {
    body = encodeJson(runtime()); await net.reconcileServices();
    expect(captured?.url).toBe("/services/softflowd/reconcile"); expect(captured?.data).toBeUndefined();
  });
  it("reads relay status with visible top-level and per-interface errors", async () => {
    body = encodeJson({ interfaces: [{ interface: "lab0", state: "unavailable", error: "binary unavailable" }], error: "relay runtime failed" });
    const result = await net.getDHCPRelayStatus();
    expect(captured?.url).toBe("/services/dhcp-relay/status");
    expect(result.error).toBe("relay runtime failed");
    expect(result.interfaces[0]?.error).toBe("binary unavailable");
  });
  it("repairs relay via the bodyless relay endpoint and decodes shared runtime", async () => {
    body = encodeJson(runtime());
    const result = await net.reconcileServices("dhcp-relay");
    expect(captured?.url).toBe("/services/dhcp-relay/reconcile");
    expect(captured?.data).toBeUndefined();
    expect(result.dhcp_relay[0]?.state).toBe("disabled");
  });
  it.each([400, 403, 422])("surfaces HTTP %s without replay or uncertain-success fallback", async code => {
    status = code; body = '{"error":"role or relay rejected","transaction":null}';
    await expect(net.submitPackage({ base_revision: "2026.10.29.1", config: config(), confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ status: code, uncertain: false });
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("uses the supplied exact history cursor", async () => {
    body = '{"revisions":[],"next_before_revision":"2026.10.29.4294967294"}';
    const page = await net.getRevisions("2026.10.29.4294967295");
    expect(captured?.url).toBe("/revisions?limit=50&before_revision=2026.10.29.4294967295");
    expect(page.next_before_revision).toBe("2026.10.29.4294967294");
  });
  it("reads independent fractional gateway measurements with no query", async () => {
    body = encodeJson({ sample: statistics().sample, monitors: [gatewayStatistics()] });
    const data = await net.getGatewayStatistics();
    expect(captured?.url).toBe("/statistics/gateways");
    expect(data.monitors[0]?.rtt_avg_ms).toBe(1.25);
    body = encodeJson({ sample: statistics().sample, monitor: gatewayStatistics() });
    await net.getGatewayStatistic("a /b");
    expect(captured?.url).toBe("/statistics/gateways/a%20%2Fb");
  });
  it.each(["ntp", "syslog", "vnstat"] as const)("reads %s metadata/status and repairs bodylessly", async service => {
    body = encodeJson(config()[service]);
    await net.getApplianceConfig(service); expect(captured?.url).toBe(`/services/${service}`);
    body = encodeJson({ instances: runtime().appliance_services, error: "partial" });
    expect((await net.getApplianceStatus(service)).error).toBe("partial");
    expect(captured?.url).toBe(`/services/${service}/status`);
    body = encodeJson(runtime()); await net.reconcileServices(service);
    expect(captured?.url).toBe(`/services/${service}/reconcile`); expect(captured?.data).toBeUndefined();
  });
  it("surfaces unknown gateway 404 without manufacturing an empty successful sample", async () => {
    status = 404; body = '{"error":"gateway monitor not found","transaction":null}';
    await expect(net.getGatewayStatistic("missing")).rejects.toMatchObject({ status: 404 });
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("stops on non-JSON registry 401 and bounds/sanitizes diagnostics", async () => {
    const unauthorized = vi.fn(() => setRegistrySessionToken("")); onUnauthorized(unauthorized);
    responseHeaders = new AxiosHeaders({ "X-Registry-Auth-Error": "true" });
    status = 401; body = `<h1>registry-test-session</h1>${"x".repeat(6000)}`;
    await expect(net.getState()).rejects.toThrow("HTTP 401");
    expect(unauthorized).toHaveBeenCalledOnce();
    try { await net.getState(); } catch (failure) {
      expect(String(failure)).not.toContain("registry-test-session"); expect(String(failure).length).toBeLessThan(4300);
      expect(String(failure)).not.toContain("<h1>");
    }
  });
  it("does not treat a firewall 401 as an expired registry session", async () => {
    const unauthorized = vi.fn(); onUnauthorized(unauthorized);
    status = 401; body = '{"error":"Invalid device key","transaction":null}';
    await expect(net.getState()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).not.toHaveBeenCalled();
  });
  it("retains a transaction on operational failure", async () => {
    status = 500; body = encodeJson({ error: "recovery detail", transaction: transaction("recovery_failed") });
    await expect(net.submitPackage({ base_revision: "2026.10.29.1", config: config(), confirm_timeout_seconds: 120 }))
      .rejects.toMatchObject({ status: 500, uncertain: true, transaction: { status: "recovery_failed" } });
  });
  it.each(["rolled_back", "recovery_failed"])("preserves long structured apply causes and %s outcome without exposing the session credential", async outcome => {
    const cause = `apply failed: ${"nested cause: ".repeat(500)}registry-test-session: gateway probes require explicit allow_gateway_monitoring opt-in; rollback detail retained`;
    const failed = { ...transaction(outcome), error: cause };
    status = 500; body = encodeJson({ error: cause, transaction: failed });
    try {
      await net.submitPackage({ base_revision: "2026.10.29.1", config: config(), confirm_timeout_seconds: 120 });
      expect.fail("Expected the backend apply error");
    } catch (failure) {
      expect(failure).toBeInstanceOf(ApiFailure);
      const error = failure as ApiFailure;
      expect(error.message.length).toBeGreaterThan(4096);
      expect(error.message).toContain("gateway probes require explicit allow_gateway_monitoring opt-in; rollback detail retained");
      expect(error.message).toContain("[redacted]"); expect(error.message).not.toContain("registry-test-session");
      expect(error.transaction).toMatchObject({ id: failed.id, status: outcome, error: cause.replace("registry-test-session", "[redacted]") });
      expect(error.transaction?.error).not.toContain("registry-test-session");
      expect(error.uncertain).toBe(true); expect(adapter).toHaveBeenCalledOnce();
    }
  });
  it("reads cached platform health and preserves unknown alert codes in state and runtime", async () => {
    const snapshot = {
      process_health: { status: "unknown", healthy: null, collected_at: null, stale: true, components: [] },
      active_alerts: [{ id: "future:condition", component: "future", resource: null, severity: "warning", code: "future_condition", message: "Condition reported", retrying: false, first_seen_at: null, last_seen_at: null }],
    };
    body = encodeJson(snapshot);
    expect(await net.getPlatformStatus()).toEqual(snapshot);
    expect(captured?.url).toBe("/platform/status"); expect(captured?.method).toBe("get"); expect(captured?.data).toBeUndefined();
    body = encodeJson({ ...state(), ...snapshot });
    expect((await net.getState()).active_alerts).toEqual(snapshot.active_alerts);
    body = encodeJson({ ...runtime(), ...snapshot });
    expect((await net.getRuntime()).process_health).toEqual(snapshot.process_health);
  });
  it("retains optional service recovery and syslog delivery status fields", async () => {
    body = encodeJson({ ...runtime(), appliance_services: [{
      name: "syslog", scope: "host", state: "running", retrying: false,
      restart_count: 2, last_error: "Collector disconnected", destination_errors: ["collector.example: unavailable"],
      captured_records: 20, forwarded_records: 10, failed_deliveries: 10,
    }, { ...mdnsStatus(), retrying: true, restart_count: 1, last_error: "Link down" }],
    softflowd: [{ name: "capture", state: "error", retrying: true, restart_count: 1, last_error: "Link down" }],
    dhcp_relay: [{ interface: "lab0", state: "error", retrying: true, restart_count: 1, last_error: "Link down" }],
    gateway_monitors: [{ ...gatewayStatistics(), retrying: true, restart_count: 1, last_error: "Link down" }],
    });
    const result = await net.getRuntime();
    expect(result.appliance_services[0]).toMatchObject({
      retrying: false, restart_count: 2, last_error: "Collector disconnected",
      destination_errors: ["collector.example: unavailable"], captured_records: 20, forwarded_records: 10, failed_deliveries: 10,
    });
    expect(result.softflowd[0]).toMatchObject({ retrying: true, restart_count: 1, last_error: "Link down" });
    for (const worker of [result.appliance_services[1], result.dhcp_relay[0], result.gateway_monitors[0]]) {
      expect(worker).toMatchObject({ retrying: true, restart_count: 1, last_error: "Link down" });
    }
    body = encodeJson({ instances: [{ ...mdnsStatus(), retrying: true, restart_count: 1, last_error: "Link down" }], error: "" });
    expect((await net.getMDNSStatus()).instances[0]).toMatchObject({ retrying: true, restart_count: 1, last_error: "Link down" });
  });
  it("reads valid configuration without requiring healthy or compatible observation diagnostics", async () => {
    body = encodeJson({ revision: "2026.10.29.1", desired: config(), active_transaction: { error: "observation unavailable" }, service_health: "failed" });
    const result = await net.getState();
    expect(result.desired).toEqual(config());
    expect(result.revision).toBe("2026.10.29.1");
    expect(result.active_transaction).toBeUndefined();
  });
  it("rejects malformed successful response visibly rather than inventing empty state", async () => {
    body = '{"revision":0,"desired":{}}';
    await expect(net.getState()).rejects.toMatchObject({ incompatible: true });
  });
  it("does not retry a failed POST and marks unknown outcome", async () => {
    adapter.mockRejectedValueOnce(new AxiosError("offline", "ERR_NETWORK"));
    await expect(net.confirmTransaction("one")).rejects.toMatchObject({ uncertain: true });
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("measures complete UTF-8 request before sending", async () => {
    await expect(request("POST", "/transactions", z.unknown(), { text: "é".repeat(524288) })).rejects.toBeInstanceOf(ApiFailure);
    expect(adapter).not.toHaveBeenCalled();
  });
  it("accepts exactly 1 MiB and rejects a request one byte larger", async () => {
    body = '{"ok":true}';
    await request("POST", "/boundary", z.object({ ok: z.boolean() }), { text: "x".repeat(1_048_565) });
    expect(adapter).toHaveBeenCalledOnce();
    await expect(request("POST", "/boundary", z.unknown(), { text: "x".repeat(1_048_566) })).rejects.toThrow("1 MiB");
    expect(adapter).toHaveBeenCalledOnce();
  });
  it("does not log a credential or reflected response payload", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    status = 403; body = '{"error":"registry-test-session","transaction":null}';
    await expect(net.getState()).rejects.toThrow("[redacted]");
    expect(logs.flatMap(log => log.mock.calls).flat().join(" ")).not.toContain("registry-test-session");
    logs.forEach(log => log.mockRestore());
  });
});
