import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createTilingPattern,
  getPatternPresetPatch,
  PATTERN_PRESETS,
  type PatternPresetId,
} from '@ograf-editor/scene-model';
import { EditorWindowContext, isDomElement, useEditorWindow } from '../layout/EditorWindow';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { usePatternDialogStore } from '../state/patternDialogStore';
import { patternSymbolFromLayer } from '../state/patternSymbols';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { ResourceTreeBranch } from './ResourceTreeComponents';
import { TilingPatternEditor } from './TilingPatternEditor';
import { PatternPreview } from './PatternPreview';
import './PatternResources.css';

export function PatternResources() {
  const composition = useActiveComposition();
  const { window: owner } = useEditorWindow();
  const open = usePatternDialogStore((state) => state.open);
  const [error, setError] = useState('');
  const run = (operation: () => void, label: string) => {
    try {
      runDiscreteHistoryStep(operation, label);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <ResourceTreeBranch label="Patterns" count={composition.patterns.length}>
      <button type="button" onClick={() => open(undefined, owner)}>
        Add pattern
      </button>
      {composition.patterns.length === 0 && (
        <p className="panel-placeholder">Start with a preset or use shapes from your canvas.</p>
      )}
      {composition.patterns.map((pattern) => {
        const allLayers = [
          ...composition.layers,
          ...composition.components.flatMap((component) => component.layers),
        ];
        const uses = allLayers.filter(
          (layer) => layer.element.type === 'pattern' && layer.element.patternId === pattern.id,
        ).length;
        const inUse =
          uses > 0 || allLayers.some((layer) => layer.lighting?.patternId === pattern.id);
        return (
          <div
            className="pattern-resource-row"
            role="treeitem"
            aria-label={pattern.name}
            key={pattern.id}
          >
            <button
              type="button"
              className="pattern-resource-preview"
              aria-label={`Edit pattern: ${pattern.name}`}
              onClick={() => open(pattern.id, owner)}
            >
              <PatternPreview pattern={pattern} frameRate={composition.frameRate} />
            </button>
            <div className="pattern-resource-copy">
              <strong title={pattern.name}>{pattern.name}</strong>
              <span>
                {pattern.rows} rows · Used by {uses} {uses === 1 ? 'layer' : 'layers'}
              </span>
              <div className="pattern-resource-actions">
                <button type="button" onClick={() => open(pattern.id, owner)}>
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Add ${pattern.name} to canvas`}
                  onClick={() =>
                    run(
                      () =>
                        useSelectionStore
                          .getState()
                          .select(useProjectStore.getState().addPatternInstance(pattern.id)),
                      `Add ${pattern.name} to canvas`,
                    )
                  }
                >
                  Add to canvas
                </button>
                <button
                  type="button"
                  aria-label={`Duplicate pattern: ${pattern.name}`}
                  onClick={() =>
                    run(() => {
                      const id = useProjectStore.getState().duplicatePatternResource(pattern.id);
                      open(id, owner);
                    }, `Duplicate ${pattern.name}`)
                  }
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  disabled={inUse}
                  title={
                    inUse
                      ? 'Remove or change linked layers before removing this pattern.'
                      : 'Remove this unused pattern. Undo restores it.'
                  }
                  aria-label={`Remove pattern: ${pattern.name}`}
                  onClick={() =>
                    run(
                      () => useProjectStore.getState().removeTilingPattern(pattern.id),
                      `Remove ${pattern.name}`,
                    )
                  }
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {error && (
        <p className="inspector-hint" role="alert">
          {error}
        </p>
      )}
    </ResourceTreeBranch>
  );
}

export function PatternDialogHost() {
  const request = usePatternDialogStore((state) => state.request);
  const project = useProjectStore((state) => state.project);
  const compositionId = useProjectStore((state) => state.activeCompositionId);
  const close = usePatternDialogStore((state) => state.close);
  useEffect(() => {
    if (
      request &&
      (request.projectId !== project.id ||
        request.compositionId !== compositionId ||
        request.owner.closed)
    )
      close();
  }, [request, project.id, compositionId, close]);
  if (
    !request ||
    request.projectId !== project.id ||
    request.compositionId !== compositionId ||
    request.owner.closed
  )
    return null;
  return (
    <EditorWindowContext.Provider value={request.owner}>
      <PatternDialog
        key={request.patternId ?? 'new'}
        patternId={request.patternId}
        onClose={close}
      />
    </EditorWindowContext.Provider>
  );
}

export function PatternInstanceActions({
  layerId,
  patternId,
  locked,
}: {
  layerId: string;
  patternId: string;
  locked: boolean;
}) {
  const composition = useActiveComposition();
  const { window: owner } = useEditorWindow();
  const [error, setError] = useState('');
  const uses = [
    ...composition.layers,
    ...composition.components.flatMap((component) => component.layers),
  ].filter(
    (layer) => layer.element.type === 'pattern' && layer.element.patternId === patternId,
  ).length;
  return (
    <div className="pattern-instance-actions">
      <p className="inspector-hint">
        Shared by {uses} {uses === 1 ? 'layer' : 'layers'}. Fill, outline, and effects belong to
        this layer.
      </p>
      <div className="resources-tree-actions">
        <button
          type="button"
          onClick={() => usePatternDialogStore.getState().open(patternId, owner)}
        >
          Edit pattern…
        </button>
        <button
          type="button"
          disabled={locked}
          title="Give this layer its own pattern copy. Other layers keep the original."
          onClick={() => {
            try {
              runDiscreteHistoryStep(
                () => useProjectStore.getState().makePatternIndependent(layerId),
                'Make pattern independent',
              );
              setError('');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          Make independent
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function PatternDialog({ patternId, onClose }: { patternId?: string; onClose: () => void }) {
  const { document, window: owner } = useEditorWindow();
  const composition = useActiveComposition();
  const selectedIds = useSelectionStore((state) => state.selectedLayerIds);
  const frame = useTimelineStore((state) => state.currentFrame);
  const dialog = useRef<HTMLDialogElement>(null);
  const [preset, setPreset] = useState<PatternPresetId | 'selection'>('dots');
  const [addToCanvas, setAddToCanvas] = useState(true);
  const [error, setError] = useState('');
  const selected = useMemo(() => {
    try {
      const layers = composition.layers.filter((layer) => selectedIds.includes(layer.id));
      if (!layers.length)
        return { error: 'Select a rectangle, ellipse, or path on the canvas first.' };
      if (layers.length > 32) return { error: 'Choose up to 32 vector shapes.' };
      return {
        symbols: layers.map((layer, index) =>
          patternSymbolFromLayer(layer, frame, `Shape${index + 1}`),
        ),
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [composition.layers, selectedIds, frame]);
  const draft = useMemo(() => {
    const patch = getPatternPresetPatch(
      preset === 'selection' ? 'dots' : preset,
      composition.width,
      composition.height,
      composition.frameRate,
    );
    if (preset === 'selection' && selected.symbols) {
      patch.name = 'Custom shapes';
      patch.symbols = selected.symbols;
      patch.sequence = selected.symbols.map((symbol) => ({ symbolKey: symbol.key, gapScale: 1 }));
    }
    return createTilingPattern(patch);
  }, [preset, selected, composition.width, composition.height, composition.frameRate]);
  const pattern = patternId ? composition.patterns.find((item) => item.id === patternId) : draft;
  useEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement;
    node.showModal();
    return () => {
      node.close();
      if (isDomElement(previous) && previous.isConnected) previous.focus();
    };
  }, [document]);
  const create = () => {
    try {
      const { id: _id, ...patch } = draft;
      const result = runDiscreteHistoryStep(
        () => useProjectStore.getState().createPatternResource(patch, addToCanvas),
        `Create ${draft.name} pattern`,
      );
      if (result.layerId) useSelectionStore.getState().select(result.layerId);
      usePatternDialogStore.getState().open(result.patternId, owner);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="pattern-resource-dialog"
      aria-labelledby="pattern-dialog-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <h2 id="pattern-dialog-title">{patternId ? 'Edit pattern' : 'Create pattern'}</h2>
          <p>
            {patternId
              ? 'Changes update every linked layer. Use Undo to revert an edit.'
              : 'Choose a starting point, then adjust its symbols, spacing, and motion.'}
          </p>
        </div>
        <button type="button" aria-label="Close pattern editor" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="pattern-resource-dialog-body">
        {patternId ? (
          pattern ? (
            <TilingPatternEditor pattern={pattern} frameRate={composition.frameRate} />
          ) : (
            <p>This pattern was removed.</p>
          )
        ) : (
          <>
            <div className="pattern-create-presets" role="group" aria-label="Pattern presets">
              {PATTERN_PRESETS.map((item) => (
                <button
                  type="button"
                  aria-pressed={preset === item.id}
                  key={item.id}
                  onClick={() => setPreset(item.id)}
                  title={item.description}
                >
                  <PatternPreview
                    pattern={createTilingPattern(
                      getPatternPresetPatch(
                        item.id,
                        composition.width,
                        composition.height,
                        composition.frameRate,
                      ),
                    )}
                    frameRate={composition.frameRate}
                  />
                  <strong>{item.name}</strong>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="pattern-use-selection"
              aria-pressed={preset === 'selection'}
              disabled={!selected.symbols}
              title={
                selected.error ??
                'Copy the selected vector silhouettes into the repeating sequence.'
              }
              onClick={() => setPreset('selection')}
            >
              Use selected shapes{selected.symbols ? ` (${selected.symbols.length})` : ''}
            </button>
            <p className="inspector-hint">
              {selected.error ??
                'Selected shapes are copied into the pattern; the original objects stay editable.'}
            </p>
            <PatternPreview pattern={draft} frameRate={composition.frameRate} showControls />
            <label className="pattern-create-option">
              <input
                type="checkbox"
                checked={addToCanvas}
                onChange={(event) => setAddToCanvas(event.target.checked)}
              />{' '}
              Add to canvas
            </label>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <footer>
        {patternId ? (
          <button type="button" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={preset === 'selection' && !selected.symbols}
              onClick={create}
            >
              Create pattern
            </button>
          </>
        )}
      </footer>
    </dialog>,
    document.body,
  );
}
