import { isLosslessNumber, LosslessNumber, parse, stringify } from "lossless-json";
import { legacyRevisionSchema, revisionSchema } from "@/types/domain";

const revisionKeys = new Set(["revision", "base_revision", "committed_revision", "restored_from_revision", "next_before_revision"]);

function isConfigurationRevision(key: string, holder: unknown): boolean {
  // Hardware identities also have a revision, but it is an opaque string.
  return revisionKeys.has(key) && !(key === "revision" && holder !== null && typeof holder === "object" &&
    "vendor_id" in holder && "device_id" in holder);
}

export function decodeJson(text: string, exactIntegerFields: readonly string[] = []): unknown {
  return parse(text, function (this: unknown, key, value: unknown) {
    if (isConfigurationRevision(key, this) && value !== null) {
      return isLosslessNumber(value) ? legacyRevisionSchema.parse(value.value) : revisionSchema.parse(value);
    }
    if (!isLosslessNumber(value)) return value;
    if (exactIntegerFields.includes(key)) return value;
    const number = Number(value.value);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error("Unsafe numeric value in API response");
    // Integer tokens must remain exact; bounded fractional measurements use JSON numbers.
    if (/^-?\d+$/.test(value.value) && !Number.isSafeInteger(number)) throw new Error("Unsafe numeric value in API response");
    return number;
  });
}

export function encodeJson(value: unknown): string {
  const result = stringify(value, function (this: unknown, key, item: unknown) {
    if (isConfigurationRevision(key, this) && item !== null && item !== undefined) {
      const revision = revisionSchema.parse(item);
      return legacyRevisionSchema.safeParse(revision).success ? new LosslessNumber(revision) : revision;
    }
    return item;
  });
  if (result === undefined) throw new Error("Unable to serialize request");
  return result;
}

export const utf8Size = (text: string): number => new TextEncoder().encode(text).byteLength;
