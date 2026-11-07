import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FieldValue } from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import { useFitZoom } from '../canvas/useFitZoom';
import { transparencyCheckerboardStyle } from '../canvas/compositionBackground';
import { useProjectStore } from '../state/projectStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { templatePreviewDocumentSnapshot } from '../state/presenterDocument';
import { openStudioDocument } from '../state/openStudioDocument';
import {
  enterPreviewFullscreen,
  exitPreviewFullscreen,
  isPreviewPresented,
} from '../state/previewPresentation';
import { registerPreviewPresentation } from '../state/previewPresentationStore';
import {
  attachPresenterViewport,
  loadPresenter,
  navigatePresenter,
  stopPresenter,
  unloadPresenter,
  updatePresenterData,
  presenterNextStep,
  presenterPreviousStep,
  usePresenterStore,
} from '../state/presenterStore';
import { Panel } from './Panel';
import { PreviewDataFields } from './PreviewDataFields';
import { usePreviewControlsInteraction } from './usePreviewControlsInteraction';
import { usePreviewControlsPosition } from './usePreviewControlsPosition';
import './PresenterPanel.css';

/** A compact browser for the open document's templates, using the native preview runtime. */
export function PresenterPanel() {
  const { document: ownerDocument, window: ownerWindow } = useEditorWindow();
  const project = useProjectStore((state) => state.project);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const source = useMemo(
    () => templatePreviewDocumentSnapshot(project, projectSet, activeTemplateId),
    [project, projectSet, activeTemplateId],
  );
  const live = usePresenterStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [showData, setShowData] = useState(false);
  const controlsPosition = usePreviewControlsPosition(viewportRef, dataRef, fullscreen && showData);
  usePreviewControlsInteraction(viewportRef, dataRef, fullscreen && showData, (event) => {
    viewportRef.current?.focus({ preventScroll: true });
    controlsPosition.openAt(event.clientX, event.clientY);
    setShowData(true);
  });
  const [localError, setLocalError] = useState('');
  const [dataError, setDataError] = useState('');
  const [dataDraft, setDataDraft] = useState<Record<string, FieldValue>>({});
  const [pendingData, setPendingData] = useState<{
    sessionId: string;
    entryId: string;
    values: Record<string, FieldValue>;
  } | null>(null);
  const pendingRef = useRef(pendingData);
  pendingRef.current = pendingData;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const zoom = useFitZoom(measureRef, live.width || 1920, live.height || 1080, 0, Infinity);
  const busy = live.loading || live.busy;
  const entries = source.entries.filter((entry) => entry.available);
  const currentIndex =
    live.sourceId === source.id
      ? entries.findIndex((entry) => entry.id === live.selectedEntryId)
      : -1;
  const changed = Boolean(live.sessionId && (live.sourceChanged || live.sourceId !== source.id));
  const run = useCallback((action: () => Promise<unknown> | unknown) => {
    setLocalError('');
    try {
      void Promise.resolve(action()).catch((cause) =>
        setLocalError(cause instanceof Error ? cause.message : String(cause)),
      );
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  const reveal = useCallback(() => {
    setQuiet(false);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setQuiet(true), 2200);
  }, []);
  const flushData = useCallback(async () => {
    const pending = pendingRef.current;
    const state = usePresenterStore.getState();
    if (
      !pending ||
      pending.sessionId !== state.sessionId ||
      pending.entryId !== state.selectedEntryId
    )
      return;
    pendingRef.current = null;
    setPendingData(null);
    setDataError('');
    try {
      await updatePresenterData(pending.values);
    } catch (cause) {
      setDataError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, []);
  const take = useCallback(
    async (entryId?: string, refresh = false) => {
      await flushData();
      const document = sourceRef.current;
      const state = usePresenterStore.getState();
      const entries = document.entries.filter((entry) => entry.available);
      const activeId = document.projectSet?.activeTemplateId ?? document.project.id;
      const selected =
        entries.find((entry) => entry.id === entryId) ??
        entries.find((entry) => entry.id === state.selectedEntryId) ??
        entries.find((entry) => entry.templateId === activeId) ??
        entries[0];
      if (!selected) throw new Error('Open a template or template set to preview it.');
      if (!state.sessionId || state.sourceId !== document.id || state.sourceChanged || refresh)
        await loadPresenter(document);
      await navigatePresenter(selected.id);
    },
    [flushData],
  );
  const step = useCallback(
    async (delta: -1 | 1) => {
      await flushData();
      await (delta > 0 ? presenterNextStep() : presenterPreviousStep());
    },
    [flushData],
  );
  const move = useCallback(
    async (delta: -1 | 1) => {
      const state = usePresenterStore.getState();
      const available = sourceRef.current.entries.filter((entry) => entry.available);
      const index =
        state.sourceId === sourceRef.current.id
          ? available.findIndex((entry) => entry.id === state.selectedEntryId)
          : -1;
      const next = index < 0 ? available[0] : available[index + delta];
      if (next) await take(next.id);
    },
    [take],
  );
  const enter = useCallback(async () => {
    const viewport = viewportRef.current;
    if (!viewport) throw new Error('Open Preview & Export first.');
    await enterPreviewFullscreen(viewport);
    reveal();
    const state = usePresenterStore.getState();
    if (!state.onAir || state.sourceId !== sourceRef.current.id) await take();
  }, [reveal, take]);
  const toggleData = useCallback(() => {
    if (
      dataRef.current?.querySelector('.preview-popup-body')?.contains(ownerDocument.activeElement)
    )
      viewportRef.current?.focus({ preventScroll: true });
    setShowData((shown) => !shown);
  }, [ownerDocument]);
  useLayoutEffect(() => {
    if (stageRef.current) return attachPresenterViewport(stageRef.current);
  }, [ownerDocument]);
  useLayoutEffect(() => {
    if (viewportRef.current)
      return registerPreviewPresentation({ viewport: viewportRef.current, enter, ownerDocument });
  }, [ownerDocument, enter]);
  useEffect(() => {
    pendingRef.current = null;
    setPendingData(null);
    setDataError('');
    setDataDraft(structuredClone(usePresenterStore.getState().data));
  }, [live.sessionId, live.selectedEntryId]);
  useEffect(() => {
    if (!pendingRef.current) setDataDraft(structuredClone(live.data));
  }, [live.data]);
  // Coalesce edits while an update effect is running. Do not send a previous template's draft to a new one.
  useEffect(() => {
    if (!pendingData || busy || pendingData.entryId !== live.selectedEntryId) return;
    const timer = setTimeout(() => {
      const state = usePresenterStore.getState();
      if (
        pendingRef.current !== pendingData ||
        state.sessionId !== pendingData.sessionId ||
        state.selectedEntryId !== pendingData.entryId ||
        state.busy ||
        state.loading
      )
        return;
      pendingRef.current = null;
      setPendingData(null);
      setDataError('');
      void updatePresenterData(pendingData.values).catch((cause) => {
        const current = usePresenterStore.getState();
        if (
          current.sessionId === pendingData.sessionId &&
          current.selectedEntryId === pendingData.entryId
        )
          setDataError(cause instanceof Error ? cause.message : String(cause));
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [pendingData, busy, live.onAir, live.selectedEntryId]);
  useEffect(() => {
    const viewport = viewportRef.current;
    const changed = () => {
      setFullscreen(isPreviewPresented(viewport));
      reveal();
    };
    changed();
    ownerDocument.addEventListener('fullscreenchange', changed);
    return () => {
      clearTimeout(hideTimer.current);
      ownerDocument.removeEventListener('fullscreenchange', changed);
      if (viewport && isPreviewPresented(viewport))
        void exitPreviewFullscreen(viewport).catch(() => undefined);
    };
  }, [ownerDocument, reveal]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const full = isPreviewPresented(viewportRef.current);
      if (
        (!full && !panelRef.current?.contains(target)) ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      if (target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))
        return;
      let action: (() => Promise<unknown> | unknown) | undefined;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') action = () => move(1);
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') action = () => move(-1);
      else if (event.key === ' ' && !target?.closest('button'))
        action = () => {
          const state = usePresenterStore.getState();
          return sourceRef.current.entries.length > 1
            ? move(1)
            : state.onAir && state.mode === 'independent'
              ? step(1)
              : take();
        };
      else if (event.key.toLowerCase() === 'f')
        action = () =>
          full && viewportRef.current ? exitPreviewFullscreen(viewportRef.current) : enter();
      else if (event.key.toLowerCase() === 'd' && full) action = toggleData;
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        reveal();
        const state = usePresenterStore.getState();
        if (!event.repeat && (event.key.toLowerCase() === 'd' || (!state.loading && !state.busy)))
          run(action);
      }
    };
    ownerDocument.addEventListener('keydown', keydown, true);
    return () => ownerDocument.removeEventListener('keydown', keydown, true);
  }, [ownerDocument, move, take, enter, reveal, run, toggleData, step]);
  const transport = (
    <div className="template-preview-transport">
      <button type="button" disabled={busy || !entries.length} onClick={() => run(() => take())}>
        Take In
      </button>
      <button
        type="button"
        disabled={busy || !live.onAir}
        onClick={() =>
          run(async () => {
            await flushData();
            await stopPresenter();
          })
        }
      >
        Take Out
      </button>
      {live.mode === 'independent' && live.onAir && (
        <>
          <button type="button" disabled={busy} onClick={() => run(() => step(-1))}>
            Previous step
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => step(1))}>
            Next step
          </button>
        </>
      )}
      {changed && (
        <button type="button" disabled={busy} onClick={() => run(() => take(undefined, true))}>
          Refresh preview
        </button>
      )}
    </div>
  );
  return (
    <Panel title="Preview">
      <div className="template-set-preview" ref={panelRef}>
        <div className="template-preview-heading">
          <strong title={source.name}>{source.name}</strong>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (await openStudioDocument(ownerWindow)) {
                  await unloadPresenter();
                  usePaneRequestStore.getState().reveal('export');
                }
              })
            }
          >
            Open .ogs…
          </button>
        </div>
        <div
          className={`template-preview-surface${quiet ? ' is-quiet' : ''}`}
          ref={viewportRef}
          tabIndex={0}
          aria-label="Template preview output. In fullscreen, right-click for controls at the pointer. D toggles controls; Escape exits."
          onPointerMove={reveal}
          onPointerDown={reveal}
          onMouseDown={(event) => {
            if (
              !(event.target as HTMLElement).closest(
                'button,input,textarea,select,[data-preview-controls]',
              )
            )
              event.currentTarget.focus({ preventScroll: true });
          }}
        >
          <div className="template-preview-fit" ref={measureRef}>
            <div
              className="template-preview-size"
              style={{ width: live.width * zoom, height: live.height * zoom }}
            >
              <div
                ref={stageRef}
                className="template-preview-stage"
                style={{
                  width: live.width,
                  height: live.height,
                  transform: `scale(${zoom})`,
                  ...transparencyCheckerboardStyle(zoom),
                }}
              />
            </div>
          </div>
          {(!live.sessionId || (!live.onAir && !live.busy)) && (
            <div className="template-preview-empty">
              <span>
                {live.loading
                  ? 'Loading preview…'
                  : entries.length
                    ? 'Choose a template or Take In to preview.'
                    : 'Open a template or template set.'}
              </span>
            </div>
          )}
          <nav
            className="template-preview-navigation"
            aria-label="Template navigation"
            data-preview-controls
          >
            <button
              type="button"
              aria-label="Previous template"
              title="Previous template (Left arrow)"
              disabled={busy || currentIndex <= 0}
              onClick={() => run(() => move(-1))}
            >
              ←
            </button>
            <select
              aria-label="Preview template"
              disabled={busy || !entries.length}
              value={currentIndex < 0 ? '' : entries[currentIndex]!.id}
              onChange={(event) => run(() => take(event.target.value))}
            >
              <option value="" disabled>
                Choose template…
              </option>
              {entries.map((entry, index) => (
                <option key={entry.id} value={entry.id}>
                  {index + 1}. {entry.title}
                </option>
              ))}
            </select>
            <span className="template-preview-count">
              {currentIndex < 0 ? '—' : currentIndex + 1}/{entries.length}
            </span>
            <button
              type="button"
              aria-label="Next template"
              title="Next template (Right arrow)"
              disabled={busy || !entries.length || currentIndex >= entries.length - 1}
              onClick={() => run(() => move(1))}
            >
              →
            </button>
            {!fullscreen && (
              <button
                type="button"
                aria-label="Preview fullscreen"
                onClick={() => run(() => enter())}
              >
                Fullscreen
              </button>
            )}
          </nav>
          <aside
            ref={dataRef}
            className="template-preview-data"
            style={controlsPosition.style}
            aria-label="Preview data controls"
            data-preview-controls
            hidden={fullscreen && !showData}
          >
            <div className="preview-popup-body">
              {transport}
              {live.fields.length > 0 ? (
                <fieldset disabled={live.loading}>
                  <PreviewDataFields
                    fields={live.fields}
                    values={dataDraft}
                    onChange={(key, value) => {
                      const values = { ...dataDraft, [key]: value };
                      setDataDraft(values);
                      if (live.selectedEntryId && live.sessionId) {
                        const pending = {
                          sessionId: live.sessionId,
                          entryId: live.selectedEntryId,
                          values,
                        };
                        pendingRef.current = pending;
                        setPendingData(pending);
                      }
                    }}
                  />
                </fieldset>
              ) : live.onAir ? (
                <p className="template-preview-hint">No exposed data fields.</p>
              ) : null}
              {dataError && (
                <p className="template-preview-error" role="alert">
                  {dataError}
                </p>
              )}
              {fullscreen && (
                <p className="template-preview-hint">
                  Right-click for controls at the pointer. D toggles controls; Escape exits preview.
                </p>
              )}
            </div>
          </aside>
          {(localError || (live.error && !dataError)) && (
            <p className="template-preview-error" role="alert">
              {localError || live.error}
            </p>
          )}
        </div>
        {live.warning && <p className="template-preview-hint">{live.warning}</p>}
      </div>
    </Panel>
  );
}
