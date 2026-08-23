import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assembleManifest,
  BUILT_IN_EXPORT_PROFILES,
  compileDescriptor,
  getExportProfile,
  type ExportProfileMode,
} from '@ograf-editor/codegen';
import { registerGraphicElement } from '@ograf-editor/ograf-runtime';
import type { Graphic, RenderType, ScheduledAction } from '@ograf-editor/ograf-types';
import { validateManifest } from '@ograf-editor/validation';
import {
  computeKeyframeFrames,
  runBroadcastQa,
  type BroadcastQaIssue,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useTestDataStore, type TestValue } from '../state/testDataStore';
import { exportProjectAsZip } from '../state/exportPackage';
import {
  buildExportArtifacts,
  certifyExportArtifacts,
  type OGrafCompatibilityResult,
} from '../state/ografCompatibility';
import { useFitZoom } from '../canvas/useFitZoom';
import { transparencyCheckerboardStyle } from '../canvas/compositionBackground';
import { resolvePreviewDataRecord } from '../state/previewData';
import { measureAgentText } from '../state/agentCapture';
import { Panel } from './Panel';
import { resolveSourceOverlayGeometry } from './sourceOverlay';
import './PreviewExportPanel.css';

interface LogEntry {
  id: number;
  method: string;
  paramsSummary: string;
  resultSummary: string;
  isError: boolean;
}

interface ScheduleRow {
  id: number;
  timestamp: number;
  actionType: ScheduledAction['action']['type'];
  paramsJson: string;
}

const DEFAULT_SCHEDULE_PARAMS_JSON: Record<ScheduledAction['action']['type'], string> = {
  updateAction: '{"data":{}}',
  playAction: '{"delta":1}',
  stopAction: '{}',
  customAction: '{"id":"","payload":{}}',
};

let logCounter = 0;
let scheduleRowCounter = 0;

function successful(result: unknown): boolean {
  return !(
    typeof result === 'object' &&
    result !== null &&
    'statusCode' in result &&
    typeof result.statusCode === 'number' &&
    result.statusCode >= 400
  );
}

