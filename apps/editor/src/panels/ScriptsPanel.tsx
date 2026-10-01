import { ScriptLogWindow } from './ScriptLogWindow';
import { JavaScriptEditor } from '../components/JavaScriptEditor';
import { useRef, useState } from 'react';
import {
  compositionScriptSyntaxError,
  scriptModuleName,
  scriptModuleSyntaxError,
  type Composition,
  type CompositionScripting,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useActiveComposition, useProjectStore } from '../state/projectStore';
import { useExpressionDiagnosticsStore } from '../state/expressionDiagnosticsStore';
import { LayerExpressionsEditor } from './LayerExpressionsEditor';
import './ScriptsPanel.css';

const EMPTY: CompositionScripting = { source: '', enabled: false, modules: [] };

export function ScriptsPanel() {
  const composition = useActiveComposition();
  const [view, setView] = useState('expressions');
  return (
    <div className="scripts-panel">
      <label className="scripts-file-select">
        Edit
        <select
          aria-label="Scripting view"
          value={view}
          onChange={(event) => setView(event.target.value)}
        >
          <option value="expressions">Layer expressions</option>
          <option value="scripts">Composition &amp; modules</option>
        </select>
      </label>
      <div hidden={view !== 'expressions'}>
        <LayerExpressionsEditor key={composition.id} />
      </div>
      <div className="scripts-editor-view" hidden={view !== 'scripts'}>
        <ScriptEditor key={composition.id} composition={composition} />
      </div>
      <ScriptLogWindow />
    </div>
  );
}

function ScriptEditor({ composition }: { composition: Composition }) {
  const scripting = composition.scripting ?? EMPTY;
  const [selected, setSelected] = useState(-1);
  const [importError, setImportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const update = useProjectStore((state) => state.updateCompositionSettings);
  const diagnostics = useExpressionDiagnosticsStore();
  const edit = (change: (current: CompositionScripting) => CompositionScripting) => {
    const state = useProjectStore.getState();
    const active = getActiveComposition(state.project, state.activeCompositionId);
    if (active.id !== composition.id) return;
    update({ scripting: change(active.scripting ?? EMPTY) });
  };
  const file = scripting.modules[selected];
  let syntaxError = compositionScriptSyntaxError(scripting.source);
  const names = new Set<string>();
  for (const module of scripting.modules) {
    try {
      const name = scriptModuleName(module.fileName);
      if (names.has(name)) throw new Error('Duplicate module name: ' + name);
      names.add(name);
      const error = scriptModuleSyntaxError(module.source);
      if (error) throw new Error(error);
    } catch (error) {
      syntaxError ??=
        module.fileName + ': ' + (error instanceof Error ? error.message : String(error));
    }
  }
  const runtimeErrors =
    diagnostics.compositionId === composition.id
      ? [
          ...new Set(
            diagnostics.diagnostics
              .filter((entry) => entry.property === 'script')
              .map((entry) => entry.message),
          ),
        ]
      : [];
  const editFile = (patch: Partial<{ fileName: string; source: string }>) =>
    edit((current) => ({
      ...current,
      modules: current.modules.map((module, index) =>
        index === selected ? { ...module, ...patch } : module,
      ),
    }));
  const importFiles = async (files: File[]) => {
    setImportError('');
    try {
      const imported = await Promise.all(
        files.map(async (file) => {
          scriptModuleName(file.name);
          if (file.size > 1024 * 1024) throw new Error(file.name + ' exceeds 1 MB.');
          return { fileName: file.name, source: await file.text() };
        }),
      );
      edit((current) => ({ ...current, modules: [...current.modules, ...imported] }));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="scripts-editor">
      <div className="scripts-toolbar">
        <label>
          <input
            type="checkbox"
            checked={scripting.enabled}
            onChange={(event) => edit((current) => ({ ...current, enabled: event.target.checked }))}
          />
          Composition script enabled
        </label>
      </div>
      <label className="scripts-file-select">
        Script
        <select
          value={file ? selected : -1}
          onChange={(event) => setSelected(Number(event.target.value))}
        >
          <option value={-1}>Composition</option>
          {scripting.modules.map((module, index) => (
            <option key={index} value={index}>
              {module.fileName}
            </option>
          ))}
        </select>
      </label>
      <div className="scripts-toolbar">
        <button type="button" onClick={() => fileInput.current?.click()}>
          Import .js files
        </button>
        <button
          type="button"
          onClick={() => {
            let index = 1;
            while (scripting.modules.some((module) => module.fileName === `helpers${index}.js`))
              index++;
            setSelected(scripting.modules.length);
            edit((current) => ({
              ...current,
              modules: [...current.modules, { fileName: `helpers${index}.js`, source: '' }],
            }));
          }}
        >
          New module
        </button>
        {file && (
          <button
            type="button"
            onClick={() => {
              edit((current) => ({
                ...current,
                modules: current.modules.filter((_, index) => index !== selected),
              }));
              setSelected(-1);
            }}
          >
            Remove module
          </button>
        )}
        <input
          ref={fileInput}
          hidden
          type="file"
          multiple
          accept=".js,.mjs"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void importFiles(files);
          }}
        />
      </div>
      {file && (
        <label className="scripts-file-select">
          Filename
          <input
            value={file.fileName}
            onChange={(event) => editFile({ fileName: event.target.value })}
          />
        </label>
      )}
      <JavaScriptEditor
        key={selected}
        label={file ? 'Module source' : 'Composition script'}
        value={file?.source ?? scripting.source}
        onChange={(source) => {
          if (file) editFile({ source });
          else edit((current) => ({ ...current, source }));
        }}
      />
      {importError && (
        <p role="alert" className="inspector-error">
          {importError}
        </p>
      )}
      {syntaxError && (
        <p role="alert" className="inspector-error">
          {syntaxError}
        </p>
      )}
      {runtimeErrors.map((message) => (
        <p role="alert" className="inspector-error" key={message}>
          {message}
        </p>
      ))}
    </div>
  );
}
