import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoordinatedPlayoutSnapshot, ReturnPayload } from '@ograf-editor/ograf-types';
import type { TransitionLogicDefinition } from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import { useDockPaneVisible } from '../layout/PaneVisibilityContext';
import type { ProjectSetDocument } from '../state/projectSet';
import {
  createCoordinatedPreviewRuntime,
  runCoordinatedPreviewCommand,
  type CoordinatedPreviewRuntime,
} from '../state/coordinatedPreviewRuntime';
import { CoordinatedPreviewSurface } from './CoordinatedPreviewSurface';
import { PlayoutOperatorControls, type PlayoutOperatorCommand } from './PlayoutOperatorControls';
import './CoordinatedDraftPreview.css';

interface ReplaySession {
  abort: AbortController;
  cancelled: boolean;
  runtime: CoordinatedPreviewRuntime | null;
  target: number | null;
  running: boolean;
}
interface DraftPreviewSession {
  abort: AbortController;
  disposed: boolean;
  source: ProjectSetDocument;
  live: CoordinatedPreviewRuntime | null;
  replay: ReplaySession | null;
}
function assertResult(result: ReturnPayload | undefined) {
  if (result && result.statusCode >= 400)
    throw new Error(result.statusMessage || 'Draft preview operation failed.');
}

/** Isolated draft preview and recorded replay both use the same coordinator as exported packages. */
export function CoordinatedDraftPreview({
  projectSet,
  definition,
}: {
  projectSet: ProjectSetDocument;
  definition: TransitionLogicDefinition;
}) {
  const { document: ownerDocument } = useEditorWindow();
  const visible = useDockPaneVisible();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const sourceKey = useMemo(
    () => JSON.stringify({ ...projectSet, transitionLogic: definition }),
    [projectSet, definition],
  );
  const sessionRef = useRef<DraftPreviewSession | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const [runtime, setRuntime] = useState<CoordinatedPreviewRuntime | null>(null);
  const [snapshot, setSnapshot] = useState<CoordinatedPlayoutSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reset, setReset] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [replayFrame, setReplayFrame] = useState(0);
  const [replayMax, setReplayMax] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const attach = useCallback((container: HTMLElement) => {
    viewportRef.current = container;
    const current = sessionRef.current;
    (current?.replay?.runtime ?? current?.live)?.attach(container);
    return () => {
      if (viewportRef.current === container) viewportRef.current = null;
      sessionRef.current?.live?.park();
      sessionRef.current?.replay?.runtime?.park();
    };
  }, []);

  useEffect(() => {
    const session: DraftPreviewSession = {
      abort: new AbortController(),
      disposed: false,
      source: JSON.parse(sourceKey) as ProjectSetDocument,
      live: null,
      replay: null,
    };
    sessionRef.current = session;
    setLoading(true);
    setRuntime(null);
    setSnapshot(null);
    setError('');
    setReviewing(false);
    setSeeking(false);
    setReplayMax(0);
    setReplayFrame(0);
    let unsubscribe: (() => void) | undefined;
    void createCoordinatedPreviewRuntime(session.source, {
      document: ownerDocument,
      signal: session.abort.signal,
    })
      .then((created) => {
        if (session.disposed) {
          void created.dispose();
          return;
        }
        session.live = created;
        if (viewportRef.current) created.attach(viewportRef.current);
        unsubscribe = created.graphic.subscribePlayout((next) => {
          if (session.disposed || session.replay) return;
          setSnapshot(next);
          setReplayMax(next.frame);
        });
        if (!visibleRef.current) created.graphic.pausePlayout();
        setRuntime(created);
        setLoading(false);
      })
      .catch((cause) => {
        if (!session.disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      });
    return () => {
      session.disposed = true;
      session.abort.abort();
      unsubscribe?.();
      if (session.replay) {
        session.replay.cancelled = true;
        session.replay.abort.abort();
        void session.replay.runtime?.dispose();
      }
      void session.live?.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [sourceKey, ownerDocument, reset]);

  useEffect(() => {
    if (!visible) sessionRef.current?.live?.graphic.pausePlayout();
  }, [visible]);

  const command = useCallback(async (operation: PlayoutOperatorCommand) => {
    const session = sessionRef.current;
    if (!session?.live || session.disposed || session.replay)
      throw new Error('Return to draft preview before sending a command.');
    if (['take', 'update', 'out'].includes(operation.type)) session.live.graphic.resumePlayout();
    await runCoordinatedPreviewCommand(session.live, operation);
  }, []);

  const returnDraft = () => {
    const session = sessionRef.current;
    if (!session?.live) return;
    if (session.replay) {
      session.replay.cancelled = true;
      session.replay.abort.abort();
      void session.replay.runtime?.dispose();
      session.replay = null;
    }
    if (viewportRef.current) session.live.attach(viewportRef.current);
    session.live.graphic.resumePlayout();
    setSnapshot(session.live.graphic.getPlayoutSnapshot());
    setReviewing(false);
    setSeeking(false);
    setError('');
  };

  const seek = (frame: number) => {
    const session = sessionRef.current;
    if (!session?.live || session.disposed) return;
    if (!session.replay) {
      session.live.graphic.pausePlayout();
      session.replay = {
        abort: new AbortController(),
        cancelled: false,
        runtime: null,
        target: frame,
        running: false,
      };
      setReplayMax(session.live.graphic.getPlayoutSnapshot().frame);
    }
    const replay = session.replay;
    replay.target = frame;
    setReviewing(true);
    setReplayFrame(frame);
    setError('');
    setSeeking(true);
    if (replay.running) return;
    replay.running = true;
    void (async () => {
      try {
        if (!replay.runtime) {
          const recorded = session.live!.graphic.getRecordedActions();
          const epoch = session.live!.graphic.getPlayoutSnapshot().clockEpochMs;
          const created = await createCoordinatedPreviewRuntime(session.source, {
            document: ownerDocument,
            renderType: 'non-realtime',
            signal: replay.abort.signal,
            ...(epoch === null ? {} : { replayClockEpochMs: epoch }),
          });
          if (session.disposed || replay.cancelled) {
            await created.dispose();
            return;
          }
          replay.runtime = created;
          assertResult(await created.graphic.setActionsSchedule({ schedule: recorded }));
        }
        while (!session.disposed && !replay.cancelled && replay.target !== null) {
          const target = replay.target;
          replay.target = null;
          assertResult(
            await replay.runtime.graphic.goToTime({
              timestamp: (target * 1000) / replay.runtime.descriptor.frameRate,
            }),
          );
          if (session.disposed || replay.cancelled) return;
          if (viewportRef.current) {
            session.live!.park();
            replay.runtime.attach(viewportRef.current);
          }
          setSnapshot(replay.runtime.graphic.getPlayoutSnapshot());
        }
      } catch (cause) {
        if (!session.disposed && !replay.cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        replay.running = false;
        if (!session.disposed && !replay.cancelled) setSeeking(false);
      }
    })();
  };
  const toggle = () => {
    if (reviewing) {
      returnDraft();
      return;
    }
    const graphic = sessionRef.current?.live?.graphic;
    if (!graphic) return;
    if (graphic.getPlayoutSnapshot().paused) graphic.resumePlayout();
    else graphic.pausePlayout();
  };
  const controls = runtime ? (
    <PlayoutOperatorControls
      key={`${reset}-${runtime.descriptor.id}`}
      definition={runtime.definition}
      templates={runtime.templates}
      snapshot={snapshot}
      onCommand={command}
      disabled={reviewing || loading}
    />
  ) : null;
  return (
    <section className="coordinated-draft-preview" aria-label="Playout transitions draft preview">
      <div className="coordinated-draft-preview-heading">
        <strong>{reviewing ? 'Recorded preview' : 'Draft preview'}</strong>
        <span>
          {runtime
            ? `${runtime.descriptor.width} × ${runtime.descriptor.height} · ${runtime.descriptor.frameRate} fps`
            : 'Coordinated runtime'}
        </span>
      </div>
      <CoordinatedPreviewSurface
        width={runtime?.descriptor.width ?? 1920}
        height={runtime?.descriptor.height ?? 1080}
        attach={attach}
        controls={controls}
        registerPresentation
        emptyMessage={
          loading
            ? 'Loading draft preview…'
            : !runtime
              ? 'Draft preview is not available.'
              : undefined
        }
      />
      <div className="coordinated-draft-preview-transport">
        <button type="button" disabled={!runtime} onClick={toggle}>
          {reviewing ? 'Return to draft' : snapshot?.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          disabled={!runtime || reviewing}
          onClick={() =>
            void command({ type: 'clear' }).catch((cause) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
          }
        >
          Clear all
        </button>
        <button type="button" onClick={() => setReset((value) => value + 1)}>
          Reset preview
        </button>
        <output>
          {Math.round(reviewing ? replayFrame : (snapshot?.frame ?? 0))}f
          {reviewing ? ' · Recorded preview' : ''}
          {seeking ? ' · Seeking…' : ''}
        </output>
        <label>
          Recorded preview{' '}
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(replayMax))}
            step={1}
            value={Math.min(
              Math.floor(reviewing ? replayFrame : (snapshot?.frame ?? 0)),
              Math.floor(replayMax),
            )}
            disabled={!runtime || replayMax === 0 || snapshot?.recordingTruncated}
            onChange={(event) => seek(Number(event.target.value))}
          />
        </label>
      </div>
      {(error || snapshot?.error) && (
        <p className="coordinated-draft-preview-error" role="alert">
          {error || snapshot?.error}
        </p>
      )}
      <p className="coordinated-draft-preview-note">
        Editing the draft resets this preview. Pause and Recorded preview inspect recorded takes.
      </p>
      {snapshot?.recordingTruncated && (
        <p className="coordinated-draft-preview-error">
          Recording is full. Reset preview to record a new sequence.
        </p>
      )}
    </section>
  );
}
