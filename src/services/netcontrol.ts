import { ApiFailure, request } from "@/services/api";
import { z } from "zod";
import { cloneConfig, numericAddress, stableJson } from "@/services/configuration";
import { hostHealthSchema } from "@/services/hostHealth";
import { linkDiagnosticsSchema } from "@/services/linkDiagnostics";
import { interfaceCapabilitySnapshotSchema } from "@/services/interfaceCapabilities";
import { dhcpRelayLogPageSchema, dhcpRelayStatisticsSchema, dhcpLogQuerySchema, type DHCPLogQuery } from "@/services/dhcpDiagnostics";
import { persistentLogPageSchema, persistentLogQuerySchema, logSourceSchema, type LogSource, type PersistentLogQuery } from "@/services/logs";
import { rpsDiagnosticsSchema } from "@/services/rps";
import { pathTestRequestSchema, pathTestStatusSchema, type PathTestRequest } from "@/services/pathTests";
import { tuningSettings } from "@/services/tuning";
import { kernelTunablesCatalogSchema, kernelTunablesSchema, conntrackPreserved } from "@/services/conntrack";
import { discordConfigSchema, discordDefaults, discordStatusSchema, discordTestSchema, discordWebhookSchema, discordWebhookReferenceSchema, redactDiscordError } from "@/services/discord";
import { dateVersionSchema } from "@/services/versions";
import { ruleOwnershipPreserved } from "@/services/ruleOwnership";
import { firewallCountersSchema, firewallDenyPageSchema, firewallDenyQuerySchema, type FirewallDenyQuery } from "@/services/firewallTelemetry";
import { dnsLookupRequestSchema, dnsLookupSchema, restartResponseSchema, restartTargetSchema, type DNSLookupRequest } from "@/services/operations";
import {
  adoptVlanRequestSchema, adoptVlanResponseSchema, type AdoptVlanRequest,
  mqttPasswordReferenceSchema, mqttStatusSchema, dynamicDnsSecretReferenceSchema, dynamicDnsStatusSchema, timezonesSchema,
  stateSchema, runtimeSchema, transactionSchema, revisionPageSchema, discoveredInterfacesSchema, dhcpRetrySchema, connectionsPageSchema,
  revisionSchema, revisionDetailSchema, statisticsSchema, transactionsSchema, dhcpRelayStatusPageSchema,
  gatewayStatisticsPageSchema, gatewayStatisticsDetailSchema, gatewayStatusPageSchema,
  applianceStatusPageSchema, ntpSchema, syslogSchema, vnstatSchema, vnstatReportingSchema, mdnsSchema, mdnsStatusPageSchema,
  gatewayMonitorSchema, rpfModeSchema, type ApplianceService, type RepairService, type PackageRequest,
  connectionDeletionSchema, upgradeVersionSchema, upgradeJobSchema, upgradeStatusSchema, type Connection,
  platformStatusSchema, bgpSchema, bgpStatusSchema, bgpRoutesSchema, bgpAdvertisedRoutesSchema, udpBroadcastRelaySchema, udpRelayStatusPageSchema,
} from "@/types/domain";

const id = encodeURIComponent;
export const getDHCPRelayStatistics = (signal?: AbortSignal) =>
  request("GET", "/statistics/dhcp-relay", dhcpRelayStatisticsSchema, undefined, signal);
export function getDHCPRelayLog(query: DHCPLogQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(dhcpLogQuerySchema.parse(query))) if (value !== undefined) params.set(key, String(value));
  return request("GET", `/services/dhcp-relay/log${params.size ? `?${params}` : ""}`, dhcpRelayLogPageSchema, undefined, signal);
}
export function getPersistentLog(source: LogSource, query: PersistentLogQuery = {}, signal?: AbortSignal) {
  const selected = logSourceSchema.parse(source), params = new URLSearchParams();
  for (const [key, value] of Object.entries(persistentLogQuerySchema.parse(query))) if (value !== undefined) params.set(key, String(value));
  return request("GET", `/logs/${selected}${params.size ? `?${params}` : ""}`,
    persistentLogPageSchema.refine(value => value.source === selected, "Log response belongs to a different stream"), undefined, signal);
}
export function adoptVlan(input: AdoptVlanRequest, signal?: AbortSignal) {
  const value = adoptVlanRequestSchema.parse(input);
  return request("POST", "/interfaces/adopt-vlan", adoptVlanResponseSchema.refine(result =>
    result.interface.name === value.name && result.interface.kind === "vlan" &&
    result.interface.vlan.parent === value.parent && result.interface.vlan.id === value.id,
  "Adopted VLAN identity differs from the request"), value, signal);
}
export const getPathTests = (signal?: AbortSignal) =>
  request("GET", "/diagnostics/path-tests", pathTestStatusSchema, undefined, signal);
