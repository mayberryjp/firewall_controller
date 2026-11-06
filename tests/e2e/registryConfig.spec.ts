import { expect, test } from "@playwright/test";

test("uses the runtime registry address for direct browser sign-in", async ({ page }) => {
  const registry = "http://192.0.2.10:4041/api/v1";
  await page.route("**/runtime-config.js", route => route.fulfill({
    contentType: "application/javascript",
    body: `window.__MODAN_CONFIG__ = ${JSON.stringify({ registryApiUrl: registry })};`,
  }));
  const requests: string[] = [];
  await page.route(`${registry}/**`, route => {
    const request = route.request();
    requests.push(request.url());
    const headers = {
      "Access-Control-Allow-Origin": request.headers().origin ?? "",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (new URL(request.url()).pathname === "/api/v1/devices") {
      expect(request.headers().authorization).toBe("Bearer runtime-registry-session");
      return route.fulfill({ headers, contentType: "application/json", body: '{"devices":[]}' });
    }
    const login = request.method() === "POST";
    return route.fulfill({
      status: login ? 200 : 401, headers, contentType: "application/json",
      body: JSON.stringify(login ? { token: "runtime-registry-session", expires_in: 28800 } : { error: "Registry login required" }),
    });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  const login = page.waitForRequest(request => request.url() === `${registry}/session` && request.method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await login).postDataJSON()).toEqual({ password: "registry-test-password" });
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(url => url.startsWith(`${registry}/`))).toBe(true);
});
