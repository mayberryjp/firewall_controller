import { z } from "zod";
import type { Config } from "@/types/domain";

export const ruleOwnershipShape = {
  origin: z.enum(["manual", "import", "system", "inherited"]).optional(),
  import_source: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).nullable().optional(),
};
const ownershipObject = z.object(ruleOwnershipShape);
export type RuleOwnership = z.infer<typeof ownershipObject>;
export const manualRuleOwnership = { origin: "manual", import_source: null } as const;
export function validateRuleOwnership(value: RuleOwnership, context: z.RefinementCtx): void {
  if ((value.origin === "import") !== (value.import_source != null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["import_source"], message: "Imported rules require a provider ID; other origins must not have an import source." });
  }
}
export const ruleOwnershipSchema = ownershipObject.superRefine(validateRuleOwnership);
export function ruleOwnershipLabel(value: unknown): string {
  const rule = ruleOwnershipSchema.parse(value);
  return rule.origin === "import" ? `Import: ${rule.import_source}` :
    rule.origin === "system" ? "System" : rule.origin === "inherited" ? "Inherited" : "Manual";
}
export function withoutRuleOwnership(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRuleOwnership);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "origin" && key !== "import_source")
    .map(([key, child]) => [key, withoutRuleOwnership(child)]));
  return value;
}
function ownershipEntries(config: Config, keyBy: "position" | "owner"): Map<string, RuleOwnership> {
  const entries = new Map<string, RuleOwnership>();
  const key = (index: number, owner: string) => keyBy === "owner" ? encodeURIComponent(owner) : index;
  const add = (path: string, rules: RuleOwnership[]) => rules.forEach((rule, index) => entries.set(`${path}/${index}`, rule));
  add("/firewall/rules", config.firewall.rules);
  add("/firewall/nat/masquerade", config.firewall.nat.masquerade);
  add("/firewall/nat/destination_rewrite", config.firewall.nat.destination_rewrite ?? []);
  config.firewall.policies?.hosts.forEach((host, index) => add(`/firewall/policies/hosts/${key(index, host.id)}/rules`, host.rules));
  config.firewall.policies?.interfaces.forEach((group, index) => add(`/firewall/policies/interfaces/${key(index, group.interface)}/rules`, group.rules));
  config.firewall.input?.interfaces.forEach((group, index) => add(`/firewall/input/interfaces/${key(index, group.interface)}/rules`, group.rules));
  return entries;
}
export function ruleOwnershipEntries(config: Config): Map<string, RuleOwnership> {
  return ownershipEntries(config, "position");
}
export function ruleOwnershipPreserved(expected: Config, received: Config): boolean {
  // The backend sorts owner groups, but rule positions within each group retain their priority.
  const actual = ownershipEntries(received, "owner");
  return [...ownershipEntries(expected, "owner")].every(([path, rule]) =>
    (rule.origin === undefined || actual.get(path)?.origin === rule.origin) &&
    (rule.import_source === undefined || actual.get(path)?.import_source === rule.import_source));
}
