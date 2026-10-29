import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { configSchema, mdnsSchema, udpRelayInstanceSchema, runtimeSchema, udpRelayStatusPageSchema } from "@/types/domain";
import { config, state, transaction, runtime, udpRelayStatus, processHealthSnapshot } from "../fixtures";
import { stateSchema, transactionSchema } from "@/types/domain";
import { cloneConfig, differenceContext, differences, normalize, requiredPermissions, serviceRepairPermissions, validateConfig } from "@/services/configuration";
import { processRestartTarget } from "@/services/operations";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";

const instance = { id: 1, enabled: false, port: 4001, interfaces: ["lan0", "iot0"], multicast_address: "239.255.255.250", source: "original" };

describe("UDP Broadcast Relay", () => {
  it("preserves relay configuration in complete packages, state and transactions", () => {
    const candidate = configSchema.parse({ ...config(), udp_broadcast_relay: { enabled: false, instances: [instance] } });
    expect(candidate.udp_broadcast_relay?.instances).toEqual([instance]);
    expect(stateSchema.parse({ ...state(), desired: candidate, observed: candidate }).desired).toEqual(candidate);
    expect(transactionSchema.parse({ ...transaction(), candidate }).candidate).toEqual(candidate);
    expect(configSchema.parse(config()).udp_broadcast_relay).toBeUndefined();
  });
  it("rejects invalid IDs, ports, multicast groups, source modes and unknown fields", () => {
    for (const invalid of [{ id: 0 }, { id: 64 }, { port: 0 }, { multicast_address: "192.0.2.1" }, { source: "spoof" }, { extra: true }]) {
      expect(udpRelayInstanceSchema.safeParse({ ...instance, ...invalid }).success).toBe(false);
    }
  });
  it("reviews, authorizes and canonically orders relay edits without losing other settings", () => {
    const before = config(), after = configSchema.parse({ ...before, udp_broadcast_relay: { enabled: false, instances: [instance] } });
    const changes = differences(before, after);
    expect(requiredPermissions(changes)).toContain("udp_broadcast_relay.write");
    expect(differenceContext(before, after, changes[0]!).after.udp_broadcast_relay).toEqual(normalize(after).udp_broadcast_relay);
    expect(normalize(after).udp_broadcast_relay?.instances[0]?.interfaces).toEqual(["iot0", "lan0"]);
    after.udp_broadcast_relay!.enabled = true;
    expect(serviceRepairPermissions(after, "ntp")).toContain("udp_broadcast_relay.write");
    expect(serviceRepairPermissions(before, "udp-broadcast-relay")).toContain("udp_broadcast_relay.write");
  });
  it("validates links, uniqueness, enable dependencies and service port conflicts", () => {
    const candidate = config();
    candidate.interfaces.push({ name: "iot0", kind: "ethernet", role: "lan", mtu: 1500, up: true, addresses: ["192.168.10.1/24"], dhcp_relay: { enabled: false, servers: [] } });
    candidate.interfaces.push({ name: "lan0", kind: "ethernet", role: "lan", mtu: 1500, up: true, addresses: ["192.168.20.1/24"], dhcp_relay: { enabled: false, servers: [] } });
    candidate.udp_broadcast_relay = { enabled: true, instances: [{ ...instance, source: "original", enabled: true }] };
    expect(validateConfig(candidate)).toEqual([]);
    const invalid = cloneConfig(candidate);
    invalid.udp_broadcast_relay!.instances.push({ ...invalid.udp_broadcast_relay!.instances[0]! });
    expect(validateConfig(invalid).filter(issue => issue.path.startsWith("udp_broadcast_relay")).map(issue => issue.path)).toEqual(expect.arrayContaining(["udp_broadcast_relay.instances.1.id", "udp_broadcast_relay.instances.1.port"]));
    candidate.interfaces.find(link => link.name === "lan0")!.up = false;
    expect(validateConfig(candidate).some(issue => issue.path.endsWith("interfaces") && issue.page.includes("udp-broadcast-relay"))).toBe(true);
    candidate.interfaces.find(link => link.name === "lan0")!.up = true;
    candidate.udp_broadcast_relay.instances[0]!.port = 5353;
    candidate.mdns = mdnsSchema.parse({ enabled: true });
    expect(validateConfig(candidate).some(issue => issue.message.includes("conflicts with enabled mDNS"))).toBe(true);
  });
  it("preserves per-instance identities, nullable unknown loss and exact decimal counters in status and runtime", () => {
    const instances = [udpRelayStatus(), { ...udpRelayStatus(), instance_id: 2, port: 3610 }];
    const parsed = udpRelayStatusPageSchema.parse({ instances, error: "" });
    expect(parsed.instances.map(value => value.instance_id)).toEqual([1, 2]);
    expect(parsed.instances[0]!.received_packets).toBe("9007199254740993");
    expect(parsed.instances[0]!.transmitted_packets).toBe("18446744073709551615");
    expect(parsed.instances[0]!.receive_drops).toBeNull();
    expect(parsed.instances[0]!.statistics_complete).toBe(false);
    expect(runtimeSchema.parse({ ...runtime(), appliance_services: instances }).appliance_services).toEqual(instances);
    expect(udpRelayStatusPageSchema.safeParse({ instances: [{ ...instances[0], received_packets: 9007199254740992 }], error: "" }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...runtime(), appliance_services: [{ ...instances[0], received_packets: 123 }] }).success).toBe(false);
  });
  it("accepts native running relay rows after the supervisor removes the current error field", () => {
    const native = { ...udpRelayStatus() };
    const { error: currentError, ...withoutError } = native;
    expect(currentError).toBeNull();
    const instances = [withoutError, { ...withoutError, instance_id: 2, port: 3610 }];
    const parsed = runtimeSchema.parse({ ...runtime(), appliance_services: instances });
    expect(parsed.appliance_services).toEqual(instances.map(row => ({ ...row, error: null })));
    expect(udpRelayStatusPageSchema.parse({ instances, error: "" }).instances).toEqual(instances.map(row => ({ ...row, error: null })));
  });
  it("maps only canonical relay IDs to instance restart targets", () => {
    const row = processHealthSnapshot().process_health.components[0]!;
    for (const id of ["1", "12", "63"]) expect(processRestartTarget({ ...row, component: "appliance_services", resource: `udp-broadcast-relay:${id}` })).toBe(`udp-broadcast-relay:${id}`);
    for (const id of ["0", "64", "01", "1:extra"]) expect(processRestartTarget({ ...row, component: "appliance_services", resource: `udp-broadcast-relay:${id}` })).toBeNull();
  });
  it("accepts relay startup rows without supervision fields and preserves unknown measurements", () => {
    const startup = {
      ...udpRelayStatus(), state: "running", error: null, retrying: undefined,
      restart_count: undefined, last_error: undefined, started_at: null,
      collected_at: null, multicast_address: null, last_send_error: null,
      last_send_error_at: null, receive_drops: null, statistics_complete: false,
    };
    const instances = [startup, { ...startup, instance_id: 2, port: 3610 }];
    const parsed = runtimeSchema.parse({ ...runtime(), appliance_services: instances });
    expect(parsed.appliance_services).toHaveLength(2);
    for (const [index, row] of parsed.appliance_services.entries()) {
      expect(row.name).toBe("udp-broadcast-relay");
      if (row.name !== "udp-broadcast-relay" || !("instance_id" in row)) throw new Error("Relay decoded as a generic service");
      expect(row.instance_id).toBe(index + 1);
      expect(row.receive_drops).toBeNull();
      expect(row.statistics_complete).toBe(false);
      expect(row.error).toBeNull();
      expect(row.retrying).toBeUndefined();
      expect(row.started_at).toBeNull();
      expect(row.collected_at).toBeNull();
    }
  });
});

