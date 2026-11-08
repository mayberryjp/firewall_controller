import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsView from "@/views/NotificationsView.vue";
import { useControllerStore } from "@/stores/controller";
import { getDiscordStatus, uploadDiscordWebhook } from "@/services/netcontrol";
import { cloneConfig, requiredPermissions } from "@/services/configuration";
import { state } from "../fixtures";
import { discordStatus, webhookReference, webhookUrl } from "../discordFixtures";
import { discordDefaults } from "@/services/discord";

vi.mock("@/services/netcontrol", async importOriginal => ({
  ...await importOriginal<typeof import("@/services/netcontrol")>(),
  getDiscordStatus: vi.fn(), uploadDiscordWebhook: vi.fn(),
}));
const stubs = {
  VDivider: true,
  VChip: { name: "VChip", props: ["color", "variant", "size"], template: "<span><slot /></span>" },
  VBtn: { props: ["disabled", "type"], template: '<button :disabled="disabled" :type="type || \'button\'"><slot /></button>' },
  VAlert: { template: "<div><slot /></div>" },
  VSwitch: {
    props: ["modelValue", "disabled", "id", "ariaLabel"], emits: ["update:modelValue"],
    template: '<input type="checkbox" :id="id" :aria-label="ariaLabel" :disabled="disabled" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
  VTextField: {
    props: ["modelValue", "disabled", "id", "ariaLabel", "type"], emits: ["update:modelValue"],
    template: '<div><input :id="id" :aria-label="ariaLabel" :type="type" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
  },
};
let wrapper: ReturnType<typeof mount> | undefined;
const secret = () => wrapper!.get<HTMLInputElement>('[aria-label="Discord webhook URL"]');
const enabled = () => wrapper!.get<HTMLInputElement>('[aria-label="Enable firewall drop notifications"]');
const save = () => wrapper!.get('button[type="submit"]');
const start = async () => { wrapper = mount(NotificationsView, { global: { stubs } }); await flushPromises(); };
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const store = useControllerStore();
  store.connected = true; store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
  store.transactions.data = {}; store.transactions.stale = false;
  vi.mocked(getDiscordStatus).mockResolvedValue(discordStatus());
  vi.mocked(uploadDiscordWebhook).mockResolvedValue({ webhook_ref: webhookReference });
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; useControllerStore().$dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Notification settings", () => {
  it("provides independent default-off category switches in the existing row layout", async () => {
    await start();
    for (const label of ["Broadcast drop notifications", "TCP FIN/RST/empty ACK notifications"]) {
      const input = wrapper!.get<HTMLInputElement>(`input[aria-label="${label}"]`);
      expect(input.element.checked).toBe(false);
      expect(input.attributes("disabled")).toBeUndefined();
      expect(input.element.closest(".setting-row")?.querySelector(".setting-name")?.textContent?.trim()).toBe(label);
    }
  });
  it.each([
    [true, false], [false, true], [true, true],
  ])("stages category-only changes broadcast=%s TCP=%s without uploading, applying or losing the stored reference", async (broadcast, tcp) => {
    const store = useControllerStore();
    store.state.data!.desired.discord = { ...discordDefaults(), enabled: true, webhook_ref: webhookReference };
    const apply = vi.spyOn(store, "apply");
    await start();
    await wrapper!.get('input[aria-label="Broadcast drop notifications"]').setValue(broadcast);
    await wrapper!.get('input[aria-label="TCP FIN/RST/empty ACK notifications"]').setValue(tcp);
    await wrapper!.get("form").trigger("submit"); await flushPromises();
    expect(store.draft!.discord).toEqual({
      ...discordDefaults(), enabled: true, webhook_ref: webhookReference, notify_broadcast: broadcast, notify_tcp_closures: tcp,
    });
    expect(requiredPermissions(store.diff)).toEqual(["transactions.write", "discord.write"]);
    expect(uploadDiscordWebhook).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("matches General Settings rows, password field and Save action without extra panels", async () => {
    await start();
    expect(wrapper!.findAll(".setting-row")).toHaveLength(5);
    expect(wrapper!.findAll(".setting-name").map(label => label.text())).toEqual([
      "Enable firewall drop notifications", "Webhook URL", "Broadcast drop notifications",
      "TCP FIN/RST/empty ACK notifications", "Notification status",
    ]);
    expect(wrapper!.get("h1").text()).toBe("Firewall drop notifications");
    expect(wrapper!.get("#notifications-discord-description").text()).toContain("Discord alerts for newly seen firewall drops");
    expect(wrapper!.text()).toContain("Notification status");
    expect(wrapper!.text()).not.toContain("Committed delivery");
    const chips = wrapper!.findAllComponents({ name: "VChip" });
    expect(chips.map(chip => [chip.text(), chip.props("color")])).toEqual([
      ["Delivered: 0", "success"], ["Failed: 0", "error"],
    ]);
    expect(wrapper!.text()).not.toContain("Counts for this session");
    expect(wrapper!.get(".settings-head").text()).toBe("Setting");
    expect(secret().attributes("type")).toBe("password");
    expect(wrapper!.get(".setting-field").attributes("variant")).toBeUndefined();
    expect(save().attributes("prepend-icon")).toBe("mdi-content-save-outline");
    expect(wrapper!.findAll("button").map(button => button.text())).toEqual(["Save"]);
    expect(wrapper!.findAll("details, [role='dialog']")).toHaveLength(0);
    expect(enabled().element.checked).toBe(false);
    expect(save().attributes("disabled")).toBeDefined();
    expect(uploadDiscordWebhook).not.toHaveBeenCalled();
  });
  it("uploads privately, clears the input, and stages only the reference without applying or confirming", async () => {
    await start();
    const store = useControllerStore(), apply = vi.spyOn(store, "apply"), lifecycle = vi.spyOn(store, "lifecycle");
    await enabled().setValue(true); await secret().setValue(webhookUrl);
    expect(store.editorDirty).toBe(true);
    await wrapper!.get("form").trigger("submit"); await flushPromises();
    expect(uploadDiscordWebhook).toHaveBeenCalledExactlyOnceWith(webhookUrl, expect.any(AbortSignal));
    expect(secret().element.value).toBe("");
    expect(wrapper!.findAll(".setting-row")[1]!.get(".setting-name").text()).toBe("Replacement webhook URL");
    expect(store.draft?.discord).toEqual({ ...discordDefaults(), enabled: true, webhook_ref: webhookReference });
    expect(JSON.stringify(store.draft)).not.toContain(webhookUrl);
    expect(wrapper!.text()).not.toContain(webhookUrl);
    expect(wrapper!.text()).toContain("Webhook stored; notification changes staged");
    expect(wrapper!.findAllComponents({ name: "VChip" }).map(chip => chip.text())).toEqual(["Delivered: 0", "Failed: 0"]);
    expect(requiredPermissions(store.diff)).toEqual(["transactions.write", "discord.write"]);
    expect(store.editorDirty).toBe(false);
    expect(apply).not.toHaveBeenCalled(); expect(lifecycle).not.toHaveBeenCalled();
  });
  it("requires a stored webhook for enabling and keeps existing references when disabling", async () => {
    await start(); await enabled().setValue(true);
    await wrapper!.get("form").trigger("submit"); await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain("Enter a webhook");
    expect(uploadDiscordWebhook).not.toHaveBeenCalled();
    wrapper!.unmount();
    const store = useControllerStore(), desired = cloneConfig(store.state.data!.desired);
    desired.discord = { ...discordDefaults(), enabled: true, webhook_ref: webhookReference };
    store.state.data = { ...store.state.data!, desired };
    await start();
    expect(wrapper!.text()).toContain("Replacement webhook URL");
    await enabled().setValue(false); await wrapper!.get("form").trigger("submit"); await flushPromises();
    expect(store.draft?.discord).toEqual({ ...discordDefaults(), enabled: false, webhook_ref: webhookReference });
    expect(uploadDiscordWebhook).not.toHaveBeenCalled();
  });
  it("keeps pending reads neutral, then establishes support on success", async () => {
    let resolve!: (value: ReturnType<typeof discordStatus>) => void;
    vi.mocked(getDiscordStatus).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    wrapper = mount(NotificationsView, { global: { stubs } }); await flushPromises();
    expect(wrapper.text()).toContain("Loading notifications");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findAllComponents({ name: "VChip" })).toHaveLength(0);
    expect(enabled().attributes("disabled")).toBeDefined();
    expect(wrapper.findAll('input[type="checkbox"]').every(input => input.attributes("disabled") !== undefined)).toBe(true);
    resolve(discordStatus()); await flushPromises();
    expect(enabled().attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).not.toContain("Loading notifications");
    expect(wrapper.findAllComponents({ name: "VChip" }).map(chip => chip.text())).toEqual(["Delivered: 0", "Failed: 0"]);
  });
  it("shows actual initial read failure, keeps controls disabled and recovers through Retry", async () => {
    vi.mocked(getDiscordStatus).mockRejectedValueOnce(new Error("HTTP 404: Discord support unavailable"));
    await start();
    expect(wrapper!.get('[role="alert"]').text()).toContain("HTTP 404");
    expect(enabled().attributes("disabled")).toBeDefined();
    await wrapper!.findAll("button").find(button => button.text() === "Retry")!.trigger("click"); await flushPromises();
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    expect(enabled().attributes("disabled")).toBeUndefined();
  });
  it.each(["success", "failure"])("keeps pending configuration neutral until %s", async outcome => {
    const store = useControllerStore();
    store.state.data = null; store.state.lastSuccess = null; store.state.loading = true;
    await start();
    expect(wrapper!.text()).toContain("Loading notifications");
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    expect(enabled().attributes("disabled")).toBeDefined();
    store.state.loading = false;
    if (outcome === "success") {
      store.state.data = state(); store.state.lastSuccess = Date.now();
      await flushPromises();
      expect(enabled().attributes("disabled")).toBeUndefined();
    } else {
      store.state.error = "Unable to read configuration"; await flushPromises();
      expect(wrapper!.get('[role="alert"]').text()).toContain("Unable to read configuration");
      expect(enabled().attributes("disabled")).toBeDefined();
    }
    expect(wrapper!.text()).not.toContain("Loading notifications");
  });
  it("retains existing drafts and clears raw input on upload failure", async () => {
    const store = useControllerStore(), existing = cloneConfig(store.state.data!.desired);
    existing.routes[0]!.metric = 2; store.stage(existing);
    vi.mocked(uploadDiscordWebhook).mockRejectedValueOnce(new Error("Webhook upload failed (HTTP 403)."));
    await start(); await enabled().setValue(true); await secret().setValue(webhookUrl);
    await wrapper!.get("form").trigger("submit"); await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain("HTTP 403");
    expect(secret().element.value).toBe("");
    expect(store.draft).toEqual(existing);
    expect(enabled().element.checked).toBe(true);
  });
  it("merges unrelated draft changes arriving during private upload", async () => {
    let resolve!: (value: { webhook_ref: string }) => void;
    vi.mocked(uploadDiscordWebhook).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await start(); await enabled().setValue(true); await secret().setValue(webhookUrl);
    await wrapper!.get("form").trigger("submit"); await flushPromises();
    const store = useControllerStore(), candidate = cloneConfig(store.state.data!.desired);
    candidate.routes[0]!.metric = 9; store.stage(candidate);
    resolve({ webhook_ref: webhookReference }); await flushPromises();
    expect(store.draft?.routes[0]?.metric).toBe(9);
    expect(store.draft?.discord?.enabled).toBe(true);
  });
  it("does not apply old-device upload replies and clears raw input on session change", async () => {
    let resolve!: (value: { webhook_ref: string }) => void;
    vi.mocked(uploadDiscordWebhook).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await start(); await enabled().setValue(true); await secret().setValue(webhookUrl);
    await wrapper!.get("form").trigger("submit"); await flushPromises();
    const store = useControllerStore(); store.disconnect(); await flushPromises();
    resolve({ webhook_ref: webhookReference }); await flushPromises();
    expect(store.draft).toBeNull();
    expect(secret().element.value).toBe("");
    expect(store.editorDirty).toBe(false);
  });
  it("does not let late old-device uploads clear edits on a new connection", async () => {
    let resolve!: (value: { webhook_ref: string }) => void;
    vi.mocked(uploadDiscordWebhook).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await start(); await enabled().setValue(true); await secret().setValue(webhookUrl);
    await wrapper!.get("form").trigger("submit"); await flushPromises();
    const signal = vi.mocked(uploadDiscordWebhook).mock.calls[0]![1]!;
    const store = useControllerStore(); store.disconnect(); await flushPromises();
    expect(signal.aborted).toBe(true);
    store.state.data = state(); store.state.stale = false; store.state.lastSuccess = Date.now();
    store.transactions.data = {}; store.transactions.stale = false; store.connected = true;
    await flushPromises(); await secret().setValue(webhookUrl);
    resolve({ webhook_ref: webhookReference }); await flushPromises();
    expect(secret().element.value).toBe(webhookUrl);
    expect(store.draft).toBeNull();
    expect(store.editorDirty).toBe(true);
  });
  it("blocks conflicting notification drafts arriving during upload without overwriting them", async () => {
    let resolve!: (value: { webhook_ref: string }) => void;
    vi.mocked(uploadDiscordWebhook).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await start(); await enabled().setValue(true); await secret().setValue(webhookUrl);
    await wrapper!.get("form").trigger("submit"); await flushPromises();
    const store = useControllerStore(), candidate = cloneConfig(store.state.data!.desired);
    candidate.discord = { ...discordDefaults(), enabled: false, webhook_ref: "b".repeat(32) }; store.stage(candidate);
    resolve({ webhook_ref: webhookReference }); await flushPromises();
    expect(store.draft).toEqual(candidate);
    expect(wrapper!.get('[role="alert"]').text()).toContain("Webhook stored, but notification settings changed");
    expect(secret().element.value).toBe("");
    expect(save().attributes("disabled")).toBeDefined();
    await wrapper!.findAll("button").find(button => button.text() === "Reset edits")!.trigger("click");
    expect(enabled().element.checked).toBe(false);
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
  });
  it("aborts outstanding reads and removes polling when unmounted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let resolve!: (value: ReturnType<typeof discordStatus>) => void;
    vi.mocked(getDiscordStatus).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    wrapper = mount(NotificationsView, { global: { stubs } }); await flushPromises();
    const signal = vi.mocked(getDiscordStatus).mock.calls[0]![0]!;
    wrapper.unmount(); wrapper = undefined;
    expect(signal.aborted).toBe(true);
    resolve(discordStatus()); await flushPromises(); await vi.advanceTimersByTimeAsync(60000);
    window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange"));
    expect(getDiscordStatus).toHaveBeenCalledTimes(1);
  });
  it("polls visible status without writes and preserves exact entry totals and failures", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await start();
    vi.mocked(getDiscordStatus).mockResolvedValue({
      ...discordStatus(), state: "error", delivered: "18446744073709551615", failed: "9007199254740993", error: "Rate-limit response invalid",
    });
    await vi.advanceTimersByTimeAsync(7500); await flushPromises();
    expect(wrapper!.text()).toContain("18446744073709551615");
    expect(wrapper!.text()).toContain("9007199254740993");
    expect(wrapper!.findAllComponents({ name: "VChip" }).map(chip => [chip.text(), chip.props("color")])).toEqual([
      ["Delivery error", "error"], ["Delivered: 18446744073709551615", "success"], ["Failed: 9007199254740993", "error"],
    ]);
    expect(wrapper!.get('[role="alert"]').text()).toContain("Rate-limit response invalid");
    const calls = vi.mocked(getDiscordStatus).mock.calls.length;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(15000);
    expect(getDiscordStatus).toHaveBeenCalledTimes(calls);
    expect(uploadDiscordWebhook).not.toHaveBeenCalled();
  });
  it.each([
    ["starting", "Starting", "info"],
    ["simulated", "Simulation only", "info"], ["unavailable", "Unavailable", "warning"],
    ["paused", "Paused", "warning"], ["ready", "Active", "success"],
    ["error", "Delivery error", "error"], ["stopped", "Stopped", "secondary"],
  ] as const)("shows a readable %s status chip without raw combined state text", async (state, label, color) => {
    vi.mocked(getDiscordStatus).mockResolvedValue({ ...discordStatus(), enabled: true, state });
    await start();
    const chip = wrapper!.findAllComponents({ name: "VChip" })[0]!;
    expect(chip.text()).toBe(label);
    expect(chip.props("color")).toBe(color);
    expect(wrapper!.text()).not.toContain("Enabled -");
    expect(wrapper!.text()).not.toContain("Disabled -");
  });
  it.each(["disabled", "ready"] as const)("omits the disabled chip for disabled notifications in %s state", async state => {
    vi.mocked(getDiscordStatus).mockResolvedValue({ ...discordStatus(), state });
    await start();
    expect(wrapper!.findAllComponents({ name: "VChip" }).map(chip => [chip.text(), chip.props("color")])).toEqual([
      ["Delivered: 0", "success"], ["Failed: 0", "error"],
    ]);
  });
  it("keeps stale status and previously loaded counts visible after a polling failure and recovers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.mocked(getDiscordStatus).mockResolvedValue({ ...discordStatus(), enabled: true, state: "ready", delivered: "7", failed: "2" });
    await start();
    vi.mocked(getDiscordStatus).mockRejectedValueOnce(new Error("Status read failed"));
    await vi.advanceTimersByTimeAsync(7500); await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain("Status read failed");
    const chips = () => wrapper!.findAllComponents({ name: "VChip" });
    expect(chips().map(chip => chip.text())).toEqual(["Stale", "Delivered: 7", "Failed: 2"]);
    expect(chips()[0]!.props("color")).toBe("warning");
    expect(enabled().attributes("disabled")).toBeDefined();
    await wrapper!.findAll("button").find(button => button.text() === "Retry")!.trigger("click"); await flushPromises();
    expect(chips()[0]!.text()).toBe("Active");
    expect(enabled().attributes("disabled")).toBeUndefined();
  });
});
