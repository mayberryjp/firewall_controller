import { z } from "zod";
import { request } from "@/services/api";
import {
  stateSchema, runtimeSchema, transactionSchema, revisionPageSchema,
  revisionDetailSchema, statisticsSchema, type PackageRequest,
} from "@/types/domain";

const id = encodeURIComponent;
export const getState = (signal?: AbortSignal) => request("GET", "/state", stateSchema, undefined, signal);
export const getRuntime = (signal?: AbortSignal) => request("GET", "/runtime", runtimeSchema, undefined, signal);
export const getTransactions = (signal?: AbortSignal) => request("GET", "/transactions",
  z.record(transactionSchema).nullable().transform((value) => value ?? {}), undefined, signal);
export const getTransaction = (value: string) => request("GET", `/transactions/${id(value)}`, transactionSchema);
export const getStatistics = (signal?: AbortSignal) => request("GET", "/statistics", statisticsSchema, undefined, signal);
export const getRevisions = (before?: string) => request("GET",
  `/revisions?limit=50${before === undefined ? "" : `&before_revision=${id(before)}`}`, revisionPageSchema);
export const getRevision = (revision: string) => request("GET", `/revisions/${id(revision)}`, revisionDetailSchema);
export const submitPackage = (body: PackageRequest) => request("POST", "/transactions", transactionSchema, body);
export const confirmTransaction = (value: string) => request("POST", `/transactions/${id(value)}/confirm`, transactionSchema);
export const rollbackTransaction = (value: string) => request("POST", `/transactions/${id(value)}/rollback`, transactionSchema);
export const reconcileServices = () => request("POST", "/services/softflowd/reconcile", runtimeSchema);
export const restoreRevision = (revision: string, body: Omit<PackageRequest, "config">) =>
  request("POST", `/revisions/${id(revision)}/restore`, transactionSchema, body);
