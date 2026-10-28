import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DNSLookup from "@/components/feature/DNSLookup.vue";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { state } from "../fixtures";
import { dnsResponse } from "../diagnosticsFixtures";

const stubs = {
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VTextField: { props: ["modelValue", "disabled"], emits: ["update:modelValue"], template: '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
};
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore(); store.connected = true; store.state.data = state();
  store.state.data.desired.dns = { lab0: { servers: ["192.0.2.53"], domains: [] } };
  vi.spyOn(api, "lookupDNS").mockResolvedValue(dnsResponse());
});
afterEach(() => { wrapper?.unmount(); useControllerStore().$dispose(); });
async function setup(server = "192.0.2.53") {
  wrapper = mount(DNSLookup, { props: { server }, global: { stubs } });
  if (!wrapper.get<HTMLInputElement>("input").element.disabled) await wrapper.get("input").setValue("Example.TEST.");
}
async function submit() { await wrapper.get("button").trigger("click"); await flushPromises(); }
describe("DNS server row lookup", () => {
  it("renders four cells with RTT and the query result without dirtying the editor", async () => {
    const store = useControllerStore();
    store.stage(store.state.data!.desired); store.draft!.interfaces.push({ ...store.draft!.interfaces[0]!, name: "draft0" });
    const draft = JSON.stringify(store.draft);
    await setup(); await submit();
    expect(wrapper.findAll("td")).toHaveLength(4);
    expect(wrapper.findAll("input")).toHaveLength(1);
    expect(wrapper.get("button").attributes("color")).toBe("primary");
    expect(wrapper.get("button").attributes("variant")).toBe("elevated");
    expect(wrapper.find("select").exists()).toBe(false);
    expect(api.lookupDNS).toHaveBeenCalledWith({ server: "192.0.2.53", hostname: "example.test", record_type: "A", timeout_ms: 2000 }, expect.any(AbortSignal));
    expect(wrapper.get('[aria-label="RTT for 192.0.2.53"]').text()).toBe("13 ms");
    expect(wrapper.get('[aria-label="Result for 192.0.2.53"]').text()).toBe("192.0.2.7");
    expect(wrapper.text()).not.toContain("9007199254740993");
    expect(JSON.stringify(store.draft)).toBe(draft); expect(store.editorDirty).toBe(false);
  });
  it("submits on Enter", async () => {
    await setup(); await wrapper.get("input").trigger("keydown.enter"); await flushPromises();
    expect(api.lookupDNS).toHaveBeenCalledTimes(1);
  });
  it.each([[0, "0 ms"], [0.49, "0 ms"], [0.5, "1 ms"], [12.49, "12 ms"], [12.5, "13 ms"], [25, "25 ms"]] as const)("rounds RTT %s to %s only at the display boundary", async (rtt_ms, expected) => {
    const response = { ...dnsResponse(), rtt_ms };
    vi.mocked(api.lookupDNS).mockResolvedValue(response);
    await setup(); await submit();
    expect(wrapper.get('[aria-label="RTT for 192.0.2.53"]').text()).toBe(expected);
    expect(response.rtt_ms).toBe(rtt_ms);
  });
  it.each(["127.0.0.1", "bad..test", "-bad.test", "tést.test", "bad test", "a".repeat(64) + ".test"])("rejects invalid domain %s inline", async host => {
    await setup(); await wrapper.get("input").setValue(host); await submit();
    expect(api.lookupDNS).not.toHaveBeenCalled(); expect(wrapper.get('[role="alert"]').text()).toContain("ASCII domain");
  });
  it.each([[1, "FORMERR"], [2, "SERVFAIL"], [3, "NXDOMAIN"], [5, "REFUSED"], [15, "RCODE 15"]] as const)("shows DNS response %s as %s while retaining measured RTT", async (rcode, label) => {
    vi.mocked(api.lookupDNS).mockResolvedValue({ ...dnsResponse(), rcode, addresses: [] });
    await setup(); await submit();
    expect(wrapper.get('[aria-label="RTT for 192.0.2.53"]').text()).toBe("13 ms");
    expect(wrapper.get('[aria-label="Result for 192.0.2.53"]').text()).toBe(label);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it("shows all returned IPv4/IPv6 addresses and distinguishes an empty successful answer", async () => {
    vi.mocked(api.lookupDNS).mockResolvedValue({ ...dnsResponse(), addresses: ["192.0.2.7", "192.0.2.8", "2001:db8::7"] });
    await setup(); await submit();
    expect(wrapper.get('[aria-label="Result for 192.0.2.53"]').text()).toBe("192.0.2.7, 192.0.2.8, 2001:db8::7");
    vi.mocked(api.lookupDNS).mockResolvedValue({ ...dnsResponse(), addresses: [] }); await submit();
    expect(wrapper.get('[aria-label="Result for 192.0.2.53"]').text()).toBe("No answers (NOERROR)");
  });
  it("does not invent a response code when the backend leaves it unavailable", async () => {
    vi.mocked(api.lookupDNS).mockResolvedValue({ ...dnsResponse(), rcode: null, addresses: [] });
    await setup(); await submit();
    expect(wrapper.get('[aria-label="Result for 192.0.2.53"]').text()).toBe("Response code unavailable");
  });
  it.each(["failed", "simulated"] as const)("does not zero-fill %s timings", async status => {
    vi.mocked(api.lookupDNS).mockResolvedValue({ ...dnsResponse(), status, rtt_ms: null, elapsed_ms: null, addresses: [], server: null, transport: null, rcode: null, attempts: status === "failed" ? [{ server: "192.0.2.53", status: "failed", rtt_ms: null, error: "DNS timed out" }] : [] });
    await setup(); await submit();
    expect(wrapper.text()).not.toContain("0 ms");
    expect(wrapper.text()).toContain(status === "failed" ? "DNS timed out" : "Unavailable");
    expect(wrapper.get('[aria-label="Result for 192.0.2.53"]').text()).toBe(status === "failed" ? "DNS timed out" : "Simulated");
    expect(wrapper.get('[aria-label="RTT for 192.0.2.53"]').text()).toBe("Unavailable");
  });
  it.each([400, 403, 409, 429, 503])("surfaces HTTP %s without retrying", async status => {
    vi.mocked(api.lookupDNS).mockRejectedValue(new ApiFailure(`HTTP ${status}: lookup rejected`, status));
    await setup(); await submit(); expect(wrapper.get('[role="alert"]').text()).toContain(`HTTP ${status}`);
    expect(api.lookupDNS).toHaveBeenCalledTimes(1);
  });
  it("tests a draft-only server without applying it, changing the draft, or substituting a different resolver", async () => {
    const store = useControllerStore();
    store.stage(store.state.data!.desired); store.draft!.dns!.lab0!.servers.push("1.1.1.1");
    const draft = JSON.stringify(store.draft), desired = JSON.stringify(store.state.data!.desired);
    vi.mocked(api.lookupDNS).mockResolvedValue({ ...dnsResponse(), server: "1.1.1.1", attempts: [{ ...dnsResponse().attempts[0]!, server: "1.1.1.1" }] });
    await setup("1.1.1.1"); await submit();
    expect(api.lookupDNS).toHaveBeenCalledWith({ server: "1.1.1.1", hostname: "example.test", record_type: "A", timeout_ms: 2000 }, expect.any(AbortSignal));
    expect(wrapper.get('[aria-label="RTT for 1.1.1.1"]').text()).toBe("13 ms");
    expect(JSON.stringify(store.draft)).toBe(draft); expect(JSON.stringify(store.state.data!.desired)).toBe(desired);
    expect(store.editorDirty).toBe(false);
  });
  it("does not require configured interfaces or DNS for explicit-server diagnostics", async () => {
    const store = useControllerStore();
    store.state.data!.desired.interfaces = []; delete store.state.data!.desired.dns;
    await setup(); await submit();
    expect(api.lookupDNS).toHaveBeenCalledOnce();
    expect(wrapper.get('[aria-label="RTT for 192.0.2.53"]').text()).toBe("13 ms");
  });
  it("keeps operational guards in place without sending a lookup during a restart", async () => {
    useControllerStore().restartPending = "ntp";
    await setup();
    expect(wrapper.get<HTMLButtonElement>("button").element.disabled).toBe(true);
    expect(wrapper.text()).toContain("restart");
    expect(api.lookupDNS).not.toHaveBeenCalled();
  });
  it("lets backend routing choose an interface instead of binding to the interface owning the resolver setting", async () => {
    const config = useControllerStore().state.data!.desired;
    config.interfaces.push({ ...config.interfaces[0]!, name: "wan0", role: "wan", addresses: ["203.0.113.1/24"] });
    config.routes.push({ enabled: true, interface: "wan0", destination: "192.0.2.53/32", table: 254, metric: 1 });
    vi.mocked(api.lookupDNS).mockResolvedValue(dnsResponse());
    await setup(); await submit();
    expect(api.lookupDNS).toHaveBeenCalledWith({ server: "192.0.2.53", hostname: "example.test", record_type: "A", timeout_ms: 2000 }, expect.any(AbortSignal));
    expect(wrapper.get('[aria-label="RTT for 192.0.2.53"]').text()).toBe("13 ms");
    expect(wrapper.text()).not.toContain("wan0");
  });
  it("invalidates an in-flight result after the committed routing revision changes", async () => {
    let finish!: (value: ReturnType<typeof dnsResponse>) => void;
    vi.mocked(api.lookupDNS).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await setup(); await wrapper.get("button").trigger("click");
    const store = useControllerStore(); store.state.data = { ...store.state.data!, revision: "1" }; await flushPromises();
    expect(vi.mocked(api.lookupDNS).mock.calls[0]![1]!.aborted).toBe(true);
    finish(dnsResponse()); await flushPromises();
    expect(wrapper.text()).not.toContain("13 ms");
  });
  it("single-flights submissions and discards results after a device-session change", async () => {
    let finish!: (value: ReturnType<typeof dnsResponse>) => void;
    vi.mocked(api.lookupDNS).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await setup(); await wrapper.get("input").trigger("keydown.enter"); await wrapper.get("input").trigger("keydown.enter");
    expect(api.lookupDNS).toHaveBeenCalledTimes(1);
    useControllerStore().disconnect(); await flushPromises();
    expect(vi.mocked(api.lookupDNS).mock.calls[0]![1]!.aborted).toBe(true);
    finish(dnsResponse()); await flushPromises();
    expect(wrapper.text()).not.toContain("13 ms");
  });
  it("clears a stale result when the domain changes", async () => {
    await setup(); await submit(); await wrapper.get("input").setValue("other.test");
    expect(wrapper.text()).not.toContain("13 ms");
    expect(wrapper.get('[aria-label="Result for 192.0.2.53"]').text()).toBe("\u2014");
  });
  it("aborts pending work when the row is removed", async () => {
    vi.mocked(api.lookupDNS).mockImplementation(() => new Promise(() => {}));
    await setup(); await wrapper.get("button").trigger("click");
    wrapper.unmount();
    expect(vi.mocked(api.lookupDNS).mock.calls[0]![1]!.aborted).toBe(true);
  });
});
