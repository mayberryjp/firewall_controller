import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppHeader from "@/components/layout/AppHeader.vue";
import ConnectionStatus from "@/components/layout/ConnectionStatus.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { state } from "../fixtures";

vi.mock("vuetify", () => ({ useDisplay: () => ({ lgAndUp: true }) }));
beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true;
  store.state.data = state();
});
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push("/overview");
  await router.isReady();
  return mount(AppHeader, { global: { plugins: [router], stubs: {
    VAppBar: { template: "<header><slot /></header>" }, VBtn: true, VIcon: true, VSpacer: true,
    ConnectionStatus: true, MobileCategoryMenu: true,
  } } });
}

describe("navbar configuration status", () => {
  it.each([
    ["fw-1", "example.test", "fw-1.example.test"],
    ["fw-1", "", "fw-1"],
    ["", "example.test", "example.test"],
    ["", "", undefined],
  ])("shows committed identity in the Settings gear tooltip (%j, %j)", async (hostname, domain, expected) => {
    useControllerStore().state.data!.desired.system = { hostname, domain, timezone: "" };
    const wrapper = await render();
    try {
      const settings = wrapper.find('[aria-label="Settings"]');
      expect(settings.attributes("title")).toBe(expected);
      expect(wrapper.findAll("[title]")).toHaveLength(expected ? 2 : 1);
    } finally { wrapper.unmount(); }
  });
  it.each([
    ["fw-1", "home.example.test"],
    ["fw-1", ""],
    ["", "home.example.test"],
    ["", ""],
  ])("does not display hostname %j or domain %j below the revision", async (hostname, domain) => {
    useControllerStore().state.data!.desired.system = { hostname, domain, timezone: "" };
    const wrapper = await render();
    try {
      expect(wrapper.find('[aria-label="Device name"]').exists()).toBe(false);
      expect(wrapper.find(".device-name").exists()).toBe(false);
      if (hostname) expect(wrapper.text()).not.toContain(hostname);
      if (domain) expect(wrapper.text()).not.toContain(domain);
      expect(wrapper.findComponent(ConnectionStatus).exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });
  it("keeps the identity hidden across drafts, commits and disconnects", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "fw-1", domain: "example.test", timezone: "" };
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.system!.domain = "pending.test";
    const wrapper = await render();
    try {
      expect(wrapper.find(".device-name").exists()).toBe(false);
      expect(wrapper.find('[aria-label="Settings"]').attributes("title")).toBe("fw-1.example.test");
      const committed = cloneConfig(store.state.data!.desired);
      committed.system!.domain = "committed.test";
      store.state.data = { ...store.state.data!, desired: committed };
      await flushPromises();
      expect(wrapper.find(".device-name").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("fw-1");
      expect(wrapper.text()).not.toContain("committed.test");
      expect(wrapper.text()).not.toContain("pending.test");
      expect(wrapper.find('[aria-label="Settings"]').attributes("title")).toBe("fw-1.committed.test");
      store.connected = false;
      await flushPromises();
      expect(wrapper.find(".device-name").exists()).toBe(false);
      expect(wrapper.find('[aria-label="Settings"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it("does not show a device label without committed configuration", async () => {
    useControllerStore().state.data = null;
    const wrapper = await render();
    expect(wrapper.find(".device-name").exists()).toBe(false);
    expect(wrapper.find('[aria-label="Settings"]').attributes("title")).toBeUndefined();
    wrapper.unmount();
  });
});
