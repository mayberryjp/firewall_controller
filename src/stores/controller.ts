import { computed, onScopeDispose, ref, shallowReactive, watch } from "vue";
import { defineStore } from "pinia";
import { ApiFailure, onUnauthorized, setApiDevice } from "@/services/api";
import * as api from "@/services/netcontrol";
import {
  configSchema, knownStatuses, terminal,
  type Config, type StateView, type RuntimeState, type Transaction, type PlatformStatus,
  type Statistics, type Revision, type RevisionMetadata, type GatewayStatisticsPage, type RepairService, type UpgradeStatus,
  type BGPStatus, type BGPRoutes,
} from "@/types/domain";
import { cloneConfig, differences, equalConfig, stableJson, syncWireGuardRoutes, validateConfig } from "@/services/configuration";
import { encodeJson, utf8Size } from "@/services/json";
import type { HostHealth } from "@/services/hostHealth";
import type { LinkDiagnostics } from "@/services/linkDiagnostics";
import { mqttStatusSchema, dynamicDnsStatusSchema, mdnsStatusPageSchema } from "@/types/domain";
import type { z } from "zod";
import { rememberRegistryDevice, setRegistrySessionToken } from "@/services/registry";

export interface Dataset<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastSuccess: number | null;
  stale: boolean;
  incompatible: boolean;
  delayed: boolean;
}
function dataset<T>(): Dataset<T> {
  return shallowReactive({ data: null, loading: false, error: null, lastSuccess: null, stale: true, incompatible: false, delayed: false });
}
const message = (error: unknown): string => error instanceof Error ? error.message : "Unexpected operation failure";

