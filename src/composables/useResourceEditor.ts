import { computed, onUnmounted, ref, watch } from "vue";
import { ZodError } from "zod";
import ipaddr from "ipaddr.js";
import { useControllerStore } from "@/stores/controller";
import { dhcpClientSchema, dnsConfigSchema, objectMetadataSchema, timeoutNames, type DiscoveredInterface } from "@/types/domain";
import { record, type Field } from "@/types/forms";
import { preset, resourceFields, type Section } from "@/services/resourceForms";
import { cloneConfig, numericAddress, prefix, stableJson, validateConfig } from "@/services/configuration";
import { interfaceChoice, resourceItems, replaceResourceItems } from "@/services/resourceCollections";

export function useResourceEditor(section: Section, wireguard = false, vlan = false, loopbacks = false) {
  const store = useControllerStore();
  const dialog = ref(false), form = ref<Record<string, unknown>>({});
  const original = ref<unknown>(), editingIndex = ref(-1), renameAcknowledged = ref(false);
  const formStart = ref(""), errors = ref<Record<string, string[]>>({}), formError = ref("");
  const deletion = ref<{ index: number; value: unknown } | null>(null);
  const editingConfig = computed(() => store.draft ?? store.state.data?.desired);
  const editingBlocked = computed(() => Boolean(store.readOnlyReason) || (section === "firewall" && Boolean(editingConfig.value?.firewall.policies)));
  const allManaged = computed(() => editingConfig.value?.interfaces.map(link => link.name) ?? []);
  const interfaceOptions = computed(() => {
    const options = editingConfig.value?.interfaces.map(interfaceChoice) ?? [];
    const target = editingConfig.value?.blackhole?.name;
    return section === "routes" && target ? [...options, { title: `${target} (blackhole)`, value: target }] : options;
  });
  const parentOptions = computed(() => editingConfig.value?.interfaces
    .filter(link => link.kind === "ethernet" && link.name !== form.value.name).map(interfaceChoice) ?? []);
  const adopted = computed(() => store.runtime.data?.parent_interfaces
    .filter(parent => parent.available && parent.kind === "ethernet" && parent.name !== form.value.name && !allManaged.value.includes(parent.name))
    .map(interfaceChoice) ?? []);
  const familyInterfaces = computed(() => editingConfig.value?.interfaces.filter(link => (form.value.family === "ipv4" && editingConfig.value?.dhcp_clients?.[link.name]) || link.addresses.some(address => {
    try { return prefix(address, false).family === form.value.family; } catch { return false; }
  })).map(interfaceChoice) ?? []);
  const immutable = computed(() => Boolean(original.value && store.state.data?.desired.interfaces.some(link => link.name === record(original.value).name)));
  const fields = computed(() => {
    const result: Field[] = resourceFields(section, section === "interfaces" ? parentOptions.value : interfaceOptions.value,
      adopted.value, immutable.value, form.value.kind, form.value.family, familyInterfaces.value, wireguard, editingIndex.value < 0, vlan)
      .map(field => loopbacks && field.key === "kind" ? { ...field, disabled: true, choices: [{ title: "Loopback", value: "dummy" }] } :
        field.key === "family" && !store.ipv6Enabled ? { ...field, choices: field.choices?.filter(choice => choice.value !== "ipv6") } : field);
    return result;
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
  function monitorGateway(value: Record<string, unknown>): string {
    const retained = value.enabled === false ? String(value.gateway ?? "") : "";
    try {
      const target = numericAddress(String(value.target));
      const routes = (editingConfig.value?.routes ?? []).flatMap(route => {
        if (route.enabled === false || route.table !== 254 || route.interface !== value.interface) return [];
        try {
          const network = ipaddr.parseCIDR(route.destination);
          return network[0].kind() === target.kind() && target.match(network) ?
            [{ gateway: route.gateway || String(value.target), prefix: network[1], metric: route.metric }] : [];
        } catch { return []; }
      }).sort((left, right) => right.prefix - left.prefix || left.metric - right.metric);
      const best = routes[0];
      if (!best) return retained;
      const gateways = new Set(routes.filter(route => route.prefix === best.prefix && route.metric === best.metric).map(route => route.gateway));
      return gateways.size === 1 ? best.gateway : retained;
    } catch { return ""; }
  }
  function inferRouteGateway(value: Record<string, unknown>): string {
    const parse = (text: string) => { try { return ipaddr.parseCIDR(text); } catch { return null; } };
    const destination = parse(String(value.destination));
    const name = String(value.interface), config = editingConfig.value;
    if (!destination || !config || name === config.blackhole?.name) return "";
    const lease = store.runtime.data?.dhcp_clients?.leases[name];
    const local = [...(config.interfaces.find(link => link.name === name)?.addresses ?? []), ...(lease ? [lease.address] : [])]
      .flatMap(address => { const cidr = parse(address); return cidr ? [cidr] : []; });
    // A destination inside a connected subnet is reached directly and needs no next hop.
    if (local.some(network => network[0].kind() === destination[0].kind() && destination[0].match(network))) return "";
    const isDefault = (text: string) => ["0.0.0.0/0", "::/0"].includes(text);
    const candidates = (routes: Array<{ destination: string; gateway?: string }>) => [...new Set(routes.flatMap(route => {
      try { return isDefault(route.destination) && route.gateway && numericAddress(route.gateway).kind() === destination[0].kind() ? [route.gateway] : []; } catch { return []; }
    }))];
    const fromLease = candidates(lease?.routes ?? []);
    if (fromLease.length === 1) return fromLease[0]!;
    const fromConfig = candidates(config.routes.filter(route => route.enabled !== false && route.table === 254 && route.interface === name));
    return fromLease.length === 0 && fromConfig.length === 1 ? fromConfig[0]! : "";
  }
  function monitorSource(value: Record<string, unknown>): string {
    let family: string | undefined;
    for (const key of ["target", "gateway"]) {
      try { family = numericAddress(String(value[key])).kind(); break; } catch { continue; }
    }
    const link = editingConfig.value?.interfaces.find(item => item.name === value.interface);
    const addresses = (link?.addresses ?? []).flatMap(address => {
      try {
        const parsed = prefix(address, false);
        return (!family || parsed.family === family) && (store.ipv6Enabled || parsed.family !== "ipv6") ? [parsed.address.toString()] : [];
      } catch { return []; }
    });
    return addresses.find(address => address === value.source_address) ?? addresses[0] ??
      (value.enabled === false ? String(value.source_address ?? "") : "");
  }
  function inferMonitor(value: Record<string, unknown>): Record<string, unknown> {
    const next = { ...value };
    let ipv6 = false;
    try { ipv6 = numericAddress(String(next.target)).kind() === "ipv6"; } catch { ipv6 = false; }
    if (editingConfig.value?.dhcp_clients?.[String(next.interface)] && !ipv6) {
      next.mode = "dhcp";
      delete next.source_address; delete next.gateway; delete next.routing_table;
    } else {
      delete next.mode;
      next.gateway = monitorGateway(next);
      next.source_address = monitorSource(next);
      next.routing_table = 254;
    }
    return next;
  }
  function open(value?: unknown): void {
    if (!editingConfig.value) return;
    original.value = value;
    editingIndex.value = value === undefined ? -1 : resourceItems(editingConfig.value, section).findIndex(item =>
      record(value).name ? record(item).name === record(value).name : stableJson(item) === stableJson(value));
    if (value !== undefined && editingIndex.value < 0) { formError.value = "This record no longer exists in the current configuration."; return; }
    const initial = editingIndex.value >= 0 ? resourceItems(editingConfig.value, section)[editingIndex.value] : preset(section, wireguard);
    form.value = record(JSON.parse(JSON.stringify(initial)));
    if (section === "gateway_monitors") form.value = inferMonitor(form.value);
    if (section === "softflowd") {
      const timeouts = record(form.value.timeouts);
      for (const name of timeoutNames) form.value[`timeout_${name}`] = timeouts[name] ?? "";
    }
    if (section === "interfaces" && editingIndex.value < 0 && (vlan || loopbacks)) form.value.up = true;
    if (section === "interfaces" && loopbacks && editingIndex.value < 0) {
      form.value.role = "unassigned";
      form.value.mtu = 65535;
    }
    if (section === "interfaces" && vlan && editingIndex.value < 0) {
      form.value.kind = "vlan";
      form.value.role = "unassigned";
      form.value.vlan = { parent: "", id: 1 };
    }
    if (section === "interfaces") {
      if (form.value.kind === "ethernet") {
        form.value.display_name = record(form.value.metadata).display_name ?? "";
      }
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
    if (editingBlocked.value || link.name === "lo" || link.ownership !== "unmanaged" || !(loopbacks ? ["dummy"] : ["ethernet", "veth"]).includes(link.kind)) return;
    open();
    form.value = { ...form.value, name: link.name, kind: loopbacks ? "dummy" : "ethernet", role: "unassigned", mtu: link.mtu, up: link.up, addresses: [] };
    formStart.value = stableJson(form.value);
  }
  function change(key: string, value: unknown): void {
    let next = { ...form.value, [key]: value };
    if (section === "gateway_monitors" && ["interface", "target"].includes(key)) {
      next = inferMonitor(next);
      errors.value = {}; formError.value = "";
    }
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
    if (store.editorDirty && section !== "nat" && form.value.kind !== "ethernet" && !window.confirm("Discard unstaged form input?")) return;
    dialog.value = false; store.editorDirty = false; form.value = {};
  }
  function stageForm(): void {
    if (!editingConfig.value) return;
    errors.value = {}; formError.value = "";
    try {
      if (renaming.value && !renameAcknowledged.value) throw new Error("Review and acknowledge interface rename dependency impacts first");
      let value = JSON.parse(JSON.stringify(form.value)) as Record<string, unknown>;
      if (section === "routes") {
        value.table = 254;
        if (record(original.value).interface !== value.interface) delete value.gateway;
        if (!value.gateway) { const gateway = inferRouteGateway(value); if (gateway) value.gateway = gateway; else delete value.gateway; }
        if (value.interface === editingConfig.value.blackhole?.name) delete value.gateway;
      }
      if (section === "gateway_monitors") value = inferMonitor(value);
      if (section === "gateway_monitors" && value.mode === "dhcp") {
        if (!store.supportsDhcpGatewayMonitors) {
          errors.value["editor.interface"] = ["The selected backend does not advertise DHCP monitor support."];
          throw new Error("The selected backend does not advertise DHCP IPv4 gateway monitoring. Refresh runtime capabilities before saving.");
        }
        delete value.source_address; delete value.gateway; delete value.routing_table;
      } else if (section === "gateway_monitors") {
        delete value.mode;
        value.routing_table = 254;
        value.source_address = monitorSource(value);
        if (!value.source_address) {
          errors.value["editor.interface"] = [editingConfig.value.dhcp_clients?.[String(value.interface)]
            ? "The selected interface needs a configured IPv6 source matching the probe target's IP version."
            : "The selected interface needs a configured source IP of the same IP version as the probe target, not the same address or subnet."];
          throw new Error("The selected interface has no suitable source address.");
        }
        value.gateway = monitorGateway(value);
        if (!value.gateway) {
          errors.value["editor.target"] = ["Select a probe target with an unambiguous route in table 254 on this interface."];
          throw new Error("No unambiguous route to the probe target on the selected interface.");
        }
      }
      if (loopbacks && (value.kind !== "dummy" || value.name === "lo")) throw new Error("Only loopback interfaces other than lo can be managed here.");
      if (section === "softflowd") {
        value.promiscuous = true;
        value.timeouts = Object.fromEntries(timeoutNames.flatMap(name => {
          const seconds = value[`timeout_${name}`];
          delete value[`timeout_${name}`];
          return seconds === "" || seconds === undefined || seconds === null ? [] : [[name, seconds]];
        }));
      }
      const candidate = cloneConfig(editingConfig.value);
      if (section === "interfaces") {
        if (value.kind === "ethernet") {
          const metadata = objectMetadataSchema.parse({ ...record(value.metadata), display_name: value.display_name ?? "" });
          if (metadata) value.metadata = metadata; else delete value.metadata;
          delete value.display_name;
        }
        const name = String(value.name), previousName = record(original.value).name;
        const current = candidate.interfaces.find(link => link.name === previousName);
        if (wireguard && current?.kind === "wireguard") {
          value = { ...current, wireguard: value.wireguard };
        } else {
          value.dhcp_relay = current?.dhcp_relay ?? { enabled: false, servers: [] };
          if (current?.kind === "wireguard") value.wireguard = current.wireguard;
          const clients = { ...candidate.dhcp_clients }, dns = { ...candidate.dns };
          if (typeof previousName === "string" && previousName !== name) { delete clients[previousName]; delete dns[previousName]; }
          if (value.address_mode === "dhcp") clients[name] = dhcpClientSchema.parse(value.dhcp_client);
          else delete clients[name];
          if (value.resolver_enabled) dns[name] = dnsConfigSchema.parse(value.resolver);
          else delete dns[name];
          candidate.dhcp_clients = clients; candidate.dns = dns;
        }
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
        const key = issue.path.replace(basePath, "editor").replace(/\.(addresses|allowed_ips|servers)\.\d+$/, ".$1")
          .replace(/^editor\.timeouts\./, section === "softflowd" ? "editor.timeout_" : "editor.timeouts.");
        errors.value[key] = [...(errors.value[key] ?? []), issue.message];
      }
      if (ownIssues.length) throw new Error("Correct the highlighted local validation errors. Cross-resource errors remain visible in SAVE.");
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
    editingBlocked, allManaged, interfaceOptions, fields, impacts, renaming, renameImpacts,
    open, manage, change, cancel, stageForm, stageDelete, move };
}