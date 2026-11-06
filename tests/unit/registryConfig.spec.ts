import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete window.__MODAN_CONFIG__;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function baseUrl() {
  vi.resetModules();
  return (await import("@/services/registry")).registryApiBaseUrl;
}

describe("registry URL configuration", () => {
  it("uses the website host and default registry port when unconfigured", async () => {
    vi.stubEnv("VITE_REGISTRY_API_URL", "");
    const expected = new URL(window.location.origin);
    expected.port = "3031";
    expect(await baseUrl()).toBe(`${expected.origin}/api/v1`);
  });

  it("preserves the build-time URL when runtime configuration is empty", async () => {
    vi.stubEnv("VITE_REGISTRY_API_URL", "https://built.example/api/v1");
    window.__MODAN_CONFIG__ = { registryApiUrl: "" };
    expect(await baseUrl()).toBe("https://built.example/api/v1");
  });

  it("prefers the runtime registry IP over the build-time URL", async () => {
    vi.stubEnv("VITE_REGISTRY_API_URL", "https://built.example/api/v1");
    window.__MODAN_CONFIG__ = { registryApiUrl: "http://192.0.2.10:3031/api/v1/" };
    expect(await baseUrl()).toBe("http://192.0.2.10:3031/api/v1");
  });

  it("accepts an IPv6 registry address", async () => {
    window.__MODAN_CONFIG__ = { registryApiUrl: "http://[2001:db8::1]:3031/api/v1" };
    expect(await baseUrl()).toBe("http://[2001:db8::1]:3031/api/v1");
  });

  it.each([
    "javascript:alert(1)", "http://user:password@registry.example/api/v1",
    "http://registry.example/api/v1?query=1", "http://registry.example/api/v1#fragment",
    "http://registry.example/wrong-path", "not a URL",
  ])("rejects invalid runtime configuration instead of falling back: %s", async registryApiUrl => {
    vi.stubEnv("VITE_REGISTRY_API_URL", "https://built.example/api/v1");
    window.__MODAN_CONFIG__ = { registryApiUrl };
    await expect(baseUrl()).rejects.toThrow();
  });
});
