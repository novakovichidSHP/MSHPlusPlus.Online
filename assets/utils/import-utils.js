export function getBaseName(name) {
  return String(name || "").split(/[/\\\\]/).pop() || "";
}

export function createNumberedImportName(original, isTaken) {
  const name = String(original || "");
  const dot = name.lastIndexOf(".");
  const hasExtension = dot > 0;
  const base = hasExtension ? name.slice(0, dot) : name;
  const extension = hasExtension ? name.slice(dot) : ".cpp";
  let index = 1;
  let candidate = `${base}${index}${extension}`;
  while (isTaken(candidate)) {
    index += 1;
    candidate = `${base}${index}${extension}`;
  }
  return candidate;
}
