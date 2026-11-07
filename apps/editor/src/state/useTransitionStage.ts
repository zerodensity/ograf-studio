import { useCallback, useEffect, useRef, useState } from 'react';
import { suppressBrowserContextMenu } from './browserContextMenu';
import {
  createCoordinatedPreviewRuntime,
  type CoordinatedPreviewRuntime,
} from './coordinatedPreviewRuntime';
import type { ProjectSetDocument } from './projectSet';
import type { stageSchedule } from './transitionsDesign';
import { playTransitionStageSchedule } from './transitionStagePlayback';

export interface TransitionStageRequest {
  /** The set to compile, with the edited Transition Logic definition in place. */
  source: ProjectSetDocument;
  schedule: ReturnType<typeof stageSchedule>;
  /** Scrubbable length, in frames from the schedule's start. */
  totalFrames: number;
  frameRate: number;
  /** Frame shown when the request changes, e.g. the settled end of a make-room view. */
  initialFrame?: number;
}

export interface TransitionStage {
  /** Attach to the element the scaled output fills. */
  viewportRef: (element: HTMLDivElement | null) => void;
  frame: number;
  totalFrames: number;
  playing: boolean;
  loop: boolean;
  loading: boolean;
  error: string;
  seek: (frame: number) => void;
  play: () => void;
  pause: () => void;
  setLoop: (loop: boolean) => void;
}

const REBUILD_DELAY_MS = 220;
const LOOP_HOLD_MS = 700;

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function delay(ms: number, token: { cancelled: boolean }) {
  return new Promise<void>((resolve) => {
    const started = performance.now();
    const check = () => {
      if (token.cancelled || performance.now() - started >= ms) resolve();
      else window.setTimeout(check, Math.min(50, ms));
    };
    check();
  });
}

/**
 * Preview of one transition with two runtimes built from the same exported module. Scrubbing and
 * pausing use a non-real-time runtime that replays the schedule to the exact frame (goToTime) and
 * always shows the latest requested frame. Play uses a real-time runtime that runs the takes as
 * playout does, so shaders and media animate smoothly instead of being rebuilt every frame.
 */
