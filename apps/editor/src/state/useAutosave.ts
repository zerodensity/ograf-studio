import { useEffect, useRef } from 'react';
import { useProjectStore } from './projectStore';
import { saveAutosave } from './fileIO';

export function useAutosave(delayMs = 500): void {
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state) => {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => saveAutosave(state.project), delayMs);
    });
    return () => {
      window.clearTimeout(timeoutRef.current);
      unsubscribe();
    };
  }, [delayMs]);
}
