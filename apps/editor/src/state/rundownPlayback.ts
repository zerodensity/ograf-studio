import type { FieldValue } from '@ograf-editor/scene-model';

export interface RundownPlaybackPort {
  prepare: (data: Record<string, FieldValue>) => Promise<void>;
  take: () => Promise<void>;
  update: (data: Record<string, FieldValue>) => Promise<void>;
  out: () => Promise<void>;
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Stopped', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Serialize through the real preview transport; rows are never baked into the exported graphic. */
export async function playRundown(
  rows: Array<Record<string, FieldValue>>,
  port: RundownPlaybackPort,
  options: { holdMs: number; signal: AbortSignal; onRow: (index: number) => void },
): Promise<void> {
  if (!rows.length) throw new Error('The rundown has no rows.');
  if (options.signal.aborted) throw new DOMException('Stopped', 'AbortError');
  options.onRow(0);
  await port.prepare(rows[0]!);
  if (options.signal.aborted) throw new DOMException('Stopped', 'AbortError');
  await port.take();
  try {
    for (let index = 1; index < rows.length; index++) {
      await pause(options.holdMs, options.signal);
      options.onRow(index);
      await port.update(rows[index]!);
    }
    await pause(options.holdMs, options.signal);
  } finally {
    await port.out();
  }
}
