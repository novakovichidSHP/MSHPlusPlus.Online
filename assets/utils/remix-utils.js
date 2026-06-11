export function cloneFilesForProject(files = [], mainFile = "main.py") {
  const list = [];
  for (const file of files) {
    if (!file || typeof file.name !== "string" || !file.name) {
      continue;
    }
    list.push({
      name: file.name,
      content: String(file.content ?? "")
    });
  }
  ensureMainFileAtFront(list, mainFile);
  return list;
}

export function resolveLastActiveFile(files = [], candidate, mainFile = "main.py") {
  if (candidate && files.some((file) => file.name === candidate)) {
    return candidate;
  }
  const main = files.find((file) => file.name === mainFile);
  if (main) {
    return main.name;
  }
  return files[0]?.name || mainFile;
}

function ensureMainFileAtFront(files, mainFile) {
  const mainIndex = files.findIndex((file) => file.name === mainFile);
  if (mainIndex === -1) {
    files.unshift({ name: mainFile, content: "" });
    return;
  }
  if (mainIndex > 0) {
    const [main] = files.splice(mainIndex, 1);
    files.unshift(main);
  }
}
