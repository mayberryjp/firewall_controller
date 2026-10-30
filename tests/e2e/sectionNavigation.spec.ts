import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { navigationSections } from "../../src/constants/navigation";

async function connect(page: Page) {
  await mockBackend(page);
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
}

test("Firewall/NAT highlights only the current page through navigation, queries and browser history", async ({ page }, testInfo) => {
  await connect(page);
  const section = navigationSections.find(section => section.name === "firewall-section")!;
  const navigation = page.getByRole("navigation", { name: "Firewall/NAT pages", exact: true });
  async function checkSelected(title: string) {
    const expand = navigation.getByRole("button", { name: "Expand Firewall/NAT navigation", exact: true });
    if (await expand.isVisible()) await expand.click();
    const selected = navigation.getByRole("tab", { name: title, exact: true });
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(selected).toHaveAttribute("aria-current", "page");
    await expect(navigation.locator(".v-tab--selected")).toHaveCount(1);
    await expect(navigation.locator('[role="tab"][aria-current="page"]')).toHaveCount(1);
    await expect(navigation.locator('[role="tab"].text-primary')).toHaveCount(1);
    await expect(selected).toHaveClass(/text-primary/);
  }
  await page.goto("/firewall/ingress");
  await checkSelected(section.pages[0]!.title);
  for (const entry of section.pages.slice(1)) {
    await navigation.getByRole("tab", { name: entry.title, exact: true }).click();
    await expect(page).toHaveURL(new URL(entry.path, testInfo.project.use.baseURL).href);
    await checkSelected(entry.title);
  }
  await page.goBack();
  await checkSelected(section.pages.at(-2)!.title);
  await page.goForward();
  await checkSelected(section.pages.at(-1)!.title);
  await page.goto("/firewall/ingress?filter=rules#selected");
  await checkSelected(section.pages[0]!.title);
  await page.screenshot({ path: testInfo.outputPath("firewall-navigation.png"), fullPage: true, animations: "disabled" });
});

test("section tabs retain their selection on detail pages with query strings", async ({ page }) => {
  await connect(page);
  for (const entry of [
    { path: "/interfaces/lab0?view=details", section: "Interfaces", title: "Physical interfaces" },
    { path: "/config/revisions/2026.10.29.1?view=details", section: "Config", title: "PUSH REQUESTS" },
  ]) {
    await page.goto(entry.path);
    const navigation = page.getByRole("navigation", { name: `${entry.section} pages`, exact: true });
    await expect(navigation.getByRole("tab", { name: entry.title, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(navigation.locator(".v-tab--selected")).toHaveCount(1);
  }
});
