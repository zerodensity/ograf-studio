import { describe, expect, it, vi } from 'vitest';
import {
  publishExpressionDiagnostics,
  useExpressionDiagnosticsStore,
} from './expressionDiagnosticsStore';
import type { ExpressionDiagnostic } from '@ograf-editor/scene-model';

describe('expression diagnostics', () => {
  it('publishes changes without notifying on every frame and clears repaired errors', () => {
    useExpressionDiagnosticsStore.setState({ compositionId: null, diagnostics: [] });
    const listener = vi.fn();
    const unsubscribe = useExpressionDiagnosticsStore.subscribe(listener);
    const error: ExpressionDiagnostic = {
      layerId: 'text',
      property: 'x',
      source: 'data.x',
      message: 'Missing data',
    };
    publishExpressionDiagnostics('a', [error]);
    publishExpressionDiagnostics('a', [{ ...error }]);
    expect(listener).toHaveBeenCalledTimes(1);
    publishExpressionDiagnostics('a', []);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(useExpressionDiagnosticsStore.getState().diagnostics).toEqual([]);
    publishExpressionDiagnostics('b', []);
    expect(useExpressionDiagnosticsStore.getState().compositionId).toBe('b');
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
