import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { classifyApiError } from "@/services/errors";

describe("API error classification", () => {
  it.each([
    ["ECONNABORTED", "timeout"],
    ["ETIMEDOUT", "timeout"],
    ["ERR_NETWORK", "network"],
    ["ERR_CANCELED", "unknown"],
  ])("classifies %s as %s", (code, kind) => {
    expect(classifyApiError(new AxiosError("Request failed", code)).kind).toBe(kind);
  });

  it.each([
    [400, "validation"],
    [401, "auth"],
    [403, "auth"],
    [422, "validation"],
    [500, "server"],
    [503, "server"],
    [404, "unknown"],
  ])("classifies HTTP %s as %s", (status, kind) => {
    const config = { headers: new AxiosHeaders() };
    const error = new AxiosError("Request failed", undefined, config, undefined, {
      status,
      statusText: "Request failed",
      headers: new AxiosHeaders(),
      config,
      data: null,
    });
    expect(classifyApiError(error).kind).toBe(kind);
  });

  it("preserves ordinary errors and handles unknown values", () => {
    expect(classifyApiError(new Error("Unexpected failure"))).toEqual({
      kind: "unknown",
      message: "Unexpected failure",
    });
    expect(classifyApiError(null)).toEqual({ kind: "unknown", message: "Unknown error" });
  });
});
