export const PROJECT_SOURCE_EXTENSION = '.ogs';
export const LEGACY_PROJECT_SOURCE_EXTENSIONS = ['.ogeproj', '.ogeproj.json'] as const;

export function isProjectSourcePath(path: string, includeLegacy = true): boolean {
  const normalized = path.trim().toLowerCase();
  if (normalized.endsWith(PROJECT_SOURCE_EXTENSION)) return true;
  return includeLegacy
    ? LEGACY_PROJECT_SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension))
    : false;
}
