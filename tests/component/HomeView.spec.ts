import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectView from "@/views/ConnectView.vue";
import FieldInput from "@/components/base/FieldInput.vue";
import { useControllerStore } from "@/stores/controller";
vi.mock("vue-router", () => ({ useRouter: () => ({ replace: vi.fn() }), useRoute: () => ({ query: {} }) }));
beforeEach(() => setActivePinia(createPinia()));
describe("connection and editor contracts", () => {
  it("explains registry sign-in and controller-proxied firewall access", () => {
    const wrapper = mount(ConnectView, { global: {
      stubs: { VAlert: true, VCard: { template: "<div><slot /></div>" }, VForm: { template: "<form><slot /></form>" }, VTextField: true, VBtn: true },
    } });
    expect(wrapper.get("h1").text()).toBe("Connect to a firewall");
    expect(wrapper.text()).toContain("central device registry");
    expect(wrapper.text()).toContain("Device records and encrypted firewall keys persist on the controller");
    expect(wrapper.text()).toContain("without returning saved keys to the browser");
    expect(useControllerStore().connected).toBe(false);
  });
  it("splits address lines into separate values without rewriting host bits", async () => {
    const wrapper = mount(FieldInput, {
      props: { field: { key: "addresses", label: "Addresses", kind: "lines" }, modelValue: [], path: "editor.addresses" },
      global: { stubs: { VTextarea: { props: ["modelValue"], emits: ["update:modelValue"], template: '<textarea @input="$emit(\'update:modelValue\', $event.target.value)" />' } } },
    });
    await wrapper.get("textarea").setValue("192.0.2.10/24\n2001:db8::10/64");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["192.0.2.10/24", "2001:db8::10/64"]]);
  });
});
