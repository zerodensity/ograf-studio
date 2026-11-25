import { sha256 } from '@noble/hashes/sha2.js';
import { readRemoteDocumentBytes } from '../state/fileIO';
import { assertSupportedStudioDocumentUrl } from '../state/studioDocumentFormat';
import {
  parseExampleCatalog,
  type CatalogExample,
  type ExampleCatalog,
  type ExampleSource,
} from './exampleCatalog';

/**
 * Everything the explorer reads over the network goes through here. Having no connection is a
 * normal state, not a fault: a catalog that cannot be reached is `null`, and callers show what is
 * saved on this computer instead.
 */

/** The public examples repo. A build can point at another catalog, for example a company's own. */
export const ONLINE_CATALOG_URL: string =
  import.meta.env?.VITE_OGRAF_EXAMPLE_CATALOG_URL ??
  'https://raw.githubusercontent.com/zerodensity/ograf-studio-examples/main/catalog.json';

/** Examples shipped inside Studio, served from its own files. */
export const BUILTIN_CATALOG_PATH = 'explorer/examples/catalog.json';

/** A slow connection must not hold the window up; the saved list is already on screen. */
const CATALOG_TIMEOUT_MS = 6_000;
const HASH_HEADER = 'x-ograf-sha256';

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Saved copies of the catalog, pictures, previews and downloaded examples. */
export interface ExampleFileCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}

/** `null` where the browser offers no storage (a page served over plain HTTP from another machine). */
export async function openExampleFileCache(): Promise<ExampleFileCache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open('ograf-studio-examples-v1');
    return {
      match: (url) => cache.match(url),
      put: (url, response) => cache.put(url, response),
    };
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseCatalogResponse(
  response: Response,
  url: string,
  source: ExampleSource,
): Promise<ExampleCatalog | null> {
  try {
    return parseExampleCatalog(await response.json(), url, source);
  } catch (cause) {
    // A catalog Studio cannot read is a publishing mistake, so it is reported where its author
    // looks, and the explorer keeps showing the last good list.
    console.warn(`Ignoring ${url}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
}

/** The catalog saved by the last successful refresh, for an instant first paint and for offline. */
export async function readSavedCatalog(
  cache: ExampleFileCache | null,
  url: string,
): Promise<ExampleCatalog | null> {
  const saved = await cache?.match(url).catch(() => undefined);
  return saved ? parseCatalogResponse(saved, url, 'online') : null;
}

/**
 * Ask the server for the current catalog. The browser revalidates its own copy with the ETag, so
 * an unchanged catalog costs one small request. `null` means it could not be reached or read.
 */
export async function fetchCatalog(
  url: string,
  source: ExampleSource,
  fetcher: Fetcher,
  cache: ExampleFileCache | null,
): Promise<ExampleCatalog | null> {
  let response: Response;
  try {
    response = await fetcher(url, {
      cache: 'no-cache',
      credentials: 'omit',
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const copy = response.clone();
  const catalog = await parseCatalogResponse(response, url, source);
  if (catalog && source === 'online') await cache?.put(url, copy).catch(() => undefined);
  return catalog;
}

async function savedExampleBytes(
  example: CatalogExample,
  cache: ExampleFileCache | null,
): Promise<Uint8Array | null> {
  const saved = await cache?.match(example.fileUrl).catch(() => undefined);
  if (!saved || saved.headers.get(HASH_HEADER) !== example.sha256) return null;
  return new Uint8Array(await saved.arrayBuffer());
}

/** Whether this example opens without a connection: shipped with Studio, or downloaded before. */
export async function isExampleSaved(
  example: CatalogExample,
  cache: ExampleFileCache | null,
): Promise<boolean> {
  if (example.source === 'builtin') return true;
  const saved = await cache?.match(example.fileUrl).catch(() => undefined);
  return saved?.headers.get(HASH_HEADER) === example.sha256;
}

/**
 * The example's document bytes, from the saved copy when it is still the catalog's version,
 * otherwise downloaded, checked against the catalog's hash and saved for next time.
 */
export async function loadExampleBytes(
  example: CatalogExample,
  fetcher: Fetcher,
  cache: ExampleFileCache | null,
): Promise<Uint8Array> {
  assertSupportedStudioDocumentUrl(new URL(example.fileUrl));
  const saved = await savedExampleBytes(example, cache);
  if (saved) return saved;
  let response: Response;
  try {
    response = await fetcher(example.fileUrl, { credentials: 'omit', cache: 'no-cache' });
  } catch {
    throw new Error(`Could not download "${example.title}". It will open once you are online.`);
  }
  if (!response.ok)
    throw new Error(`Could not download "${example.title}" (HTTP ${response.status}).`);
  const bytes = await readRemoteDocumentBytes(response);
  if (hex(sha256(bytes)) !== example.sha256)
    throw new Error(
      `The download of "${example.title}" does not match the catalog. Try again in a few minutes.`,
    );
  if (example.source === 'online')
    await cache
      ?.put(
        example.fileUrl,
        new Response(bytes.slice().buffer, { headers: { [HASH_HEADER]: example.sha256 } }),
      )
      .catch(() => undefined);
  return bytes;
}

const ASSET_TYPES: Record<string, string> = { '.webp': 'image/webp', '.mp4': 'video/mp4' };

/** GitHub serves a video as a generic download; the page needs to be told what it is. */
function typedAsset(url: string, blob: Blob): Blob {
  const type = ASSET_TYPES[url.slice(url.lastIndexOf('.')).toLowerCase()];
  return type && blob.type !== type ? new Blob([blob], { type }) : blob;
}

/**
 * A picture or preview video as a URL the page can show. Online files are saved on first use so
 * they still show without a connection; `null` means it is neither saved nor reachable.
 */
export async function loadExampleAsset(
  url: string,
  source: ExampleSource,
  fetcher: Fetcher,
  cache: ExampleFileCache | null,
): Promise<Blob | null> {
  if (source === 'online') {
    const saved = await cache?.match(url).catch(() => undefined);
    if (saved) return typedAsset(url, await saved.blob());
  }
  try {
    const response = await fetcher(url, { credentials: 'omit' });
    if (!response.ok) return null;
    if (source === 'online') await cache?.put(url, response.clone()).catch(() => undefined);
    return typedAsset(url, await response.blob());
  } catch {
    return null;
  }
}
