import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PerformanceLogMessage from "@/components/feature/PerformanceLogMessage.vue";
import { parsePerformanceLog } from "@/services/logs";
import { linkDiagnostics } from "../diagnosticsFixtures";

const stubs = {
  VChip: { props: ["color"], template: '<span class="chip" :data-color="color"><slot /></span>' },
};
function render(event: string, details: Record<string, unknown>) {
  const message = JSON.stringify({ schema: "netcontrol-performance/v1", observed_at: "2026-11-17T03:07:46.918008538Z", event, details });
  const parsed = parsePerformanceLog(message)!;
  const wrapper = mount(PerformanceLogMessage, { props: { event: parsed, message }, global: { stubs } });
  return { wrapper, message };
}
describe("structured experience log messages", () => {
  it("distinguishes new probe timeouts from rolling loss and current healthy status", () => {
    const { wrapper } = render("gateway_probe_loss", {
      name: "AZURE-PRIVATE", interface: "tun_wg0", target: "192.168.4.4",
      newly_lost: 1, loss_timeout_ms: 2000, window: { health: "up", lost: 19, loss_percent: 3.448275862, rtt_avg_ms: 20.534198607 },
    });
    expect(wrapper.get(".evidence-event").text()).toBe("Probe timeout");
    expect(wrapper.get(".evidence-event").attributes("data-color")).toBe("warning");
    expect(wrapper.get(".evidence-resource").text()).toBe("AZURE-PRIVATE");
    expect(wrapper.get(".evidence-interface").text()).toBe("tun_wg0");
    expect(wrapper.get(".evidence-target").text()).toBe("192.168.4.4");
    const chips = wrapper.findAll(".evidence-metrics .chip");
    expect(chips.map(chip => chip.text())).toEqual([
      "New timeouts: 1", "Window loss: 3.45%", "RTT avg: 20.53 ms",
    ]);
    expect(chips[0]!.attributes("data-color")).toBe("warning");
    expect(wrapper.findAll("td")).toHaveLength(5);
    expect(wrapper.find("details").exists()).toBe(false);
    wrapper.unmount();
  });
  it.each([
    ["unknown", "up", "success"], ["up", "degraded", "warning"], ["degraded", "down", "error"], ["up", "unknown", "default"],
  ])("labels %s to %s health transitions without inventing latency thresholds", (previous_health, health, color) => {
    const { wrapper } = render("gateway_health_change", {
      previous_health, health, name: "WAN_DHCP", window: { loss_percent: 0, rtt_avg_ms: 1000 },
    });
    expect(wrapper.get(".evidence-event").attributes("data-color")).toBe(color);
    expect(wrapper.get(".evidence-metrics").text()).toContain(`Health: ${previous_health[0]!.toUpperCase()}${previous_health.slice(1)} to ${health[0]!.toUpperCase()}${health.slice(1)}`);
    expect(wrapper.text()).toContain("Window loss: 0.00%");
    expect(wrapper.findAll(".chip").at(-1)!.attributes("data-color")).toBe("info");
    wrapper.unmount();
  });
  it("keeps hierarchical queues and exact u64 deltas separate from monitoring and local TCP evidence", () => {
    const evidence = [
      { event: "qdisc_drops", qdisc: { name: "wan0", kind: "fq_codel", handle: 10, parent: 0, drops_delta: "9007199254740993", queue: { drops: "18446744073709551615" } } },
      { event: "qdisc_drops", qdisc: { name: "wan0", kind: "fq_codel", handle: 20, parent: 10, drops_delta: "7", queue: { drops: "12" } } },
      { event: "interface_errors_or_drops", interface: { ...linkDiagnostics().interfaces![0]!, name: "wan0", rx_errors_delta: null, rx_drops_delta: "2" } },
      { event: "local_tcp_retransmissions", local_tcp: { retransmissions_delta: "3" } },
      { event: "diagnostic_capture_drops", drops_delta: "4", drops: "99" },
      { event: "future_evidence", more: "kept" },
    ];
    const wrappers = evidence.map(item => render("link_observation", { evidence: [item] }).wrapper);
    expect(wrappers[0]!.get(".evidence-metrics").text()).toContain("New drops: 9007199254740993");
    expect(wrappers[0]!.get(".evidence-metrics").text()).toContain("Total: 18446744073709551615");
    expect(wrappers[1]!.get(".evidence-metrics").text()).toContain("Parent: 10");
    expect(wrappers[2]!.get(".evidence-metrics").text()).toContain("New RX errors: Unavailable");
    expect(wrappers[2]!.get(".evidence-metrics").text()).toContain("New RX drops: 2");
    expect(wrappers[3]!.get(".evidence-resource").text()).toBe("Router-local TCP");
    expect(wrappers[4]!.get(".evidence-event").text()).toBe("Monitoring coverage lost");
    expect(wrappers[4]!.get(".evidence-metrics").text()).not.toContain("New drops:");
    expect(wrappers[5]!.get(".opaque-message").text()).toContain("future_evidence");
    wrappers.forEach(wrapper => wrapper.unmount());
  });
  it("renders exact directional evidence without summing RX subcategories or inferring WireGuard rejection causes", () => {
    const link = { ...linkDiagnostics().interfaces![0]!, name: "tun_wg0",
      rx_errors_delta: "2", rx_frame_errors_delta: "2", rx_length_errors_delta: null,
      tx_errors_delta: "9007199254740993", rx_drops_delta: "0", tx_drops_delta: "7",
    };
    const { wrapper } = render("link_observation", { evidence: [{ event: "interface_errors_or_drops", interface: link }] });
    expect(wrapper.get(".evidence-interface").text()).toBe("tun_wg0");
    const chips = wrapper.findAll(".evidence-metrics .chip");
    expect(chips.map(chip => chip.text())).toEqual([
      "New RX errors: 2", "New TX errors: 9007199254740993", "New RX drops: 0", "New TX drops: 7",
      "New RX frame errors: 2", "New RX length errors: Unavailable",
    ]);
    expect(chips.map(chip => chip.attributes("data-color"))).toEqual(["warning", "warning", "default", "warning", "warning", "default"]);
    expect(chips[0]!.attributes("title")).toBe("Cumulative RX errors: 9007199254740993");
    expect(chips[4]!.attributes("title")).toContain("Included in RX errors, not additional packet loss");
    expect(wrapper.text()).not.toContain("AllowedIPs mismatch");
    wrapper.unmount();
  });
  it.each([
    { index: 2, name: "old0", errors: "9", drops: "7", errors_delta: "2", drops_delta: "1" },
    { ...linkDiagnostics().interfaces![0]!, rx_errors_delta: undefined },
    { ...linkDiagnostics().interfaces![0]!, rx_drops: 9007199254740992 },
  ])("preserves historical or malformed interface evidence as opaque JSON", link => {
    const { wrapper, message } = render("link_observation", { evidence: [{ event: "interface_errors_or_drops", interface: link }] });
    expect(wrapper.get(".opaque-message").text()).toBe(message);
    expect(wrapper.find(".chip").exists()).toBe(false);
    wrapper.unmount();
  });
  it.each(["gateway_unavailable", "link_monitor_unavailable"])("keeps %s failures explicit and escaped", event => {
    const { wrapper } = render(event, { name: "<img src=x>", error: "<script>alert(1)</script>" });
    expect(wrapper.get(".evidence-event").attributes("data-color")).toBe("error");
    expect(wrapper.get(".text-error").text()).toBe("<script>alert(1)</script>");
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find("img").exists()).toBe(false);
    wrapper.unmount();
  });
  it("shows monitoring recovery without pretending it establishes traffic health", () => {
    const { wrapper } = render("link_monitor_recovered", {});
    expect(wrapper.get(".evidence-event").text()).toBe("Link monitoring recovered");
    expect(wrapper.get(".evidence-event").attributes("data-color")).toBe("success");
    wrapper.unmount();
  });
  it.each([
    ["future_event", { extra: "<img src=x>" }],
    ["gateway_probe_loss", { newly_lost: null }],
    ["gateway_health_change", { health: "up" }],
  ])("preserves unknown or incomplete %s messages as raw text", (event, details) => {
    const { wrapper, message } = render(event, details);
    expect(wrapper.get(".opaque-message").text()).toBe(message);
    expect(wrapper.find(".chip").exists()).toBe(false);
    expect(wrapper.find("img").exists()).toBe(false);
    wrapper.unmount();
  });
});
