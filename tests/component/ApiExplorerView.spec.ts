import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApiExplorerView from "@/views/ApiExplorerView.vue";
import { useControllerStore } from "@/stores/controller";
import * as api from "@/services/api";
import { config } from "../fixtures";

const stubs = {
  VCombobox: { name: "VCombobox", props: ["modelValue", "items", "disabled"], emits: ["update:modelValue"],
    template: '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)">' },
  VBtn: { props: ["disabled", "icon"], template: '<button :disabled="disabled" :data-icon="icon"><slot /></button>' },
  VAlert: { template: "<div><slot /></div>" },
  RouterLink: { template: "<a><slot /></a>" },
};
beforeEach(() => {
  setActivePinia(createPinia());
  useControllerStore().connected = true;
  vi.spyOn(api, "inspectApiPath").mockResolvedValue({ status: 200, body: '{"counter":18446744073709551615}' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function render(send = true) {
  const wrapper = mount(ApiExplorerView, { attachTo: document.body, global: { stubs } });
  if (send) { await wrapper.get("form").trigger("submit"); await flushPromises(); }
  return wrapper;
}

describe("API response selection and copying", () => {
  it.each(["ctrlKey", "metaKey"] as const)("limits %s+A to the response body", async modifier => {
    const wrapper = await render(), body = wrapper.get<HTMLElement>('[aria-label="Response body"]');
    body.element.focus();
    const event = new KeyboardEvent("keydown", { key: "a", [modifier]: true, bubbles: true, cancelable: true });
    body.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.getSelection()?.toString()).toBe(body.text());
    expect(document.getSelection()?.toString()).not.toContain("HTTP 200");
    const outside = new KeyboardEvent("keydown", { key: "a", [modifier]: true, bubbles: true, cancelable: true });
    wrapper.get("form").element.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
  });

  describe("interface capability GET actions", () => {
    const cachedPath = "/api/v1/interface-capabilities", refreshPath = `${cachedPath}/refresh`;
    const snapshot = JSON.stringify({ collected_at: "2026-11-04T05:10:00.123+00:00", scope: "simulator",
      inventory: { source: "simulator", status: "partial", kernel_release: null, boot_id: null, errors: ["Driver information unavailable"], interfaces: [] } });
    it("registers both labeled paths without scanning on mount or selection", async () => {
      const wrapper = await render(false);
      const items = wrapper.getComponent({ name: "VCombobox" }).props("items");
      expect(items).toContainEqual({ value: "/api/v1/statistics/performance", title: "/api/v1/statistics/performance" });
      expect(items).toContainEqual({ value: "/api/v1/diagnostics/path-tests", title: "/api/v1/diagnostics/path-tests" });
      expect(wrapper.text()).toContain("POST /api/v1/diagnostics/path-tests");
      expect(wrapper.text()).toContain("POST /api/v1/diagnostics/path-tests/{id}/cancel");
      expect(items).toContainEqual({ value: cachedPath, title: `${cachedPath} (Read saved interface capabilities)` });
      expect(items).toContainEqual({ value: refreshPath, title: `${refreshPath} (Scans hardware and saves)` });
      await wrapper.get("input").setValue(refreshPath);
      expect(wrapper.text()).toContain("Scans hardware and saves");
      expect(wrapper.text()).toContain("state.read and interfaces.write");
      expect(api.inspectApiPath).not.toHaveBeenCalled();
    });
    it("treats a completed null cached read as no snapshot, not pending or an empty simulated inventory", async () => {
      vi.mocked(api.inspectApiPath).mockResolvedValue({ status: 200, body: "null" });
      const wrapper = await render(false);
      await wrapper.get("input").setValue(cachedPath);
      expect(wrapper.text()).not.toContain("No saved capability snapshot");
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(api.inspectApiPath).toHaveBeenCalledExactlyOnceWith(cachedPath, expect.any(AbortSignal));
      expect(wrapper.text()).toContain("No saved capability snapshot");
      expect(wrapper.get('[aria-label="Response body"]').text()).toBe("null");
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });
    it("scans only on deliberate single-flight requests, replaces partial evidence and never changes drafts", async () => {
      const store = useControllerStore(); store.draft = config();
      const before = JSON.stringify(store.draft);
      let resolve!: (value: { status: number; body: string }) => void;
      vi.mocked(api.inspectApiPath).mockImplementation(() => new Promise(done => { resolve = done; }));
      const wrapper = await render(false);
      await wrapper.get("input").setValue(refreshPath);
      await wrapper.get("form").trigger("submit");
      await wrapper.get("form").trigger("submit");
      expect(api.inspectApiPath).toHaveBeenCalledExactlyOnceWith(refreshPath, expect.any(AbortSignal));
      expect(wrapper.get("input").attributes("disabled")).toBeDefined();
      expect(wrapper.find('[aria-label="Cancel request"]').exists()).toBe(false);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      resolve({ status: 200, body: snapshot }); await flushPromises();
      expect(wrapper.get('[aria-label="Response body"]').text()).toContain('"status": "partial"');
      expect(wrapper.get('[aria-label="Response body"]').text()).toContain("Driver information unavailable");
      expect(wrapper.get('[aria-label="Response body"]').text()).toContain("2026-11-04T05:10:00.123+00:00");
      expect(api.inspectApiPath).toHaveBeenCalledTimes(1);
      vi.mocked(api.inspectApiPath).mockResolvedValue({ status: 200, body: snapshot.replace('"partial"', '"simulated"') });
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(api.inspectApiPath).toHaveBeenCalledTimes(2);
      expect(wrapper.get('[aria-label="Response body"]').text()).toContain('"status": "simulated"');
      expect(JSON.stringify(store.draft)).toBe(before);
    });
    it.each([400, 401, 403, 409, 500, 503])("retains prior capability evidence as stale after HTTP %s", async status => {
      const wrapper = await render(false);
      await wrapper.get("input").setValue(cachedPath);
      vi.mocked(api.inspectApiPath).mockResolvedValue({ status: 200, body: snapshot });
      await wrapper.get("form").trigger("submit"); await flushPromises();
      await wrapper.get("input").setValue(refreshPath);
      vi.mocked(api.inspectApiPath).mockResolvedValue({ status, body: '{"error":"Capability request rejected"}' });
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toContain(`HTTP ${status}`);
      expect(wrapper.get('[role="alert"]').text()).toContain("Capability request rejected");
      expect(wrapper.get('[role="status"]').text()).toContain("Stale: previous saved capabilities");
      expect(wrapper.get('[aria-label="Response body"]').text()).toContain("Driver information unavailable");
      expect(api.inspectApiPath).toHaveBeenCalledTimes(2);
      if (status === 403) {
        expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
        await wrapper.get("form").trigger("submit"); await flushPromises();
        expect(api.inspectApiPath).toHaveBeenCalledTimes(2);
        expect(wrapper.get('[role="alert"]').text()).toContain("interfaces.write");
        await wrapper.get("input").setValue(cachedPath);
        expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeUndefined();
      }
    });
    it("shows failed initial capability reads without a fake empty snapshot", async () => {
      const wrapper = await render(false);
      await wrapper.get("input").setValue(cachedPath);
      vi.mocked(api.inspectApiPath).mockRejectedValue(new Error("Connection failed"));
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toContain("Connection failed");
      expect(wrapper.find('[aria-label="Response body"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("No saved capability snapshot");
    });
    it("retains old evidence on uncertain refresh failure and clears session-specific evidence and denial", async () => {
      const wrapper = await render(false);
      await wrapper.get("input").setValue(cachedPath);
      vi.mocked(api.inspectApiPath).mockResolvedValue({ status: 200, body: snapshot });
      await wrapper.get("form").trigger("submit"); await flushPromises();
      await wrapper.get("input").setValue(refreshPath);
      vi.mocked(api.inspectApiPath).mockRejectedValue(new Error("Connection failed"));
      await wrapper.get("form").trigger("submit"); await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toContain("outcome is unknown");
      expect(wrapper.get('[role="status"]').text()).toContain("Stale");
      vi.mocked(api.inspectApiPath).mockResolvedValue({ status: 403, body: "interfaces.write required" });
      await wrapper.get("form").trigger("submit"); await flushPromises();
      useControllerStore().sessionVersion++; await flushPromises();
      expect(wrapper.find('[aria-label="Response body"]').exists()).toBe(false);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeUndefined();
    });
  });
  it("does not intercept unmodified A or Ctrl+Alt+A", async () => {
    const wrapper = await render();
    for (const modifiers of [{}, { ctrlKey: true, altKey: true }]) {
      const event = new KeyboardEvent("keydown", { key: "a", ...modifiers, bubbles: true, cancelable: true });
      wrapper.get('[aria-label="Response body"]').element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });
  it("copies only the formatted response with full numeric precision and inline feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const wrapper = await render();
    await wrapper.get('[aria-label="Copy response to clipboard"]').trigger("click"); await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('{\n  "counter": 18446744073709551615\n}');
    expect(wrapper.get('[role="status"]').text()).toBe("Copied");
    expect(wrapper.get('[aria-label="Copy response to clipboard"]').attributes("data-icon")).toBe("mdi-check");
    useControllerStore().sessionVersion++; await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="API response"]').exists()).toBe(false);
  });
  it.each(["unavailable", "denied"])("reports %s clipboard access inline without claiming success", async reason => {
    vi.stubGlobal("navigator", reason === "unavailable" ? {} : {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) },
    });
    const wrapper = await render();
    await wrapper.get('[aria-label="Copy response to clipboard"]').trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Unable to copy response");
    expect(wrapper.get('[role="alert"]').text()).toContain("copy it manually");
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
  it("does not show stale clipboard feedback after fetching another response", async () => {
    let resolve!: () => void;
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockImplementation(() => new Promise<void>(done => { resolve = done; })) } });
    const wrapper = await render();
    await wrapper.get('[aria-label="Copy response to clipboard"]').trigger("click");
    expect(wrapper.get('[aria-label="Copy response to clipboard"]').attributes("disabled")).toBeDefined();
    vi.mocked(api.inspectApiPath).mockResolvedValue({ status: 503, body: "Worker unavailable" });
    await wrapper.get("form").trigger("submit"); await flushPromises();
    resolve(); await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Response body"]').text()).toBe("Worker unavailable");
  });
  it("copies an empty body rather than the empty-response placeholder", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.mocked(api.inspectApiPath).mockResolvedValue({ status: 204, body: "" });
    const wrapper = await render();
    await wrapper.get('[aria-label="Copy response to clipboard"]').trigger("click"); await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith("");
  });
});
