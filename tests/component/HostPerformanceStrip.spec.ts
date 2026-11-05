import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HostPerformanceStrip from "@/components/feature/HostPerformanceStrip.vue";
import { useControllerStore } from "@/stores/controller";
import { healthSnapshot, trafficStatistics } from "../fixtures";
import type { HostHealth } from "@/services/hostHealth";

const render = () => mount(HostPerformanceStrip, { global: { stubs: { VProgressLinear: true } } });
let wrapper: ReturnType<typeof render>;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore(); store.connected = true;
  vi.spyOn(store, "refreshHostHealth").mockResolvedValue();
});
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });
async function publish(index = 0, change?: (data: HostHealth) => void) {
  const store = useControllerStore();
  const data = healthSnapshot(String(100 + index * 25), String(100 + index * 75), 100 + index * 3);
  change?.(data);
  store.hostHealth.data = data; store.hostHealth.stale = false; store.hostHealth.error = null;
  store.hostHealth.lastSuccess = Date.now(); store.hostHealth.loading = false;
  await flushPromises();
}
const value = (label: string) => wrapper.findAll("dl > div").find(row => row.get("dt").text() === label)!.get("dd").text();

describe("compact host performance", () => {
  it.each(["success", "failure"])("keeps initial pending feedback neutral through %s", async outcome => {
    const store = useControllerStore(); store.hostHealth.loading = true;
    wrapper = render();
    expect(wrapper.text()).toContain("Loading...");
    expect(wrapper.text()).not.toContain("Unavailable");
    if (outcome === "success") {
      await publish(); expect(value("CPU")).toBe("Collecting...");
      await publish(1); expect(value("CPU")).toBe("25%");
      expect(value("Memory")).toBe("75%"); expect(value("Load (1 min)")).toBe("0.1");
    } else {
      store.hostHealth.loading = false; store.hostHealth.error = "HTTP 503: host read failed";
      await flushPromises();
      expect(wrapper.text()).toContain("HTTP 503: host read failed");
      expect(value("CPU")).toBe("Unavailable");
    }
  });
  it("uses only available host-scoped aggregate uptime and preserves memory precision in the tooltip", async () => {
    const store = useControllerStore();
    wrapper = render(); await publish();
    store.statistics.data = trafficStatistics(); store.statistics.stale = false; store.statistics.lastSuccess = Date.now();
    await flushPromises();
    expect(value("Host uptime")).not.toBe("Unavailable");
    expect(wrapper.findAll("dl > div")[1]!.attributes("title")).toBe("6 GB / 8 GB");
    store.statistics.data = { ...trafficStatistics(), uptime: { ...trafficStatistics().uptime, scope: "simulator" } };
    await flushPromises(); expect(value("Host uptime")).toBe("Unavailable");
    store.statistics.data = { ...trafficStatistics(), sample: { ...trafficStatistics().sample, status: "simulated" } };
    await flushPromises(); expect(value("Host uptime")).toBe("Unavailable");
  });
  it("surfaces stale failures, retains memory evidence and requires a fresh CPU baseline on recovery", async () => {
    const store = useControllerStore();
    wrapper = render(); await publish(); await publish(1);
    store.hostHealth.stale = true; store.hostHealth.error = "HTTP 503: host read failed";
    await flushPromises();
    expect(wrapper.text()).toContain("Showing previously loaded data");
    expect(value("CPU")).toBe("Unavailable"); expect(value("Memory")).toBe("75%");
    await publish(2); expect(value("CPU")).toBe("Collecting...");
    await publish(3); expect(value("CPU")).toBe("25%");
  });
  it("does not turn simulated or failed sections into measured performance", async () => {
    wrapper = render();
    await publish(0, data => {
      data.sample.status = "simulated";
      Object.values(data.sections).forEach(section => { section.status = "simulated"; section.data = null; });
    });
    expect(value("CPU")).toBe("Simulated"); expect(value("Memory")).toBe("Simulated");
    await publish(1, data => { data.sections.memory.status = "unavailable"; data.sections.memory.error = "Memory access denied"; });
    expect(value("Memory")).toBe("Unavailable"); expect(wrapper.text()).toContain("Memory access denied");
  });
  it("breaks CPU baselines on identity changes and hidden tabs, and clears previous-device values", async () => {
    const store = useControllerStore();
    wrapper = render(); await publish(); await publish(1);
    await publish(2, data => { data.sample.boot_id = "rebooted"; });
    expect(value("CPU")).toBe("Collecting...");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await publish(3);
    visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
    await publish(4); expect(value("CPU")).toBe("Collecting...");
    await publish(5); expect(value("CPU")).toBe("25%");
    store.sessionVersion++; await flushPromises();
    expect(value("Memory")).toBe("Unavailable"); expect(wrapper.text()).not.toContain("25%");
    await publish(6); expect(value("CPU")).toBe("Collecting...");
    store.connected = false; await flushPromises();
    expect(value("Memory")).toBe("Unavailable");
  });
});
