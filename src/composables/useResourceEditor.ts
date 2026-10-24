import { computed, onUnmounted, ref, watch } from "vue";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import { dhcpClientSchema, dnsConfigSchema, type ManagedInterface, type DiscoveredInterface } from "@/types/domain";
import { record } from "@/types/forms";
import { preset, resourceFields, type Section } from "@/services/resourceForms";
import { cloneConfig, prefix, selectedRelayPrefix, stableJson, validateConfig } from "@/services/configuration";
import { resourceItems, replaceResourceItems } from "@/services/resourceCollections";

export function useResourceEditor(section: Section, wireguard = false) {
  const store = useControllerStore();
  const dialog = ref(false), form = ref<Record<string, unknown>>({});
  const original = ref<unknown>(), editingIndex = ref(-1), renameAcknowledged = ref(false);
  const formStart = ref(""), errors = ref<Record<string, string[]>>({}), formError = ref("");
  const deletion = ref<{ index: number; value: unknown } | null>(null);
  const editingConfig = computed(() => store.draft ?? store.state.data?.desired);
  const editingBlocked = computed(() => Boolean(store.readOnlyReason) || (section === "firewall" && Boolean(editingConfig.value?.firewall.policies)));
  const allManaged = computed(() => editingConfig.value?.interfaces.map(link => link.name) ?? []);
  const adopted = computed(() => store.runtime.data?.parent_interfaces.filter(parent => parent.available).map(parent => parent.name) ?? []);
  const parentOptions = computed(() => editingConfig.value?.interfaces.filter(link => {
    if (link.kind === "wireguard" || link.name === form.value.name) return false;
    const visited = new Set<string>();
    let parent: ManagedInterface = link;
    while (parent.kind === "vlan") {
      if (parent.vlan.parent === form.value.name || visited.has(parent.name)) return false;
      visited.add(parent.name);
      const next = editingConfig.value?.interfaces.find(candidate => candidate.name === (parent.kind === "vlan" ? parent.vlan.parent : ""));
      if (!next) break;
      parent = next;
    }
    return true;
  }).map(link => link.name) ?? []);
  const familyInterfaces = computed(() => editingConfig.value?.interfaces.filter(link => (form.value.family === "ipv4" && editingConfig.value?.dhcp_clients?.[link.name]) || link.addresses.some(address => {
    try { return prefix(address, false).family === form.value.family; } catch { return false; }
  })).map(link => link.name) ?? []);
  const immutable = computed(() => Boolean(original.value && store.state.data?.desired.interfaces.some(link => link.name === record(original.value).name)));
  const fields = computed(() => resourceFields(section, section === "interfaces" ? parentOptions.value : allManaged.value,
    adopted.value, immutable.value, form.value.kind, form.value.family, familyInterfaces.value));
  const relaySelection = computed(() => {
    try {
      const addresses = form.value.addresses;
      return selectedRelayPrefix({ addresses: Array.isArray(addresses) ? addresses.filter((item): item is string => typeof item === "string") : [] }) ?? "No eligible IPv4 prefix";
    } catch (error) { return error instanceof Error ? error.message : "Invalid address prefix"; }
  });
  function dependencies(name: unknown): string[] {
    if (!editingConfig.value || section !== "interfaces") return [];
    const config = editingConfig.value;
    return [
      ...config.interfaces.filter(link => link.kind === "vlan" && link.vlan.parent === name).map(link => `Child VLAN ${link.name}`),
      ...config.routes.filter(item => item.interface === name).map(item => `Route ${item.destination}`),
      ...config.firewall.nat.masquerade.filter(item => item.out_interface === name).map((_, index) => `Masquerade reference ${index + 1}`),
      ...(config.firewall.input?.interfaces.filter(item => item.interface === name).map(item => `Host input policy ${item.interface}`) ?? []),
      ...config.softflowd.filter(item => item.interface === name).map(item => `Capture instance ${item.name}`),
      ...config.gateway_monitors.filter(item => item.interface === name).map(item => `Gateway monitor ${item.name}`),
    ];
  }
  const impacts = computed(() => deletion.value ? dependencies(record(deletion.value.value).name) : []);
  const renaming = computed(() => section === "interfaces" && original.value !== undefined && record(original.value).name !== form.value.name);
  const renameImpacts = computed(() => renaming.value ? dependencies(record(original.value).name) : []);
  function open(value?: unknown): void {
    if (!editingConfig.value) return;
    original.value = value;
    editingIndex.value = value === undefined ? -1 : resourceItems(editingConfig.value, section).findIndex(item =>
      record(value).name ? record(item).name === record(value).name : stableJson(item) === stableJson(value));
    if (value !== undefined && editingIndex.value < 0) { formError.value = "This record no longer exists in the current configuration."; return; }
    const initial = editingIndex.value >= 0 ? resourceItems(editingConfig.value, section)[editingIndex.value] : preset(section, wireguard);
    form.value = record(JSON.parse(JSON.stringify(initial)));
    if (section === "interfaces") {
      const name = String(form.value.name);
      form.value.address_mode = editingConfig.value.dhcp_clients?.[name] ? "dhcp" : "static";
      form.value.dhcp_client = dhcpClientSchema.parse(editingConfig.value.dhcp_clients?.[name] ?? {});
      form.value.resolver_enabled = Boolean(editingConfig.value.dns?.[name]);
      form.value.resolver = dnsConfigSchema.parse(editingConfig.value.dns?.[name] ?? {});
    }
    formStart.value = stableJson(form.value); errors.value = {}; formError.value = ""; dialog.value = true;
    renameAcknowledged.value = false;
  }
  function manage(link: DiscoveredInterface): void {
    if (editingBlocked.value) return;
    open();
    form.value = { ...form.value, name: link.name, kind: "ethernet", mtu: link.mtu, up: link.up, addresses: [] };
    formStart.value = stableJson(form.value);
  }
  function change(key: string, value: unknown): void {
    const next = { ...form.value, [key]: value };
    if (section === "interfaces" && key === "kind") {
      delete next.vlan; delete next.wireguard;
      if (value === "vlan") next.vlan = { parent: "", id: 1 };
      if (value === "wireguard") next.wireguard = { key_ref: "", listen_port: 51820, peers: [] };
    }
    form.value = next;
  }
  watch(form, () => { if (dialog.value) store.editorDirty = stableJson(form.value) !== formStart.value; }, { deep: true });
  onUnmounted(() => { store.editorDirty = false; });
  function cancel(): void {
    if (store.editorDirty && !window.confirm("Discard unstaged form input?")) return;
    dialog.value = false; store.editorDirty = false; form.value = {};
  }
  function stageForm(): void {
    if (!editingConfig.value) return;
    errors.value = {}; formError.value = "";
    try {
      if (renaming.value && !renameAcknowledged.value) throw new Error("Review and acknowledge interface rename dependency impacts first");
      const value = JSON.parse(JSON.stringify(form.value)) as Record<string, unknown>;
      if (section === "softflowd") {
        const timeouts = record(value.timeouts);
        value.timeouts = Object.fromEntries(Object.entries(timeouts).filter(([, seconds]) => seconds !== "" && seconds !== undefined));
      }
      const candidate = cloneConfig(editingConfig.value);
      if (section === "interfaces") {
        const name = String(value.name), previousName = record(original.value).name;
        const clients = { ...candidate.dhcp_clients }, dns = { ...candidate.dns };
        if (typeof previousName === "string" && previousName !== name) { delete clients[previousName]; delete dns[previousName]; }
        if (value.address_mode === "dhcp") clients[name] = dhcpClientSchema.parse(value.dhcp_client);
        else delete clients[name];
        if (value.resolver_enabled) dns[name] = dnsConfigSchema.parse(value.resolver);
        else delete dns[name];
        candidate.dhcp_clients = clients; candidate.dns = dns;
        for (const key of ["address_mode", "dhcp_client", "resolver_enabled", "resolver"]) delete value[key];
      }
      const values = [...resourceItems(candidate, section)], index = editingIndex.value < 0 ? values.length : editingIndex.value;
      values[index] = value;
      replaceResourceItems(candidate, section, values);
      const basePath = section === "firewall" ? `firewall.rules.${index}` : section === "nat" ? `firewall.nat.masquerade.${index}` : `${section}.${index}`;
      const ownIssues = validateConfig(candidate, store.runtime.data?.parent_interfaces, store.state.data?.desired).filter(issue =>
        issue.path === basePath || issue.path.startsWith(`${basePath}.`) ||
        (section === "interfaces" && ["dhcp_clients", "dns"].some(area => issue.path === `${area}.${String(value.name)}` || issue.path.startsWith(`${area}.${String(value.name)}.`))));
      for (const issue of ownIssues) {
        const key = issue.path.replace(basePath, "editor").replace(/\.(addresses|allowed_ips|servers)\.\d+$/, ".$1");
        errors.value[key] = [...(errors.value[key] ?? []), issue.message];
      }
      if (ownIssues.length) throw new Error("Correct the highlighted local validation errors. Cross-resource errors remain visible in Review changes.");
      store.stage(candidate); dialog.value = false; store.editorDirty = false;
    } catch (error) {
      if (error instanceof ZodError) for (const issue of error.issues) {
        const key = `editor.${issue.path.join(".")}`;
        errors.value[key] = [...(errors.value[key] ?? []), issue.message];
      }
      formError.value = error instanceof Error ? error.message : "Unable to stage record";
    }
  }
  function stageDelete(): void {
    if (!editingConfig.value || !deletion.value) return;
    try {
      const candidate = cloneConfig(editingConfig.value), value = deletion.value.value;
      const values = resourceItems(candidate, section);
      const index = values.findIndex(item => record(value).name ? record(item).name === record(value).name : stableJson(item) === stableJson(value));
      if (index < 0) throw new Error("Record no longer exists in draft");
      replaceResourceItems(candidate, section, values.filter((_, itemIndex) => itemIndex !== index));
      if (section === "interfaces") {
        const name = String(record(value).name);
        if (candidate.dhcp_clients) delete candidate.dhcp_clients[name];
        if (candidate.dns) delete candidate.dns[name];
      }
      store.stage(candidate); deletion.value = null;
    } catch (error) { formError.value = error instanceof Error ? error.message : "Unable to stage deletion"; }
  }
  function move(index: number, delta: number): void {
    if (!editingConfig.value) return;
    try {
      const candidate = cloneConfig(editingConfig.value), values = [...resourceItems(candidate, section)];
      [values[index], values[index + delta]] = [values[index + delta], values[index]];
      replaceResourceItems(candidate, section, values); store.stage(candidate);
    } catch (error) { formError.value = error instanceof Error ? error.message : "Unable to reorder"; }
  }
  return { dialog, form, editingIndex, renameAcknowledged, errors, formError, deletion,
    editingBlocked, allManaged, fields, relaySelection, impacts, renaming, renameImpacts,
    open, manage, change, cancel, stageForm, stageDelete, move };
}