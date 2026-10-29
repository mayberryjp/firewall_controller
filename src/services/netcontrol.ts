import { ApiFailure, request } from "@/services/api";
import { z } from "zod";
import { numericAddress } from "@/services/configuration";
import { hostHealthSchema } from "@/services/hostHealth";
import { linkDiagnosticsSchema } from "@/services/linkDiagnostics";
import { dnsLookupRequestSchema, dnsLookupSchema, restartResponseSchema, restartTargetSchema, type DNSLookupRequest } from "@/services/operations";
import {
  mqttPasswordReferenceSchema, mqttStatusSchema, dynamicDnsSecretReferenceSchema, dynamicDnsStatusSchema, timezonesSchema,
  stateSchema, runtimeSchema, transactionSchema, revisionPageSchema, discoveredInterfacesSchema, dhcpRetrySchema, connectionsPageSchema,
  revisionDetailSchema, statisticsSchema, transactionsSchema, dhcpRelayStatusPageSchema,
  gatewayStatisticsPageSchema, gatewayStatisticsDetailSchema, gatewayStatusPageSchema,
  applianceStatusPageSchema, ntpSchema, syslogSchema, vnstatSchema, mdnsSchema, mdnsStatusPageSchema,
  gatewayMonitorSchema, type ApplianceService, type RepairService, type PackageRequest,
  connectionDeletionSchema, upgradeVersionSchema, upgradeJobSchema, upgradeStatusSchema, type Connection,
  platformStatusSchema, bgpSchema, bgpStatusSchema, bgpRoutesSchema, bgpAdvertisedRoutesSchema, udpBroadcastRelaySchema, udpRelayStatusPageSchema,
} from "@/types/domain";

const id = encodeURIComponent;
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
const submittedTransactionSchema = transactionSchema.extend({ ignored_fields: z.array(z.string()).optional() });
export const getHostHealth = (signal?: AbortSignal) => request("GET", "/statistics/host", hostHealthSchema, undefined, signal);
export const getMqttStatus = (signal?: AbortSignal) => request("GET", "/services/mqtt/status", mqttStatusSchema, undefined, signal);
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
export function startSystemUpgrade(version: string) {
  const canonical = upgradeVersionSchema.parse(version);
  return request("POST", "/system/upgrade", upgradeJobSchema.refine(job => job.version === canonical, "Upgrade response version does not match the requested version"), { version: canonical });
}
export const getRevisions = (before?: string) => request("GET",
  `/revisions?limit=50${before === undefined ? "" : `&before_revision=${id(before)}`}`, revisionPageSchema);
export const getRevision = (revision: string) => request("GET", `/revisions/${id(revision)}`, revisionDetailSchema);
export const getLatestRevision = () => request("GET", "/revisions/latest", revisionDetailSchema);
export const submitPackage = (body: PackageRequest) => request("POST", "/transactions", submittedTransactionSchema, body);
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
export const getApplianceConfig = (service: ApplianceService, signal?: AbortSignal) =>
  service === "ntp" ? request("GET", "/services/ntp", ntpSchema, undefined, signal) :
    service === "syslog" ? request("GET", "/services/syslog", syslogSchema, undefined, signal) :
      request("GET", "/services/vnstat", vnstatSchema, undefined, signal);
export const reconcileServices = (service: RepairService = "softflowd") =>
  request("POST", `/services/${service}/reconcile`, runtimeSchema);
export const restoreRevision = (revision: string, body: Omit<PackageRequest, "config">) =>
  request("POST", `/revisions/${id(revision)}/restore`, transactionSchema, body);
