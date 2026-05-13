export function orderScriptsWithPins<T extends { name: string }>(
  scripts: T[],
  pinnedScripts: string[],
): T[] {
  const byName = new Map(scripts.map((script) => [script.name, script]));
  const pinnedOrder = pinnedScripts.filter((name) => byName.has(name));
  const pinnedSet = new Set(pinnedOrder);
  const rest = scripts.filter((script) => !pinnedSet.has(script.name));
  const pinnedRows = pinnedOrder.map((name) => byName.get(name) as T);
  return [...pinnedRows, ...rest];
}
