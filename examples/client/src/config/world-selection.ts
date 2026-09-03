export const DEFAULT_WORLD_NAME = "flat";

export const resolveWorldName = (
  search: string,
  savedWorldName: string | null,
) =>
  new URLSearchParams(search).get("world") ??
  savedWorldName ??
  DEFAULT_WORLD_NAME;
