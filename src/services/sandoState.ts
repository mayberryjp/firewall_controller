import { z } from "zod";

export const sandoSourceUrlSchema = z.string().superRefine((value, context) => {
  let valid = false;
  try {
    const url = new URL(value);
    valid = /^https?:\/\//.test(value) && Boolean(url.hostname) && !url.username && !url.password &&
      !url.search && !url.hash && url.port !== "0" && !/[\s\\?#]/.test(value) &&
      ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
      new TextEncoder().encode(value).length <= 2048;
  } catch { valid = false; }
  if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, message: "Use an absolute lowercase HTTP(S) base URL without credentials, query, fragment, whitespace, controls, backslashes or port zero (at most 2048 UTF-8 bytes)." });
});
const count = z.number().int().min(0).max(4294967295);
export const sandoImportReportSchema = z.object({
  source_url: sandoSourceUrlSchema, import_count: count.min(1),
  last_import_at: z.string().datetime({ offset: true }).refine(value => Date.parse(value) >= 0),
  status: z.enum(["succeeded", "partial"]), imported_count: count, skipped_count: count,
}).strict().refine(value => value.status === "succeeded" ? value.skipped_count === 0 : value.imported_count > 0 && value.skipped_count > 0,
  "A successful import has no skipped items; a partial import requires both imported and skipped items.");
export const sandoSchema = z.object({
  api_url: z.union([z.literal(""), sandoSourceUrlSchema]).default(""),
  sync_enabled: z.boolean().default(false),
  hosts_import: sandoImportReportSchema.nullable().default(null),
  rules_import: sandoImportReportSchema.nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.sync_enabled && !value.api_url) context.addIssue({
    code: z.ZodIssueCode.custom, path: ["api_url"],
    message: "Save a Sando API endpoint before enabling automatic sync.",
  });
});
export type SandoSettings = z.infer<typeof sandoSchema>;
export type SandoImportReport = z.infer<typeof sandoImportReportSchema>;