export async function startPathTest(input: PathTestRequest, signal?: AbortSignal) {
  const value = pathTestRequestSchema.parse(input);
  try { return await request("POST", "/diagnostics/path-tests",
    pathTestStatusSchema.refine(result => result.id !== null && result.state !== "idle", "Accepted start lacks a native session"),
    value, signal); }
  catch (failure) {
    const status = failure instanceof ApiFailure ? failure.status : undefined;
    const detail = failure instanceof ApiFailure ? [
      value.pairing_secret, JSON.stringify(value.pairing_secret).slice(1, -1), encodeURIComponent(value.pairing_secret),
    ].reduce((text, secret) => text.split(secret).join("[redacted]"), failure.message) : "";
    throw new ApiFailure(status ? `Path test start failed. ${detail}. Check status before another start.` :
      "Path test start outcome is unknown. Check status before another start; no request was automatically repeated.",
    status, undefined, !(failure instanceof ApiFailure) || failure.uncertain, failure instanceof ApiFailure && failure.incompatible);
  }
}
export function cancelPathTest(value: string, signal?: AbortSignal) {
  if (!/^[0-9a-f]{32}$/.test(value)) throw new Error("A native path-test ID is required for cancellation.");
  return request("POST", `/diagnostics/path-tests/${value}/cancel`,
    pathTestStatusSchema.refine(result => result.id === value, "Cancellation response belongs to a different session"), undefined, signal);
}
export const getRpsDiagnostics = (signal?: AbortSignal) =>
  request("GET", "/statistics/performance", rpsDiagnosticsSchema, undefined, signal);
export const getKernelTunablesCatalog = (signal?: AbortSignal) =>
  request("GET", "/kernel/tunables/catalog", kernelTunablesCatalogSchema, undefined, signal);
export const getKernelTunables = (signal?: AbortSignal) =>
  request("GET", "/kernel/tunables", kernelTunablesSchema, undefined, signal);
export const getInterfaceCapabilities = (signal?: AbortSignal) =>
  request("GET", "/interface-capabilities", interfaceCapabilitySnapshotSchema.nullable(), undefined, signal);
export const refreshInterfaceCapabilities = (signal?: AbortSignal) =>
  request("GET", "/interface-capabilities/refresh", interfaceCapabilitySnapshotSchema, undefined, signal);
export const getUDPRelayConfig = (signal?: AbortSignal) => request("GET", "/services/udp-broadcast-relay", udpBroadcastRelaySchema, undefined, signal);
export const getUDPRelayStatus = (signal?: AbortSignal) => request("GET", "/services/udp-broadcast-relay/status", udpRelayStatusPageSchema, undefined, signal);
export const getBGPConfig = (signal?: AbortSignal) => request("GET", "/services/bgp", bgpSchema, undefined, signal);
export const getBGPStatus = (signal?: AbortSignal) => request("GET", "/services/bgp/status", bgpStatusSchema, undefined, signal);
export const getBGPRoutes = (signal?: AbortSignal) => request("GET", "/routes/bgp", bgpRoutesSchema, undefined, signal);
export const getBGPAdvertisedRoutes = (signal?: AbortSignal) => request("GET", "/routes/bgp/advertised", bgpAdvertisedRoutesSchema, undefined, signal);
export const getLinkDiagnostics = (signal?: AbortSignal) =>
  request("GET", "/statistics/link-diagnostics", linkDiagnosticsSchema, undefined, signal);
export function lookupDNS(input: DNSLookupRequest, signal?: AbortSignal) {
  const value = dnsLookupRequestSchema.parse(input);
  const schema = dnsLookupSchema.refine(result => !value.server ||
    ((result.status !== "answered" || result.server === value.server) &&
      (result.server === null || result.server === value.server) &&
      result.attempts.every(attempt => attempt.server === value.server)),
  "DNS response resolver differs from the requested server");
  return request("POST", "/diagnostics/dns-lookup", schema, value, signal);
}
export function restartProcess(target: string) {
  const value = restartTargetSchema.parse(target);
  return request("POST", "/processes/restart", restartResponseSchema.refine(result => result.target === value, "Restart response target differs from the requested process"), { target: value });
}
const submittedTransactionSchema = transactionSchema.extend({ ignored_fields: z.array(z.string()).optional() })
  .refine(value => value.confirmation_deadline !== null && value.status !== "applying_local", "Remote transactions require timed confirmation");
