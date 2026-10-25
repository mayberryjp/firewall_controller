import { z } from "zod";

const counter = z.string().regex(/^(0|[1-9]\d*)$/);
const finite = z.number().finite().nonnegative();
const status = z.enum(["available", "partial", "unavailable", "simulated"]);
const section = <T extends z.ZodTypeAny>(data: T) => z.object({ status, data: data.nullable(), error: z.string().nullable() });
const pressure = section(z.object({
  some: z.object({ avg10: finite.max(100), avg60: finite.max(100), avg300: finite.max(100), total: counter }),
  full: z.object({ avg10: finite.max(100), avg60: finite.max(100), avg300: finite.max(100), total: counter }).optional(),
}));
export const hostHealthSchema = z.object({
  schema: z.literal("netcontrol-host-health/v1"),
  sample: z.object({ scope: z.string(), boot_id: z.string().nullable(), started_at: z.string().datetime({ offset: true }), collected_at: z.string().datetime({ offset: true }), status: z.enum(["available", "partial", "simulated"]) }),
  sections: z.object({
    cpu: section(z.object({ ticks_per_second: z.number().int().positive(), cpus: z.array(z.object({ name: z.string(), ticks: z.record(counter) })), scheduler: z.record(counter) })),
    memory: section(z.object({ bytes: z.object({ MemTotal: counter, MemFree: counter, MemAvailable: counter, SwapTotal: counter, SwapFree: counter }).catchall(counter), used_bytes: counter, swap_used_bytes: counter })),
    load: section(z.object({ one: finite, five: finite, fifteen: finite, runnable_tasks: counter, total_tasks: counter, last_pid: counter })),
    uptime: section(z.object({ uptime_seconds: finite, idle_seconds: finite })),
    vm: section(z.record(counter)),
    pressure_cpu: pressure, pressure_memory: pressure, pressure_io: pressure,
    disks: section(z.array(z.object({ name: z.string(), major: counter, minor: counter, counters: z.record(counter) }))),
    filesystems: section(z.array(z.object({ mount_id: counter, device: z.string(), mount_point: z.string(), filesystem: z.string(), usage: section(z.object({
      total_bytes: counter, free_bytes: counter, available_bytes: counter, used_bytes: counter,
      total_inodes: counter, free_inodes: counter, available_inodes: counter, read_only: z.boolean(),
    })) }))),
    thermal: section(z.array(z.object({ id: z.string(), status, error: z.string().nullable(), data: z.object({ type: z.string(), temperature_millicelsius: z.number().int().safe() }).nullable() }))),
    hwmon: section(z.array(z.object({ id: z.string(), chip: z.string().optional(), unit: z.enum(["millicelsius", "rpm"]).optional(), status, error: z.string().nullable(), data: z.object({ value: z.number().int().safe(), label: z.string().nullable() }).nullable() }))),
  }),
}).superRefine((value, context) => {
  if (value.sample.status === "simulated" && Object.values(value.sections).some(item => item.data !== null)) {
    context.addIssue({ code: "custom", message: "Simulated host health must not expose measured host data", path: ["sections"] });
  }
});
export type HostHealth = z.infer<typeof hostHealthSchema>;
const cpuFields = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"];
export function cpuUsage(current: HostHealth, previous: HostHealth | null): number | null {
  if (!previous || current.sample.status === "simulated" || current.sample.scope !== previous.sample.scope ||
    !current.sample.boot_id || current.sample.boot_id !== previous.sample.boot_id) return null;
  const elapsed = (current.sections.uptime.data?.uptime_seconds ?? 0) - (previous.sections.uptime.data?.uptime_seconds ?? 0);
  if (elapsed <= 0 || Date.parse(current.sample.collected_at) <= Date.parse(previous.sample.collected_at)) return null;
  const now = current.sections.cpu.data, before = previous.sections.cpu.data;
  if (!now || !before || now.ticks_per_second !== before.ticks_per_second ||
    now.cpus.map(item => item.name).sort().join("/") !== before.cpus.map(item => item.name).sort().join("/")) return null;
  const latest = now.cpus.find(item => item.name === "cpu")?.ticks;
  const earlier = before.cpus.find(item => item.name === "cpu")?.ticks;
  if (!latest || !earlier || cpuFields.slice(0, 4).some(field => latest[field] === undefined || earlier[field] === undefined)) return null;
  let total = 0n, idle = 0n;
  for (const field of cpuFields) {
    if ((latest[field] === undefined) !== (earlier[field] === undefined)) return null;
    const delta = BigInt(latest[field] ?? "0") - BigInt(earlier[field] ?? "0");
    if (delta < 0n) return null;
    total += delta;
    if (field === "idle" || field === "iowait") idle += delta;
  }
  return total > 0n ? Number((total - idle) * 10000n / total) / 100 : null;
}
const display = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function formatBytes(value: string | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  const count = BigInt(value), units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  let divisor = 1n, unit = 0;
  while (count >= divisor * 1000n && unit < units.length - 1) { divisor *= 1000n; unit++; }
  return `${display.format(Number((count * 100n + divisor / 2n) / divisor) / 100)} ${units[unit]}`;
}
export function usagePercent(used: string, total: string): number | null {
  const limit = BigInt(total), count = BigInt(used);
  return limit > 0n && count <= limit ? Number(count * 10000n / limit) / 100 : null;
}
export function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`;
}