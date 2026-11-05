import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PathTestsView from "@/views/PathTestsView.vue";
import { ApiFailure } from "@/services/api";
import * as api from "@/services/netcontrol";
import { useControllerStore } from "@/stores/controller";
import { pathTestInterfaces, pathTestRequest, pathTestResult, pathTestStatus } from "../pathTestFixtures";
import { state } from "../fixtures";
import type { PathTestStatus } from "@/services/pathTests";

const stubs = {
  VForm: { template: '<form><slot /></form>' },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VAlert: { template: "<div><slot /></div>" }, VTable: { template: "<table><slot /></table>" },
  VCheckbox: {
    inheritAttrs: false, props: ["modelValue", "label"], emits: ["update:modelValue"],
    template: '<label><input v-bind="$attrs" type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)">{{ label }}</label>',
  },
  VTextField: {
    inheritAttrs: false, props: ["modelValue"], emits: ["update:modelValue"],
    template: '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
  },
  VSelect: {
    inheritAttrs: false, props: ["modelValue", "items"], emits: ["update:modelValue"],
    template: '<select v-bind="$attrs" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">Select</option><option v-for="item in items" :key="item" :value="item">{{ item }}</option></select>',
  },
};
const render = () => mount(PathTestsView, { global: { stubs } });
const button = (wrapper: ReturnType<typeof render>, text: string) => wrapper.findAll("button").find(value => value.text() === text)!;
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore(); store.connected = true;
  store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
  vi.spyOn(api, "getPathTests").mockResolvedValue(pathTestStatus());
  vi.spyOn(api, "getDiscoveredInterfaces").mockResolvedValue(pathTestInterfaces());
  vi.spyOn(api, "getState").mockResolvedValue(state());
  vi.spyOn(api, "getTransactions").mockResolvedValue({});
  vi.spyOn(api, "startPathTest").mockImplementation(async () => {
    vi.mocked(api.getPathTests).mockResolvedValue(pathTestStatus(true));
    return pathTestStatus(true);
  });
  vi.spyOn(api, "cancelPathTest").mockResolvedValue(pathTestStatus(true));
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => { useControllerStore().$dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fill(wrapper: ReturnType<typeof render>) {
  await wrapper.get('[aria-label="Local interface"]').setValue("vlan100");
  await wrapper.get('[aria-label="Local source IP"]').setValue("192.0.2.1");
  await wrapper.get('[aria-label="Peer IP"]').setValue("192.0.2.2");
  await wrapper.get('[aria-label="Maximum MTU (bytes)"]').setValue("9000");
  await wrapper.get('[aria-label="One-time pairing secret"]').setValue(pathTestRequest().pairing_secret);
}
describe("paired path diagnostics", () => {
  it.each(["success", "failure"] as const)("distinguishes initial pending-to-%s reads without premature unsupported warnings", async outcome => {
    let resolve!: (value: PathTestStatus) => void, reject!: (reason: Error) => void;
    vi.mocked(api.getPathTests).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain("Loading native test status");
    expect(wrapper.text()).not.toContain("does not expose paired path tests");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(button(wrapper, "Start paired test").attributes("disabled")).toBeDefined();
    if (outcome === "success") resolve(pathTestStatus());
    else reject(new ApiFailure("HTTP 503: Native preparation unavailable", 503));
    await flushPromises();
    expect(wrapper.text()).not.toContain("Loading native test status");
    if (outcome === "failure") expect(wrapper.get('[role="alert"]').text()).toContain("HTTP 503");
    expect(api.startPathTest).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it.each(["success", "failure"] as const)("waits for dependent live-interface discovery before %s", async outcome => {
    let resolve!: (value: ReturnType<typeof pathTestInterfaces>) => void, reject!: (reason: Error) => void;
    vi.mocked(api.getDiscoveredInterfaces).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const wrapper = render(); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(button(wrapper, "Start paired test").attributes("disabled")).toBeDefined();
    if (outcome === "success") resolve(pathTestInterfaces());
    else reject(new ApiFailure("Discovery failed", 503));
    await flushPromises();
    if (outcome === "success") expect(wrapper.get('[aria-label="Local interface"]').text()).toContain("gre0");
    else expect(wrapper.text()).toContain("Discovery failed");
    wrapper.unmount();
  });
  it("generates and explicitly copies a masked one-time secret without storing it", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const wrapper = render(); await flushPromises();
    await button(wrapper, "Generate one-time secret").trigger("click");
    const field = wrapper.get<HTMLInputElement>('[aria-label="One-time pairing secret"]');
    expect(field.element.value).toMatch(/^[a-f0-9]{64}$/);
    expect(field.attributes("type")).toBe("password");
    expect(write).not.toHaveBeenCalled();
    await button(wrapper, "Copy one-time secret").trigger("click"); await flushPromises();
    expect(write).toHaveBeenCalledExactlyOnceWith(field.element.value);
    expect(wrapper.text()).toContain("Secret copied");
    expect(storage).not.toHaveBeenCalled();
    expect(useControllerStore().draft).toBeNull();
    wrapper.unmount();
  });
  it("shows unsupported state only after a real endpoint refusal", async () => {
    vi.mocked(api.getPathTests).mockRejectedValue(new ApiFailure("HTTP 404: Not found", 404));
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain("Deploy a backend with native path-test support");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(api.startPathTest).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it("requires explicit maxima and per-parent approvals, submits one request, clears the secret and preserves config", async () => {
    const store = useControllerStore(), original = JSON.stringify(store.state.data);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const wrapper = render(); await flushPromises();
    const interfaces = wrapper.get('[aria-label="Local interface"]').findAll("option").map(option => option.text());
    expect(interfaces).toContain("gre0");
    await fill(wrapper);
    expect(wrapper.get('[aria-label="Local source IP"]').findAll("option").map(option => option.text())).not.toContain("fe80::1");
    await button(wrapper, "Add ancestor").trigger("click");
    await wrapper.get('[aria-label="Ancestor 1"]').setValue("eno1");
    await wrapper.get('[aria-label="Ancestor 1 maximum MTU (bytes)"]').setValue("9100");
    await wrapper.get('[aria-label="Approve the selected interface and disruption above"]').setValue(true);
    expect(button(wrapper, "Start paired test").attributes("disabled")).toBeDefined();
    await wrapper.get('[aria-label="Approve temporary MTU changes on ancestor 1"]').setValue(true);
    await wrapper.get('[aria-label="Approve the selected interface and disruption above"]').setValue(true);
    expect(button(wrapper, "Start paired test").attributes("disabled")).toBeUndefined();
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(api.startPathTest).toHaveBeenCalledExactlyOnceWith(pathTestRequest(), expect.any(AbortSignal));
    expect(wrapper.get<HTMLInputElement>('[aria-label="One-time pairing secret"]').element.value).toBe("");
    expect(wrapper.text()).toContain("Waiting for the peer");
    expect(JSON.stringify(store.state.data)).toBe(original);
    expect(store.draft).toBeNull(); expect(storage).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("retains directional nulls, inconclusive errors and cleanup ownership after results complete", async () => {
    const sample: PathTestStatus = {
      ...pathTestStatus(true), state: "cleanup_failed", error: "Original MTU could not be restored",
      result: pathTestResult(), deadline_unix_ms: Date.parse("2026-11-05T05:10:00.123Z"),
      mtu_changes: [{
        interface: "vlan100", index: 4, kind: "vlan", address: [], parent: 2, approved: false,
        original_mtu: 1500, maximum_mtu: 9000, observed_mtu: null, identity_matches: false, restored: false,
      }],
    };
    const store = useControllerStore(); store.state.data!.desired.system = { hostname: "", domain: "", timezone: "Asia/Kolkata" };
    vi.mocked(api.getPathTests).mockResolvedValue(sample);
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain("Original MTU could not be restored");
    expect(wrapper.text()).toContain("Context only");
    expect(wrapper.text()).toContain("Peer authentication timed out");
    expect(wrapper.get("time").text()).toBe("2026-11-05 10:40:00");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-11-05T05:10:00.123Z");
    const inbound = wrapper.get('[aria-label="inbound UDP evidence"]');
    expect(inbound.text()).toContain("Unavailable");
    expect(inbound.findAll("tbody td").map(cell => cell.text())).toEqual(["3", "Unavailable", "Unavailable", "Unavailable", "Unavailable", "Unavailable", "Unavailable", "Unavailable", "verified"]);
    expect(button(wrapper, "Start paired test").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "Cancel and restore").attributes("disabled")).toBeUndefined();
    await button(wrapper, "Cancel and restore").trigger("click"); await flushPromises();
    expect(api.cancelPathTest).toHaveBeenCalledExactlyOnceWith("a".repeat(32), expect.any(AbortSignal));
    expect(store.pathTestWriteBlockedReason).not.toBe(""); wrapper.unmount();
  });
  it("clears unsubmitted secrets and approvals on firewall changes and never starts on mount", async () => {
    const wrapper = render(); await flushPromises(); await fill(wrapper);
    useControllerStore().sessionVersion++; await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[aria-label="One-time pairing secret"]').element.value).toBe("");
    expect(wrapper.get<HTMLSelectElement>('[aria-label="Local interface"]').element.value).toBe("");
    expect(api.startPathTest).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
