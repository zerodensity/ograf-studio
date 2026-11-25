export function assertSupportedStudioDocumentName(name: string): void {
  if (/\.ogp$/i.test(name.trim()))
    throw new Error('OGraf Studio no longer supports .ogp files. Use an .ogs file.');
}

export function assertSupportedStudioDocumentUrl(url: URL): void {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Check the original path when it contains an invalid escape.
  }
  assertSupportedStudioDocumentName(path);
}
