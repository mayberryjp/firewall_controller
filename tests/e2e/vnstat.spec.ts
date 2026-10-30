import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, vnstatReporting } from "../fixtures";

test("vnStat daily reporting shows attempt dates and UDP failures without claiming successful uploads", async ({ page, isMobile }) => {
  const initialConfig = config(); initialConfig.vnstat = { enabled: true, collector: "192.0.2.10:9999" };
  const backend = await mockBackend(page, { initialConfig });
  let reads = 0;
  await page.route("**/proxy/statistics/vnstat", route => {
    reads++;
    expect(route.request().method()).toBe("GET");
    expect(new URL(route.request().url()).search).toBe("");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...vnstatReporting(), last_report_date: "2026-10-30", failed_datagrams: "7",
      last_report_error: "Collector route unavailable", interfaces: {}, history: [],
    }) });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/services/vnstat");
  const view = page.getByRole("region", { name: "vnStat", exact: true });
  const row = view.getByRole("row").filter({ hasText: "192.0.2.10:9999" });
  await expect(row.locator(".report-value")).toHaveText(["2026-10-30", "18446744073709551615", "7"]);
  await expect(row.locator("td").nth(2)).toHaveAttribute("title", /Appliance-local attempt date/);
  await expect(row.locator("td").nth(3)).toHaveAttribute("title", /UDP delivery is not confirmed/);
  await expect(view.getByRole("status")).toHaveText("Collector route unavailable");
  await expect(view.locator("h2, dl")).toHaveCount(0);
  await expect(view).not.toContainText("2026-10-30 00:00:00");
  await expect(page.getByRole("button", { name: "Edit collector", exact: true })).toBeEnabled();
  expect(reads).toBeGreaterThan(0); expect(backend.writes).toEqual([]);
  expect(await view.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  if (isMobile) {
    const toggle = await row.locator(".v-switch").boundingBox();
    const sentLabel = await row.locator(".compact-cell-label").filter({ hasText: /^Sent$/ }).boundingBox();
    expect(toggle).not.toBeNull(); expect(sentLabel).not.toBeNull();
    expect(toggle!.y + toggle!.height).toBeLessThanOrEqual(sentLabel!.y);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

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
  await expect(view).toContainText("Native accounting unavailable in simulator");
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
  await expect(view.locator("tbody .report-value")).toHaveText(["Unavailable", "Unavailable", "Unavailable"]);
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