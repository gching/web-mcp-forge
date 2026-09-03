export const DEFAULT_WORLD_NAME = "flat";
// Deliberately separate from the legacy `voxelize-world` key, whose old
// terrain default was persisted by prior deployments.
export const WORLD_SELECTION_STORAGE_KEY = "forge-world-selection";

export const resolveWorldName = (
  search: string,
  savedWorldName: string | null,
) =>
  new URLSearchParams(search).get("world") ??
  savedWorldName ??
  DEFAULT_WORLD_NAME;
