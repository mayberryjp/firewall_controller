import { request } from "@/services/api";
import {
  stateSchema, runtimeSchema, transactionSchema, revisionPageSchema, discoveredInterfacesSchema,
  revisionDetailSchema, statisticsSchema, transactionsSchema, dhcpRelayStatusPageSchema,
  gatewayStatisticsPageSchema, gatewayStatisticsDetailSchema, gatewayStatusPageSchema,
  applianceStatusPageSchema, ntpSchema, syslogSchema, vnstatSchema,
  gatewayMonitorSchema, type ApplianceService, type RepairService, type PackageRequest,
} from "@/types/domain";

const id = encodeURIComponent;
export const getState = (signal?: AbortSignal) => request("GET", "/state", stateSchema, undefined, signal);
export const getRuntime = (signal?: AbortSignal) => request("GET", "/runtime", runtimeSchema, undefined, signal);
export const getDiscoveredInterfaces = (signal?: AbortSignal) => request("GET", "/interfaces/discovered", discoveredInterfacesSchema, undefined, signal);
export const getTransactions = (signal?: AbortSignal) => request("GET", "/transactions",
  transactionsSchema, undefined, signal);
export const getTransaction = (value: string) => request("GET", `/transactions/${id(value)}`, transactionSchema);
export const getStatistics = (signal?: AbortSignal) => request("GET", "/statistics", statisticsSchema, undefined, signal);
export const getRevisions = (before?: string) => request("GET",
  `/revisions?limit=50${before === undefined ? "" : `&before_revision=${id(before)}`}`, revisionPageSchema);
export const getRevision = (revision: string) => request("GET", `/revisions/${id(revision)}`, revisionDetailSchema);
export const submitPackage = (body: PackageRequest) => request("POST", "/transactions", transactionSchema, body);
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
  request("GET", `/services/${service}`, service === "ntp" ? ntpSchema : service === "syslog" ? syslogSchema : vnstatSchema, undefined, signal);
export const reconcileServices = (service: RepairService = "softflowd") =>
  request("POST", `/services/${service}/reconcile`, runtimeSchema);
export const restoreRevision = (revision: string, body: Omit<PackageRequest, "config">) =>
  request("POST", `/revisions/${id(revision)}/restore`, transactionSchema, body);
