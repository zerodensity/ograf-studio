import type { CustomActionParams, ReturnPayload } from '@ograf-editor/ograf-types';
import type { stageSchedule } from './transitionsDesign';

type StageSchedule = ReturnType<typeof stageSchedule>;
type StageGraphic = {
  customAction(params: CustomActionParams): Promise<ReturnPayload | undefined>;
};

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Play the same timestamped actions as deterministic scrubbing without rebuilding each frame. */
export async function playTransitionStageSchedule({
  graphic,
  schedule,
  durationMs,
  signal,
  onStart,
}: {
  graphic: StageGraphic;
  schedule: StageSchedule;
  durationMs: number;
  signal: AbortSignal;
  onStart: (startedAt: number) => void;
}): Promise<void> {
  if (signal.aborted) return;
  let stopped: () => void = () => undefined;
  const cancelled = new Promise<void>((resolve) => {
    stopped = resolve;
    signal.addEventListener('abort', stopped, { once: true });
  });
  let fail: (cause: unknown) => void = () => undefined;
  const failure = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  // An action can fail between two scheduled timestamps. Always observe that rejection.
  void failure.catch(() => undefined);
  const checked = async (params: CustomActionParams) => {
    const result = await graphic.customAction(params);
    if (result && result.statusCode >= 400)
      throw new Error(result.statusMessage || 'The preview could not play this transition.');
  };
  const guarded = (operation: Promise<void>) => Promise.race([operation, cancelled, failure]);
  try {
    await guarded(checked({ id: 'transition.clear', payload: {} }));
    const ordered = schedule
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.timestamp - b.entry.timestamp || a.index - b.index)
      .map(({ entry }) => entry);
    for (const entry of ordered.filter((entry) => entry.timestamp === 0)) {
      if (signal.aborted) return;
      // Settle context templates before starting the clock; resource loading is not motion.
      await guarded(checked(entry.action.params));
    }
    if (signal.aborted) return;
    const startedAt = performance.now();
    onStart(startedAt);
    const pending: Promise<void>[] = [];
    for (const entry of ordered.filter((entry) => entry.timestamp > 0)) {
      await guarded(wait(entry.timestamp - (performance.now() - startedAt), signal));
      if (signal.aborted) return;
      // Actions on different slots may overlap, but each keeps its authored timestamp.
      const action = checked(entry.action.params);
      void action.catch(fail);
      pending.push(action);
    }
    await guarded(wait(durationMs - (performance.now() - startedAt), signal));
    if (signal.aborted) return;
    // A slow preparation must not make a resize/restore disappear at the end of the preview.
    await guarded(Promise.all(pending).then(() => undefined));
  } finally {
    signal.removeEventListener('abort', stopped);
  }
}
