const TURTLE_IMPORT_RE = /(^|\n)\s*(from\s+turtle\s+import\b|import\s+[^\n#]*\bturtle\b)/i;
const PROJECT_IMPORT_RE = /(?:^|\n)\s*(?:from|import)\s+([A-Za-z0-9._-]+)/g;

export function getTurtlePatchAssetNames(assets, isImageAsset) {
  if (!Array.isArray(assets)) {
    return [];
  }
  const imagePredicate = typeof isImageAsset === "function"
    ? isImageAsset
    : (name) => /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(String(name || ""));
  return assets
    .map((asset) => String(asset?.name || ""))
    .filter((name) => name && !name.startsWith("/") && imagePredicate(name));
}

export function detectTurtleUsage(files, { entryFileName = "main.py" } = {}) {
  if (!Array.isArray(files) || !files.length) {
    return false;
  }

  const entryFile = files.find((file) => file?.name === entryFileName);
  if (!entryFile) {
    return false;
  }

  const fileMap = new Map();
  for (const file of files) {
    if (!file || typeof file.name !== "string") {
      continue;
    }
    fileMap.set(file.name, String(file.content ?? ""));
  }

  const visited = new Set();
  const queue = [entryFileName];
  visited.add(entryFileName);

  while (queue.length > 0) {
    const currentName = queue.shift();
    const content = fileMap.get(currentName);
    if (content == null) {
      continue;
    }

    if (TURTLE_IMPORT_RE.test(content)) {
      return true;
    }

    const importRegex = new RegExp(PROJECT_IMPORT_RE);
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importedModule = String(match[1] || "").split(".")[0];
      if (!importedModule) {
        continue;
      }
      const fileName = `${importedModule}.py`;
      if (!visited.has(fileName) && fileMap.has(fileName)) {
        visited.add(fileName);
        queue.push(fileName);
      }
    }
  }

  return false;
}
