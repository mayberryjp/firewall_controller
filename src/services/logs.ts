import { z } from "zod";
import { uint64Schema } from "@/services/counters";
import { logCursorSchema } from "@/services/dhcpDiagnostics";
import { utf8Size } from "@/services/json";

export const logSourceSchema = z.enum(["syslog", "netcontrol"]);
export const persistentLogQuerySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(), cursor: logCursorSchema.optional(),
}).strict();
export const persistentLogPageSchema = z.object({
  source: logSourceSchema,
  entries: z.array(z.object({
    sequence: uint64Schema.refine(value => value !== "0", "Expected positive sequence"),
    timestamp: z.string(),
    message: z.string().refine(value => utf8Size(value) <= 65000, "Log message exceeds 65000 bytes"),
  })).max(500).refine(value => utf8Size(JSON.stringify(value)) <= 524288, "Log entries exceed 512 KiB"),
  next_cursor: logCursorSchema, oldest_cursor: logCursorSchema.nullable(),
  gap: z.boolean(), reset: z.boolean(), has_more: z.boolean(),
  retention_bytes: z.literal(8388608), max_message_bytes: z.literal(65000),
  capture: z.object({ state: z.string(), retrying: z.boolean(), error: z.string().nullable() }),
});
export type LogSource = z.infer<typeof logSourceSchema>;
export type PersistentLogPage = z.infer<typeof persistentLogPageSchema>;
export type PersistentLogQuery = z.infer<typeof persistentLogQuerySchema>;
