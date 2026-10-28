import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import OverviewInterfaceStatus from "@/components/feature/OverviewInterfaceStatus.vue";
import { statistics } from "../fixtures";
import type { Statistics } from "@/types/domain";

const chip = { props: ["color"], template: '<span :data-color="color"><slot /></span>' };
function render(state: "admin" | "operational", sample = statistics().interfaces[0], stale = false, simulated = false) {
  return mount(OverviewInterfaceStatus, { props: { state, sample, stale, simulated }, global: { stubs: { VChip: chip } } });
}
function sample(overrides: Partial<Statistics["interfaces"][number]> = {}) {
  return { ...statistics().interfaces[0]!, status: "available", ...overrides };
}
describe("separate interface administrative and operational states", () => {
  it.each(["wireguard", "loopback", "dummy"])("shows enabled %s as Admin Up with a dash for Operational Unknown", kind => {
    const data = sample({ kind, admin_up: true, oper_state: "UNKNOWN" });
    const admin = render("admin", data), operational = render("operational", data);
    expect(admin.text()).toBe("Up"); expect(admin.attributes("data-color")).toBe("success");
    expect(admin.attributes("title")).toBe("Administrative state: Up");
    expect(operational.text()).toBe("-"); expect(operational.attributes("data-color")).toBe("default");
    expect(operational.attributes("title")).toBe("Kernel operational state: UNKNOWN");
  });
  it("reports actual observed admin and operational states independently", () => {
    const data = sample({ admin_up: false, oper_state: "UP" });
    expect(render("admin", data).text()).toBe("Down");
    expect(render("operational", data).text()).toBe("Up");
  });
  it.each([
    ["UP", "Up", "success"], ["DOWN", "Down", "error"], ["LOWERLAYERDOWN", "Lower layer down", "error"],
    ["NOTPRESENT", "Not present", "error"], ["DORMANT", "Dormant", "warning"], ["TESTING", "Testing", "default"],
    ["UNKNOWN", "-", "default"], ["future", "Unknown (future)", "default"],
  ])("preserves kernel operational state %s", (oper_state, label, color) => {
    const wrapper = render("operational", sample({ oper_state }));
    expect(wrapper.text()).toBe(label); expect(wrapper.attributes("data-color")).toBe(color);
  });
  it.each(["admin", "operational"] as const)("keeps %s state unknown for stale, missing, failed or unavailable samples", state => {
    for (const data of [sample({ error: "Read failed" }), sample({ status: "unavailable" })]) {
      expect(render(state, data).text()).toBe("Unknown");
    }
    expect(render(state, sample(), true).text()).toBe("Unknown");
    const missing = mount(OverviewInterfaceStatus, { props: { state, stale: false, simulated: false }, global: { stubs: { VChip: chip } } });
    expect(missing.text()).toBe("Unknown");
  });
  it.each(["admin", "operational"] as const)("never reports simulated %s state as observed Up", state => {
    expect(render(state, sample(), false, true).text()).toBe("Simulated");
    expect(render(state, sample({ status: "simulated" })).text()).toBe("Simulated");
  });
});
