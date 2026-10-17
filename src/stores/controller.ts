import { computed, ref, shallowReactive } from "vue";
import { defineStore } from "pinia";
import { ApiFailure, onUnauthorized, setCredential } from "@/services/api";
import * as api from "@/services/netcontrol";
import {
  configSchema, knownStatuses, terminal,
  type Config, type StateView, type RuntimeState, type Transaction,
  type Statistics, type Revision, type RevisionMetadata,
} from "@/types/domain";
import { cloneConfig, differences, equalConfig, validateConfig } from "@/services/configuration";
import { encodeJson, utf8Size } from "@/services/json";

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
  const transactions = dataset<Record<string, Transaction>>(), statistics = dataset<Statistics>();
  const revisions = dataset<RevisionMetadata[]>(), revisionDetail = dataset<Revision>();
  const comparisonRevision = dataset<Revision>();
  const nextRevision = ref<string | undefined>(), currentRevisionID = ref("");
  const draft = ref<Config | null>(null), baseline = ref<Config | null>(null), baseRevision = ref<string | null>(null);
  const submitted = ref<{ config: Config; id?: string } | null>(null);
  const busy = ref(false), actionError = ref<string | null>(null), notice = ref<string | null>(null);
  const uncertain = ref<{ operation: string; id?: string; priorIDs: string[]; base: string | null; startedAt: string } | null>(null);
  const editorDirty = ref(false), monitoring = ref(false);
  let epoch = 0;
  const flights = new Map<object, Promise<void>>();
  const aborts = new Set<AbortController>();
  const versions = new WeakMap<object, number>();
  const queryAborts = new WeakMap<object, AbortController>();
  const revisionCache = new Map<string, Revision>();
  const detailReads = new Map<string, Promise<Transaction | null>>();
  const allDatasets = [state, runtime, transactions, statistics, revisions, revisionDetail, comparisonRevision];
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
  const freshState = computed(() => Boolean(connected.value && state.data && !state.stale && !state.error && !transactions.stale &&
    state.lastSuccess && Date.now() - state.lastSuccess < 20_000));
  const canApply = computed(() => freshState.value && !incompatible.value && !busy.value && !uncertain.value &&
    activeTransactions.value.length === 0 && !state.data?.drift && !draftStale.value &&
    draft.value !== null && diff.value.length > 0 && validation.value.length === 0 && !submitted.value);
  const sortedTransactions = computed(() => Object.values(transactions.data ?? {}).sort((a, b) =>
    (b.submitted_at ?? "").localeCompare(a.submitted_at ?? "") || a.id.localeCompare(b.id)));
  const readOnlyReason = computed(() => {
    if (!connected.value) return "Connect with a bearer credential.";
    if (incompatible.value) return "Incompatible API data or unknown lifecycle state. Editing is disabled; retain diagnostics.";
    if (busy.value || submitted.value || uncertain.value) return "A submitted snapshot or uncertain write is frozen. Reconcile its server outcome first.";
    if (!state.data) return "Committed desired configuration is unavailable. Recovery remains accessible.";
    return "";
  });

  function invalidateReads(): void {
    epoch++;
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
  async function refreshTransactions(): Promise<void> {
    await load(transactions, api.getTransactions);
    if (uncertain.value?.id && connected.value) await readTransaction(uncertain.value.id);
    await settleSubmitted();
  }
  const refreshStatistics = () => load(statistics, api.getStatistics);
  async function refresh(): Promise<void> {
    if (!connected.value) return;
    await Promise.all([refreshState(), refreshRuntime(), refreshTransactions()]);
  }
  onUnauthorized(() => {
    connected.value = false; connecting.value = false;
    setCredential(""); invalidateReads();
    authError.value = "Credential rejected (401). Re-enter a valid credential; your in-memory draft is preserved.";
  });
  async function connect(credential: string): Promise<boolean> {
    if (!credential.trim() || /[\r\n]/.test(credential)) { authError.value = "Enter a valid bearer credential"; return false; }
    connecting.value = true; authError.value = null;
    setCredential(credential.trim());
    invalidateReads();
    await load(transactions, api.getTransactions);
    if (transactions.stale) {
      setCredential(""); connecting.value = false;
      authError.value = transactions.error ?? authError.value ?? "Unable to establish read access";
      return false;
    }
    connected.value = true; connecting.value = false;
    void Promise.all([refreshState(), refreshRuntime(), refreshRevisions()]).then(settleSubmitted);
    return connected.value;
  }
  function disconnect(): void {
    setCredential(""); connected.value = false; invalidateReads();
    allDatasets.forEach((query) => { query.data = null; query.error = null; query.lastSuccess = null; query.incompatible = false; });
    draft.value = null; baseline.value = null; baseRevision.value = null; submitted.value = null;
    uncertain.value = null; actionError.value = null; notice.value = null; authError.value = null;
    nextRevision.value = undefined; currentRevisionID.value = ""; editorDirty.value = false;
    revisionCache.clear();
  }
  function stage(config: Config): void {
    if (readOnlyReason.value) throw new Error(readOnlyReason.value);
    if (!draft.value) {
      if (!state.data) throw new Error("Committed desired configuration unavailable");
      baseline.value = cloneConfig(state.data.desired); baseRevision.value = state.data.revision;
    }
    draft.value = cloneConfig(configSchema.parse(config));
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
      notice.value = `Server verified committed transaction ${transaction.id}.`;
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
    if (!canApply.value || !draft.value || baseRevision.value === null) throw new Error("Resolve validation, stale state, drift, active transactions, and unknown outcomes before applying");
    const captured = cloneConfig(draft.value), capturedBase = baseRevision.value;
    await Promise.all([refreshState(), refreshTransactions()]);
    if (!canApply.value || state.data?.revision !== capturedBase || !draft.value || !equalConfig(captured, draft.value)) throw new Error("Pre-submit state changed; review again");
    const request = { base_revision: capturedBase, config: captured, confirm_timeout_seconds: seconds, description: trimmed };
    if (utf8Size(encodeJson(request)) > 1_048_576) throw new Error("Complete request exceeds 1 MiB");
    submitted.value = { config: captured };
    return mutate("Apply package", () => api.submitPackage(request));
  }
  async function lifecycle(id: string, action: "confirm" | "rollback"): Promise<Transaction | null> {
    if (incompatible.value) throw new Error("Incompatible server state; lifecycle assumptions disabled");
    const transaction = await readTransaction(id);
    if (!transaction || !knownStatuses.includes(transaction.status)) throw new Error("Unable to obtain a compatible fresh transaction");
    if (action === "confirm" && (transaction.status !== "pending_confirmation" || Date.parse(transaction.confirmation_deadline) <= Date.now())) throw new Error("Confirmation is not currently available; await server outcome");
    if (action === "rollback" && !["pending_confirmation", "recovery_failed"].includes(transaction.status)) throw new Error("Rollback is not available in this state");
    return mutate(action === "confirm" ? "Confirm configuration" : "Roll back", () =>
      action === "confirm" ? api.confirmTransaction(id) : api.rollbackTransaction(id), id);
  }
  async function restore(revision: string, seconds: number, description: string): Promise<Transaction | null> {
    const trimmed = validateWindow(seconds, description);
    await Promise.all([refreshState(), refreshTransactions()]);
    if (!freshState.value || incompatible.value || busy.value || uncertain.value || draft.value ||
      submitted.value || activeTransactions.value.length || !state.data || state.data.drift) throw new Error("Restore requires fresh drift-free state, no draft, and no active/uncertain write");
    const capturedBase = state.data.revision;
    const history = await api.getRevision(revision);
    if (!freshState.value || !state.lastSuccess || Date.now() - state.lastSuccess >= 20_000 ||
      busy.value || uncertain.value || submitted.value || draft.value || activeTransactions.value.length ||
      incompatible.value || state.data?.revision !== capturedBase || state.data.drift) {
      throw new Error("Pre-restore state changed; review the current state before restoring");
    }
    submitted.value = { config: cloneConfig(history.config) };
    return mutate(`Restore revision ${revision}`, () => api.restoreRevision(revision, {
      base_revision: capturedBase, confirm_timeout_seconds: seconds, description: trimmed,
    }));
  }
  async function reconcile(): Promise<void> {
    if (incompatible.value || uncertain.value || activeTransactions.value.some((item) =>
      ["applying", "rolling_back", "recovery_failed"].includes(item.status))) throw new Error("Service reconciliation is blocked by safety state");
    await mutate("Reconcile managed services", api.reconcileServices);
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
    connected, connecting, authError, state, runtime, transactions, statistics, revisions, revisionDetail,
    nextRevision, comparisonRevision, draft, baseline, baseRevision, submitted, busy, actionError, notice, uncertain, editorDirty,
    monitoring, activeTransactions, unknownStatus, incompatible, draftStale, diff, validation, freshState,
    canApply, sortedTransactions, readOnlyReason,
    connect, disconnect, refresh, refreshState, refreshRuntime, refreshTransactions, refreshStatistics,
    refreshRevisions, loadRevision, compareRevision, clearComparison, stage, discardDraft, restartDraft, apply, lifecycle, restore, reconcile,
    readTransaction, resolveUncertainty,
  };
});