export function PreviewExportPanel() {
  const project = useProjectStore((s) => s.project);
  const composition = useActiveComposition();
  const testValues = useTestDataStore((s) => s.values);

  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphicRef = useRef<(HTMLElement & Graphic) | null>(null);
  const zoom = useFitZoom(viewportRef, composition.width, composition.height, 8);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [currentStep, setCurrentStep] = useState<number | undefined>();
  const [renderType, setRenderType] = useState<RenderType>('realtime');
  const [isPreviewLoaded, setIsPreviewLoaded] = useState(false);
  const [dataForm, setDataForm] = useState<Record<string, TestValue>>({});
  const [exportStatus, setExportStatus] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingCompatibility, setIsCheckingCompatibility] = useState(false);
  const [compatibility, setCompatibility] = useState<OGrafCompatibilityResult | null>(null);
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scrubTimestamp, setScrubTimestamp] = useState(0);
  const [exportProfileId, setExportProfileId] = useState<ExportProfileMode>('dual');
  const exportProfile = getExportProfile(exportProfileId);
  const [qaIssues, setQaIssues] = useState<BroadcastQaIssue[] | null>(null);
  const [isRunningQa, setIsRunningQa] = useState(false);
  const [interlacedQa, setInterlacedQa] = useState(false);
  const [comparisonAssetId, setComparisonAssetId] = useState('');
  const [comparisonOpacity, setComparisonOpacity] = useState(0.5);
  const [comparisonNaturalSize, setComparisonNaturalSize] = useState<{
    assetId: string;
    width: number;
    height: number;
  } | null>(null);
  const comparisonAsset = composition.assets.find(
    (asset) => asset.id === comparisonAssetId && asset.kind === 'image',
  );
  const comparisonGeometry = useMemo(() => {
    if (!comparisonAsset) return null;
    return (
      resolveSourceOverlayGeometry(composition, comparisonAsset) ??
      (comparisonNaturalSize?.assetId === comparisonAsset.id
        ? {
            x: 0,
            y: 0,
            width: comparisonNaturalSize.width,
            height: comparisonNaturalSize.height,
            rotation: 0,
            transformOriginX: 0,
            transformOriginY: 0,
            source: 'intrinsic' as const,
          }
        : null)
    );
  }, [comparisonAsset, comparisonNaturalSize, composition]);

  useEffect(() => setComparisonNaturalSize(null), [comparisonAssetId]);

  const descriptor = useMemo(() => compileDescriptor(composition), [composition]);
  const previewData = useMemo(
    () => resolvePreviewDataRecord(composition, dataForm),
    [composition, dataForm],
  );
  const latestPreviewDataRef = useRef(previewData);
  const lastAttemptedDataSignatureRef = useRef<string | null>(null);
  latestPreviewDataRef.current = previewData;
  const manifest = useMemo(
    () => assembleManifest(project, composition, descriptor),
    [project, composition, descriptor],
  );
  const validation = useMemo(() => validateManifest(manifest), [manifest]);

  const resetDataForm = () => {
    const next: Record<string, TestValue> = {};
    for (const field of composition.dataFields) {
      next[field.key] = testValues[field.id] ?? field.defaultValue;
    }
    setDataForm(next);
  };

  const appendLog = useCallback((method: string, params: unknown, result: unknown) => {
    const isError =
      typeof result === 'object' &&
      result !== null &&
      'statusCode' in result &&
      (result as { statusCode: number }).statusCode >= 400;
    setLog((prev) =>
      [
        {
          id: logCounter++,
          method,
          paramsSummary: JSON.stringify(params),
          resultSummary: JSON.stringify(result),
          isError,
        },
        ...prev,
      ].slice(0, 30),
    );
  }, []);

  const call = useCallback(
    async <T,>(
      method: string,
      params: unknown,
      fn: (graphic: HTMLElement & Graphic) => Promise<T>,
    ) => {
      const graphic = graphicRef.current;
      if (!graphic) return;
      try {
        const result = await fn(graphic);
        appendLog(method, params, result);
      } catch (err) {
        appendLog(method, params, {
          statusCode: 550,
          statusMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [appendLog],
  );

  // Rebuilds the live preview instance whenever the descriptor changes — same "every edit
  // invalidates the instance" behavior as Stage.tsx's master timeline, and arguably more correct
  // here: it forces re-testing after an edit rather than showing possibly-stale harness state.
  useEffect(() => {
    const tagName = registerGraphicElement(descriptor);
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    const el = document.createElement(tagName) as HTMLElement & Graphic;
    container.appendChild(el);
    graphicRef.current = el;
    setIsPreviewLoaded(false);
    setCurrentStep(undefined);
    setLog([]);

    const data = latestPreviewDataRef.current;
    const dataSignature = JSON.stringify(data);
    const params = {
      data,
      renderType,
      renderCharacteristics: {
        resolution: { width: composition.width, height: composition.height },
        frameRate: composition.frameRate,
        accessToPublicInternet: false,
      },
    };
    void el
      .load(params)
      .then((result) => {
        if (graphicRef.current !== el) return;
        appendLog('load', params, result);
        if (!successful(result)) return;
        lastAttemptedDataSignatureRef.current = dataSignature;
        setIsPreviewLoaded(true);
      })
      .catch((error) => {
        if (graphicRef.current !== el) return;
        appendLog('load', params, {
          statusCode: 550,
          statusMessage: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      if (graphicRef.current === el) graphicRef.current = null;
      void el.dispose({});
      el.remove();
    };
  }, [
    appendLog,
    composition.frameRate,
    composition.height,
    composition.width,
    descriptor,
    renderType,
  ]);

  useEffect(() => {
    resetDataForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition.dataFields, project.mainCompositionId]);

  useEffect(() => {
    setCompatibility(null);
  }, [project, composition, exportProfileId]);

  useEffect(() => {
    if (!isPreviewLoaded) return;
    const signature = JSON.stringify(previewData);
    if (lastAttemptedDataSignatureRef.current === signature) return;

    const timeout = window.setTimeout(() => {
      lastAttemptedDataSignatureRef.current = signature;
      const params = { data: previewData };
      void call('updateAction', params, (graphic) => graphic.updateAction(params));
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [call, isPreviewLoaded, previewData]);

  const handlePlayAction = (params: { delta?: number; goto?: number }) => {
    void call('playAction', params, async (g) => {
      const result = await g.playAction(params);
      setCurrentStep(result.currentStep);
      return result;
    });
  };

  const handleStop = () =>
    void call('stopAction', {}, async (g) => {
      const result = await g.stopAction({});
      setCurrentStep(undefined);
      return result;
    });

  const handleCustomAction = (actionId: string) => {
    const params = { id: actionId, payload: {} };
    void call('customAction', params, (g) => g.customAction(params));
  };

  const addScheduleRow = () => {
    setScheduleRows((prev) => [
      ...prev,
      {
        id: scheduleRowCounter++,
        timestamp: 0,
        actionType: 'updateAction',
        paramsJson: DEFAULT_SCHEDULE_PARAMS_JSON.updateAction,
      },
    ]);
  };

  const removeScheduleRow = (id: number) =>
    setScheduleRows((prev) => prev.filter((row) => row.id !== id));

  const updateScheduleRow = (id: number, patch: Partial<ScheduleRow>) =>
    setScheduleRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const handleSendSchedule = () => {
    let schedule: ScheduledAction[];
    try {
      schedule = scheduleRows.map((row) => ({
        timestamp: row.timestamp,
        action: { type: row.actionType, params: JSON.parse(row.paramsJson || '{}') as unknown },
      }));
    } catch (err) {
      appendLog('setActionsSchedule', scheduleRows, {
        statusCode: 550,
        statusMessage: `Invalid params JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    const params = { schedule };
    void call('setActionsSchedule', params, (g) => g.setActionsSchedule(params));
  };

  const handleGoToTime = () => {
    const params = { timestamp: scrubTimestamp };
    void call('goToTime', params, (g) => g.goToTime(params));
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportStatus('');
    try {
      const result = await exportProjectAsZip(project, composition, exportProfile);
      setCompatibility(result.compatibility);
      if (result.saveResult === 'cancelled') {
        setExportStatus('Export cancelled.');
      } else if (!result.valid) {
        setExportStatus(`Exported with ${result.errors.length} manifest issue(s) — see below.`);
      } else {
        setExportStatus(result.saveResult === 'saved' ? 'Exported.' : 'Exported (downloaded).');
      }
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCompatibilityCheck = async () => {
    setIsCheckingCompatibility(true);
    setExportStatus('Running OGraf devtool-compatible checks…');
    try {
      const result = await certifyExportArtifacts(
        buildExportArtifacts(project, composition, exportProfile),
      );
      setCompatibility(result);
      setExportStatus(
        result.valid
          ? 'OGraf v1 compatibility test passed. The next unchanged export is eligible to save.'
          : `Compatibility failed: ${result.errors.join(' ')}`,
      );
    } catch (err) {
      setCompatibility(null);
      setExportStatus(err instanceof Error ? err.message : 'Compatibility test failed.');
    } finally {
      setIsCheckingCompatibility(false);
    }
  };

  const handleBroadcastQa = async () => {
    setIsRunningQa(true);
    const issues = runBroadcastQa(project, { interlacedOutput: interlacedQa });
    const lifecycle = computeKeyframeFrames(composition);
    const stepIds = new Set(
      composition.keyframes
        .filter((keyframe) => keyframe.role === 'step')
        .map((keyframe) => keyframe.id),
    );
    const frame =
      lifecycle.find((item) => stepIds.has(item.keyframeId))?.frame ?? lifecycle[0]?.frame ?? 0;
    const stressSamples = [
      'BREAKING NEWS — REPRESENTATIVE LONG REPLACEMENT TEXT 00:00',
      'İstanbul İzmir Şampiyonluk gündemi — العربية 1234567890',
    ];
    try {
      for (const layer of composition.layers.filter(
        (candidate) => candidate.isVisible && candidate.element.type === 'text',
      )) {
        for (const text of stressSamples) {
          const result = await measureAgentText({
            project,
            compositionId: composition.id,
            layerId: layer.id,
            text,
            frame,
          });
          if (result.overflowsParent || result.degenerate) {
            issues.push({
              severity: 'warning',
              category: 'typography',
              compositionId: composition.id,
              layerId: layer.id,
              frame,
              message: `${layer.name} ${result.degenerate ? 'hits its minimum font-size floor' : 'overflows its authored box'} with stress value “${text}”.`,
            });
          }
          if (result.resolvedFont.requestedFamily !== result.resolvedFont.resolvedFamily) {
            issues.push({
              severity: 'warning',
              category: 'resources',
              compositionId: composition.id,
              layerId: layer.id,
              frame,
              message: `${layer.name} requested ${result.resolvedFont.requestedFamily} but resolved to ${result.resolvedFont.resolvedFamily}.`,
            });
          }
        }
      }
      setQaIssues(
        issues.filter(
          (issue, index) =>
            issues.findIndex((candidate) => candidate.message === issue.message) === index,
        ),
      );
    } catch (error) {
      setQaIssues([
        ...issues,
        {
          severity: 'warning',
          category: 'typography',
          compositionId: composition.id,
          message: `Browser text stress test failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setIsRunningQa(false);
    }
  };

  return (
    <Panel title="Preview & Export">
      <div className="preview-export-panel">
        <div className="preview-stage-wrap" ref={viewportRef}>
          <div
            className="preview-stage-measure"
            style={{ width: composition.width * zoom, height: composition.height * zoom }}
          >
            <div
              className="preview-stage"
              ref={containerRef}
              style={{
                width: composition.width,
                height: composition.height,
                transform: `scale(${zoom})`,
                ...(composition.backgroundColor === 'transparent'
                  ? transparencyCheckerboardStyle(zoom)
                  : undefined),
              }}
            />
            {comparisonAsset && (
              <img
                className="preview-source-overlay"
                src={comparisonAsset.dataUri}
                alt="Source design comparison overlay"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setComparisonNaturalSize({
                      assetId: comparisonAsset.id,
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    });
                  }
                }}
                style={{
                  left: (comparisonGeometry?.x ?? 0) * zoom,
                  top: (comparisonGeometry?.y ?? 0) * zoom,
                  width: (comparisonGeometry?.width ?? 0) * zoom,
                  height: (comparisonGeometry?.height ?? 0) * zoom,
                  opacity: comparisonOpacity,
                  visibility: comparisonGeometry ? 'visible' : 'hidden',
                  transform: `rotate(${comparisonGeometry?.rotation ?? 0}deg)`,
                  transformOrigin: `${(comparisonGeometry?.transformOriginX ?? 0) * 100}% ${(comparisonGeometry?.transformOriginY ?? 0) * 100}%`,
                }}
              />
            )}
          </div>
        </div>

        <div className="preview-controls">
          <div className="preview-controls-row">
            <select
              value={renderType}
              onChange={(e) => setRenderType(e.target.value as RenderType)}
            >
              <option value="realtime">realtime</option>
              <option value="non-realtime">non-realtime</option>
            </select>
            <button
              type="button"
              onClick={() => handlePlayAction({ delta: -1 })}
              disabled={!isPreviewLoaded}
            >
              {'⏮ Prev step'}
            </button>
            <span className="preview-step-indicator">
              {currentStep === undefined
                ? 'off-step'
                : `step ${currentStep + 1} / ${descriptor.stepCount}`}
            </span>
            <button
              type="button"
              onClick={() => handlePlayAction({ delta: 1 })}
              disabled={!isPreviewLoaded}
            >
              {'Next step ⏭'}
            </button>
            <button type="button" onClick={handleStop} disabled={!isPreviewLoaded}>
              Take Out
            </button>
          </div>

          {renderType === 'non-realtime' && (
            <div className="preview-schedule">
              <div className="preview-controls-row">
                <span className="preview-step-indicator">goToTime</span>
                <input
                  type="number"
                  className="preview-schedule-timestamp"
                  value={scrubTimestamp}
                  onChange={(e) => setScrubTimestamp(Number(e.target.value))}
                />
                <span className="preview-step-indicator">ms</span>
                <button type="button" onClick={handleGoToTime}>
                  Go to time
                </button>
              </div>

              {scheduleRows.map((row) => (
                <div key={row.id} className="preview-schedule-row">
                  <input
                    type="number"
                    className="preview-schedule-timestamp"
                    value={row.timestamp}
                    onChange={(e) =>
                      updateScheduleRow(row.id, { timestamp: Number(e.target.value) })
                    }
                  />
                  <span className="preview-step-indicator">ms</span>
                  <select
                    value={row.actionType}
                    onChange={(e) => {
                      const actionType = e.target.value as ScheduledAction['action']['type'];
                      updateScheduleRow(row.id, {
                        actionType,
                        paramsJson: DEFAULT_SCHEDULE_PARAMS_JSON[actionType],
                      });
                    }}
                  >
                    <option value="updateAction">updateAction</option>
                    <option value="playAction">playAction</option>
                    <option value="stopAction">stopAction</option>
                    <option value="customAction">customAction</option>
                  </select>
                  <input
                    type="text"
                    className="preview-schedule-params"
                    value={row.paramsJson}
                    onChange={(e) => updateScheduleRow(row.id, { paramsJson: e.target.value })}
                  />
                  <button type="button" onClick={() => removeScheduleRow(row.id)}>
                    ✕
                  </button>
                </div>
              ))}

              <div className="preview-controls-row">
                <button type="button" onClick={addScheduleRow}>
                  + Schedule row
                </button>
                <button type="button" onClick={handleSendSchedule}>
                  Send setActionsSchedule
                </button>
              </div>
            </div>
          )}

          {composition.dataFields.length > 0 && (
            <div className="preview-data-form">
              {composition.dataFields.map((field) => (
                <label key={field.id} className="preview-data-row">
                  <span>{field.label || field.key}</span>
                  <input
                    type="text"
                    value={String(dataForm[field.key] ?? '')}
                    onChange={(e) =>
                      setDataForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
          )}

          {descriptor.customActions.length > 0 && (
            <div className="preview-controls-row">
              {descriptor.customActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={!isPreviewLoaded}
                  onClick={() => handleCustomAction(action.id)}
                >
                  {action.name || action.id}
                </button>
              ))}
            </div>
          )}

          <div className="preview-log">
            {log.length === 0 ? (
              <p className="panel-placeholder">
                Call a lifecycle method above to see results here.
              </p>
            ) : (
              log.map((entry) => (
                <div key={entry.id} className={`preview-log-entry${entry.isError ? ' error' : ''}`}>
                  <span className="preview-log-method">{entry.method}</span>
                  <span className="preview-log-params">{entry.paramsSummary}</span>
                  <span className="preview-log-result">{entry.resultSummary}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <section className="data-panel-section">
          <h3>Typography & broadcast QA</h3>
          <div className="preview-controls-row">
            <label className="preview-data-row">
              <span>Source overlay</span>
              <select
                value={comparisonAssetId}
                onChange={(event) => setComparisonAssetId(event.target.value)}
              >
                <option value="">Off</option>
                {composition.assets
                  .filter((asset) => asset.kind === 'image')
                  .map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
              </select>
            </label>
            {comparisonAsset && (
              <label className="preview-data-row">
                <span>Overlay opacity</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={comparisonOpacity}
                  onChange={(event) => setComparisonOpacity(Number(event.target.value))}
                />
              </label>
            )}
            {comparisonGeometry && (
              <span className="preview-step-indicator">
                {Math.round(comparisonGeometry.width)}×{Math.round(comparisonGeometry.height)} at{' '}
                {Math.round(comparisonGeometry.x)}, {Math.round(comparisonGeometry.y)}
              </span>
            )}
            <label className="preview-data-row">
              <span>Interlaced</span>
              <input
                type="checkbox"
                checked={interlacedQa}
                onChange={(event) => setInterlacedQa(event.target.checked)}
              />
            </label>
            <button type="button" disabled={isRunningQa} onClick={() => void handleBroadcastQa()}>
              {isRunningQa ? 'Testing…' : 'Run broadcast QA'}
            </button>
          </div>
          <p className="panel-placeholder">
            Checks Step-frame safe areas, minimum text size, packaged fonts, backing contrast,
            optional interlaced rules, and long Latin/Turkish/Arabic replacement text in the real
            browser renderer. QA is advisory and does not replace OGraf certification.
          </p>
          {qaIssues && (
            <ul className="preview-qa-results">
              {qaIssues.length === 0 ? (
                <li className="preview-validation-check-valid">✓ No QA warnings.</li>
              ) : (
                qaIssues.map((issue, index) => (
                  <li key={`${issue.message}-${index}`} className={issue.severity}>
                    {issue.severity === 'warning' ? '⚠' : 'ℹ'} [{issue.category}] {issue.message}
                  </li>
                ))
              )}
            </ul>
          )}
        </section>

        <section className="data-panel-section">
          <h3>Export</h3>
          <label className="preview-data-row">
            <span>Export profile</span>
            <select
              value={exportProfileId}
              onChange={(event) => setExportProfileId(event.target.value as ExportProfileMode)}
            >
              {BUILT_IN_EXPORT_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <p className="panel-placeholder">
            Output-only profile: {exportProfile.mode}. The editable project render-mode flags and ID
            are not changed.
          </p>
          <p className={`preview-validation${validation.valid ? '' : ' invalid'}`}>
            {validation.valid
              ? '✓ Manifest schema precheck passed.'
              : `✕ ${validation.errors.length} manifest issue(s):`}
          </p>
          {!validation.valid && (
            <ul className="preview-validation-errors">
              {validation.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          <p className={`preview-validation${compatibility?.valid ? '' : ' invalid'}`}>
            {compatibility?.valid
              ? `✓ OGraf v1 certified for ${exportProfile.name}: package, module API, and declared lifecycle tests passed.`
              : compatibility
                ? '✕ OGraf compatibility certification failed.'
                : 'Not yet certified. Certification always runs again immediately before saving.'}
          </p>
          {compatibility && (
            <ul className="preview-validation-errors">
              {compatibility.checks.map((check) => (
                <li
                  key={check.id}
                  className={check.valid ? 'preview-validation-check-valid' : undefined}
                >
                  {check.valid ? '✓' : '✕'} {check.label}
                  {!check.valid && check.errors.length > 0 ? ` — ${check.errors.join(' ')}` : ''}
                </li>
              ))}
            </ul>
          )}
          <div className="preview-controls-row">
            <button
              type="button"
              onClick={handleCompatibilityCheck}
              disabled={isCheckingCompatibility || isExporting}
            >
              {isCheckingCompatibility ? 'Testing…' : 'Run compatibility test'}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting || isCheckingCompatibility}
            >
              {isExporting ? 'Testing & exporting…' : 'Export .ograf.zip'}
            </button>
          </div>
          <p className="panel-placeholder">
            The .ogeproj file is editable source, not an OGraf manifest. Extract the .ograf.zip and
            select that folder in ograf-devtool.
          </p>
          {exportStatus && <p className="preview-export-status">{exportStatus}</p>}
        </section>
      </div>
    </Panel>
  );
}
