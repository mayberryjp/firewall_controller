import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

async function connect(page: Page): Promise<void> {
  await page.goto("/connect");
  await page.getByLabel("Bearer credential").fill("browser-test-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
}
test("invalid credentials do not start a polling loop or persist tokens", async ({ page }) => {
  await mockBackend(page);
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/v1")) requests.push(request.url()); });
  await page.goto("/connect");
  await page.getByLabel("Bearer credential").fill("invalid-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "401" }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("recovery remains accessible when state observation is unavailable", async ({ page }) => {
  await mockBackend(page, { observationFailed: true, initialStatus: "recovery_failed" });
  await connect(page);
  await expect(page.getByText("Critical: recovery failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry rollback", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Observation unavailable");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("shared route draft preserves other subsystems and requires explicit apply and confirmation", async ({ page, isMobile }) => {
  const backend = await mockBackend(page);
  await connect(page);
  if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Routes", exact: true }).click();
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await page.getByRole("main").getByRole("link", { name: "Review changes", exact: true }).click();
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending_confirmation");
  expect(backend.writes.filter(write => write.path === "/transactions")).toHaveLength(1);
  expect(backend.writes[0]?.body).toMatchObject({
    base_revision: "0", config: { routes: [{ metric: 42 }], interfaces: [{ name: "lab0" }], softflowd: [{ name: "capture" }], kernel: { namespace: { "net.ipv4.tcp_syncookies": "1" } } },
  });
  expect(backend.writes.some(write => write.path.endsWith("/confirm"))).toBe(false);
  await page.getByRole("button", { name: "Confirm configuration", exact: true }).first().click();
  await page.getByLabel("I have checked connectivity and want to commit this candidate.").check();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm configuration", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Committed revision 1");
  expect(backend.writes.filter(write => write.path.endsWith("/confirm"))).toHaveLength(1);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("unknown write outcomes are frozen and never automatically replayed", async ({ page, isMobile }) => {
  const backend = await mockBackend(page, { lostSubmit: true });
  await connect(page);
  if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Routes", exact: true }).click();
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("99");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  await page.getByRole("main").getByRole("link", { name: "Review changes", exact: true }).click();
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByText("Outcome unknown: Apply package.", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(backend.writes.filter(write => write.path === "/transactions")).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("reload requires credential re-entry and rediscovers pending transactions", async ({ page }) => {
  await mockBackend(page, { initialStatus: "pending_confirmation" }); await connect(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect to Netcontrol" })).toBeVisible();
  await page.getByLabel("Bearer credential").fill("browser-test-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending confirmation");
});

test("keyboard skip link, unknown routes, and exact statistics values", async ({ page }) => {
  await mockBackend(page);
  await connect(page);
  await expect(page.getByRole("cell", { name: "18446744073709551615", exact: true })).toBeVisible();
  await page.goto("/unknown-controller-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});
