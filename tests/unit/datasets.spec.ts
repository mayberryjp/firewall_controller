import { describe, expect, it } from "vitest";
import { isInitialLoad } from "@/services/datasets";

describe("initial dataset readiness", () => {
  it.each([false, true])("recognizes pending initialization when loading is %s", loading => {
    expect(isInitialLoad({ data: null, error: null, lastSuccess: null, ...{ loading } })).toBe(true);
  });
  it.each([
    { data: null, error: "Permission denied", lastSuccess: null },
    { data: {}, error: null, lastSuccess: null },
    { data: [], error: null, lastSuccess: 1 },
    { data: null, error: null, lastSuccess: 1 },
    { data: { retained: true }, error: "Refresh failed", lastSuccess: 1 },
  ])("does not hide a completed, failed, or previously loaded dataset: %j", query => {
    expect(isInitialLoad(query)).toBe(false);
  });
});
