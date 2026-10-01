import { create } from 'zustand';
import type { ExpressionDiagnostic } from '@ograf-editor/scene-model';

interface ExpressionDiagnosticsState {
  compositionId: string | null;
  diagnostics: ExpressionDiagnostic[];
}

/** Transient canvas results, never serialized into the project or undo history. */
export const useExpressionDiagnosticsStore = create<ExpressionDiagnosticsState>(() => ({
  compositionId: null,
  diagnostics: [],
}));

export function publishExpressionDiagnostics(
  compositionId: string,
  diagnostics: ExpressionDiagnostic[],
): void {
  const previous = useExpressionDiagnosticsStore.getState();
  if (
    previous.compositionId === compositionId &&
    previous.diagnostics.length === diagnostics.length &&
    diagnostics.every((entry, index) => {
      const before = previous.diagnostics[index]!;
      return (
        entry.layerId === before.layerId &&
        entry.property === before.property &&
        entry.source === before.source &&
        entry.message === before.message
      );
    })
  )
    return;
  useExpressionDiagnosticsStore.setState({ compositionId, diagnostics });
}
