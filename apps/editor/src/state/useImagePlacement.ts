import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import type { ImagePlacement } from './imageImport';

export function useImagePlacement() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  const place = async (source: File[] | { assetId: string }, options: ImagePlacement = {}) => {
    if (pending.current) return false;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const ids = await useProjectStore
        .getState()
        .placeImageSource(source, { ...options, signal: controller.signal });
      if (!ids.length || controller.signal.aborted) return false;
      useSelectionStore.getState().selectMany(ids);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return { place, busy, error, clearError: () => setError('') };
}
