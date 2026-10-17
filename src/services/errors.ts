import axios from "axios";
import type { ApiError } from "@/types/api";

export function classifyApiError(error: unknown): ApiError {
  if (axios.isAxiosError<unknown>(error)) {
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return { kind: "timeout", message: "Request timed out" };
    }
    if (error.code === "ERR_CANCELED") {
      return { kind: "unknown", message: "Request canceled" };
    }
    if (!error.response) {
      return { kind: "network", message: "Network unavailable" };
    }
    const status = error.response.status;
    if (status === 401 || status === 403) {
      return { kind: "auth", message: "Access denied" };
    }
    if (status === 400 || status === 422) {
      return { kind: "validation", message: "Validation error" };
    }
    if (status >= 500) {
      return { kind: "server", message: "Server error" };
    }
  }
  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : "Unknown error",
  };
}