export const useControllerStore = defineStore("controller", () => {
  const connected = ref(false), connecting = ref(false), authError = ref<string | null>(null);
  const state = dataset<StateView>(), runtime = dataset<RuntimeState>();
  const platform = dataset<PlatformStatus>();
  const linkDiagnostics = dataset<LinkDiagnostics>();
  const bgpStatus = dataset<BGPStatus>(), bgpRoutes = dataset<BGPRoutes>();
  const bgpUnsupported = ref(false);
  const bgpExpired = ref(true), bgpRoutesExpired = ref(true), bgpMonitoring = ref(false);
  for (const [query, expired] of [[bgpStatus, bgpExpired], [bgpRoutes, bgpRoutesExpired]] as const) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(() => query.lastSuccess, time => {
      clearTimeout(timer);
      const remaining = time === null ? 0 : time + 15000 - Date.now();
      expired.value = remaining <= 0;
      if (remaining > 0) timer = setTimeout(() => { expired.value = true; }, remaining);
    }, { immediate: true, flush: "sync" });
    onScopeDispose(() => clearTimeout(timer));
  }
  const bgpStatusCurrent = computed(() => connected.value && !bgpExpired.value && !bgpStatus.stale && !bgpStatus.error);
  const bgpRoutesCurrent = computed(() => connected.value && !bgpRoutesExpired.value && !bgpRoutes.stale && !bgpRoutes.error);
  watch(() => stableJson((state.data?.active_transaction?.candidate ?? state.data?.desired)?.bgp), () => {
    bgpStatus.stale = true; bgpRoutes.stale = true;
  }, { flush: "sync" });
  const sessionVersion = ref(0);
  const restartPending = ref(""), restartReconnecting = ref(false), restartNotice = ref(""), restartError = ref("");
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  onScopeDispose(() => clearTimeout(reconnectTimer));
  const platformUnsupported = ref(false);
  const healthSource = computed(() => {
    const sources = [state, runtime, platform].filter(query => query.data?.process_health);
    sources.sort((left, right) => {
      const time = (query: typeof sources[number]) => Date.parse(query.data?.process_health?.collected_at ?? "") || query.lastSuccess || 0;
      return time(right) - time(left) || (right.lastSuccess ?? 0) - (left.lastSuccess ?? 0);
    });
    return sources[0];
  });
  const healthExpired = ref(true);
  let healthTimer: ReturnType<typeof setTimeout> | undefined;
  watch(() => healthSource.value?.lastSuccess, lastSuccess => {
    clearTimeout(healthTimer);
    const remaining = lastSuccess === null || lastSuccess === undefined ? 0 : lastSuccess + 15000 - Date.now();
    healthExpired.value = remaining <= 0;
    if (remaining > 0) healthTimer = setTimeout(() => { healthExpired.value = true; }, remaining);
  }, { immediate: true, flush: "sync" });
  onScopeDispose(() => clearTimeout(healthTimer));
  const healthStatus = computed(() => {
    const source = healthSource.value;
    return source?.data?.process_health ? {
      process_health: source.data.process_health,
      active_alerts: [...new Map((source.data.active_alerts ?? []).map(alert => [alert.id, alert])).values()],
      stale: source.stale || source.data.process_health.stale || healthExpired.value,
    } : null;
  });
  const transactions = dataset<Record<string, Transaction>>(), statistics = dataset<Statistics>();
  const gatewayStatistics = dataset<GatewayStatisticsPage>();
  const hostHealth = dataset<HostHealth>(), mqttStatus = dataset<z.infer<typeof mqttStatusSchema>>();
  const dynamicDnsStatus = dataset<z.infer<typeof dynamicDnsStatusSchema>>();
  const mdnsStatus = dataset<z.infer<typeof mdnsStatusPageSchema>>();
  const upgrade = dataset<UpgradeStatus>();
  const upgradePending = ref(false), upgradeUncertain = ref(false), upgradeNeedsRefresh = ref(false);
  const acceptedUpgradeID = ref(""), requestedUpgradeVersion = ref(""), previousUpgradeID = ref("");
  const upgradeNotice = ref("");
  const revisions = dataset<RevisionMetadata[]>(), revisionDetail = dataset<Revision>();
  const comparisonRevision = dataset<Revision>();
  const nextRevision = ref<string | undefined>(), currentRevisionID = ref("");
  const draft = ref<Config | null>(null), baseline = ref<Config | null>(null), baseRevision = ref<string | null>(null);
  const submitted = ref<{ config: Config; id?: string } | null>(null);
  const busy = ref(false), actionError = ref<string | null>(null), notice = ref<string | null>(null);
  const ignoredFields = ref<string[]>([]);
  const uncertain = ref<{ operation: string; id?: string; priorIDs: string[]; base: string | null; startedAt: string } | null>(null);
  const editorDirty = ref(false), monitoring = ref(false), gatewayMonitoring = ref(false);
  const ipv6Enabled = computed(() => (draft.value ?? state.data?.active_transaction?.candidate ?? state.data?.desired)?.ipv6_enabled !== false);
  const supportsDhcpGatewayMonitors = computed(() => !runtime.stale && !runtime.error &&
    runtime.data?.capabilities?.gateway_monitor_modes?.includes("dhcp") === true &&
    runtime.data.capabilities.dhcp_gateway_monitor_address_families?.includes("ipv4") === true);
  let epoch = 0;
  const flights = new Map<object, Promise<void>>();
  const aborts = new Set<AbortController>();
  const versions = new WeakMap<object, number>();
  const queryAborts = new WeakMap<object, AbortController>();
  const revisionCache = new Map<string, Revision>();
  const detailReads = new Map<string, Promise<Transaction | null>>();
  const allDatasets = [state, runtime, platform, linkDiagnostics, bgpStatus, bgpRoutes, transactions, statistics, gatewayStatistics, hostHealth, mqttStatus, dynamicDnsStatus, mdnsStatus, revisions, revisionDetail, comparisonRevision, upgrade];
  const upgradeActive = computed(() => Boolean(upgrade.data?.job && !["succeeded", "failed", "rolled_back"].includes(upgrade.data.job.status)));
  const upgradeBlockedReason = computed(() => {
    if (upgradeUncertain.value) return "Upgrade submission outcome is unconfirmed. Do not resubmit; reconnect and inspect the upgrade job.";
    if (acceptedUpgradeID.value && upgrade.data?.job?.id !== acceptedUpgradeID.value) return "The latest upgrade job differs from the accepted job. Its outcome needs operator verification.";
    if (upgradeActive.value) return `System upgrade ${upgrade.data?.job?.id}: ${upgrade.data?.job?.status}. Writes are blocked; recovery_required needs console recovery.`;
    if (upgradeNeedsRefresh.value) return "Refreshing committed state after upgrade. Local changes are retained.";
    if (upgrade.data?.enabled && upgrade.stale) return "Upgrade status is unavailable. Refresh before writing.";
    return "";
  });
  const activeTransactions = computed(() => {
    const items = new Map<string, Transaction>(Object.values(transactions.data ?? {}).map((item) => [item.id, item]));
    const active = state.data?.active_transaction;
    if (active && !items.has(active.id)) items.set(active.id, active);
    return [...items.values()].filter((item) => !terminal(item));
  });
  const unknownStatus = computed(() => Object.values(transactions.data ?? {}).some((item) => !knownStatuses.includes(item.status)) ||
    Boolean(state.data?.active_transaction && !knownStatuses.includes(state.data.active_transaction.status)));
  const incompatible = computed(() => unknownStatus.value || state.incompatible || transactions.incompatible);
  const draftStale = computed(() => draft.value !== null && baseRevision.value !== state.data?.revision);
  const diff = computed(() => baseline.value && draft.value ? differences(baseline.value, draft.value) : []);
  const validation = computed(() => draft.value ? validateConfig(draft.value, runtime.data?.parent_interfaces, baseline.value ?? undefined) : []);
  const freshState = computed(() => Boolean(connected.value && state.data && !state.stale && !state.error &&
    state.lastSuccess && Date.now() - state.lastSuccess < 20_000));
  const sortedTransactions = computed(() => Object.values(transactions.data ?? {}).sort((a, b) =>
    (b.submitted_at ?? "").localeCompare(a.submitted_at ?? "") || a.id.localeCompare(b.id)));
  const readOnlyNotice = computed(() => {
    if (!connected.value) return "Sign in and select a registered firewall.";
    if (restartPending.value || restartReconnecting.value) return "A process restart is in progress. Your local draft is preserved.";
    if (busy.value || submitted.value || uncertain.value) return "A submitted snapshot or uncertain write is frozen. Reconcile its server outcome first.";
    return "";
  });
  const readOnlyReason = computed(() => readOnlyNotice.value ||
    (!state.data ? "Committed desired configuration is unavailable. Recovery remains accessible." : ""));
  const applyBlockedReason = computed(() => {
    if (readOnlyReason.value) return readOnlyReason.value;
    if (draftStale.value) return `Draft base revision ${baseRevision.value} differs from committed revision ${state.data?.revision}. Compare the revisions before discarding changes and starting over.`;
    if (state.error) return `Unable to check the current firewall configuration: ${state.error}. Try Commit & push again.`;
    if (!freshState.value) return "Current firewall state will be checked before pushing. Your changes are retained.";
    if (!draft.value || !diff.value.length) return "No changes to apply.";
    if (validation.value.length) return "Resolve validation errors before applying.";
    return "";
  });
  const canApply = computed(() => !applyBlockedReason.value);
  const operationBlockedReason = computed(() => {
    if (!connected.value) return "Select a connected firewall.";
    if (restartPending.value || restartReconnecting.value) return "A restart is already in progress.";
    if (busy.value || submitted.value || uncertain.value) return "Resolve the pending configuration operation first.";
    if (activeTransactions.value.length) return "Finish the active transaction or recovery first.";
    if (upgradePending.value || upgradeBlockedReason.value) return upgradeBlockedReason.value || "An upgrade is pending.";
    return "";
  });

  function invalidateReads(): void {
    epoch++;
    sessionVersion.value++;
    clearTimeout(reconnectTimer);
    restartPending.value = ""; restartReconnecting.value = false; restartNotice.value = ""; restartError.value = "";
    aborts.forEach((controller) => controller.abort());
    aborts.clear();
    allDatasets.forEach((query) => { query.stale = true; query.loading = false; query.delayed = false; });
    flights.clear();
    detailReads.clear();
  }
  async function load<T>(query: Dataset<T>, read: (signal: AbortSignal) => Promise<T>): Promise<void> {
    const existing = flights.get(query);
    if (existing) return existing;
    const version = epoch, controller = new AbortController();
    const queryVersion = (versions.get(query) ?? 0) + 1;
    versions.set(query, queryVersion);
    queryAborts.set(query, controller);
    const current = () => version === epoch && versions.get(query) === queryVersion;
    aborts.add(controller);
    query.loading = true;
    const delayed = setTimeout(() => { if (current()) query.delayed = true; }, 3000);
    const promise = (async () => {
      try {
        const result = await read(controller.signal);
        if (!current()) return;
        query.data = result; query.error = null; query.stale = false;
        query.incompatible = false; query.lastSuccess = Date.now();
      } catch (error) {
        if (!current()) return;
        query.error = message(error); query.stale = true;
        query.incompatible = error instanceof ApiFailure && error.incompatible;
      } finally {
        clearTimeout(delayed);
        aborts.delete(controller);
        if (current()) { query.loading = false; query.delayed = false; flights.delete(query); }
      }
    })();
    flights.set(query, promise);
    return promise;
  }
  const refreshState = () => load(state, api.getState);
  const refreshRuntime = () => load(runtime, api.getRuntime);
  const refreshLinkDiagnostics = () => load(linkDiagnostics, api.getLinkDiagnostics);
  async function refreshBGPStatus(): Promise<void> {
    if (bgpUnsupported.value) return;
    const session = epoch;
    await load(bgpStatus, async signal => {
      try { return await api.getBGPStatus(signal); }
      catch (error) {
        if (session === epoch && error instanceof ApiFailure && [403, 404, 405].includes(error.status ?? 0)) bgpUnsupported.value = true;
        throw error;
      }
    });
  }
  const refreshBGPRoutes = () => bgpUnsupported.value ? Promise.resolve() : load(bgpRoutes, api.getBGPRoutes);
  function reconnectAfterRestart(session: number): void {
    restartReconnecting.value = true;
    let attempts = 0;
    async function probe(): Promise<void> {
      if (session !== epoch || !connected.value) return;
      attempts++;
      await load(platform, signal => api.getPlatformStatus(AbortSignal.any([signal, AbortSignal.timeout(5000)])));
      if (session !== epoch || !connected.value) return;
      if (!platform.stale) {
        restartReconnecting.value = false;
        restartNotice.value = "Management is reachable. Review current process health; connectivity alone does not confirm a completed daemon restart.";
        return;
      }
      if (attempts >= 8) {
        restartReconnecting.value = false;
        restartError.value = `Unable to verify management connectivity after eight checks. Restart outcome remains unknown; do not automatically resubmit. ${platform.error ?? ""}`;
        return;
      }
      reconnectTimer = setTimeout(() => { void probe(); }, Math.min(5000, 1000 * 2 ** attempts));
    }
    reconnectTimer = setTimeout(() => { void probe(); }, 5000);
  }
  async function restartProcess(target: string): Promise<void> {
    if (operationBlockedReason.value) throw new Error(operationBlockedReason.value);
    const session = epoch;
    restartPending.value = target; restartError.value = ""; restartNotice.value = "";
    try {
      const result = await api.restartProcess(target);
      if (session !== epoch) return;
      restartNotice.value = result.status === "simulated" ? `${target}: simulated; no process was restarted.` :
        result.status === "restart_requested" ? `${target}: restart requested, not completed. No automatic resubmission.` :
          `${target}: supervisor restarted. Protocol health and delivery are not established.`;
      if (target === "netcontrold" && result.status === "restart_requested") reconnectAfterRestart(session);
      else void refreshPlatformStatus();
    } catch (error) {
      if (session !== epoch) return;
      const unknown = error instanceof ApiFailure && error.uncertain;
      restartError.value = unknown ? `Restart outcome unknown. Do not automatically resubmit. ${message(error)}` : message(error);
      if (unknown && target === "netcontrold") reconnectAfterRestart(session);
    } finally {
      if (session === epoch) {
        restartPending.value = "";
        if (target === "bgp" || target === "netcontrold") { bgpStatus.stale = true; bgpRoutes.stale = true; }
      }
    }
  }
  async function refreshPlatformStatus(): Promise<void> {
    if (platformUnsupported.value) return;
    const session = epoch;
    await load(platform, async signal => {
      try { return await api.getPlatformStatus(AbortSignal.any([signal, AbortSignal.timeout(5000)])); }
      catch (error) {
        if (session === epoch && error instanceof ApiFailure && [403, 404, 405].includes(error.status ?? 0)) platformUnsupported.value = true;
        throw error;
      }
    });
  }
  async function refreshUpgrade(): Promise<void> {
    const session = epoch;
    await load(upgrade, api.getSystemUpgrade);
    if (session !== epoch || upgrade.stale || !upgrade.data) return;
    const job = upgrade.data.job;
    if (upgradeUncertain.value && job && job.id !== previousUpgradeID.value && job.version === requestedUpgradeVersion.value) {
      acceptedUpgradeID.value = job.id; upgradeUncertain.value = false;
    }
    if (acceptedUpgradeID.value && job?.id !== acceptedUpgradeID.value) {
      upgradeNotice.value = `Accepted job ${acceptedUpgradeID.value}; latest job ${job?.id ?? "unavailable"}. The earlier outcome is not established.`;
      return;
    }
    if (upgradeNeedsRefresh.value && !upgradeActive.value && !upgradeUncertain.value) {
      await Promise.all([refreshState(), refreshTransactions()]);
      if (session === epoch && !state.stale && !transactions.stale) upgradeNeedsRefresh.value = false;
    }
  }
  async function checkMaintenance(): Promise<void> {
    if (upgradePending.value) throw new Error("System upgrade submission is pending");
    await refreshUpgrade();
    if (upgrade.stale || !upgrade.data || upgradeBlockedReason.value) throw new Error(upgradeBlockedReason.value || upgrade.error || "Upgrade status is unavailable");
  }
  async function startUpgrade(version: string, expectedRepository: string): Promise<void> {
    if (upgradePending.value) return;
    const session = epoch;
    upgradePending.value = true; upgradeNotice.value = "";
    try {
      await Promise.all([refreshUpgrade(), refreshTransactions()]);
      if (upgrade.data?.repository !== expectedRepository) throw new Error("Configured repository changed. Review the upgrade again.");
      if (session !== epoch || !connected.value || upgrade.stale || !upgrade.data?.enabled || !upgrade.data.repository || upgradeBlockedReason.value ||
          busy.value || uncertain.value || submitted.value || transactions.stale || activeTransactions.value.length) {
        throw new Error(upgradeBlockedReason.value || "Upgrade requires configured trust, fresh status and no active or uncertain write");
      }
      requestedUpgradeVersion.value = version; previousUpgradeID.value = upgrade.data.job?.id ?? "";
      try {
        const job = await api.startSystemUpgrade(version);
        if (session !== epoch) return;
        queryAborts.get(upgrade)?.abort();
        versions.set(upgrade, (versions.get(upgrade) ?? 0) + 1); flights.delete(upgrade);
        upgrade.loading = false; upgrade.delayed = false; upgrade.stale = false; upgrade.error = null; upgrade.lastSuccess = Date.now();
        upgradeNotice.value = "";
        upgrade.data = { ...upgrade.data, job }; acceptedUpgradeID.value = job.id;
        upgradeNeedsRefresh.value = true;
      } catch (error) {
        if (session === epoch && error instanceof ApiFailure && error.uncertain) { upgradeUncertain.value = true; upgradeNeedsRefresh.value = true; }
        throw error;
      }
    } finally { if (session === epoch) upgradePending.value = false; }
  }
  async function refreshTransactions(): Promise<void> {
    await load(transactions, api.getTransactions);
    if (uncertain.value?.id && connected.value) await readTransaction(uncertain.value.id);
    await settleSubmitted();
  }
  const refreshStatistics = () => load(statistics, api.getStatistics);
  const refreshGatewayStatistics = () => load(gatewayStatistics, api.getGatewayStatistics);
  const refreshHostHealth = () => load(hostHealth, api.getHostHealth);
  const refreshMqttStatus = () => load(mqttStatus, api.getMqttStatus);
  const refreshDynamicDnsStatus = () => load(dynamicDnsStatus, api.getDynamicDnsStatus);
  const refreshMDNSStatus = () => load(mdnsStatus, api.getMDNSStatus);
  async function refresh(): Promise<void> {
    if (!connected.value) return;
    await Promise.all([refreshState(), refreshRuntime(), refreshTransactions()]);
  }
  onUnauthorized(() => {
    connected.value = false; connecting.value = false;
    setApiDevice(""); setRegistrySessionToken(""); invalidateReads();
    authError.value = "Registry session expired (401). Sign in again; your in-memory draft is preserved.";
  });
  async function connect(deviceId: string): Promise<boolean> {
    try { setApiDevice(deviceId); }
    catch (error) { authError.value = error instanceof Error ? error.message : "Invalid saved firewall"; return false; }
    connecting.value = true; authError.value = null;
    invalidateReads();
    platform.data = null; platformUnsupported.value = false; linkDiagnostics.data = null;
    bgpStatus.data = null; bgpRoutes.data = null; bgpUnsupported.value = false;
    hostHealth.data = null; mqttStatus.data = null; mdnsStatus.data = null;
    await load(transactions, api.getTransactions);
    if (transactions.stale) {
      await refreshState();
      if (state.stale) {
        setApiDevice(""); connecting.value = false;
        authError.value = state.error ?? authError.value ?? "Unable to establish read access";
        return false;
      }
    }
    connected.value = true; connecting.value = false;
    rememberRegistryDevice(deviceId);
    void Promise.all([refreshState(), refreshRuntime(), refreshRevisions(), refreshUpgrade()]).then(settleSubmitted);
    return connected.value;
  }
  function disconnect(): void {
    rememberRegistryDevice("");
    setApiDevice(""); connected.value = false; invalidateReads();
    platformUnsupported.value = false;
    bgpUnsupported.value = false;
    allDatasets.forEach((query) => { query.data = null; query.error = null; query.lastSuccess = null; query.incompatible = false; });
    draft.value = null; baseline.value = null; baseRevision.value = null; submitted.value = null;
    uncertain.value = null; actionError.value = null; notice.value = null; authError.value = null; ignoredFields.value = [];
    nextRevision.value = undefined; currentRevisionID.value = ""; editorDirty.value = false;
    revisionCache.clear();
    upgradePending.value = false; upgradeUncertain.value = false; upgradeNeedsRefresh.value = false;
    acceptedUpgradeID.value = ""; requestedUpgradeVersion.value = ""; previousUpgradeID.value = ""; upgradeNotice.value = "";
  }
  function stage(config: Config, syncWireGuard = false): void {
    if (readOnlyReason.value) throw new Error(readOnlyReason.value);
    const candidate = cloneConfig(configSchema.parse(config));
    const previous = draft.value ?? state.data?.desired;
    if (syncWireGuard || stableJson(previous?.interfaces.filter(link => link.kind === "wireguard")) !==
        stableJson(candidate.interfaces.filter(link => link.kind === "wireguard"))) syncWireGuardRoutes(candidate);
    if (!draft.value) {
      if (!state.data) throw new Error("Committed desired configuration unavailable");
      baseline.value = cloneConfig(state.data.desired); baseRevision.value = state.data.revision;
    }
    draft.value = candidate;
  }
  function discardDraft(): void {
    if (busy.value || submitted.value || uncertain.value) throw new Error("Cannot discard a frozen submitted snapshot");
    draft.value = null; baseline.value = null; baseRevision.value = null;
  }
  function restartDraft(): void {
    if (!state.data || !freshState.value || !state.lastSuccess || Date.now() - state.lastSuccess >= 20_000) throw new Error("Refresh committed state before restarting");
    discardDraft();
    baseline.value = cloneConfig(state.data.desired); baseRevision.value = state.data.revision;
    draft.value = cloneConfig(state.data.desired);
  }
  async function settleSubmitted(): Promise<void> {
    const pending = submitted.value;
    if (!pending?.id || !transactions.data || transactions.stale) return;
    const transaction = transactions.data[pending.id];
    if (!transaction || !terminal(transaction)) return;
    if (uncertain.value?.id === transaction.id) uncertain.value = null;
    const session = epoch;
    await refreshState();
    if (session !== epoch || submitted.value?.id !== pending.id || !state.data || state.stale) return;
    if (transaction.status === "committed") {
      if (draft.value && equalConfig(draft.value, pending.config)) {
        draft.value = null; baseline.value = null; baseRevision.value = null;
      }
      notice.value = null;
    } else {
      if (!draft.value) {
        draft.value = cloneConfig(pending.config);
        baseline.value = cloneConfig(state.data.desired);
        baseRevision.value = state.data.revision;
      }
      notice.value = `Server verified rollback ${transaction.id}. Candidate retained; review against the latest committed state before applying again.`;
    }
    submitted.value = null;
    void refreshRevisions();
  }
  async function readTransaction(id: string): Promise<Transaction | null> {
    const existing = detailReads.get(id);
    if (existing) return existing;
    const promise = readTransactionOnce(id);
    detailReads.set(id, promise);
    try { return await promise; }
    finally { if (detailReads.get(id) === promise) detailReads.delete(id); }
  }
  async function readTransactionOnce(id: string): Promise<Transaction | null> {
    const session = epoch;
    try {
      const transaction = await api.getTransaction(id);
      if (session !== epoch || !connected.value) return null;
      transactions.data = { ...transactions.data, [id]: transaction };
      if (uncertain.value?.id === id && terminal(transaction)) uncertain.value = null;
      await settleSubmitted();
      return transaction;
    } catch (error) { if (session === epoch) actionError.value = message(error); return null; }
  }
  async function mutate(operation: string, action: () => Promise<Transaction | RuntimeState>, id?: string): Promise<Transaction | null> {
    if (!connected.value || busy.value) throw new Error("Connect and wait for the current operation");
    busy.value = true; actionError.value = null; notice.value = null;
    const priorIDs = Object.keys(transactions.data ?? {});
    const base = state.data?.revision ?? null;
    invalidateReads();
    const session = epoch;
    let result: Transaction | null = null;
    try {
      const response = await action();
      if (session !== epoch || !connected.value) return null;
      if ("status" in response) {
        result = response;
        transactions.data = { ...transactions.data, [response.id]: response };
        if (submitted.value && !submitted.value.id) submitted.value.id = response.id;
        notice.value = `Server reports ${response.status}; only committed is a durable revision.`;
      } else runtime.data = response;
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        if (submitted.value && !submitted.value.id) submitted.value = null;
        actionError.value = message(error);
        return null;
      }
      if (session !== epoch || !connected.value) return null;
      actionError.value = message(error);
      if (error instanceof ApiFailure && error.transaction) {
        const transaction = error.transaction;
        transactions.data = { ...transactions.data, [transaction.id]: transaction };
        if (submitted.value && !submitted.value.id) submitted.value.id = transaction.id;
        id = transaction.id;
      }
      if (!(error instanceof ApiFailure) || error.uncertain || (error instanceof ApiFailure && error.transaction)) {
        uncertain.value = { operation, id, priorIDs, base, startedAt: new Date().toISOString() };
        if (error instanceof ApiFailure && error.incompatible) transactions.incompatible = true;
      } else if (!id) submitted.value = null;
    } finally {
      busy.value = false;
      if (connected.value) await refresh();
    }
    return result;
  }
  function validateWindow(seconds: number, description: string): string {
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 300) throw new Error("Confirmation window must be 10..300 seconds");
    const trimmed = description.trim();
    if (utf8Size(trimmed) > 1024) throw new Error("Description exceeds 1024 UTF-8 bytes after trimming");
    return trimmed;
  }
  async function apply(seconds: number, description: string): Promise<Transaction | null> {
    const trimmed = validateWindow(seconds, description);
    if (!canApply.value || !draft.value || baseRevision.value === null) throw new Error(applyBlockedReason.value || "Draft base revision is unavailable");
    const captured = cloneConfig(draft.value), capturedBase = baseRevision.value;
    await refreshState();
    if (!canApply.value || state.data?.revision !== capturedBase || !draft.value || !equalConfig(captured, draft.value)) throw new Error("Pre-submit state changed; review again");
    const request = { base_revision: capturedBase, config: captured, confirm_timeout_seconds: seconds, description: trimmed };
    if (utf8Size(encodeJson(request)) > 1_048_576) throw new Error("Complete request exceeds 1 MiB");
    submitted.value = { config: captured }; ignoredFields.value = [];
    return mutate("Apply package", async () => {
      const { ignored_fields: ignored, ...transaction } = await api.submitPackage(request);
      ignoredFields.value = ignored ?? [];
      return transaction;
    });
  }
  async function lifecycle(id: string, action: "confirm" | "rollback"): Promise<Transaction | null> {
    const transaction = await readTransaction(id);
    if (!transaction || !knownStatuses.includes(transaction.status)) throw new Error("Unable to obtain a compatible fresh transaction");
    if (action === "confirm" && (transaction.status !== "pending_confirmation" || Date.parse(transaction.confirmation_deadline) <= Date.now())) throw new Error("Confirmation is not currently available; await server outcome");
    if (action === "rollback" && !["pending_confirmation", "recovery_failed"].includes(transaction.status)) throw new Error("Rollback is not available in this state");
    return mutate(action === "confirm" ? "Confirm configuration" : "Roll back", () =>
      action === "confirm" ? api.confirmTransaction(id) : api.rollbackTransaction(id), id);
  }
  async function restore(revision: string, seconds: number, description: string): Promise<Transaction | null> {
    const trimmed = validateWindow(seconds, description);
    await refreshState();
    if (!freshState.value || busy.value || uncertain.value || draft.value ||
      submitted.value || !state.data) throw new Error("Restore requires fresh configuration, no draft, and no submitted or uncertain write");
    const capturedBase = state.data.revision;
    const history = await api.getRevision(revision);
    if (!freshState.value || !state.lastSuccess || Date.now() - state.lastSuccess >= 20_000 ||
      busy.value || uncertain.value || submitted.value || draft.value || state.data?.revision !== capturedBase) {
      throw new Error("Pre-restore state changed; review the current state before restoring");
    }
    submitted.value = { config: cloneConfig(history.config) };
    return mutate(`Restore revision ${revision}`, () => api.restoreRevision(revision, {
      base_revision: capturedBase, confirm_timeout_seconds: seconds, description: trimmed,
    }));
  }
  async function reconcile(service: RepairService = "softflowd"): Promise<void> {
    await checkMaintenance();
    if (incompatible.value || uncertain.value || activeTransactions.value.some((item) =>
      ["applying", "rolling_back", "recovery_failed"].includes(item.status))) throw new Error("Service reconciliation is blocked by safety state");
    await mutate("Reconcile managed services", () => api.reconcileServices(service));
    if (actionError.value) throw new Error(actionError.value);
  }
  function resolveUncertainty(): void {
    if (transactions.stale || state.stale || !freshState.value || busy.value) throw new Error("Fresh transaction and committed state reads are required");
    if (activeTransactions.value.length) throw new Error("Resolve the active transaction first");
    uncertain.value = null; submitted.value = null;
    notice.value = "Operator acknowledged reconciliation. Review the retained candidate against the latest committed revision.";
  }
  async function refreshRevisions(append = false): Promise<void> {
    if (append && !nextRevision.value) return;
    const cursor = append ? nextRevision.value : undefined;
    const session = epoch;
    await load(revisions, async () => {
      const page = await api.getRevisions(cursor);
      if (session === epoch) nextRevision.value = page.next_before_revision;
      return append ? [...(revisions.data ?? []), ...page.revisions] : page.revisions;
    });
  }
  async function loadRevision(id: string): Promise<void> {
    if (currentRevisionID.value !== id) {
      queryAborts.get(revisionDetail)?.abort();
      versions.set(revisionDetail, (versions.get(revisionDetail) ?? 0) + 1);
      flights.delete(revisionDetail);
      revisionDetail.data = null; revisionDetail.error = null; currentRevisionID.value = id;
    }
    const cached = revisionCache.get(id);
    if (cached) {
      revisionDetail.data = cached; revisionDetail.stale = false; revisionDetail.lastSuccess = Date.now(); return;
    }
    await load(revisionDetail, () => api.getRevision(id));
    if (revisionDetail.data?.revision === id && !revisionDetail.stale) revisionCache.set(id, revisionDetail.data);
  }
  function clearComparison(): void {
    queryAborts.get(comparisonRevision)?.abort();
    versions.set(comparisonRevision, (versions.get(comparisonRevision) ?? 0) + 1);
    flights.delete(comparisonRevision);
    comparisonRevision.data = null; comparisonRevision.error = null; comparisonRevision.loading = false;
    comparisonRevision.stale = true; comparisonRevision.lastSuccess = null; comparisonRevision.incompatible = false;
  }
  async function compareRevision(id: string): Promise<void> {
    clearComparison();
    await load(comparisonRevision, () => {
      const cached = revisionCache.get(id);
      return cached ? Promise.resolve(cached) : api.getRevision(id);
    });
    if (comparisonRevision.data?.revision === id && !comparisonRevision.stale) revisionCache.set(id, comparisonRevision.data);
  }
  return {
    linkDiagnostics, refreshLinkDiagnostics, sessionVersion, operationBlockedReason,
    bgpStatus, bgpRoutes, bgpUnsupported, bgpStatusCurrent, bgpRoutesCurrent, bgpMonitoring, refreshBGPStatus, refreshBGPRoutes,
    restartProcess, restartPending, restartReconnecting, restartNotice, restartError,
    platform, platformUnsupported, healthStatus, refreshPlatformStatus,
    connected, connecting, authError, state, runtime, transactions, statistics, gatewayStatistics, hostHealth, mqttStatus, revisions, revisionDetail,
    nextRevision, comparisonRevision, draft, baseline, baseRevision, submitted, busy, actionError, notice, ignoredFields, uncertain, editorDirty,
    monitoring, gatewayMonitoring, activeTransactions, unknownStatus, incompatible, draftStale, diff, validation, freshState,
    canApply, applyBlockedReason, sortedTransactions, readOnlyReason, readOnlyNotice, ipv6Enabled,
    upgrade, upgradePending, upgradeUncertain, upgradeActive, upgradeBlockedReason, upgradeNotice, acceptedUpgradeID,
    refreshUpgrade, checkMaintenance, startUpgrade, supportsDhcpGatewayMonitors,
    connect, disconnect, refresh, refreshState, refreshRuntime, refreshTransactions, refreshStatistics, refreshGatewayStatistics,
    refreshHostHealth, refreshMqttStatus, dynamicDnsStatus, refreshDynamicDnsStatus, mdnsStatus, refreshMDNSStatus,
    refreshRevisions, loadRevision, compareRevision, clearComparison, stage, discardDraft, restartDraft, apply, lifecycle, restore, reconcile,
    readTransaction, resolveUncertainty,
  };
});
