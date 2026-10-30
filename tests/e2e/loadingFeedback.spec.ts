import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { hostPolicyConfig } from "../fixtures";

for (const outcome of ["success", "failure"] as const) {
  test(`ADVANCED has no premature warning while configuration loads (${outcome})`, async ({ page }) => {
    await mockBackend(page, { initialConfig: hostPolicyConfig() });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/proxy/state", async route => {
      if (route.request().method() !== "GET") return route.fallback();
      await pending;
      if (outcome === "success") return route.fallback();
      return route.fulfill({
        status: 403, json: { error: "state.read permission required", transaction: null },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    });
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        const view = document.querySelector('section[aria-label="Advanced settings"]');
        if (view?.querySelector("#advanced-blocked")) {
          document.documentElement.dataset.prematureLoadingWarning = "seen";
        }
      });
      observer.observe(document, { childList: true, characterData: true, subtree: true });
      document.addEventListener("finish-loading-audit", () => observer.disconnect(), { once: true });
    });
    try {
      await page.goto("/connect");
      await page.getByLabel("Registry admin password").fill("registry-test-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
      await page.goto("/settings/advanced");
      const view = page.getByRole("region", { name: "Advanced settings", exact: true });
      await expect(view).toBeVisible();
      const action = view.getByRole("button", { name: "Delete all firewall hosts and forwarding rules", exact: true });
      await expect(action).toBeDisabled();
      await expect(view.locator("#advanced-blocked")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.dataset.prematureLoadingWarning)).toBeUndefined();
      await page.evaluate(() => document.dispatchEvent(new Event("finish-loading-audit")));
      release();
      if (outcome === "success") {
        await expect(action).toBeEnabled();
        await expect(view.locator("#advanced-blocked")).toHaveCount(0);
      } else {
        await expect(view.locator("#advanced-blocked")).toContainText("Current configuration and transaction state are unavailable");
        await expect(action).toBeDisabled();
      }
    } finally { release(); }
  });
}
