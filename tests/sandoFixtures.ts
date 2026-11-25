import type { SandoStatus } from "../src/services/sando";

export function sandoStatus(): SandoStatus {
  const sync = {
    enabled: true, state: "succeeded" as const, sync_interval_seconds: 3600,
    source_url: "https://sando.example",
    last_attempt_at: "2026-10-30T20:00:00.999Z",
    last_success_at: "2026-10-30T14:00:00.123Z",
    next_sync_at: "2026-10-30T21:00:00Z", error: null,
  };
  return {
    ...sync, hosts: [],
    policies: { ...sync, sync_interval_seconds: 300, last_success_at: "2026-10-30T12:30:08.722-07:00" },
  };
}
