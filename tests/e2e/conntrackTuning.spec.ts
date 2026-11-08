import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { conntrackCatalog, conntrackSnapshot } from "../conntrackFixtures";
import { encodeJson } from "../../src/services/json";

test("conntrack tuning stages exact scoped strings and uses the existing reviewed confirmation flow", async ({ page, isMobile }, testInfo) => {
  const backend = await mockBackend(page), dialogs: string[] = [];
  const current = conntrackSnapshot();
  for (const entry of conntrackCatalog()) {
    current.observed[entry.scope][entry.name] = entry.scope === "host" ? "4096" : "120";
  }
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.route("**/proxy/kernel/tunables/catalog", route => route.fulfill({ contentType: "application/json", body: encodeJson(conntrackCatalog()) }));
  await page.route("**/proxy/kernel/tunables", route => route.fulfill({ contentType: "application/json", body: encodeJson(current) }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/settings/conntrack-tuning");
  const settings = page.getByRole("region", { name: "Conntrack tuning", exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Conntrack tuning", exact: true })).toBeVisible();
  await expect(settings.locator(".settings-head, h2, .conntrack-group")).toHaveCount(0);
  await expect(settings).not.toContainText("The firewall manages these settings.");
  await expect(settings).not.toContainText("Maximum tracked connections for the entire host.");
  await expect(settings).not.toContainText("Timeouts in seconds for connections in the firewall's network namespace.");
  await expect(settings.getByRole("heading", { name: "CONNTRACK TUNING", exact: true })).toHaveCount(0);
  await expect(settings).not.toContainText("Blank values leave settings unmanaged.");
  await expect(settings.locator("input")).toHaveCount(9);
  await expect(settings.locator(".setting-row")).toHaveCount(9);
  const columns = await settings.locator(".setting-row").first().evaluate(row => getComputedStyle(row).gridTemplateColumns.split(" "));
  expect(columns).toHaveLength(isMobile ? 1 : 2);
  if (!isMobile) expect(columns[0]).toBe("240px");
  expect(await settings.locator(".setting-field").first().evaluate(field => getComputedStyle(field).maxWidth)).toBe("360px");
  await expect(settings.locator(".v-field--variant-outlined")).toHaveCount(0);
  const capacity = settings.getByRole("textbox", { name: "Maximum connections (entries)", exact: true });
  await expect(capacity).toBeEnabled();
  await expect(capacity).toHaveValue("4096");
  await expect(settings).toContainText("Current system: 4096 entries");
  await expect(settings).not.toContainText("Unmanaged");
  await expect(settings.locator("dl")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Reload settings", exact: true })).toHaveCount(0);
  await capacity.fill("01");
  await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(settings).toContainText("leading zeros");
  await capacity.fill("");
  await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(settings).toContainText("Enter a value");
  expect(backend.writes).toEqual([]);
  await capacity.fill("2048");
  await settings.getByRole("textbox", { name: "UDP unreplied timeout (seconds)", exact: true }).fill("30");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toContainText("Conntrack changes staged");
  expect(backend.writes).toEqual([]);
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("conntrack-tuning.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  const push = page.getByRole("dialog");
  await expect(push).toContainText("kernel.host.write");
  await expect(push).toContainText("kernel.namespace.write");
  await expect(push).toContainText("independently verify connectivity");
  await push.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(push.getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  await expect(push).toContainText("cannot recover expired flows");
  expect(backend.writes.find(write => write.path === "/transactions")!.body).toMatchObject({
    config: { kernel: {
      host: { "net.netfilter.nf_conntrack_max": "2048" },
      namespace: { "net.ipv4.tcp_syncookies": "1", "net.netfilter.nf_conntrack_udp_timeout": "30" },
    } }, confirm_timeout_seconds: 120,
  });
  const submitted = backend.writes.find(write => write.path === "/transactions")!.body as { config: { kernel: unknown } };
  expect(submitted.config.kernel).toEqual({
    host: { "net.netfilter.nf_conntrack_max": "2048" },
    namespace: { "net.ipv4.tcp_syncookies": "1", "net.netfilter.nf_conntrack_udp_timeout": "30" },
  });
  expect(backend.writes.filter(write => write.path.endsWith("/confirm"))).toEqual([]);
  await push.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(push).not.toBeVisible();
  expect(backend.writes.filter(write => write.path.endsWith("/confirm"))).toHaveLength(1);
  expect(dialogs).toEqual([]);
});
