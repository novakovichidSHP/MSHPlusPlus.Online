export const IMPORT_LIMITS = Object.freeze({
  maxInputBytes: 1_000_000,
  maxFiles: 30,
  maxSingleFileBytes: 50_000,
  maxTotalFileBytes: 250_000,
  maxSnapshotJsonBytes: 350_000
});

const VALID_NAME = /^[A-Za-z0-9._\-\u0400-\u04FF]+$/;
const encoder = new TextEncoder();

export class ImportPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ImportPolicyError";
    this.code = code;
  }
}

export function assertInputSize(byteLength, limits = IMPORT_LIMITS) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > limits.maxInputBytes) {
    throw new ImportPolicyError("input-too-large", "Import payload is too large");
  }
}

export function validatePortableFileName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 255 &&
    !name.includes("/") && !name.includes("\\") && !name.includes("..") && VALID_NAME.test(name);
}

export function validatePortableFiles(files, limits = IMPORT_LIMITS) {
  if (!Array.isArray(files) || files.length < 1 || files.length > limits.maxFiles) {
    throw new ImportPolicyError("file-count", "Invalid number of project files");
  }
  let totalBytes = 0;
  const names = new Set();
  return files.map((file) => {
    if (!file || !validatePortableFileName(file.name) || names.has(file.name)) {
      throw new ImportPolicyError("invalid-file-name", "Invalid or duplicate file name");
    }
    names.add(file.name);
    if (typeof file.content !== "string") {
      throw new ImportPolicyError("invalid-file-content", "File content must be text");
    }
    const bytes = encoder.encode(file.content).length;
    if (bytes > limits.maxSingleFileBytes) {
      throw new ImportPolicyError("file-too-large", `File ${file.name} is too large`);
    }
    totalBytes += bytes;
    if (totalBytes > limits.maxTotalFileBytes) {
      throw new ImportPolicyError("project-too-large", "Project files are too large");
    }
    return { name: file.name, content: file.content };
  });
}

export function parseProjectExport(text, limits = IMPORT_LIMITS) {
  if (typeof text !== "string" || encoder.encode(text).length > limits.maxSnapshotJsonBytes) {
    throw new ImportPolicyError("json-too-large", "JSON import is too large");
  }
  let payload;
  try { payload = JSON.parse(text); } catch {
    throw new ImportPolicyError("invalid-json", "Malformed JSON import");
  }
  if (!payload || payload.version !== 1 || !payload.project || !Array.isArray(payload.project.files)) {
    throw new ImportPolicyError("invalid-schema", "Invalid project export schema");
  }
  return { files: validatePortableFiles(payload.project.files, limits), hasAssets: Array.isArray(payload.project.assets) && payload.project.assets.length > 0 };
}

export function parseShareSnapshot(text, limits = IMPORT_LIMITS) {
  if (typeof text !== "string" || encoder.encode(text).length > limits.maxSnapshotJsonBytes) {
    throw new ImportPolicyError("snapshot-too-large", "Snapshot is too large");
  }
  let payload;
  try { payload = JSON.parse(text); } catch {
    throw new ImportPolicyError("invalid-json", "Malformed snapshot JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      (payload.title != null && typeof payload.title !== "string") ||
      (payload.lastActiveFile != null && typeof payload.lastActiveFile !== "string")) {
    throw new ImportPolicyError("invalid-schema", "Invalid snapshot schema");
  }
  const files = validatePortableFiles(payload.files, limits);
  if (payload.lastActiveFile != null && !files.some((file) => file.name === payload.lastActiveFile)) {
    throw new ImportPolicyError("invalid-active-file", "Snapshot active file is missing");
  }
  return { title: payload.title || "", files, lastActiveFile: payload.lastActiveFile || files[0].name };
}

export function createArchiveBudget(limits = IMPORT_LIMITS) {
  let count = 0;
  let total = 0;
  return {
    beginFile(name, declaredBytes) {
      if (!validatePortableFileName(name)) throw new ImportPolicyError("invalid-file-name", "Invalid archive entry name");
      count += 1;
      if (count > limits.maxFiles) throw new ImportPolicyError("file-count", "Too many archive files");
      if (Number.isFinite(declaredBytes) && declaredBytes > limits.maxSingleFileBytes) throw new ImportPolicyError("file-too-large", `File ${name} is too large`);
      let size = 0;
      return (chunkBytes) => {
        size += chunkBytes;
        total += chunkBytes;
        if (size > limits.maxSingleFileBytes) throw new ImportPolicyError("file-too-large", `File ${name} is too large`);
        if (total > limits.maxTotalFileBytes) throw new ImportPolicyError("project-too-large", "Archive expands beyond project limit");
      };
    }
  };
}