export const getHostHealth = (signal?: AbortSignal) => request("GET", "/statistics/host", hostHealthSchema, undefined, signal);
export const getMqttStatus = (signal?: AbortSignal) => request("GET", "/services/mqtt/status", mqttStatusSchema, undefined, signal);
export async function getDiscordStatus(signal?: AbortSignal) {
  try { return await request("GET", "/services/discord/status", discordStatusSchema, undefined, signal); }
  catch (failure) {
    const status = failure instanceof ApiFailure ? failure.status : undefined;
    throw new ApiFailure(`Discord status unavailable${status ? ` (HTTP ${status})` : ""}. Check backend support and state.read permission.`,
      status, undefined, false, failure instanceof ApiFailure && failure.incompatible);
  }
}
export async function testDiscordWebhook(signal?: AbortSignal) {
  try { return await request("POST", "/services/discord/test", discordTestSchema, undefined, signal); }
  catch (failure) {
    const status = failure instanceof ApiFailure ? failure.status : undefined;
    const detail = failure instanceof Error ? redactDiscordError(failure.message) : "Discord test failed.";
    throw new ApiFailure(`${detail} Check saved webhook settings, discord.write permission and native worker availability. Delivery may have occurred; no automatic retry was made.`,
      status, undefined, !(failure instanceof ApiFailure) || failure.uncertain, failure instanceof ApiFailure && failure.incompatible);
  }
}
export async function uploadDiscordWebhook(webhookUrl: string, signal?: AbortSignal) {
  const input = discordWebhookSchema.parse({ webhook_url: webhookUrl });
  try { return await request("POST", "/services/discord/webhooks", discordWebhookReferenceSchema, input, signal); }
  catch (failure) {
    const status = failure instanceof ApiFailure ? failure.status : undefined;
    throw new ApiFailure(status ? `Webhook upload failed (HTTP ${status}). Check discord.write permission and backend availability.` :
      "Webhook upload outcome is unknown. No configuration was staged and no automatic retry was made.",
    status, undefined, !(failure instanceof ApiFailure) || failure.uncertain, failure instanceof ApiFailure && failure.incompatible);
  }
}
export const getDynamicDnsStatus = (signal?: AbortSignal) => request("GET", "/services/dynamic-dns/status", dynamicDnsStatusSchema, undefined, signal);
export const getMDNSConfig = (signal?: AbortSignal) => request("GET", "/services/mdns", mdnsSchema, undefined, signal);
export const getMDNSStatus = (signal?: AbortSignal) => request("GET", "/services/mdns/status", mdnsStatusPageSchema, undefined, signal);
export const getTimezones = (signal?: AbortSignal) => request("GET", "/system/timezones", timezonesSchema, undefined, signal);
export async function uploadDynamicDnsSecret(secret: string, signal?: AbortSignal) {
  if (!secret || secret.includes("\0") || new TextEncoder().encode(secret).length > 4096) throw new Error("Client secret must be 1..4096 UTF-8 bytes without NUL");
  try { return await request("POST", "/services/dynamic-dns/secrets", dynamicDnsSecretReferenceSchema, { client_secret: secret }, signal); }
  catch (error) {
    const status = error instanceof ApiFailure ? error.status : undefined;
    throw new ApiFailure(status ? `Client secret storage failed (HTTP ${status}). Check permissions and backend availability.` :
      "Client secret upload outcome is unknown. No automatic retry was made; check backend availability before another upload.", status);
  }
}
export async function uploadMqttPassword(password: string, signal?: AbortSignal) {
  if (!password || password.includes("\0") || new TextEncoder().encode(password).length > 4096) throw new Error("Password must be 1..4096 UTF-8 bytes without NUL");
  try { return await request("POST", "/services/mqtt/passwords", mqttPasswordReferenceSchema, { password }, signal); }
  catch (error) {
    const status = error instanceof ApiFailure ? error.status : undefined;
    throw new ApiFailure(status ? `Password storage failed (HTTP ${status}). Check permissions and backend availability.` :
      "Password upload outcome is unknown. No automatic retry was made; check backend availability before another upload.", status);
  }
}
export const getState = (signal?: AbortSignal) => request("GET", "/state", stateSchema, undefined, signal);
export const getPlatformStatus = (signal?: AbortSignal) => request("GET", "/platform/status", platformStatusSchema, undefined, signal);
export const getRuntime = (signal?: AbortSignal) => request("GET", "/runtime", runtimeSchema, undefined, signal);
export const getDiscoveredInterfaces = (signal?: AbortSignal) => request("GET", "/interfaces/discovered", discoveredInterfacesSchema, undefined, signal);
export const retryDHCP = (name: string) => request("POST", `/interfaces/${id(name)}/dhcp/retry`, dhcpRetrySchema);
export const getTransactions = (signal?: AbortSignal) => request("GET", "/transactions",
  transactionsSchema, undefined, signal);
