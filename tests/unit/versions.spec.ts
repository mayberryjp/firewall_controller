import { describe, expect, it } from "vitest";
import { compareDateVersions, dateVersionSchema } from "@/services/versions";
import { decodeJson, encodeJson } from "@/services/json";
import { cloneConfig, equalConfig, importConfig } from "@/services/configuration";
import { softwareMetadataSchema, transactionSchema } from "@/types/domain";
import { transaction, software, state } from "../fixtures";

describe("calendar software versions and revision IDs", () => {
  it.each(["0001.01.01.1", "2000.02.29.1", "2024.02.29.10", "9999.12.31.4294967295"])("accepts canonical %s", value => {
    expect(dateVersionSchema.parse(value)).toBe(value);
  });
  it.each([
    "0000.01.01.1", "1900.02.29.1", "2026.02.29.1", "2026.04.31.1", "2026.00.01.1",
    "2026.13.01.1", "2026.01.00.1", "2026.1.01.1", "2026.01.1.1",
    "2026.10.29.0", "2026.10.29.01", "2026.10.29.4294967296",
    "v2026.10.29.1", "2026.10.29.1-rc.1", "2026.10.29.1+build", "1.2.3", 1, null,
  ])("rejects noncanonical or impossible version %s", value => {
    expect(dateVersionSchema.safeParse(value).success).toBe(false);
  });
  it("compares numeric iterations and date boundaries independently", () => {
    expect(compareDateVersions("2026.10.29.10", "2026.10.29.9")).toBeGreaterThan(0);
    expect(compareDateVersions("2026.10.30.1", "2026.10.29.4294967295")).toBeGreaterThan(0);
    expect(compareDateVersions("2027.01.01.1", "2026.12.31.99")).toBeGreaterThan(0);
    expect(compareDateVersions("2026.10.29.1", "2026.10.29.1")).toBe(0);
  });
  it("preserves legacy numeric revisions exactly while keeping internal revisions as strings", () => {
    for (const key of ["revision", "base_revision", "committed_revision", "restored_from_revision", "next_before_revision"]) {
      expect(decodeJson(`{"${key}":18446744073709551615}`)).toEqual({ [key]: "18446744073709551615" });
      expect(encodeJson({ [key]: "18446744073709551615" })).toBe(`{"${key}":18446744073709551615}`);
      expect(() => encodeJson({ [key]: 1 })).toThrow();
      for (const value of ["-1", "1.5", "18446744073709551616"]) {
        expect(() => decodeJson(`{"${key}":${value}}`)).toThrow();
      }
    }
    expect(decodeJson('{"committed_revision":null,"bytes":"18446744073709551615"}'))
      .toEqual({ committed_revision: null, bytes: "18446744073709551615" });
  });
  it("reads assigned commit results rather than calculating the next revision", () => {
    expect(transactionSchema.parse(transaction()).committed_revision).toBeNull();
    const committed = { ...transaction("committed"), committed_revision: "2026.10.30.1" };
    expect(transactionSchema.parse(decodeJson(encodeJson(committed))).committed_revision).toBe("2026.10.30.1");
    const missing: Record<string, unknown> = { ...committed }; delete missing.committed_revision;
    expect(transactionSchema.parse(missing).committed_revision).toBeNull();
  });
  it("requires explicit nullable software check fields and keeps timestamp precision", () => {
    const metadata = { ...software(), last_checked_at: "2026-10-29T23:00:00.123456789Z" };
    expect(softwareMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(softwareMetadataSchema.safeParse({ version: metadata.version }).success).toBe(false);
  });
  it("omits software from editable clones and imports without mutating saved metadata", () => {
    const saved = state().desired;
    expect(cloneConfig(saved)).not.toHaveProperty("software");
    expect(importConfig(encodeJson(saved))).not.toHaveProperty("software");
    expect(saved.software).toEqual(software());
    expect(equalConfig(saved, { ...saved, software: { ...software(), error: "Release check failed" } })).toBe(true);
    expect(encodeJson(saved)).toContain('"software"');
  });
});
