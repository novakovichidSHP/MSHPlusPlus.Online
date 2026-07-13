function sameBytes(a, b) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Collect changed files without reading any file whose stat already exceeds a
 * limit. This function intentionally receives FS as a dependency so the policy
 * is unit-testable outside Emscripten.
 */
export function collectLimitedOutputFiles({
  runtimeFS,
  workdir,
  inputSnapshot = new Map(),
  maxFiles = 30,
  maxSingleFileBytes = 50_000,
  maxTotalTextBytes = 250_000
}) {
  const files = [];
  const omitted = [];
  let entries;
  try { entries = runtimeFS.readdir(workdir); } catch { return { files, limited: false, omitted }; }

  const candidates = [];
  for (const name of entries) {
    if (name === "." || name === "..") continue;
    const path = workdir + "/" + name;
    let stat;
    try { stat = runtimeFS.stat(path); } catch { continue; }
    if (runtimeFS.isDir(stat.mode)) continue;
    candidates.push({ name, path, size: Number(stat.size) || 0 });
  }

  let totalReadBytes = 0;
  for (let index = 0; index < candidates.length; index++) {
    const item = candidates[index];
    if (index >= maxFiles) {
      omitted.push({ name: item.name, reason: "maxFiles", size: item.size });
      continue;
    }
    if (item.size > maxSingleFileBytes) {
      omitted.push({ name: item.name, reason: "maxSingleFileBytes", size: item.size });
      continue;
    }
    if (totalReadBytes + item.size > maxTotalTextBytes) {
      omitted.push({ name: item.name, reason: "maxTotalTextBytes", size: item.size });
      continue;
    }

    let data;
    try { data = runtimeFS.readFile(item.path); } catch { continue; }
    totalReadBytes += data.byteLength;
    const previous = inputSnapshot.get(item.name);
    if (previous && sameBytes(previous, data)) continue;
    files.push({ name: item.name, content: new TextDecoder().decode(data) });
  }

  return {
    files,
    limited: omitted.length > 0,
    omitted,
    acceptedBytes: totalReadBytes
  };
}
