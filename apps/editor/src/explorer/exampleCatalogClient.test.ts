import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it, vi } from 'vitest';
import { parseExampleCatalog, type CatalogExample } from './exampleCatalog';
import {
  fetchCatalog,
  isExampleSaved,
  loadExampleAsset,
  loadExampleBytes,
  readSavedCatalog,
  type ExampleFileCache,
  type Fetcher,
} from './exampleCatalogClient';

const CATALOG_URL = 'https://examples.test/v1/catalog.json';
const DOCUMENT = new TextEncoder().encode('{"an":"example document"}');
const HASH = Array.from(sha256(DOCUMENT), (byte) => byte.toString(16).padStart(2, '0')).join('');

function catalogJson(hash = HASH) {
  return {
    version: 1,
    examples: [
      {
        id: 'rain',
        title: 'Rain',
        summary: 'Rain falls.',
        category: 'Weather',
        level: 'Basic',
        tags: [],
        author: 'Zero Density',
        released: '2026-10-01',
        updated: '2026-10-02',
        file: 'rain/rain.ogs',
        bytes: DOCUMENT.byteLength,
        sha256: hash,
        thumbnail: 'rain/thumbnail.webp',
        canvas: { width: 1920, height: 1080, frameRate: 50 },
        templates: 1,
        fields: 0,
        documentVersion: 37,
      },
    ],
  };
}

function example(hash = HASH): CatalogExample {
  return parseExampleCatalog(catalogJson(hash), CATALOG_URL, 'online').examples[0]!;
}

function memoryCache(): ExampleFileCache & { urls(): string[] } {
  const saved = new Map<string, Response>();
  return {
    match: async (url) => saved.get(url)?.clone(),
    put: async (url, response) => void saved.set(url, response),
    urls: () => [...saved.keys()],
  };
}

const offline: Fetcher = async () => {
  throw new TypeError('Failed to fetch');
};

describe('fetchCatalog', () => {
  it('saves a catalog it could read, and reads it back without a connection', async () => {
    const cache = memoryCache();
    const fetcher: Fetcher = async () => Response.json(catalogJson());
    const fetched = await fetchCatalog(CATALOG_URL, 'online', fetcher, cache);
    expect(fetched?.examples.map((item) => item.id)).toEqual(['rain']);
    expect(await fetchCatalog(CATALOG_URL, 'online', offline, cache)).toBeNull();
    expect((await readSavedCatalog(cache, CATALOG_URL))?.examples[0]?.id).toBe('rain');
  });

  it('answers null, not an error, when the server is unreachable or missing', async () => {
    expect(await fetchCatalog(CATALOG_URL, 'online', offline, memoryCache())).toBeNull();
    const missing: Fetcher = async () => new Response('Not found', { status: 404 });
    expect(await fetchCatalog(CATALOG_URL, 'online', missing, memoryCache())).toBeNull();
    expect(await readSavedCatalog(null, CATALOG_URL)).toBeNull();
  });

  it('keeps the last good catalog when the server sends one Studio cannot read', async () => {
    const cache = memoryCache();
    await fetchCatalog(CATALOG_URL, 'online', async () => Response.json(catalogJson()), cache);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: Fetcher = async () => Response.json({ version: 1, examples: [{ id: 'Bad ID' }] });
    expect(await fetchCatalog(CATALOG_URL, 'online', broken, cache)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect((await readSavedCatalog(cache, CATALOG_URL))?.examples[0]?.id).toBe('rain');
  });
});

describe('loadExampleBytes', () => {
  it('downloads once, then opens the saved copy without a connection', async () => {
    const cache = memoryCache();
    const fetcher = vi.fn<Fetcher>(async () => new Response(DOCUMENT));
    expect(await isExampleSaved(example(), cache)).toBe(false);
    expect(await loadExampleBytes(example(), fetcher, cache)).toEqual(DOCUMENT);
    expect(await isExampleSaved(example(), cache)).toBe(true);
    expect(await loadExampleBytes(example(), offline, cache)).toEqual(DOCUMENT);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('downloads again when the catalog names a newer version of the file', async () => {
    const cache = memoryCache();
    await loadExampleBytes(example(), async () => new Response(DOCUMENT), cache);
    const newer = example('b'.repeat(64));
    expect(await isExampleSaved(newer, cache)).toBe(false);
    await expect(loadExampleBytes(newer, offline, cache)).rejects.toThrow('once you are online');
  });

  it('refuses a download that does not match the catalog, and does not save it', async () => {
    const cache = memoryCache();
    const tampered: Fetcher = async () => new Response('something else');
    await expect(loadExampleBytes(example(), tampered, cache)).rejects.toThrow(
      'does not match the catalog',
    );
    expect(cache.urls()).toEqual([]);
  });

  it('works without any storage', async () => {
    expect(await loadExampleBytes(example(), async () => new Response(DOCUMENT), null)).toEqual(
      DOCUMENT,
    );
  });
});

describe('loadExampleAsset', () => {
  it('saves an online picture on first use and shows it offline afterwards', async () => {
    const cache = memoryCache();
    const url = example().thumbnailUrl;
    const picture: Fetcher = async () => new Response('picture bytes');
    expect(await (await loadExampleAsset(url, 'online', picture, cache))?.text()).toBe(
      'picture bytes',
    );
    expect(await (await loadExampleAsset(url, 'online', offline, cache))?.text()).toBe(
      'picture bytes',
    );
    expect(
      await loadExampleAsset('https://examples.test/v1/other.webp', 'online', offline, cache),
    ).toBeNull();
  });

  it('labels a video that the server sent as a generic download, also when read back saved', async () => {
    const cache = memoryCache();
    const url = 'https://examples.test/v1/rain/preview.mp4';
    const download: Fetcher = async () =>
      new Response('video bytes', { headers: { 'content-type': 'application/octet-stream' } });
    expect((await loadExampleAsset(url, 'online', download, cache))?.type).toBe('video/mp4');
    const saved = await loadExampleAsset(url, 'online', offline, cache);
    expect(saved?.type).toBe('video/mp4');
    expect(await saved?.text()).toBe('video bytes');
  });
});
