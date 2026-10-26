import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppHeader from "@/components/layout/AppHeader.vue";
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

describe("navbar device name", () => {
  it.each([
    ["fw-1", "home.example.test", "fw-1.home.example.test"],
    ["fw-1", "", "fw-1"],
    ["", "home.example.test", ""],
    ["", "", ""],
  ])("displays hostname %j and domain %j without inventing missing names", async (hostname, domain, expected) => {
    useControllerStore().state.data!.desired.system = { hostname, domain, timezone: "" };
    const wrapper = await render();
    try {
      const label = wrapper.find('[aria-label="Device name"]');
      expect(label.exists()).toBe(Boolean(expected));
      if (expected) {
        expect(label.text()).toBe(expected);
        expect(label.attributes("title")).toBe(expected);
      }
    } finally { wrapper.unmount(); }
  });
  it("uses committed identity rather than a draft and reacts to commits and disconnects", async () => {
    const store = useControllerStore();
    store.state.data!.desired.system = { hostname: "fw-1", domain: "example.test", timezone: "" };
    store.draft = cloneConfig(store.state.data!.desired);
    store.draft.system!.domain = "pending.test";
    const wrapper = await render();
    try {
      expect(wrapper.get(".device-name").text()).toBe("fw-1.example.test");
      const committed = cloneConfig(store.state.data!.desired);
      committed.system!.domain = "committed.test";
      store.state.data = { ...store.state.data!, desired: committed };
      await flushPromises();
      expect(wrapper.get(".device-name").text()).toBe("fw-1.committed.test");
      store.connected = false;
      await flushPromises();
      expect(wrapper.find(".device-name").exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it("does not show a device label without committed configuration", async () => {
    useControllerStore().state.data = null;
    const wrapper = await render();
    expect(wrapper.find(".device-name").exists()).toBe(false);
    wrapper.unmount();
  });
});
