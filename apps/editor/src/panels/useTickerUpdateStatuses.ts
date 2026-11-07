import { useEffect, useState, type RefObject } from 'react';
import { getTickerUpdateStatuses, type TickerUpdateStatus } from '@ograf-editor/ograf-runtime';
import { subscribeTickerUpdates } from '../state/tickerUpdateStatus';

/** Observe the mounted output, including an adopted preview in another window. */
export function useTickerUpdateStatuses(
  target: HTMLElement | RefObject<HTMLElement | null> | null,
  session?: unknown,
): TickerUpdateStatus[] {
  const [statuses, setStatuses] = useState<TickerUpdateStatus[]>([]);
  useEffect(() => {
    const root = target && 'current' in target ? target.current : target;
    if (!root) {
      setStatuses([]);
      return;
    }
    return subscribeTickerUpdates(root, () => getTickerUpdateStatuses(root), setStatuses);
  }, [target, session]);
  return statuses;
}
