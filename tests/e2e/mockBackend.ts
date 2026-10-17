import type { Page } from "@playwright/test";
import { config, runtime, statistics, transaction } from "../fixtures";
import type { Config, Transaction } from "../../src/types/domain";
import { decodeJson, encodeJson } from "../../src/services/json";

export async function mockBackend(page: Page, options: { observationFailed?: boolean; initialStatus?: string; lostSubmit?: boolean } = {}) {
  let committed = config(), revision = "0";
  const transactions: Record<string, Transaction> = {};
  if (options.initialStatus) transactions["tx-test"] = transaction(options.initialStatus);
  const writes: Array<{ path: string; body: unknown }> = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/v1", "");
    const reply = (value: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: encodeJson(value),
    });
    if (request.headers().authorization !== "Bearer browser-test-key") return reply({ error: "Invalid credential", transaction: null }, 401);
    if (request.method() === "GET") {
      if (path === "/state") {
        if (options.observationFailed) return reply({ error: "Observation unavailable", transaction: null }, 503);
        return reply({ revision, desired: committed, observed: committed, drift: false,
          active_transaction: Object.values(transactions).find(item => !["committed", "rolled_back"].includes(item.status)) });
      }
      if (path === "/runtime") return reply(runtime());
      if (path === "/statistics") return reply(statistics());
      if (path === "/transactions") return reply(transactions);
      if (path.startsWith("/transactions/")) return transactions[path.split("/")[2] ?? ""] ? reply(transactions[path.split("/")[2]!]) : reply({ error: "Not found", transaction: null }, 404);
      if (path === "/revisions") return reply({ revisions: [{ revision, current: true, submitted_at: null, committed_at: null }] });
      if (path.startsWith("/revisions/")) return reply({ revision: path.split("/")[2], current: true, submitted_at: null, committed_at: null, config: committed });
    }
    if (request.method() === "POST") {
      const body: unknown = request.postData() ? decodeJson(request.postData()!) : undefined;
      writes.push({ path, body });
      if (path === "/transactions" || path.endsWith("/restore")) {
        const parsed = body && typeof body === "object" ? body : {};
        const pending = transaction();
        pending.previous = committed;
        pending.candidate = "config" in parsed ? parsed.config as Config : config();
        if (path.endsWith("/restore")) pending.restored_from_revision = path.split("/")[2];
        transactions[pending.id] = pending;
        if (options.lostSubmit) return route.abort("failed");
        return reply(pending, 202);
      }
      if (path.endsWith("/confirm") || path.endsWith("/rollback")) {
        const id = path.split("/")[2]!, pending = transactions[id];
        if (!pending) return reply({ error: "Not found", transaction: null }, 404);
        if (path.endsWith("/confirm")) {
          pending.status = "committed"; pending.committed_at = new Date().toISOString();
          revision = String(BigInt(revision) + 1n); committed = pending.candidate;
        } else pending.status = "rolled_back";
        return reply(pending);
      }
      if (path === "/services/softflowd/reconcile") return reply(runtime());
    }
    return reply({ error: "Unexpected mocked endpoint", transaction: null }, 404);
  });
  return { writes };
}
