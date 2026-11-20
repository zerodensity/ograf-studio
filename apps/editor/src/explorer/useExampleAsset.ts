import { useEffect, useState } from 'react';
import type { ExampleSource } from './exampleCatalog';
import { loadExampleAsset } from './exampleCatalogClient';
import { exampleFileCache } from './exampleCatalogStore';

/**
 * A URL the page can show for an example's picture or preview video, or `null` while it loads and
 * when it is neither saved nor reachable. Files shipped with Studio are used where they are.
 */
export function useExampleAsset(url: string | null, source: ExampleSource): string | null {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    if (source === 'builtin') {
      setShown(url);
      return () => setShown(null);
    }
    let active = true;
    let objectUrl: string | null = null;
    void exampleFileCache()
      .then((cache) => loadExampleAsset(url, source, (input, init) => fetch(input, init), cache))
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setShown(objectUrl);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setShown(null);
    };
  }, [url, source]);
  return shown;
}
