import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { configSchema } from "../../src/types/domain";

test("raw configuration editor validates, stages and persists through SAVE", async ({ page }) => {
  const backend = await mockBackend(page);
  page.on("dialog", dialog => { throw new Error(`Unexpected dialog: ${dialog.message()}`); });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/config/changes");
  await page.getByRole("navigation", { name: "Config pages", exact: true })
    .getByRole("tab", { name: "Config editor", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/editor$/);
  const view = page.getByRole("region", { name: "Config editor", exact: true });
  const editor = view.getByLabel("Raw configuration (JSON)", { exact: true });
  await expect(editor).toHaveValue(/"interfaces"/);
  const candidate = configSchema.parse(JSON.parse(await editor.inputValue()));
  expect(candidate.software).toBeUndefined();
  await editor.fill('{"invalid":');
  await view.getByRole("button", { name: "Save", exact: true }).click();
  await expect(view.getByRole("alert")).toContainText("Configuration was not saved");
  expect(backend.writes).toEqual([]);
  candidate.firewall.allow_all_icmp = false;
  await editor.fill(JSON.stringify(candidate, null, 2));
  await view.getByRole("button", { name: "Save", exact: true }).click();
  await expect(view.getByRole("status")).toContainText("Configuration staged.");
  expect(backend.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await view.getByRole("link", { name: "Review and push in SAVE", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(dialog).toContainText("Changes applied.");
  await dialog.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/commits\/tx-test$/);
  expect(backend.writes.map(write => write.path)).toEqual(["/transactions", "/transactions/tx-test/confirm"]);
  await page.getByRole("navigation", { name: "Config pages", exact: true })
    .getByRole("tab", { name: "Config editor", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/editor$/);
  await page.reload();
  await expect(editor).toHaveValue(/"allow_all_icmp": false/);
  expect(configSchema.parse(JSON.parse(await editor.inputValue())).firewall.allow_all_icmp).toBe(false);
});
