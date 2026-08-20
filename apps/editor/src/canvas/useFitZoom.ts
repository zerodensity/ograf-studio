import { useEffect, useState, type RefObject } from 'react';

/** Computes a scale factor that fits `contentWidth`x`contentHeight` inside the given container, capped at 1x. */
export function useFitZoom(
  containerRef: RefObject<HTMLElement | null>,
  contentWidth: number,
  contentHeight: number,
  padding = 40,
): number {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const availableWidth = el.clientWidth - padding * 2;
      const availableHeight = el.clientHeight - padding * 2;
      if (availableWidth <= 0 || availableHeight <= 0) return;
      const scale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1);
      setZoom(scale > 0 ? scale : 1);
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, contentWidth, contentHeight, padding]);

  return zoom;
}
