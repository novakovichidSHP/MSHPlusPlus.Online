import { createLegacyEditorAdapter } from "../editor-legacy/legacy-editor-adapter.js";
import { createCm6EditorAdapter } from "./cm6-editor-adapter.js";
import { normalizeEditorMode } from "../utils/editor-mode-utils.js";

export function createEditorAdapter(mode, context) {
  const normalized = normalizeEditorMode(mode);
  if (normalized === "legacy") {
    return createLegacyEditorAdapter(context);
  }
  return createCm6EditorAdapter(context);
}
