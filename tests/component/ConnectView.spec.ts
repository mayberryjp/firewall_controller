import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectView from "@/views/ConnectView.vue";
import * as registry from "@/services/registry";

vi.mock("vue-router", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useRoute: () => ({ query: {} }),
}));

const device: registry.RegistryDevice = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Office firewall",
  address: "https://192.0.2.1:8080",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function connectView() {
  return mount(ConnectView, { global: { stubs: {
    VAlert: { template: '<div role="alert"><slot /></div>' },
    VCard: { template: "<div><slot /></div>" },
    VForm: { template: "<form><slot /></form>" },
    VTextField: {
      props: ["modelValue", "label"],
      emits: ["update:modelValue"],
      template: '<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    VBtn: {
      props: ["disabled", "loading"],
      template: '<button :disabled="disabled"><slot /></button>',
    },
  } } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  registry.setRegistrySessionToken("");
});

afterEach(() => {
  registry.setRegistrySessionToken("");
  vi.restoreAllMocks();
});

describe.each(["sign-in", "session restore"] as const)("firewall list during %s", entry => {
  async function loadPendingList() {
    const pending = deferred<registry.RegistryDevice[]>();
    vi.spyOn(registry, "listRegistryDevices").mockReturnValue(pending.promise);
    vi.spyOn(registry, "restoreRegistrySession").mockImplementation(async () => {
      if (entry === "sign-in") return false;
      registry.setRegistrySessionToken("test-session");
      return true;
    });
    vi.spyOn(registry, "loginRegistry").mockImplementation(async () => {
      registry.setRegistrySessionToken("test-session");
    });
    const wrapper = connectView();
    await flushPromises();
    if (entry === "sign-in") {
      await wrapper.get('input[aria-label="Registry admin password"]').setValue("test-password");
      await wrapper.get("form").trigger("submit");
      await flushPromises();
    }
    expect(registry.listRegistryDevices).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("Saved firewalls");
    expect(wrapper.find("details").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("No firewalls are registered yet.");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    return { wrapper, pending };
  }

  it("keeps the add form hidden while loading and collapsed for saved firewalls", async () => {
    const { wrapper, pending } = await loadPendingList();
    pending.resolve([device]);
    await flushPromises();
    expect(wrapper.text()).toContain(device.name);
    expect(wrapper.get("details").element.open).toBe(false);
    expect(wrapper.text()).not.toContain("No firewalls are registered yet.");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);

    await wrapper.findAll("button").find(button => button.text() === "Edit")!.trigger("click");
    expect(wrapper.get("details").element.open).toBe(true);
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Device name"]').element.value).toBe(device.name);
    await wrapper.findAll("button").find(button => button.text() === "Cancel")!.trigger("click");
    expect(wrapper.get("details").element.open).toBe(false);
  });

  it("opens the add form only after confirming the registry is empty", async () => {
    const { wrapper, pending } = await loadPendingList();
    pending.resolve([]);
    await flushPromises();
    expect(wrapper.text()).toContain("No firewalls are registered yet.");
    expect(wrapper.get("details").element.open).toBe(true);
    expect(wrapper.get("summary").text()).toBe("Add firewall");
  });

  it("shows a list failure without presenting it as an empty registry", async () => {
    const { wrapper, pending } = await loadPendingList();
    pending.reject(new Error("Unable to load saved firewalls"));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("Unable to load saved firewalls");
    expect(wrapper.text()).not.toContain("No firewalls are registered yet.");
    expect(wrapper.find("details").exists()).toBe(false);
  });
});
