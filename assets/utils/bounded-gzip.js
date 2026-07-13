import { ImportPolicyError } from "./import-policy.js";

export function gunzipWithLimit(bytes, maxOutputBytes, Gunzip) {
  const chunks = [];
  let total = 0;
  let limitError = null;
  const gunzip = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > maxOutputBytes) {
      limitError = new ImportPolicyError("snapshot-too-large", "Snapshot expands beyond limit");
      return;
    }
    chunks.push(chunk);
  });
  gunzip.push(bytes, true);
  if (limitError) throw limitError;
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