export function useTransitionStage(request: TransitionStageRequest | null): TransitionStage {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [scrubRuntime, setScrubRuntime] = useState<CoordinatedPreviewRuntime | null>(null);
  const [liveRuntime, setLiveRuntime] = useState<CoordinatedPreviewRuntime | null>(null);
  const [showing, setShowing] = useState<'scrub' | 'live'>('scrub');
  const [frame, setFrame] = useState(request?.initialFrame ?? 0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const wanted = useRef(frame);
  const handover = useRef(0);
  const rendered = useRef<number | null>(null);
  const busy = useRef<{ runtime: CoordinatedPreviewRuntime; generation: number } | null>(null);
  const scrubGeneration = useRef(0);
  const scheduleReady = useRef(false);
  const requestRef = useRef(request);
  requestRef.current = request;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const source = request?.source ?? null;
  const scheduleKey = request ? JSON.stringify(request.schedule) : '';
  const totalFrames = request?.totalFrames ?? 0;

  // Rebuild the scrubbing runtime when the compiled source changes; editing timing does this
  // too. The previous output stays on screen until its replacement is ready.
  const scrubActive = useRef<CoordinatedPreviewRuntime | null>(null);
  const scrubSource = useRef<ProjectSetDocument | null>(null);
  const scrubScheduleKey = useRef('');
  const liveActive = useRef<{ runtime: CoordinatedPreviewRuntime; source: ProjectSetDocument }>(
    null,
  );
  useEffect(() => {
    if (!source) return;
    setLoading(true);
    setError('');
    scheduleReady.current = false;
    ++scrubGeneration.current;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      createCoordinatedPreviewRuntime(source, {
        renderType: 'non-realtime',
        replayClockEpochMs: Date.now(),
        signal: abort.signal,
      })
        .then(async (next) => {
          try {
            // Prepare the replacement while parked. Never seek the previous source with
            // a frame requested for a newly edited recipe: that produces a false resize.
            let loadedSchedule = '';
            let target: number;
            do {
              const current = requestRef.current;
              if (abort.signal.aborted || current?.source !== source) {
                void next.dispose();
                return;
              }
              const key = JSON.stringify(current.schedule);
              if (loadedSchedule !== key) {
                const result = await next.graphic.setActionsSchedule({
                  schedule: current.schedule as never,
                });
                if (result.statusCode >= 400)
                  throw new Error(
                    result.statusMessage || 'The preview could not load this transition.',
                  );
                loadedSchedule = key;
              }
              target = wanted.current;
              const result = await next.graphic.goToTime({
                timestamp: (target * 1000) / current.frameRate,
              });
              if (result.statusCode >= 400)
                throw new Error(result.statusMessage || 'The preview could not show this frame.');
            } while (
              !abort.signal.aborted &&
              requestRef.current?.source === source &&
              (target !== wanted.current ||
                loadedSchedule !== JSON.stringify(requestRef.current.schedule))
            );
            if (abort.signal.aborted || requestRef.current?.source !== source) {
              void next.dispose();
              return;
            }
            const previous = scrubActive.current;
            scrubActive.current = next;
            scrubSource.current = source;
            scrubScheduleKey.current = loadedSchedule;
            scheduleReady.current = true;
            rendered.current = target;
            setScrubRuntime(next);
            if (previous) void previous.dispose();
          } catch (cause) {
            void next.dispose();
            throw cause;
          }
        })
        .catch((cause) => {
          if (!abort.signal.aborted) setError(message(cause));
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, REBUILD_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [source]);
  useEffect(
    () => () => {
      void scrubActive.current?.dispose();
      scrubActive.current = null;
      scrubSource.current = null;
      void liveActive.current?.runtime.dispose();
      liveActive.current = null;
    },
    [],
  );

  const pump = useCallback(async () => {
    const runtime = scrubActive.current;
    const generation = scrubGeneration.current;
    if (
      !runtime ||
      scrubSource.current !== requestRef.current?.source ||
      !scheduleReady.current ||
      (busy.current?.runtime === runtime && busy.current.generation === generation)
    )
      return;
    const operation = { runtime, generation };
    busy.current = operation;
    try {
      while (
        scrubActive.current === runtime &&
        scrubSource.current === requestRef.current?.source &&
        scrubGeneration.current === generation &&
        rendered.current !== wanted.current
      ) {
        const target = wanted.current;
        const result = await runtime.graphic.goToTime({
          timestamp: (target * 1000) / (requestRef.current?.frameRate ?? 50),
        });
        if (result.statusCode >= 400)
          throw new Error(result.statusMessage || 'The preview could not show this frame.');
        if (
          scrubActive.current === runtime &&
          scrubSource.current === requestRef.current?.source &&
          scrubGeneration.current === generation
        )
          rendered.current = target;
      }
    } catch (cause) {
      if (
        scrubActive.current === runtime &&
        scrubSource.current === requestRef.current?.source &&
        scrubGeneration.current === generation
      )
        setError(message(cause));
    } finally {
      if (busy.current === operation) busy.current = null;
    }
  }, []);

  // Load the schedule into the scrubbing runtime, then show the current frame.
  useEffect(() => {
    const current = requestRef.current;
    if (!scrubRuntime || !current || scrubSource.current !== current.source) return;
    if (scrubScheduleKey.current === scheduleKey && scheduleReady.current) {
      void pump();
      return;
    }
    let cancelled = false;
    ++scrubGeneration.current;
    scheduleReady.current = false;
    rendered.current = null;
    void scrubRuntime.graphic
      .setActionsSchedule({ schedule: current.schedule as never })
      .then((result) => {
        if (cancelled) return;
        if (result.statusCode >= 400) {
          setError(result.statusMessage || 'The preview could not load this transition.');
          return;
        }
        scheduleReady.current = true;
        scrubScheduleKey.current = scheduleKey;
        void pump();
      })
      .catch((cause) => {
        if (!cancelled) setError(message(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [scrubRuntime, source, scheduleKey, pump]);

  // A new transition starts paused at its own first frame (or the frame it asks for).
  useEffect(() => {
    const current = requestRef.current;
    const start = Math.max(0, Math.min(current?.totalFrames ?? 0, current?.initialFrame ?? 0));
    wanted.current = start;
    setFrame(start);
    setPlaying(false);
    void pump();
  }, [scheduleKey, request?.initialFrame, pump]);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(totalFrames, wanted.current));
    if (wanted.current !== clamped) {
      wanted.current = clamped;
      setFrame(clamped);
      void pump();
    }
  }, [totalFrames, pump]);

  const seek = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(totalFrames, next));
      wanted.current = clamped;
      setFrame(clamped);
      setPlaying(false);
      void pump();
    },
    [pump, totalFrames],
  );

  // Play: run the schedule's takes on the real-time runtime, looping until paused.
  useEffect(() => {
    if (!playing || !source) return;
    const token = { cancelled: false };
    const abort = new AbortController();
    const owner = viewport?.ownerDocument.defaultView ?? window;
    let ticker = 0;
    const run = async () => {
      let live = liveActive.current;
      if (!live || live.source !== source) {
        setLoading(true);
        void live?.runtime.dispose();
        liveActive.current = null;
        const runtime = await createCoordinatedPreviewRuntime(source, { renderType: 'realtime' });
        if (token.cancelled) {
          void runtime.dispose();
          return;
        }
        live = { runtime, source };
        liveActive.current = live;
        setLoading(false);
      }
      const { graphic } = live.runtime;
      const liveRuntime = live.runtime;
      graphic.resumePlayout();
      do {
        const current = requestRef.current;
        if (!current) return;
        const { frameRate, schedule } = current;
        const total = current.totalFrames;
        await playTransitionStageSchedule({
          graphic,
          schedule,
          durationMs: (total * 1000) / frameRate,
          signal: abort.signal,
          onStart: (started) => {
            if (!token.cancelled) {
              setLiveRuntime(liveRuntime);
              setShowing('live');
            }
            wanted.current = 0;
            setFrame(0);
            const tick = () => {
              if (token.cancelled) return;
              const next = ((performance.now() - started) / 1000) * frameRate;
              wanted.current = Math.min(total, next);
              setFrame(Math.round(Math.min(total, next) * 2) / 2);
              if (next < total) ticker = owner.requestAnimationFrame(tick);
            };
            ticker = owner.requestAnimationFrame(tick);
          },
        });
        if (token.cancelled) return;
        owner.cancelAnimationFrame(ticker);
        wanted.current = total;
        setFrame(total);
        if (!loopRef.current) break;
        await delay(LOOP_HOLD_MS, token);
      } while (!token.cancelled);
      if (!token.cancelled) setPlaying(false);
    };
    run().catch((cause) => {
      if (token.cancelled) return;
      setError(message(cause));
      setLoading(false);
      setPlaying(false);
    });
    return () => {
      token.cancelled = true;
      abort.abort();
      owner.cancelAnimationFrame(ticker);
      try {
        liveActive.current?.runtime.graphic.pausePlayout();
      } catch {
        // A runtime that failed to load has nothing to pause.
      }
      const generation = ++handover.current;
      void pump().then(() => {
        if (handover.current === generation) setShowing('scrub');
      });
    };
  }, [playing, source, viewport, pump]);

  // Attach the runtime being shown and keep it scaled to the viewport's width. The output lives
  // in its own document, as in playout: layout reads inside the graphic then measure only the
  // graphic instead of the whole Studio page, which made every text layer ~15x slower.
  const shown = showing === 'live' && liveRuntime ? liveRuntime : scrubRuntime;
  useEffect(() => {
    if (!shown || !viewport) return;
    let frame = viewport.querySelector<HTMLIFrameElement>('iframe.transitions-stage-document');
    if (!frame) {
      frame = viewport.ownerDocument.createElement('iframe');
      frame.className = 'transitions-stage-document';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      viewport.replaceChildren(frame);
    }
    const inner = frame.contentDocument!;
    const restoreBrowserContextMenu = suppressBrowserContextMenu(inner);
    inner.documentElement.style.background = 'transparent';
    inner.body.style.cssText = 'margin:0;overflow:hidden;background:transparent';
    const host = inner.createElement('div');
    host.className = 'transitions-stage-output';
    const { width, height } = shown.descriptor;
    host.style.cssText = `position:absolute;left:0;top:0;transform-origin:0 0;width:${width}px;height:${height}px`;
    inner.body.replaceChildren(host);
    shown.attach(host);
    const fit = () => {
      host.style.transform = `scale(${viewport.clientWidth / width})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      restoreBrowserContextMenu();
      shown.park();
      host.remove();
    };
  }, [shown, viewport]);

  return {
    viewportRef: setViewport,
    frame,
    totalFrames,
    playing,
    loop,
    loading: loading || (!!source && scrubSource.current !== source && !error),
    error,
    seek,
    play: () => {
      setError('');
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    setLoop,
  };
}
