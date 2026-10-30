import { isLosslessNumber, LosslessNumber, parse, stringify } from "lossless-json";
import { legacyRevisionSchema, revisionSchema } from "@/types/domain";

const revisionKeys = new Set(["revision", "base_revision", "committed_revision", "restored_from_revision", "next_before_revision"]);

export function decodeJson(text: string): unknown {
  return parse(text, (key, value: unknown) => {
    if (revisionKeys.has(key) && value !== null) {
      return isLosslessNumber(value) ? legacyRevisionSchema.parse(value.value) : revisionSchema.parse(value);
    }
    if (!isLosslessNumber(value)) return value;
    const number = Number(value.value);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error("Unsafe numeric value in API response");
    // Integer tokens must remain exact; bounded fractional measurements use JSON numbers.
    if (/^-?\d+$/.test(value.value) && !Number.isSafeInteger(number)) throw new Error("Unsafe numeric value in API response");
    return number;
  });
}

export function encodeJson(value: unknown): string {
  const result = stringify(value, (key, item: unknown) => {
    if (revisionKeys.has(key) && item !== null && item !== undefined) {
      const revision = revisionSchema.parse(item);
      return legacyRevisionSchema.safeParse(revision).success ? new LosslessNumber(revision) : revision;
    }
    return item;
  });
  if (result === undefined) throw new Error("Unable to serialize request");
  return result;
}

export const utf8Size = (text: string): number => new TextEncoder().encode(text).byteLength;
