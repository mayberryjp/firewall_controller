import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/stores/app";

describe("app store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("opens and closes mobile navigation", () => {
    const app = useAppStore();
    expect(app.navigationOpen).toBe(false);
    app.toggleNavigation();
    expect(app.navigationOpen).toBe(true);
    app.toggleNavigation();
    expect(app.navigationOpen).toBe(false);
  });
});
