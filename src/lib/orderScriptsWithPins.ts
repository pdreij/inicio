/**
 * Pinned scripts first (in `pinnedScripts` order), then the rest in
 * `canonicalScriptOrder` (stable baseline, e.g. package.json key order).
 * If `canonicalScriptOrder` is empty, unpinned scripts keep the order of `scripts`.
 */
export function orderScriptsWithPins<T extends { name: string }>(
  scripts: T[],
  pinnedScripts: string[],
  canonicalScriptOrder: string[],
): T[] {
  const byName = new Map(scripts.map((script) => [script.name, script]));
  const pinnedOrder = pinnedScripts.filter((name) => byName.has(name));
  const pinnedSet = new Set(pinnedOrder);
  const pinnedRows = pinnedOrder.map((name) => byName.get(name) as T);

  const rest =
    canonicalScriptOrder.length > 0
      ? canonicalScriptOrder
          .filter((name) => byName.has(name) && !pinnedSet.has(name))
          .map((name) => byName.get(name) as T)
      : scripts.filter((script) => !pinnedSet.has(script.name));

  return [...pinnedRows, ...rest];
}
