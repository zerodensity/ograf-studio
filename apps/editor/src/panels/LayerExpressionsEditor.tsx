import { expressionSyntaxError } from '@ograf-editor/scene-model';
import { PropertyRow } from '../components/PropertyRow';
import { JavaScriptEditor } from '../components/JavaScriptEditor';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useExpressionDiagnosticsStore } from '../state/expressionDiagnosticsStore';

const EXPRESSION_FIELDS = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'W' },
  { key: 'height', label: 'H' },
  { key: 'rotation', label: 'Rotation' },
  { key: 'opacity', label: 'Opacity (0\u20131)' },
] as const;

export function LayerExpressionsEditor() {
  const composition = useActiveComposition();
  const selectedLayerId = useSelectionStore((s) => s.selectedLayerId);
  const layer = composition.layers.find((candidate) => candidate.id === selectedLayerId);
  const expressionDiagnostics = useExpressionDiagnosticsStore();
  const updateLayerExpressions = useProjectStore((s) => s.updateLayerExpressions);
  const setLayerExpressionEnabled = useProjectStore((s) => s.setLayerExpressionEnabled);
  if (!layer || layer.isGuide) return <p>Select a layer to edit its expressions.</p>;
  return (
    <section className="scripts-expressions">
      <h3>Expressions: {layer.name}</h3>
      {EXPRESSION_FIELDS.map(({ key, label }) => {
        const source =
          layer.expressions?.[key as keyof NonNullable<typeof layer.expressions>] ?? '';
        const runtimeError =
          expressionDiagnostics.compositionId === composition.id &&
          layer.expressionsEnabled?.[key as keyof NonNullable<typeof layer.expressions>] !== false
            ? expressionDiagnostics.diagnostics.find(
                (entry) =>
                  entry.layerId === layer.id && entry.property === key && entry.source === source,
              )?.message
            : undefined;
        const error = expressionSyntaxError(source) ?? runtimeError;
        const errorId = `expression-error-${layer.id}-${key}`;
        return (
          <PropertyRow
            as="div"
            key={`expression-${key}`}
            className="scripts-expression-row"
            help={`Expression for ${label}`}
          >
            <span>
              <input
                type="checkbox"
                aria-label={`${label} expression enabled`}
                checked={
                  layer.expressionsEnabled?.[key as keyof NonNullable<typeof layer.expressions>] !==
                  false
                }
                disabled={layer.isLocked}
                onChange={(event) =>
                  setLayerExpressionEnabled(
                    layer.id,
                    key as keyof NonNullable<typeof layer.expressions>,
                    event.target.checked,
                  )
                }
              />{' '}
              {label}
            </span>
            <div className="scripts-expression-value">
              <JavaScriptEditor
                key={layer.id}
                invalid={Boolean(error)}
                describedBy={error ? errorId : undefined}
                label={`${label} expression`}
                placeholder="Use authored value"
                value={source}
                readOnly={layer.isLocked}
                onChange={(expression) => {
                  const expressions = { ...(layer.expressions ?? {}) };
                  const expressionKey = key as keyof NonNullable<typeof layer.expressions>;
                  if (expression.length) expressions[expressionKey] = expression;
                  else delete expressions[expressionKey];
                  updateLayerExpressions(
                    layer.id,
                    Object.keys(expressions).length ? expressions : undefined,
                  );
                }}
              />
              {error && (
                <p id={errorId} className="inspector-error">
                  {error}
                </p>
              )}
            </div>
          </PropertyRow>
        );
      })}
    </section>
  );
}
