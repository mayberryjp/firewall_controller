import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirewallClock from "@/components/feature/FirewallClock.vue";
import { getSystemStatus } from "@/services/netcontrol";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { state, systemStatus } from "../fixtures";

vi.mock("@/services/netcontrol", async original => ({
  ...await original<typeof import("@/services/netcontrol")>(), getSystemStatus: vi.fn(),
}));
let wrapper: ReturnType<typeof mount> | undefined;
let visibility: DocumentVisibilityState;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  vi.resetAllMocks(); setActivePinia(createPinia());
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const store = useControllerStore(); store.connected = true; store.state.data = state();
  store.state.data.desired.ntp = { enabled: false, servers: [] };
  vi.mocked(getSystemStatus).mockResolvedValue(systemStatus());
});
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined; useControllerStore().$dispose();
  vi.useRealTimers(); vi.restoreAllMocks();
});
async function render() { wrapper = mount(FirewallClock); await flushPromises(); }
const displayed = () => wrapper!.get("output").text();

describe("current firewall clock", () => {
  it.each(["success", "failure"])("keeps the initial pending read neutral until %s, even with NTP disabled", async outcome => {
    let resolve!: (value: ReturnType<typeof systemStatus>) => void, reject!: (error: Error) => void;
    vi.mocked(getSystemStatus).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    await render();
    await vi.advanceTimersByTimeAsync(31000);
    expect(displayed()).toBe("Loading...");
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper!.text()).not.toContain("stale");
    expect(getSystemStatus).toHaveBeenCalledOnce();
    if (outcome === "success") resolve(systemStatus()); else reject(new Error("HTTP 503: system status unavailable"));
    await flushPromises();
    expect(displayed()).toBe(outcome === "success" ? "2026-11-19 08:58:31" : "Unavailable");
    if (outcome === "failure") expect(wrapper!.get('[role="alert"]').text()).toContain("HTTP 503");
    expect(useControllerStore().draft).toBeNull();
  });
  it("ticks from receipt using monotonic time and the saved timezone, not browser time or unsaved drafts", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "", domain: "", timezone: "America/Los_Angeles" };
    await render();
    expect(wrapper!.text()).toContain("Current firewall time (America/Los_Angeles)");
    expect(displayed()).toBe("2026-11-19 00:58:31");
    vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(displayed()).toBe("2026-11-19 00:58:33");
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.system = { hostname: "", domain: "", timezone: "Asia/Kolkata" };
    await flushPromises();
    expect(displayed()).toBe("2026-11-19 00:58:33");
    store.state.data = { ...store.state.data!, desired: { ...store.state.data!.desired, system: store.draft.system } };
    await flushPromises();
    expect(wrapper!.get("output").attributes("aria-label")).toBe("Current firewall time (Asia/Kolkata)");
    expect(displayed()).toBe("2026-11-19 14:28:33");
    expect(displayed()).not.toContain(".123");
    expect(wrapper!.get("output").attributes("title")).toContain("request/network latency");
    expect(wrapper!.get("output").attributes("title")).toContain("not a fresh NTP reading");
  });
  it("replaces the anchor after periodic reads and forward/backward accepted clock steps", async () => {
    await render();
    vi.mocked(getSystemStatus).mockResolvedValueOnce(systemStatus("2026-11-20T08:00:00.987654321Z"));
    await vi.advanceTimersByTimeAsync(15000); await flushPromises();
    expect(displayed()).toBe("2026-11-20 08:00:00");
    vi.mocked(getSystemStatus).mockResolvedValueOnce(systemStatus("2026-11-18T07:00:00.987654321Z"));
    await wrapper!.setProps({ sampleKey: "new-accepted-sample" }); await flushPromises();
    expect(displayed()).toBe("2026-11-18 07:00:00");
    await vi.advanceTimersByTimeAsync(1000);
    expect(displayed()).toBe("2026-11-18 07:00:01");
    expect(getSystemStatus).toHaveBeenCalledTimes(3);
  });
  it("marks a stalled or failed refresh stale without hiding errors or overlapping reads, then recovers", async () => {
    await render();
    let fail!: (error: Error) => void;
    vi.mocked(getSystemStatus).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    await vi.advanceTimersByTimeAsync(30000); await flushPromises();
    expect(displayed()).toBe("2026-11-19 08:59:01");
    expect(wrapper!.text()).toContain("stale estimate");
    expect(getSystemStatus).toHaveBeenCalledTimes(2);
    fail(new Error("HTTP 503: system status unavailable")); await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain("HTTP 503");
    expect(displayed()).not.toBe("Unavailable");
    vi.mocked(getSystemStatus).mockResolvedValueOnce(systemStatus("2026-11-19T09:00:00Z"));
    await vi.advanceTimersByTimeAsync(15000); await flushPromises();
    expect(displayed()).toBe("2026-11-19 09:00:00");
    expect(wrapper!.text()).not.toContain("stale");
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
  });
  it("pauses hidden reads and discards an older in-flight response after visibility resume", async () => {
    await render();
    let finish!: (value: ReturnType<typeof systemStatus>) => void;
    vi.mocked(getSystemStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(15000);
    const oldSignal = vi.mocked(getSystemStatus).mock.calls[1]![0]!;
    visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
    expect(oldSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(getSystemStatus).toHaveBeenCalledTimes(2);
    vi.mocked(getSystemStatus).mockResolvedValueOnce(systemStatus("2026-11-19T10:00:00Z"));
    visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); await flushPromises();
    expect(displayed()).toBe("2026-11-19 10:00:00");
    finish(systemStatus("2026-11-19T01:00:00Z")); await flushPromises();
    expect(displayed()).toBe("2026-11-19 10:00:00");
    expect(wrapper!.text()).not.toContain("stale");
  });
  it.each(["pageshow", "focus"])("refreshes on %s and cleans up refreshes and ticks on unmount", async event => {
    await render();
    vi.mocked(getSystemStatus).mockResolvedValueOnce(systemStatus("2026-11-19T11:00:00Z"));
    window.dispatchEvent(new Event(event)); await flushPromises();
    expect(displayed()).toBe("2026-11-19 11:00:00");
    wrapper!.unmount(); wrapper = undefined;
    const calls = vi.mocked(getSystemStatus).mock.calls.length;
    window.dispatchEvent(new Event(event)); document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(getSystemStatus).toHaveBeenCalledTimes(calls);
  });
  it("invalidates old-device responses when the selected firewall changes", async () => {
    let finish!: (value: ReturnType<typeof systemStatus>) => void;
    vi.mocked(getSystemStatus).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    const oldSignal = vi.mocked(getSystemStatus).mock.calls[0]![0]!;
    vi.mocked(getSystemStatus).mockResolvedValueOnce(systemStatus("2026-11-19T12:00:00Z"));
    useControllerStore().sessionVersion++;
    await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    finish(systemStatus("2026-11-19T01:00:00Z")); await flushPromises();
    expect(displayed()).toBe("2026-11-19 12:00:00");
  });
});
