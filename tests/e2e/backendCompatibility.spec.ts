import { expect, test, type Page } from "@playwright/test";
import { config, runtime, state, transaction } from "../fixtures";
import { mockBackend } from "./mockBackend";

async function connect(page: Page) {
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
}

test("omitted IPv6 defaults off and explicit enablement preserves imported policy and zero route metrics", async ({ page }) => {
  const initial = config();
  delete initial.ipv6_enabled;
  initial.interfaces[0]!.addresses = ["192.0.2.10/24"];
  initial.interfaces[0]!.metadata = { display_name: "Imported LAN", description: "Preserved notes" };
  initial.routes[0]!.metric = 0;
  initial.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ action: "drop" }] }] };
  initial.dns = { lab0: { servers: ["192.0.2.53"], domains: [] } };
  initial.backend_extension = { preserved: true };
  const backend = await mockBackend(page, { initialConfig: initial });
  await connect(page);
  await page.goto("/routes");
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "198.51.100.0/24", exact: true }) });
  await row.getByRole("button", { name: "Edit / stage", exact: true }).click();
  const editor = page.getByRole("row", { name: "Route editor", exact: true });
  await expect(editor.getByLabel("Metric", { exact: true })).toHaveValue("0");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.goto("/settings/general");
  await expect(page.getByLabel("Enable IPv6", { exact: true })).not.toBeChecked();
  await page.getByLabel("Enable IPv6", { exact: true }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("kernel.namespace.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]).toMatchObject({
    path: "/transactions", body: { config: {
      ipv6_enabled: true, interfaces: initial.interfaces, routes: initial.routes, firewall: initial.firewall,
      dns: initial.dns, backend_extension: initial.backend_extension,
    } },
  });
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/commits\/[^/]+$/);
  await page.goto("/settings/general");
  await expect(page.getByLabel("Enable IPv6", { exact: true })).toBeChecked();
  expect(backend.writes).toHaveLength(2);
});

test("console takeover transactions have no remote controls and receipts remain scoped to collapsed diagnostics", async ({ page }) => {
  const backend = await mockBackend(page);
  const local = { ...transaction("applying_local"), confirmation_deadline: null };
  await page.route("**/proxy/state", route => route.fulfill({ json: { ...state(), active_transaction: local } }));
  await page.route("**/proxy/transactions", route => route.fulfill({ json: { [local.id]: local } }));
  await page.route("**/proxy/transactions/tx-test", route => route.fulfill({ json: local }));
  await page.route("**/proxy/runtime", route => route.fulfill({ json: {
    ...runtime(), host_takeover: {
      mode: "console", phase: "failed", error: "Takeover interrupted",
      connectivity_confirmation_required: false,
      items: [{ resource: "eth0", disposition: "imported", reason: "Supported Ethernet" }, { resource: "bridge0", disposition: "disabled", reason: "Unsupported bridge" }],
    },
  } }));
  await connect(page);
  await page.goto("/config/commits/tx-test");
  const detail = page.getByRole("region", { name: "Commit detail", exact: true });
  await expect(detail).toContainText("applying_local");
  await expect(page.getByRole("button", { name: /Confirm changes|Retry rollback|Roll back/ })).toHaveCount(0);
  await expect(page.locator(".transaction-actions time")).toHaveCount(0);
  await page.goto("/diagnostics/process-health");
  const receipt = page.locator('details[aria-label="Host takeover"]');
  await expect(receipt).toBeVisible();
  await expect(receipt).not.toHaveAttribute("open");
  await receipt.locator("summary").click();
  await expect(receipt).toContainText("failed");
  await expect(receipt.getByRole("alert")).toHaveText("Takeover interrupted");
  await expect(receipt).toContainText("retry provisioning from the console");
  await expect(receipt.locator("tbody tr")).toHaveCount(2);
  await expect(receipt.getByRole("button")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toEqual([]);
});