export const getTransaction = (value: string) => request("GET", `/transactions/${id(value)}`, transactionSchema);
export const getStatistics = (signal?: AbortSignal) => request("GET", "/statistics", statisticsSchema, undefined, signal);
export const getFirewallCounters = (signal?: AbortSignal) => request("GET", "/statistics/firewall", firewallCountersSchema, undefined, signal);
export function getFirewallDenyLog(query: FirewallDenyQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(firewallDenyQuerySchema.parse(query))) if (value !== undefined) params.set(key, String(value));
  return request("GET", `/firewall/deny-log${params.size ? `?${params}` : ""}`, firewallDenyPageSchema, undefined, signal);
}
export interface ConnectionsQuery { family?: "ipv4" | "ipv6"; protocol?: string; address?: string; port?: number; zone?: number; limit?: number; offset?: number }
export function getConnections(query: ConnectionsQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return request("GET", `/statistics/connections${params.size ? `?${params}` : ""}`, connectionsPageSchema, undefined, signal);
}
export function connectionSelector(row: Connection) {
  if (row.id === null || !/^(0|[1-9]\d*)$/.test(row.id) || BigInt(row.id) > 4294967295n ||
      (row.original.zone !== null && row.original.zone !== row.zone) || (row.reply.zone !== null && row.reply.zone !== row.zone)) return null;
  const original = row.original;
  try {
    if (numericAddress(original.source).kind() !== row.family || numericAddress(original.destination).kind() !== row.family) return null;
  } catch { return null; }
  if ([6, 17, 132].includes(row.protocol)) {
    if (original.source_port === null || original.destination_port === null || [original.icmp_id, original.icmp_type, original.icmp_code].some(value => value !== null)) return null;
  } else if ((row.protocol === 1 && row.family === "ipv4") || (row.protocol === 58 && row.family === "ipv6")) {
    if ([original.icmp_id, original.icmp_type, original.icmp_code].some(value => value === null) || original.source_port !== null || original.destination_port !== null) return null;
  } else return null;
  return { family: row.family, protocol: row.protocol, zone: row.zone, original: { ...original } };
}
export function deleteConnection(row: Connection) {
  const selector = connectionSelector(row);
  if (!selector || row.id === null) throw new Error("This snapshot row has no supported complete deletion identity");
  return request("DELETE", `/connections/${id(row.id)}`, connectionDeletionSchema.extend({ status: connectionDeletionSchema.shape.status.extract(["deleted"]) }), selector);
}
export const deleteAllConnections = () => request("DELETE", "/connections", connectionDeletionSchema.extend({ status: connectionDeletionSchema.shape.status.extract(["flushed"]) }), { confirm: true });
export const getSystemUpgrade = (signal?: AbortSignal) => request("GET", "/system/upgrade", upgradeStatusSchema, undefined, signal);
export const checkSoftwareRelease = (signal?: AbortSignal) =>
  request("POST", "/system/upgrade/check", z.object({ status: z.literal("check_requested") }).strict(), undefined, signal);
export function startSystemUpgrade(version: string) {
  const canonical = upgradeVersionSchema.parse(version);
  return request("POST", "/system/upgrade", upgradeJobSchema.refine(job => job.version === canonical, "Upgrade response version does not match the requested version"), { version: canonical });
}
export const getRevisions = (before?: string) => request("GET",
  `/revisions?limit=50${before === undefined ? "" : `&before_revision=${id(revisionSchema.parse(before))}`}`, revisionPageSchema);
