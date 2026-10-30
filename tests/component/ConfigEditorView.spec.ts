import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfigEditorView from "@/views/ConfigEditorView.vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { config, state } from "../fixtures";

const stubs = {
  VBtn: { props: ["disabled", "type"], template: '<button :disabled="disabled" :type="type || \'button\'"><slot /></button>' },
  VAlert: { template: "<div><slot /></div>" },
  RouterLink: { template: "<a><slot /></a>" },
};
let wrapper: VueWrapper;
const editor = () => wrapper.get<HTMLTextAreaElement>("textarea");
const saveButton = () => wrapper.get('button[type="submit"]');
const resetButton = () => wrapper.findAll("button").find(button => button.text() === "Reset editor")!;
async function save(value: unknown): Promise<void> {
  await editor().setValue(typeof value === "string" ? value : JSON.stringify(value));
  await wrapper.get("form").trigger("submit");
}

beforeEach(() => {
  setActivePinia(createPinia());
  const store = useControllerStore();
  store.connected = true;
  store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
  wrapper = mount(ConfigEditorView, { global: { stubs } });
});
afterEach(() => {
  wrapper.unmount(); useControllerStore().$dispose(); vi.restoreAllMocks();
});

describe("raw configuration editor", () => {
  it("loads editable desired JSON without read-only software metadata", () => {
    expect(JSON.parse(editor().element.value)).toEqual(config());
    expect(saveButton().attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Save stages your edits");
    expect(useControllerStore().editorDirty).toBe(false);
  });

  it("loads the shared draft instead of committed desired configuration", async () => {
    const store = useControllerStore(), candidate = config();
    candidate.firewall.allow_all_icmp = false;
    store.stage(candidate);
    await flushPromises();
    expect(JSON.parse(editor().element.value)).toEqual(candidate);
    expect(store.editorDirty).toBe(false);
  });

  it("stages valid edits without applying and preserves unknown configuration sections", async () => {
    const store = useControllerStore(), apply = vi.spyOn(store, "apply");
    const candidate = config();
    candidate.firewall.allow_all_icmp = false;
    candidate.future_section = { enabled: true };
    await save(candidate);
    expect(store.draft).toEqual(candidate);
    expect(store.baseline).toEqual(cloneConfig(state().desired));
    expect(store.baseRevision).toBe(state().revision);
    expect(store.state.data?.desired.firewall.allow_all_icmp).toBe(true);
    expect(store.editorDirty).toBe(false);
    expect(wrapper.text()).toContain("Configuration staged.");
    expect(JSON.parse(editor().element.value)).toEqual(candidate);
    expect(apply).not.toHaveBeenCalled();
    expect(saveButton().attributes("disabled")).toBeDefined();
  });

  it.each([
    ["invalid JSON", '{"firewall":'],
    ["invalid schema", { ...config(), firewall: { policy: "invalid" } }],
    ["invalid reference", { ...config(), routes: [{ ...config().routes[0], interface: "missing" }] }],
    ["unsafe number", JSON.stringify(config()).replace('"metric":1', '"metric":9007199254740993')],
    ["oversized JSON", " ".repeat(1_048_577)],
    ["read-only metadata", state().desired],
  ])("rejects %s inline without changing the existing draft", async (_name, value) => {
    const store = useControllerStore(), candidate = config();
    candidate.firewall.allow_all_icmp = false;
    store.stage(candidate); await flushPromises();
    const stage = vi.spyOn(store, "stage");
    await save(value);
    expect(wrapper.get('[role="alert"]').text()).toContain("Configuration was not saved:");
    expect(editor().attributes("aria-invalid")).toBe("true");
    expect(store.draft).toEqual(candidate);
    expect(store.editorDirty).toBe(true);
    expect(stage).not.toHaveBeenCalled();
  });

  it("tracks unsaved edits and clears dirty state when unmounted", async () => {
    const original = editor().element.value, store = useControllerStore();
    await editor().setValue(`${original}\n`);
    expect(store.editorDirty).toBe(true);
    await editor().setValue(original);
    expect(store.editorDirty).toBe(false);
    await editor().setValue("{}");
    wrapper.unmount();
    expect(store.editorDirty).toBe(false);
  });

  it("preserves typed edits across unchanged polling responses", async () => {
    await editor().setValue('{"unfinished":');
    const store = useControllerStore();
    store.state.data = state(); await flushPromises();
    expect(editor().element.value).toBe('{"unfinished":');
    expect(wrapper.text()).not.toContain("Configuration changed while");
    expect(saveButton().attributes("disabled")).toBeUndefined();
  });

  it.each(["revision", "desired", "draft"] as const)("blocks overwriting a changed %s until the editor is reset", async target => {
    const store = useControllerStore(), candidate = config();
    candidate.firewall.allow_all_icmp = false;
    await editor().setValue(JSON.stringify(candidate));
    if (target === "revision") store.state.data = { ...state(), revision: "2026.10.29.2" };
    if (target === "desired") store.state.data = { ...state(), desired: { ...config(), ntp: { enabled: true, servers: ["192.0.2.1"] } } };
    if (target === "draft") store.stage({ ...config(), ntp: { enabled: true, servers: ["192.0.2.1"] } });
    await flushPromises();
    expect(JSON.parse(editor().element.value)).toEqual(candidate);
    expect(wrapper.text()).toContain("Configuration changed while you were editing");
    expect(saveButton().attributes("disabled")).toBeDefined();
    const stage = vi.spyOn(store, "stage");
    await wrapper.get("form").trigger("submit");
    expect(stage).not.toHaveBeenCalled();
    await resetButton().trigger("click");
    expect(JSON.parse(editor().element.value)).toEqual(cloneConfig(store.draft ?? store.state.data!.desired));
    expect(store.editorDirty).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("resets only editor input, retaining other staged changes", async () => {
    const store = useControllerStore(), candidate = config();
    candidate.firewall.allow_all_icmp = false;
    store.stage(candidate); await flushPromises();
    await editor().setValue("{}");
    await resetButton().trigger("click");
    expect(store.draft).toEqual(candidate);
    expect(JSON.parse(editor().element.value)).toEqual(candidate);
    expect(store.editorDirty).toBe(false);
  });

  it.each(["busy", "submitted", "uncertain"] as const)("blocks saving while %s freezes the shared draft", async key => {
    const store = useControllerStore();
    await editor().setValue(JSON.stringify({ ...config(), ntp: { enabled: true, servers: ["192.0.2.1"] } }));
    if (key === "busy") store.busy = true;
    if (key === "submitted") store.submitted = { config: config() };
    if (key === "uncertain") store.uncertain = { operation: "apply", priorIDs: [], base: state().revision, startedAt: "2026-10-30T00:00:00Z" };
    await flushPromises();
    expect(saveButton().attributes("disabled")).toBeDefined();
    expect(editor().attributes("readonly")).toBeDefined();
    await wrapper.get("form").trigger("submit");
    expect(store.draft).toBeNull();
    expect(wrapper.get('[role="alert"]').text()).toContain("frozen");
  });

  it("shows neutral initial loading and then loads the configuration", async () => {
    const store = useControllerStore();
    store.state.data = null; store.state.lastSuccess = null; store.state.loading = true;
    await flushPromises();
    expect(wrapper.text()).toContain("Loading configuration...");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(saveButton().attributes("disabled")).toBeDefined();
    store.state.data = state(); store.state.lastSuccess = Date.now(); store.state.loading = false;
    await flushPromises();
    expect(wrapper.text()).not.toContain("Loading configuration...");
    expect(JSON.parse(editor().element.value)).toEqual(config());
  });

  it("shows actual initial read failures instead of loading indefinitely", async () => {
    const store = useControllerStore();
    store.state.data = null; store.state.lastSuccess = null; store.state.loading = true;
    await flushPromises();
    store.state.loading = false; store.state.error = "Permission denied";
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Permission denied");
    expect(wrapper.text()).not.toContain("Loading configuration...");
    expect(saveButton().attributes("disabled")).toBeDefined();
  });

  it("clears editor text when disconnecting rather than leaking edits to another session", async () => {
    await editor().setValue('{"unfinished":');
    useControllerStore().disconnect();
    await flushPromises();
    expect(editor().element.value).toBe("");
    expect(useControllerStore().editorDirty).toBe(false);
  });
});
