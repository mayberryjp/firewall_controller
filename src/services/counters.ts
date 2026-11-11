import { z } from "zod";
import { LosslessNumber } from "lossless-json";

export const uint64Schema = z.string().regex(/^(0|[1-9]\d*)$/)
  .refine(value => /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= 18446744073709551615n, "Value exceeds uint64");
export const numericCounterSchema = z.union([z.number().int().safe().nonnegative(), z.instanceof(LosslessNumber)])
  .transform(value => value.toString()).pipe(uint64Schema);

export function formatCount(value: string | null | undefined): string {
  return value == null ? "Unknown" : BigInt(value).toLocaleString("en-US");
}