export const getRevision = (revision: string) => request("GET", `/revisions/${id(revisionSchema.parse(revision))}`, revisionDetailSchema);
export const getLatestRevision = () => request("GET", "/revisions/latest", revisionDetailSchema);
export async function submitPackage(body: PackageRequest) {
  const rpfMode = rpfModeSchema.default("disabled").parse(body.config.firewall.rpf_mode);
  const payload = { ...body, base_revision: revisionSchema.parse(body.base_revision), config: cloneConfig(body.config) };
  const result = await request("POST", "/transactions", submittedTransactionSchema, payload);
  if (rpfMode !== result.candidate.firewall.rpf_mode) {
    throw new ApiFailure("The backend did not preserve the requested IPv4 RPF mode. A provisional transaction may be active; inspect it and roll back rather than confirming. Deploy an RPF-capable backend before retrying.", 202, result, true, true);
  }
  if (stableJson(discordConfigSchema.parse(payload.config.discord ?? discordDefaults())) !==
      stableJson(discordConfigSchema.parse(result.candidate.discord ?? discordDefaults()))) {
    throw new ApiFailure("The backend did not preserve Discord notification settings. A provisional transaction may be active; inspect it and roll back rather than confirming. Deploy a Discord-capable backend before retrying.", 202, result, true, true);
  }
  if (!conntrackPreserved(payload.config.kernel, result.candidate.kernel)) {
    throw new ApiFailure("The backend did not preserve the requested conntrack settings. A provisional transaction may be active; inspect it and roll back rather than confirming. Deploy a conntrack-capable backend before retrying.", 202, result, true, true);
  }
  if (stableJson(tuningSettings(payload.config.kernel)) !== stableJson(tuningSettings(result.candidate.kernel))) {
    throw new ApiFailure("The backend did not preserve the requested RPS, RFS or NIC offload settings. A provisional transaction may be active; review it and roll back rather than confirming. Deploy a tuning-capable backend before retrying.", 202, result, true, true);
  }
  if (!ruleOwnershipPreserved(payload.config, result.candidate)) {
    throw new ApiFailure("The backend did not preserve the requested rule ownership labels. A provisional transaction may be active; review it and roll back rather than confirming. Deploy a label-capable backend before retrying.", 202, result, true, true);
  }
  return result;
}
export const deleteFirewallHostsAndRules = (body: Omit<PackageRequest, "config"> & { confirm: true }) =>
  request("DELETE", "/firewall/hosts-and-rules", transactionSchema, {
    base_revision: dateVersionSchema.parse(body.base_revision),
    confirm_timeout_seconds: body.confirm_timeout_seconds, confirm: body.confirm, description: body.description,
  });
export const confirmTransaction = (value: string) => request("POST", `/transactions/${id(value)}/confirm`, transactionSchema);
export const rollbackTransaction = (value: string) => request("POST", `/transactions/${id(value)}/rollback`, transactionSchema);
export const getDHCPRelayStatus = (signal?: AbortSignal) =>
  request("GET", "/services/dhcp-relay/status", dhcpRelayStatusPageSchema, undefined, signal);
export const getGatewayStatistics = (signal?: AbortSignal) =>
  request("GET", "/statistics/gateways", gatewayStatisticsPageSchema, undefined, signal);
export const getGatewayMonitors = (signal?: AbortSignal) =>
  request("GET", "/gateway-monitors", gatewayMonitorSchema.array().nullable().transform(value => value ?? []), undefined, signal);
export const getGatewayStatistic = (name: string, signal?: AbortSignal) =>
  request("GET", `/statistics/gateways/${id(name)}`, gatewayStatisticsDetailSchema, undefined, signal);
export const getGatewayStatus = (signal?: AbortSignal) =>
  request("GET", "/services/gateway-monitoring/status", gatewayStatusPageSchema, undefined, signal);
export const getApplianceStatus = (service: ApplianceService, signal?: AbortSignal) =>
  request("GET", `/services/${service}/status`, applianceStatusPageSchema, undefined, signal);
export const getVnStatReporting = (signal?: AbortSignal) =>
  request("GET", "/statistics/vnstat", vnstatReportingSchema, undefined, signal);
export const getApplianceConfig = (service: ApplianceService, signal?: AbortSignal) =>
  service === "ntp" ? request("GET", "/services/ntp", ntpSchema, undefined, signal) :
    service === "syslog" ? request("GET", "/services/syslog", syslogSchema, undefined, signal) :
      request("GET", "/services/vnstat", vnstatSchema, undefined, signal);
export const reconcileServices = (service: RepairService = "softflowd") =>
  request("POST", `/services/${service}/reconcile`, runtimeSchema);
export const restoreRevision = (revision: string, body: Omit<PackageRequest, "config">) =>
  request("POST", `/revisions/${id(revisionSchema.parse(revision))}/restore`, transactionSchema,
    { ...body, base_revision: revisionSchema.parse(body.base_revision) });
