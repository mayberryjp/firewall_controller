import { describe, expect, it } from "vitest";
import { sandoImportReportSchema, sandoSchema, sandoSourceUrlSchema } from "@/services/sandoState";
import { cloneConfig, normalize, differences, requiredPermissions, differenceContext, validateConfig } from "@/services/configuration";
import { configSchema } from "@/types/domain";
import { config } from "../fixtures";

const report = () => ({
  source_url: "https://sando.example/proxy", import_count: 1, last_import_at: "2026-10-30T01:02:03.123456789Z",
  status: "succeeded" as const, imported_count: 0, skipped_count: 0,
});
describe("saved Sando contract", () => {
  it("keeps older backends readable and normalizes missing/default settings equally", () => {
    const before = config(), after = cloneConfig(before);
    expect(configSchema.parse(before).sando).toBeUndefined();
    after.sando = sandoSchema.parse({});
    expect(after.sando).toEqual({ api_url: "", sync_enabled: false, hosts_import: null, rules_import: null });
    expect(normalize(before)).toEqual(normalize(after)); expect(differences(before, after)).toEqual([]);
  });
  it("preserves reports/provenance through URL changes, submission clones, diffs and undo", () => {
    const before = config(); before.sando = { api_url: "https://sando.example/proxy", sync_enabled: false, hosts_import: report(), rules_import: null };
    const after = cloneConfig(before); after.sando!.api_url = "";
    const changes = differences(before, after);
    expect(changes).toHaveLength(1); expect(changes[0]!.area).toBe("sando");
    expect(requiredPermissions(changes)).toEqual(["transactions.write", "sando.write"]);
    expect(cloneConfig(after).sando!.hosts_import).toEqual(report());
    expect(differenceContext(before, after, changes[0]!).after).toEqual(after);
  });
  it.each(["HTTPS://sando.example", "/relative", "https://user:pass@sando.example", "https://sando.example?q=1", "https://sando.example?", "https://sando.example#", "https://sando.example/a b", "https://sando.example\\bad", "http://sando.example:0", `https://sando.example/${"a".repeat(2048)}`, "https://sando.example/\u007f"])("rejects invalid source %s", value => {
    expect(sandoSourceUrlSchema.safeParse(value).success).toBe(false);
  });
  it("preserves reverse-proxy and IPv6 URLs", () => {
    expect(sandoSourceUrlSchema.parse("https://[2001:db8::1]:8443/proxy")).toBe("https://[2001:db8::1]:8443/proxy");
  });
  it.each([
    { import_count: 0 }, { import_count: 4294967296 }, { imported_count: -1 }, { skipped_count: 1 },
    { status: "partial", imported_count: 0, skipped_count: 1 }, { status: "partial", imported_count: 1, skipped_count: 0 },
    { status: "failed" }, { last_import_at: "1969-12-31T23:59:59Z" }, { source_url: "" },
  ])("rejects invalid report %j", invalid => {
    expect(sandoImportReportSchema.safeParse({ ...report(), ...invalid }).success).toBe(false);
  });
  it("accepts empty success and partial reports and links validation to Sando", () => {
    expect(sandoImportReportSchema.parse(report())).toEqual(report());
    expect(sandoImportReportSchema.safeParse({ ...report(), status: "partial", imported_count: 1, skipped_count: 1 }).success).toBe(true);
    const candidate = config(); candidate.sando = { api_url: "bad", sync_enabled: false, hosts_import: null, rules_import: null };
    expect(validateConfig(candidate)).toContainEqual(expect.objectContaining({ page: "/settings/sando", path: "sando.api_url" }));
  });
  it.each([null, "true", 1])("rejects a non-boolean sync flag %j", sync_enabled => {
    expect(sandoSchema.safeParse({ api_url: "https://sando.example", sync_enabled }).success).toBe(false);
  });
  it("requires a source for sync and preserves the flag through configuration review", () => {
    expect(sandoSchema.safeParse({ sync_enabled: true }).success).toBe(false);
    const before = config(); before.sando = sandoSchema.parse({ api_url: "https://sando.example" });
    const after = cloneConfig(before); after.sando!.sync_enabled = true;
    expect(validateConfig(after)).toEqual([]);
    expect(cloneConfig(after).sando!.sync_enabled).toBe(true);
    expect(requiredPermissions(differences(before, after))).toEqual(["transactions.write", "sando.write"]);
    after.sando!.api_url = "";
    expect(validateConfig(after)).toContainEqual(expect.objectContaining({ page: "/settings/sando", path: "sando.api_url" }));
  });
});
