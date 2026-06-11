export const DEFAULT_EDITOR_MODE = "cm6";
export const EDITOR_MODE_STORAGE_KEY = "shp-editor-mode";
export const EDITOR_MODE_VALUES = ["cm6", "legacy"];

export function normalizeEditorMode(mode, fallback = DEFAULT_EDITOR_MODE) {
  return EDITOR_MODE_VALUES.includes(mode) ? mode : fallback;
}

export function resolveEditorMode(query, storedMode, fallback = DEFAULT_EDITOR_MODE) {
  const normalizedFallback = normalizeEditorMode(fallback, DEFAULT_EDITOR_MODE);
  const normalizedStored = normalizeEditorMode(storedMode, normalizedFallback);
  if (!query || typeof query.get !== "function") {
    return normalizedStored;
  }
  const fromQuery = normalizeEditorMode(query.get("editor"), "");
  return fromQuery || normalizedStored;
}
