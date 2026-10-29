import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config } from "../fixtures";

test("vnStat collector stages inline with row enablement and confirms a full package", async ({ page }, testInfo) => {
  const initialConfig = config();
  initialConfig.vnstat.metadata = { display_name: "Accounting", description: "Preserved notes" };
  const backend = await mockBackend(page, { initialConfig });
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/services/vnstat");
  const view = page.getByRole("region", { name: "vnStat", exact: true });
  await view.getByRole("button", { name: "Add collector", exact: true }).click();
  await expect(view.getByRole("dialog")).toHaveCount(0);
  await expect(view.getByRole("checkbox")).toHaveCount(0);
  const editor = view.getByRole("row", { name: "Collector editor", exact: true });
  const destination = editor.getByRole("textbox", { name: "Collector", exact: true });
  await destination.fill("collector.example:9999");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(view.getByRole("alert")).toBeVisible();
  await expect(destination).toHaveValue("collector.example:9999");
  await destination.fill("192.0.2.10:9999");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const enabled = view.getByRole("checkbox", { name: "Enable vnStat", exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await expect(enabled).toBeChecked();
  await enabled.uncheck();
  await expect(view.getByRole("cell", { name: "192.0.2.10:9999", exact: true })).toBeVisible();
  await view.getByRole("button", { name: "Edit collector", exact: true }).click();
  await destination.fill("192.0.2.11:9999");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(view.getByRole("cell", { name: "192.0.2.10:9999", exact: true })).toBeVisible();
  await enabled.check();
  await expect(view.getByRole("button", { name: "Add collector", exact: true })).toBeDisabled();
  expect(backend.writes).toEqual([]);
  expect(dialogs).toEqual([]);
  const bounds = await view.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await view.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("vnstat-collector.png"), fullPage: true, animations: "disabled" });

  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("vnstat.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]).toMatchObject({
    path: "/transactions",
    body: { config: {
      vnstat: { enabled: true, collector: "192.0.2.10:9999", metadata: initialConfig.vnstat.metadata },
      kernel: initialConfig.kernel, ntp: initialConfig.ntp,
    } },
  });
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
  await page.goto("/services/vnstat");
  await expect(view.getByRole("cell", { name: "192.0.2.10:9999", exact: true })).toBeVisible();
  await expect(enabled).toBeChecked();
  expect(dialogs).toEqual([]);
});