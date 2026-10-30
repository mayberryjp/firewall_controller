import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { hostPolicyConfig } from "../fixtures";
import { transactionSchema } from "../../src/types/domain";

async function connect(page: Page) {
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/settings/general");
  await page.getByRole("navigation", { name: "Settings pages", exact: true })
    .getByRole("tab", { name: "ADVANCED", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/advanced$/);
}
async function acknowledge(page: Page) {
  const action = page.getByRole("button", { name: "Delete all firewall hosts and forwarding rules", exact: true });
  await expect(action).toBeEnabled();
  await action.click();
  const dialog = page.getByRole("dialog", { name: "Delete all firewall hosts and forwarding rules?", exact: true });
  await expect(dialog.getByRole("button", { name: "Delete hosts and rules", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  return dialog;
}

for (const outcome of ["confirm", "rollback"] as const) {
  test(`ADVANCED combined deletion preserves unrelated configuration and supports ${outcome}`, async ({ page, isMobile }, testInfo) => {
    const initialConfig = hostPolicyConfig();
    initialConfig.firewall.input = { policy: "drop", interfaces: [] };
    const backend = await mockBackend(page, { initialConfig });
    await connect(page);
    const navigation = page.getByRole("navigation", { name: "Settings pages", exact: true });
    await expect(navigation.locator(".v-tab--selected")).toHaveCount(1);
    const view = page.getByRole("region", { name: "Advanced settings", exact: true });
    await expect(view.getByRole("button")).toHaveCount(1);
    const action = view.getByRole("button");
    await expect(action).toHaveClass(/v-btn--variant-flat/);
    await expect(action).toHaveClass(/bg-error/);
    const bounds = (await action.boundingBox())!;
    expect(bounds.height).toBeLessThanOrEqual(isMobile ? 60 : 40);
    if (!isMobile) expect(bounds.width).toBeLessThan(560);
    let dialog = await acknowledge(page);
    await expect(dialog).toContainText("NAT, management input rules");
    await expect(dialog).toContainText("Keeping a Drop default can stop forwarding");
    await expect(dialog).toContainText("can broaden access");
    await expect(dialog).toContainText("does not guarantee remote connectivity");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(backend.writes).toEqual([]);
    dialog = await acknowledge(page);
    await page.screenshot({ path: testInfo.outputPath("combined-deletion-confirmation.png"), fullPage: true, animations: "disabled" });
    const response = page.waitForResponse(response => response.request().method() === "DELETE" && response.url().endsWith("/firewall/hosts-and-rules"));
    await dialog.getByRole("button", { name: "Delete hosts and rules", exact: true }).click();
    const pending = transactionSchema.parse(await (await response).json());
    expect(pending.status).toBe("pending_confirmation");
    expect(pending.candidate.firewall.policies?.hosts).toEqual([]);
    expect(pending.candidate.firewall.policies?.interfaces).toEqual(
      initialConfig.firewall.policies!.interfaces.map(policy => ({ ...policy, rules: [] })),
    );
    expect(pending.candidate.firewall.rules).toEqual([]);
    expect(pending.candidate.firewall.nat).toEqual(initialConfig.firewall.nat);
    expect(pending.candidate.firewall.input).toEqual(initialConfig.firewall.input);
    expect(pending.candidate.firewall.policy).toBe(initialConfig.firewall.policy);
    expect(pending.candidate.firewall.allow_all_icmp).toBe(initialConfig.firewall.allow_all_icmp);
    expect(pending.candidate.interfaces).toEqual(initialConfig.interfaces);
    expect(pending.candidate.routes).toEqual(initialConfig.routes);
    expect(backend.writes).toEqual([{
      path: "/firewall/hosts-and-rules",
      body: {
        base_revision: "2026.10.29.1", confirm_timeout_seconds: 120, confirm: true,
        description: "Clear reviewed firewall hosts and forwarding rules",
      },
    }]);
    await expect(page).toHaveURL(/\/config\/commits\/tx-test$/);
    const detail = page.getByRole("region", { name: "Commit detail", exact: true });
    await expect(detail.locator("dd strong")).toHaveText("pending_confirmation");
    await expect(detail).toContainText("Confirm before automatic rollback");
    if (outcome === "confirm") {
      await detail.getByRole("button", { name: "Confirm changes", exact: true }).click();
      await expect(detail.locator("dd strong")).toHaveText("committed");
      await expect(detail.getByRole("link", { name: "2026.10.29.2", exact: true })).toBeVisible();
    } else {
      await detail.getByRole("button", { name: "Roll back", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Roll back configuration", exact: true }).click();
      await expect(detail.locator("dd strong")).toHaveText("rolled_back");
    }
    await page.goto("/firewall");
    const hosts = page.getByRole("navigation", { name: "Hosts", exact: true });
    if (outcome === "confirm") await expect(hosts).toContainText("No hosts with policies.");
    else await expect(hosts.getByRole("list").getByRole("button")).toHaveCount(3);
    await page.goto("/settings/advanced");
    await expect(page.getByRole("button", { name: "Delete all firewall hosts and forwarding rules", exact: true })).toBeEnabled();
    expect(backend.writes.map(write => write.path)).toEqual(["/firewall/hosts-and-rules", `/transactions/tx-test/${outcome}`]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("advanced-settings.png"), fullPage: true, animations: "disabled" });
  });
}

for (const status of [403, 409]) {
  test(`ADVANCED deletion reports HTTP ${status} inline without retrying`, async ({ page }) => {
    await mockBackend(page, { initialConfig: hostPolicyConfig() });
    let attempts = 0;
    await page.route("**/proxy/firewall/hosts-and-rules", async route => {
      if (route.request().method() !== "DELETE") return route.fallback();
      attempts++;
      await route.fulfill({
        status, json: { error: status === 403 ? "firewall.write permission required" : "Base revision is stale", transaction: null },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    });
    await connect(page);
    const dialog = await acknowledge(page);
    await dialog.getByRole("button", { name: "Delete hosts and rules", exact: true }).click();
    await expect(dialog.getByRole("alert").last()).toContainText(status === 403 ? "firewall.write" : "Base revision is stale");
    await expect(page).toHaveURL(/\/settings\/advanced$/);
    expect(attempts).toBe(1);
  });
}

test("ADVANCED never retries a lost deletion response and offers transaction inspection", async ({ page }) => {
  const backend = await mockBackend(page, { initialConfig: hostPolicyConfig(), lostSubmit: true });
  await connect(page);
  const dialog = await acknowledge(page);
  await dialog.getByRole("button", { name: "Delete hosts and rules", exact: true }).click();
  await expect(dialog).toContainText("The deletion outcome is uncertain. Do not retry.");
  await expect(dialog.getByRole("link", { name: "Inspect the transaction in Commits" })).toHaveAttribute("href", "/config/commits");
  await expect(dialog.getByRole("button", { name: "Delete hosts and rules", exact: true })).toBeDisabled();
  expect(backend.writes.map(write => write.path)).toEqual(["/firewall/hosts-and-rules"]);
});

test("ADVANCED deletion observes server expiry without automatic confirmation or a retained deletion draft", async ({ page }) => {
  const backend = await mockBackend(page, { initialConfig: hostPolicyConfig() });
  await connect(page);
  const dialog = await acknowledge(page);
  await dialog.getByRole("button", { name: "Delete hosts and rules", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/commits\/tx-test$/);
  const detail = page.getByRole("region", { name: "Commit detail", exact: true });
  await expect(detail.locator("dd strong")).toHaveText("pending_confirmation");
  backend.expireTransactions();
  await expect(detail.locator("dd strong")).toHaveText("rolled_back");
  await expect(detail.getByRole("button", { name: "Confirm changes", exact: true })).toHaveCount(0);
  await page.goto("/settings/advanced");
  await expect(page.getByRole("button", { name: "Delete all firewall hosts and forwarding rules", exact: true })).toBeEnabled();
  expect(backend.writes.map(write => write.path)).toEqual(["/firewall/hosts-and-rules"]);
});
