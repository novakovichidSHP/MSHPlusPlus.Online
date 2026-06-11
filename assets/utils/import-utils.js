export function getBaseName(name) {
  return String(name || "").split(/[/\\\\]/).pop() || "";
}

export function createNumberedImportName(original, isTaken) {
  const base = String(original || "").replace(/\.py$/i, "");
  let index = 1;
  let candidate = `${base}${index}.py`;
  while (isTaken(candidate)) {
    index += 1;
    candidate = `${base}${index}.py`;
  }
  return candidate;
}
