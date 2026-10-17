export interface Choice { title: string; value: string | number }
export interface Field {
  key: string;
  label: string;
  kind: "text" | "number" | "switch" | "select" | "lines" | "object" | "rows";
  hint?: string;
  disabled?: boolean;
  choices?: Choice[];
  fields?: Field[];
  create?: () => unknown;
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