describe("relay status polling", () => {
  afterEach(() => { useControllerStore().$dispose(); vi.useRealTimers(); });
  it.each([
    ["running", null, false],
    ["running", "Send failed", false],
    ["error", "Bind failed", true],
  ] as const)("retains factual %s relay observations without locking configuration", async (workerState, error, retrying) => {
    setActivePinia(createPinia());
    const store = useControllerStore(); store.connected = true; store.state.data = state();
    store.stage(config());
    const draft = cloneConfig(store.draft!);
    const instances = [1, 2].map(instance_id => ({
      ...udpRelayStatus(), instance_id, state: workerState, error, retrying,
      receive_drops: null, statistics_complete: false,
    }));
    vi.spyOn(api, "getUDPRelayStatus").mockResolvedValue(udpRelayStatusPageSchema.parse({ instances, error: "" }));
    await store.refreshUDPRelayStatus();
    expect(store.udpRelayStatus.incompatible).toBe(false);
    expect(store.udpRelayStatus.error).toBeNull();
    expect(store.udpRelayStatusCurrent).toBe(true);
    expect(store.udpRelayStatus.data!.instances).toEqual(instances);
    expect(store.readOnlyReason).toBe("");
    expect(store.draft).toEqual(draft);
  });
  it("expires observations without locking edits and retains drafts through failed polling", async () => {
    vi.useFakeTimers(); setActivePinia(createPinia());
    const store = useControllerStore(); store.connected = true; store.state.data = state();
    vi.spyOn(api, "getUDPRelayStatus").mockResolvedValue({ instances: [udpRelayStatus()], error: "" });
    await store.refreshUDPRelayStatus();
    expect(store.udpRelayStatusCurrent).toBe(true);
    store.stage(config());
    const draft = cloneConfig(store.draft!);
    await vi.advanceTimersByTimeAsync(15001);
    expect(store.udpRelayStatusCurrent).toBe(false);
    vi.mocked(api.getUDPRelayStatus).mockRejectedValue(new Error("Relay status unavailable"));
    await store.refreshUDPRelayStatus();
    expect(store.udpRelayStatus.error).toContain("unavailable");
    expect(store.readOnlyReason).toBe("");
    expect(store.draft).toEqual(draft);
    store.disconnect();
    expect(store.udpRelayStatus.data).toBeNull();
  });
});