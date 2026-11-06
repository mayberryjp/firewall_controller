const alphabetic = new Intl.Collator("en", { sensitivity: "base" });

export function formatInterfaceName(name: string): string {
  return name.toUpperCase();
}

export function compareInterfaceNames(left: string, right: string): number {
  return alphabetic.compare(left, right);
}

export function sortByInterface<T>(items: readonly T[], name: (item: T) => string): T[] {
  return [...items].sort((left, right) => compareInterfaceNames(name(left), name(right)));
}

export function interfaceNameChoices(names: readonly string[]): Array<{ title: string; value: string }> {
  return [...names].sort(compareInterfaceNames).map(name => ({ title: formatInterfaceName(name), value: name }));
}
