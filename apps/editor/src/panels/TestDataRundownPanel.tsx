import { useEffect, useMemo, useRef, useState } from 'react';
import { createId, type TestDataRundown } from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useTestDataStore } from '../state/testDataStore';
import { usePlayoutControlsStore } from '../state/playoutControlsStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { resolveProjectSetTemplate } from '../state/projectSet';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { parseRundown, rundownRowData } from '../state/testRundowns';
import { checkRundown, type RundownRowReport } from '../state/testRundownQa';
import { MillisecondDurationInput } from './MillisecondDurationControl';
import './TestDataRundownPanel.css';

export function TestDataRundownPanel() {
  const composition = useActiveComposition();
  const project = useProjectStore((state) => state.project);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const rundowns = composition.testRundowns ?? [];
  const [selectedId, setSelectedId] = useState('');
  const [rowIndex, setRowIndex] = useState(0);
  const [name, setName] = useState('Test data');
  const [source, setSource] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [reports, setReports] = useState<RundownRowReport[]>([]);
  const [setReport, setSetReport] = useState<
    Array<{ template: string; rundown: string; row: number; issues: string[] }>
  >([]);
  const [setChecked, setSetChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [holdMs, setHoldMs] = useState(2000);
  const controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const selected = rundowns.find((item) => item.id === selectedId) ?? rundowns[0];
  const reportByRow = useMemo(() => new Map(reports.map((item) => [item.rowId, item])), [reports]);
  const session = usePlayoutControlsStore((state) => state.session);
  useEffect(() => {
    revision.current++;
    controller.current?.abort();
    setReports([]);
    setSetReport([]);
    setSetChecked(false);
    setRowIndex(0);
    setChecking(false);
    useTestDataStore.getState().setOverflowLayerIds([]);
  }, [composition.id, selected?.id, selected?.rows]);
  useEffect(
    () => () => {
      revision.current++;
      controller.current?.abort();
      useTestDataStore.getState().setOverflowLayerIds([]);
    },
    [],
  );

  const applyRow = (index: number, preview = true) => {
    const row = selected?.rows[index];
    if (!row) return;
    setRowIndex(index);
    useTestDataStore
      .getState()
      .replaceValues(row.values, composition.layers, composition.dataFields);
    useTestDataStore
      .getState()
      .setOverflowLayerIds(
        reportByRow
          .get(row.id)
          ?.issues.flatMap((issue) => (issue.layerId ? [issue.layerId] : [])) ?? [],
      );
    if (preview && session && session.dataTemplateId === session.activeTemplateId)
      session.updateDataBatch?.(rundownRowData(composition.dataFields, row));
  };

  const checkSet = async () => {
    if (!projectSet) return;
    const generation = ++revision.current;
    setChecking(true);
    setError('');
    try {
      const { measureAgentText } = await import('../state/agentCapture');
      const all: Array<{ template: string; rundown: string; row: number; issues: string[] }> = [];
      for (const template of projectSet.templates) {
        const itemProject =
          template.id === activeTemplateId
            ? project
            : resolveProjectSetTemplate(projectSet, template.id);
        for (const itemComposition of itemProject.compositions) {
          for (const rundown of itemComposition.testRundowns ?? []) {
            const checked = await checkRundown(
              itemProject,
              itemComposition.id,
              rundown.rows,
              measureAgentText,
            );
            checked.forEach((row, index) => {
              if (row.issues.length)
                all.push({
                  template: template.name,
                  rundown: rundown.name,
                  row: index + 1,
                  issues: row.issues.map((issue) => issue.message),
                });
            });
          }
        }
      }
      if (generation === revision.current) {
        setSetReport(all);
        setSetChecked(true);
      }
    } catch (cause) {
      if (generation === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === revision.current) setChecking(false);
    }
  };

  const save = (replace: boolean) => {
    try {
      const rows = parseRundown(source, composition.dataFields);
      const item: TestDataRundown = {
        id: replace && selected ? selected.id : createId('rundown'),
        name: name.trim() || 'Test data',
        rows,
      };
      const next =
        replace && selected
          ? rundowns.map((rundown) => (rundown.id === selected.id ? item : rundown))
          : [...rundowns, item];
      runDiscreteHistoryStep(
        () => useProjectStore.getState().setTestRundowns(next),
        replace ? 'Replace test data' : 'Add test rundown',
      );
      setSelectedId(item.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const checkAll = async () => {
    if (!selected) return;
    const generation = ++revision.current;
    setChecking(true);
    setError('');
    try {
      const { measureAgentText } = await import('../state/agentCapture');
      const results = await checkRundown(project, composition.id, selected.rows, measureAgentText);
      if (generation !== revision.current) return;
      setReports(results);
      const worst = results.reduce(
        (best, result, index) =>
          result.issues.length > results[best]!.issues.length ? index : best,
        0,
      );
      setRowIndex(worst);
      const row = selected.rows[worst]!;
      useTestDataStore
        .getState()
        .replaceValues(row.values, composition.layers, composition.dataFields);
      useTestDataStore
        .getState()
        .setOverflowLayerIds(
          results[worst]!.issues.flatMap((issue) => (issue.layerId ? [issue.layerId] : [])),
        );
      if (session && session.dataTemplateId === session.activeTemplateId)
        session.updateDataBatch?.(rundownRowData(composition.dataFields, row));
    } catch (cause) {
      if (generation === revision.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === revision.current) setChecking(false);
    }
  };

  const play = async () => {
    if (!selected || !session?.runRundown) {
      setError('Open Preview & Export to play a rundown.');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setPlaying(true);
    setError('');
    try {
      await session.runRundown(
        selected.rows.map((row) => rundownRowData(composition.dataFields, row)),
        {
          holdMs,
          signal: abort.signal,
          onRow: (index) => applyRow(index, false),
        },
      );
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setPlaying(false);
      }
    }
  };

  const loadUrl = async () => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Use an HTTP or HTTPS JSON URL.');
      const response = await fetch(parsed, { credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error(`Data request failed (${response.status}).`);
      const text = await response.text();
      if (!text.trim().startsWith('[')) throw new Error('The URL must return a JSON array.');
      setSource(text);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div
      className="test-rundowns"
      onKeyDown={(event) => {
        if (
          playing ||
          !selected ||
          (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')
        )
          return;
        if (event.key === 'ArrowLeft' && rowIndex > 0) {
          event.preventDefault();
          event.stopPropagation();
          applyRow(rowIndex - 1);
        }
        if (event.key === 'ArrowRight' && rowIndex < selected.rows.length - 1) {
          event.preventDefault();
          event.stopPropagation();
          applyRow(rowIndex + 1);
        }
      }}
    >
      <p>
        Rows are saved with this template for authoring only. They do not change defaults or
        exported controls.
      </p>
      {error && <p role="alert">{error}</p>}
      <label>
        Rundown{' '}
        <select
          aria-label="Test rundown"
          value={selected?.id ?? ''}
          onChange={(event) => setSelectedId(event.target.value)}
          disabled={playing}
        >
          {!rundowns.length && <option value="">No rundowns</option>}
          {rundowns.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.rows.length} rows
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <label>
          Rename{' '}
          <input
            key={`${selected.id}:${selected.name}`}
            aria-label="Rename rundown"
            defaultValue={selected.name}
            maxLength={128}
            disabled={playing}
            onBlur={(event) => {
              const next = event.currentTarget.value.trim();
              if (!next) {
                event.currentTarget.value = selected.name;
                return;
              }
              if (next !== selected.name)
                runDiscreteHistoryStep(
                  () =>
                    useProjectStore
                      .getState()
                      .setTestRundowns(
                        rundowns.map((item) =>
                          item.id === selected.id ? { ...item, name: next } : item,
                        ),
                      ),
                  'Rename test rundown',
                );
            }}
          />
        </label>
      )}
      <div className="test-rundown-controls">
        <button
          type="button"
          disabled={!selected || rowIndex <= 0 || playing}
          onClick={() => applyRow(rowIndex - 1)}
        >
          ← Previous
        </button>
        <span>{selected ? `${rowIndex + 1} / ${selected.rows.length}` : 'No row'}</span>
        <button
          type="button"
          disabled={!selected || rowIndex >= selected.rows.length - 1 || playing}
          onClick={() => applyRow(rowIndex + 1)}
        >
          Next →
        </button>
        <button
          type="button"
          disabled={!selected || checking || playing}
          onClick={() => void checkAll()}
        >
          {checking ? 'Checking…' : 'Check all rows'}
        </button>
        {projectSet && (
          <button type="button" disabled={checking || playing} onClick={() => void checkSet()}>
            Check template set
          </button>
        )}
      </div>
      {setReport.length > 0 && (
        <div role="status">
          <strong>Template set report</strong>
          <ul>
            {setReport.map((item, index) => (
              <li key={index}>
                {item.template} · {item.rundown} · row {item.row}: {item.issues.join(' ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {setChecked && setReport.length === 0 && (
        <p role="status">No issues found in saved template-set rundowns.</p>
      )}
      {selected && (
        <ol className="test-rundown-rows" aria-label="Test data rows">
          {selected.rows.map((row, index) => {
            const report = reportByRow.get(row.id);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  disabled={playing}
                  className={index === rowIndex ? 'active' : ''}
                  onClick={() => applyRow(index)}
                >
                  <span>
                    {index + 1}.{' '}
                    {Object.values(row.values).map(String).join(' · ').slice(0, 120) || '(empty)'}
                  </span>
                  {report && report.issues.length > 0 && (
                    <strong title={report.issues.map((issue) => issue.message).join('\n')}>
                      {report.issues.length} ⚠
                    </strong>
                  )}
                </button>
                {report?.issues.length ? (
                  <ul>
                    {report.issues.map((issue, issueIndex) => (
                      <li key={issueIndex}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <div className="test-rundown-controls">
        <label>
          Hold{' '}
          <MillisecondDurationInput
            label="Rundown hold"
            value={holdMs}
            frameRate={composition.frameRate}
            maxMs={60000}
            onChange={(value) => setHoldMs(value ?? holdMs)}
          />
        </label>
        {playing ? (
          <button type="button" onClick={() => controller.current?.abort()}>
            Stop rundown
          </button>
        ) : (
          <button type="button" disabled={!selected || checking} onClick={() => void play()}>
            Play rundown
          </button>
        )}
        {selected && (
          <button
            type="button"
            disabled={playing}
            onClick={() => {
              runDiscreteHistoryStep(
                () =>
                  useProjectStore
                    .getState()
                    .setTestRundowns(rundowns.filter((item) => item.id !== selected.id)),
                'Delete test rundown',
              );
              setSelectedId('');
            }}
          >
            Delete
          </button>
        )}
      </div>
      <details>
        <summary>Import rows</summary>
        <label>
          Name{' '}
          <input
            aria-label="Rundown name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Paste CSV, TSV or JSON array
          <textarea
            aria-label="Test data source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            rows={5}
          />
        </label>
        <label>
          Choose file{' '}
          <input
            type="file"
            accept=".csv,.tsv,.json,text/csv,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void file
                  .text()
                  .then(setSource)
                  .catch((cause: unknown) => setError(String(cause)));
              event.currentTarget.value = '';
            }}
          />
        </label>
        <label>
          JSON URL{' '}
          <input
            aria-label="Test data JSON URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button type="button" onClick={() => void loadUrl()}>
            Load
          </button>
        </label>
        <div>
          <button type="button" disabled={playing} onClick={() => save(false)}>
            Save as new
          </button>
          {selected && (
            <button type="button" disabled={playing} onClick={() => save(true)}>
              Replace selected
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
