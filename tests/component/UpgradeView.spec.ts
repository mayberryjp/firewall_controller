import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UpgradeView from "@/views/UpgradeView.vue";
import { useControllerStore } from "@/stores/controller";
import type { SoftwareMetadata } from "@/types/domain";
import { state, software } from "../fixtures";

const stubs = {
  VAlert: { template: "<div><slot /></div>" },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
};
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.state.stale = false;
});
afterEach(() => { useControllerStore().$dispose(); vi.restoreAllMocks(); });
function render(metadata: Partial<SoftwareMetadata>) {
  useControllerStore().state.data!.desired.software = { ...software(), repository: "operator/appliance", ...metadata };
  return mount(UpgradeView, { global: { stubs } });
}
describe("simplified Config Upgrade page", () => {
  it.each(["disabled", "unavailable"])("permits default-repository checking with installation %s", async installation => {
    const store = useControllerStore();
    store.upgrade.data = installation === "disabled" ? { enabled: false, repository: null, job: null, last_successful_version: null } : null;
    store.upgrade.stale = true; store.upgrade.error = "Installation unavailable";
    const check = vi.spyOn(store, "checkSoftwareRelease").mockResolvedValue();
    const wrapper = render({ repository: "mayberryjp/firewall_backend" });
    try {
      expect(wrapper.get("button").attributes("disabled")).toBeUndefined();
      await wrapper.get("button").trigger("click"); expect(check).toHaveBeenCalledTimes(1);
      expect(wrapper.findAll("button")).toHaveLength(1);
      expect(wrapper.text()).not.toContain("Installation unavailable");
      expect(wrapper.text()).not.toContain("signing");
    } finally { wrapper.unmount(); }
  });
  it("disables checks only when discovery is disabled, regardless of installation support", () => {
    const store = useControllerStore();
    store.upgrade.data = { enabled: true, repository: "operator/appliance", job: null, last_successful_version: null };
    const wrapper = render({ repository: null });
    try {
      expect(wrapper.get("button").attributes("disabled")).toBeDefined();
      expect(wrapper.get('[role="status"]').text()).toBe("Checks disabled");
    } finally { wrapper.unmount(); }
  });
  it("shows only the requested fields and one check button, even when upgrade job details exist", () => {
    const store = useControllerStore();
    store.upgrade.data = { enabled: true, repository: "operator/appliance", last_successful_version: "2026.10.28.1",
      job: { id: "technical-job-id", version: "2026.10.29.2", status: "queued", created_at: "2026-10-29T00:00:00Z",
        updated_at: "2026-10-29T00:00:00Z", error: null, last_successful_version: null } };
    const refresh = vi.spyOn(store, "refreshUpgrade");
    const wrapper = render({ update_available: true, latest_version: "2026.10.29.10" });
    try {
      expect(wrapper.findAll("dt").map(field => field.text())).toEqual(["Current version", "New version", "Last checked (UTC)"]);
      expect(wrapper.findAll("button").map(button => button.text())).toEqual(["Check for upgrade"]);
      expect(wrapper.findAll("input, form, [role='dialog']")).toHaveLength(0);
      expect(wrapper.text()).not.toContain("operator/appliance"); expect(wrapper.text()).not.toContain("technical-job-id");
      expect(wrapper.text()).not.toContain("signing"); expect(refresh).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it("checks explicitly without installing or showing the previous result as fresh while waiting", async () => {
    const store = useControllerStore(), check = vi.spyOn(store, "checkSoftwareRelease").mockImplementation(async () => { store.softwareCheckPending = true; });
    const start = vi.spyOn(store, "startUpgrade");
    const wrapper = render({ update_available: false, latest_version: "2026.10.29.1" });
    try {
      expect(check).not.toHaveBeenCalled();
      await wrapper.get("button").trigger("click"); await flushPromises();
      expect(check).toHaveBeenCalledTimes(1); expect(start).not.toHaveBeenCalled();
      expect(wrapper.get('[role="status"]').text()).toBe("Checking..."); expect(wrapper.text()).not.toContain("Up to date");
      expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    } finally { wrapper.unmount(); }
  });
  it.each([
    [{ update_available: true, latest_version: "2026.10.29.10" }, "Update available: 2026.10.29.10"],
    [{ update_available: false, latest_version: "2026.10.29.1" }, "Up to date"],
    [{ update_available: false, latest_version: "2026.10.28.9" }, "Up to date"],
    [{}, "Not checked"],
    [{ repository: null }, "Checks disabled"],
    [{ error: "GitHub rate limit reached", last_checked_at: "2026-10-29T23:00:00Z" }, "Unable to check"],
  ] satisfies Array<[Partial<SoftwareMetadata>, string]>)("distinguishes release-check state %j", (metadata: Partial<SoftwareMetadata>, expected) => {
    const wrapper = render(metadata);
    try {
      expect(wrapper.get('[role="status"]').text()).toBe(expected);
      expect(wrapper.text()).toContain("2026.10.29.1");
      if (metadata.error) expect(wrapper.get('[role="alert"]').text()).toContain(metadata.error);
    } finally { wrapper.unmount(); }
  });
  it("formats fractional check timestamps only at the UTC display boundary", () => {
    const timestamp = "2026-10-29T23:00:01.123456789Z";
    const wrapper = render({ last_checked_at: timestamp });
    try {
      expect(wrapper.text()).toContain("Last checked (UTC)"); expect(wrapper.text()).toContain("2026-10-29 23:00:01");
      expect(wrapper.text()).not.toContain(timestamp);
      expect(useControllerStore().state.data!.desired.software!.last_checked_at).toBe(timestamp);
    } finally { wrapper.unmount(); }
  });
  it("keeps unavailable checks explicit instead of showing a stale success", async () => {
    const wrapper = render({ update_available: false });
    try {
      useControllerStore().state.stale = true; await flushPromises();
      expect(wrapper.get('[role="status"]').text()).toBe("Unavailable");
      expect(wrapper.get('[role="alert"]').text()).toContain("unavailable"); expect(wrapper.text()).not.toContain("Up to date");
      expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    } finally { wrapper.unmount(); }
  });
  it("keeps failed manual checks inline and does not present their previous result as a new success", async () => {
    const wrapper = render({ update_available: false });
    try {
      useControllerStore().softwareCheckError = "Release-check outcome is unknown. Explicitly retry.";
      await flushPromises();
      expect(wrapper.get('[role="status"]').text()).toBe("Unable to check");
      expect(wrapper.get('[role="alert"]').text()).toContain("outcome is unknown");
      expect(wrapper.findAll("button")).toHaveLength(1);
    } finally { wrapper.unmount(); }
  });
});
