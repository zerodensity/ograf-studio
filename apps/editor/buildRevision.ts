/** Resolve a short source revision without making Git a requirement for release archives. */
export function resolveBuildRevision(override: string | undefined, readGit: () => string): string {
  const shorten = (revision: string) => {
    const value = revision.trim();
    return /^[0-9a-f]{7,40}$/i.test(value) ? value.slice(0, 8).toLowerCase() : 'unknown';
  };
  // An explicit value wins even when invalid: do not silently substitute a different checkout.
  if (override !== undefined) return shorten(override);
  try {
    return shorten(readGit());
  } catch {
    return 'unknown';
  }
}
