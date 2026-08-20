import { useEffect, useMemo, useRef, useState } from 'react';
import { assembleManifest, compileDescriptor } from '@ograf-editor/codegen';
import { registerGraphicElement } from '@ograf-editor/ograf-runtime';
import type { Graphic, RenderType, ScheduledAction } from '@ograf-editor/ograf-types';
import { validateManifest } from '@ograf-editor/validation';
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
import { Panel } from './Panel';
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
  const [dataForm, setDataForm] = useState<Record<string, TestValue>>({});
  const [exportStatus, setExportStatus] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingCompatibility, setIsCheckingCompatibility] = useState(false);
  const [compatibility, setCompatibility] = useState<OGrafCompatibilityResult | null>(null);
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scrubTimestamp, setScrubTimestamp] = useState(0);

  const descriptor = useMemo(() => compileDescriptor(composition), [composition]);
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
    setCurrentStep(undefined);
    setLog([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor]);

  useEffect(() => {
    resetDataForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition.dataFields, project.mainCompositionId]);

  useEffect(() => {
    setCompatibility(null);
  }, [project, composition]);

  const appendLog = (method: string, params: unknown, result: unknown) => {
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
  };

  const call = async <T,>(
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
  };

  const handleLoad = () => {
    const runtimeData = resolvePreviewDataRecord(composition, dataForm);
    const params = {
      data: runtimeData,
      renderType,
      renderCharacteristics: {
        resolution: { width: composition.width, height: composition.height },
        frameRate: composition.frameRate,
        accessToPublicInternet: false,
      },
    };
    void call('load', params, (g) => g.load(params));
  };

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

  const handleUpdateData = () => {
    const params = { data: resolvePreviewDataRecord(composition, dataForm) };
    void call('updateAction', params, (g) => g.updateAction(params));
  };

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
      const result = await exportProjectAsZip(project, composition);
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
      const result = await certifyExportArtifacts(buildExportArtifacts(project, composition));
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
            <button type="button" onClick={handleLoad}>
              Load
            </button>
            <button type="button" onClick={() => handlePlayAction({ delta: -1 })}>
              {'⏮ Prev step'}
            </button>
            <span className="preview-step-indicator">
              {currentStep === undefined
                ? 'off-step'
                : `step ${currentStep + 1} / ${descriptor.stepCount}`}
            </span>
            <button type="button" onClick={() => handlePlayAction({ delta: 1 })}>
              {'Next step ⏭'}
            </button>
            <button type="button" onClick={handleStop}>
              Stop
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
              <button type="button" onClick={handleUpdateData}>
                Send updateAction
              </button>
            </div>
          )}

          {descriptor.customActions.length > 0 && (
            <div className="preview-controls-row">
              {descriptor.customActions.map((action) => (
                <button key={action.id} type="button" onClick={() => handleCustomAction(action.id)}>
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
          <h3>Export</h3>
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
              ? '✓ OGraf v1 certified: package, module API, realtime and non-realtime tests passed.'
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
