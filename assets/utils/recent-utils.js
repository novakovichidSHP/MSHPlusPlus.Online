export function mergeUniqueIds(primary = [], secondary = []) {
  const out = [];
  const seen = new Set();
  for (const id of [...primary, ...secondary]) {
    if (id == null || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}
