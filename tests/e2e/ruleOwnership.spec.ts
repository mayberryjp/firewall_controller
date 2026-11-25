import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { hostPolicyConfig } from "../fixtures";
import { dnatRule } from "../bgpFixtures";
import { firewallCounters } from "../firewallTelemetryFixtures";
import { ruleOwnershipEntries } from "../../src/services/ruleOwnership";
import { configSchema } from "../../src/types/domain";
import { record } from "../../src/types/forms";

async function connect(page: Page) {
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
}
async function save(page: Page) {
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
}

test("rule labels survive ordinary edits, backend group normalization, and confirmation across every scope", async ({ page }, testInfo) => {
  const settings = hostPolicyConfig();
  settings.firewall.policies!.hosts[2]!.addresses.push("2001:db8::30");
  settings.interfaces.push({ ...settings.interfaces[0]!, name: "wan0", role: "wan", addresses: ["203.0.113.1/24"] });
  settings.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ action: "accept" }] }] };
  settings.firewall.nat.destination_rewrite = [dnatRule()];
  for (const rule of ruleOwnershipEntries(settings).values()) Object.assign(rule, { origin: "import", import_source: "test_provider" });
  const backend = await mockBackend(page, { initialConfig: settings, normalizeCandidate: true });
  await page.route("**/statistics/firewall", route => route.fulfill({ json: firewallCounters(settings) }));
  await connect(page);
  for (const path of ["/firewall", "/firewall/ingress", "/firewall/input", "/nat", "/firewall/nat/dnat"]) {
    await page.goto(path);
    await expect(page.locator(".rule-origin").filter({ hasText: "Import: test_provider" }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`origins-${path.split("/").filter(Boolean).join("-")}.png`), fullPage: true });
  }
  await page.goto("/firewall/ingress");
  await page.getByRole("button", { name: "Edit rule 1", exact: true }).click();
  await page.getByLabel("Action", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "accept", exact: true }).click();
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(page.locator(".host-rule .rule-origin").first()).toHaveText("Import: test_provider");
  await save(page);
  const submitted = configSchema.parse(record(backend.writes[0]!.body).config);
  for (const rule of ruleOwnershipEntries(submitted).values()) expect(rule).toMatchObject({ origin: "import", import_source: "test_provider" });
  expect(submitted.firewall.policies!.interfaces[0]!.rules[0]!.action).toBe("accept");
});
