import { z } from "zod";
import { uint64Schema } from "@/services/counters";

export const logCursorSchema = z.string().regex(/^[0-9a-f]{32}:(0|[1-9]\d*)$/)
  .refine(value => /^[0-9a-f]{32}:(0|[1-9]\d*)$/.test(value) && BigInt(value.split(":")[1]!) <= 18446744073709551615n, "Cursor sequence exceeds uint64");
export const dhcpLogQuerySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  interface: z.string().regex(/^[a-zA-Z0-9_.-]{1,15}$/).refine(value => ![".", ".."].includes(value), "Invalid interface").optional(),
  cursor: logCursorSchema.optional(),
}).strict();
export const dhcpCounterColumns = [
  { key: "requests_received", title: "Requests received" },
  { key: "replies_received", title: "Replies received" },
  { key: "requests_forwarded", title: "Requests forwarded" },
  { key: "replies_forwarded", title: "Replies forwarded" },
  { key: "packets_rejected", title: "Rejected" },
  { key: "send_errors", title: "Send errors" },
  { key: "transactions_expired", title: "Expired" },
  { key: "pending_transactions", title: "Pending" },
] as const;
export const dhcpRelayCountersSchema = z.object({
  requests_received: uint64Schema, replies_received: uint64Schema,
  requests_forwarded: uint64Schema, replies_forwarded: uint64Schema,
  packets_rejected: uint64Schema, rejected_by_reason: z.record(uint64Schema),
  send_errors: uint64Schema, transactions_expired: uint64Schema, pending_transactions: uint64Schema,
});
export const dhcpRelayStatisticsSchema = z.object({
  scope: z.string(), epoch: z.string().regex(/^[0-9a-f]{32}$/).nullable(),
  generation: uint64Schema.nullable(), counters_since: z.string().nullable(), collected_at: z.string().nullable(),
  totals: dhcpRelayCountersSchema.nullable(), log_capacity: z.number().int().nonnegative().nullable(),
  log_overwritten: uint64Schema.nullable(),
  worker: z.object({
    name: z.literal("dhcp-relay"), scope: z.string().optional(),
    state: z.enum(["running", "error", "stopped", "disabled", "simulated"]),
    started_at: z.string().nullable().optional(), retrying: z.boolean().optional(),
    restart_count: z.number().int().safe().nonnegative().optional(),
    error: z.string().nullable().optional(), last_error: z.string().optional(),
  }),
  interfaces: z.array(z.object({
    interface: z.string(), enabled: z.boolean(), state: z.string(), counters: dhcpRelayCountersSchema.nullable(),
  })),
}).refine(value => value.worker.state !== "simulated" ||
  value.totals === null && value.interfaces.every(row => row.counters === null), "Simulated relay counters must be unavailable");
export const dhcpRelayLogPageSchema = z.object({
  scope: z.string(), epoch: z.string().regex(/^[0-9a-f]{32}$/), next_cursor: logCursorSchema,
  reset: z.boolean(), gap: z.boolean(), has_more: z.boolean(),
  capacity: z.number().int().nonnegative(), overwritten: uint64Schema,
  events: z.array(z.object({
    sequence: uint64Schema.refine(value => value !== "0", "Expected positive sequence"),
    generation: uint64Schema, timestamp: z.string(), interface: z.string().nullable(),
    event: z.enum(["requests_received", "replies_received", "requests_forwarded", "replies_forwarded",
      "packets_rejected", "send_errors", "transactions_expired", "worker_start", "worker_error"]),
    reason: z.string(), peer: z.string().nullable(),
    message_type: z.number().int().min(0).max(255).nullable(),
    transaction_id: z.string().nullable(), client_mac: z.string().nullable(),
  })).max(500),
}).refine(value => value.next_cursor.startsWith(`${value.epoch}:`), "Log cursor does not match epoch");
export type DHCPRelayStatistics = z.infer<typeof dhcpRelayStatisticsSchema>;
export type DHCPRelayLogPage = z.infer<typeof dhcpRelayLogPageSchema>;
export type DHCPLogQuery = z.infer<typeof dhcpLogQuerySchema>;
