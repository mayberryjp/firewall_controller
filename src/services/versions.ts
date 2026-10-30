import { z } from "zod";

export const dateVersionSchema = z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.[1-9]\d{0,9}$/)
  .refine(value => {
    const [year, month, day, iteration] = value.split(".").map(Number);
    if (!year || !month || !day || !iteration || month > 12 || iteration > 4294967295) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  }, "Use a real date and iteration, such as 2026.10.29.1 (iteration 1..4294967295)");

export function compareDateVersions(first: string, second: string): number {
  const left = dateVersionSchema.parse(first).split(".").map(Number);
  const right = dateVersionSchema.parse(second).split(".").map(Number);
  for (let index = 0; index < left.length; index++) {
    const difference = left[index]! - right[index]!;
    if (difference) return difference;
  }
  return 0;
}
