import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { hostPolicyConfig } from "../fixtures";
import { dnatRule } from "../bgpFixtures";
import { firewallCounters } from "../firewallTelemetryFixtures";
import { ruleOwnershipEntries } from "../../src/services/ruleOwnership";
import { configSchema } from "../../src/types/domain";
import { record } from "../../src/types/forms";
import { sandoSchema } from "../../src/services/sandoState";

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

test("Sando automatically stages replacement of only its own rules, preserving manual and other-provider rules through SAVE", async ({ page }, testInfo) => {
  const settings = hostPolicyConfig();
  settings.firewall.policies!.hosts[2]!.addresses.push("2001:db8::30");
  const manual = { origin: "manual", import_source: null, destination: "198.51.100.13/32", action: "accept" } as const;
  const other = { origin: "import", import_source: "other", destination: "198.51.100.12/32", action: "drop" } as const;
  settings.firewall.policies!.hosts[0]!.rules = [
    { origin: "import", import_source: "sando", destination: "198.51.100.11/32", action: "accept" }, other, manual,
  ];
  settings.firewall.policies!.hosts[1]!.rules = [{ origin: "import", import_source: "sando", action: "drop" }];
  settings.sando = sandoSchema.parse({ api_url: "https://sando.example" });
  const backend = await mockBackend(page, { initialConfig: settings, normalizeCandidate: true });
  await page.route("https://sando.example/api/**", route => route.fulfill({ json: route.request().url().endsWith("/localhosts")
    ? [{ ip_address: "192.0.2.20" }]
    : [{ src_ip: "192.0.2.20", dst_ip: "203.0.113.20", protocol: 6, dst_port: 443 }] }));
  await connect(page); await page.goto("/settings/sando");
  await page.getByRole("button", { name: "Import rules", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "2 previous Sando rules replaced." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Review Sando replacement", exact: true })).toHaveCount(0);
  expect(backend.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("sando-replacement-staged.png"), fullPage: true });
  await save(page);
  const submitted = configSchema.parse(record(backend.writes[0]!.body).config);
  expect(submitted.firewall.policies!.hosts[0]!.rules).toEqual([
    manual, other, { origin: "import", import_source: "sando", destination: "203.0.113.20/32", protocol: "tcp", destination_ports: [443], action: "accept" },
  ]);
  expect(submitted.firewall.policies!.hosts[1]!.rules).toEqual([]);
  expect(submitted.firewall.policies!.hosts.map(host => [host.id, host.addresses, host.policy])).toEqual(settings.firewall.policies!.hosts.map(host => [host.id, host.addresses, host.policy]));
  await page.goto("/settings/sando");
  await page.getByRole("button", { name: "Import rules", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "1 previous Sando rules replaced." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Save configuration", exact: true })).toBeEnabled();
  expect(backend.writes).toHaveLength(2);
});
