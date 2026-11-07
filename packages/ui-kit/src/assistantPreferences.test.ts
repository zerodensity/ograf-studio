import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_CONTEXT_TOKEN_BOUNDS,
  DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
  normalizeAssistantContextPreferences,
} from './assistantPreferences';
import {
  createBuiltinWorkspacePresets,
  DEFAULT_WORKSPACE_ID,
  parseWorkspaceState,
  serializeWorkspaceState,
} from './workspaceModel';

function profile() {
  const presets = createBuiltinWorkspacePresets();
  return serializeWorkspaceState({
    presets,
    current: presets.find((preset) => preset.id === DEFAULT_WORKSPACE_ID)!.snapshot,
    activePresetId: DEFAULT_WORKSPACE_ID,
    startup: { mode: 'last', presetId: DEFAULT_WORKSPACE_ID, restoreDetached: true },
  });
}

describe('assistant context user preferences', () => {
  it('defaults missing older profiles to automatic without rewriting their layout', () => {
    const old = profile();
    delete old.editorPreferences;
    const parsed = parseWorkspaceState(old)!;
    expect(parsed.editorPreferences?.assistantContext).toEqual(
      DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
    );
    expect(parsed.session).toEqual(old.session);
  });

  it('round-trips a mixture of custom and automatic values through the workspace profile', () => {
    const saved = profile();
    saved.editorPreferences!.assistantContext = {
      contextWindowTokens: 131_072,
      maxHistoryTokens: 32_768,
      maxToolResultTokens: null,
    };
    const reopened = parseWorkspaceState(JSON.parse(JSON.stringify(saved)))!;
    expect(reopened.editorPreferences?.assistantContext).toEqual(
      saved.editorPreferences!.assistantContext,
    );
    expect(reopened.startup).toEqual(saved.startup);
    expect(reopened.session).toEqual(saved.session);
  });

  it('rejects invalid persisted token values instead of allowing unbounded or coerced limits', () => {
    for (const invalid of [-1, 0, 0.5, NaN, Infinity, '65536', {}, []]) {
      expect(
        normalizeAssistantContextPreferences({
          contextWindowTokens: invalid,
          maxHistoryTokens: invalid,
          maxToolResultTokens: invalid,
        }),
      ).toEqual(DEFAULT_ASSISTANT_CONTEXT_PREFERENCES);
    }
    expect(
      normalizeAssistantContextPreferences({
        contextWindowTokens: ASSISTANT_CONTEXT_TOKEN_BOUNDS.contextWindowTokens.min - 1,
        maxHistoryTokens: ASSISTANT_CONTEXT_TOKEN_BOUNDS.maxHistoryTokens.max + 1,
        maxToolResultTokens: ASSISTANT_CONTEXT_TOKEN_BOUNDS.maxToolResultTokens.max + 1,
      }),
    ).toEqual(DEFAULT_ASSISTANT_CONTEXT_PREFERENCES);
  });

  it('accepts documented boundary values and returns an independent object', () => {
    const input = {
      contextWindowTokens: ASSISTANT_CONTEXT_TOKEN_BOUNDS.contextWindowTokens.min,
      maxHistoryTokens: ASSISTANT_CONTEXT_TOKEN_BOUNDS.maxHistoryTokens.max,
      maxToolResultTokens: ASSISTANT_CONTEXT_TOKEN_BOUNDS.maxToolResultTokens.min,
    };
    const normalized = normalizeAssistantContextPreferences(input);
    expect(normalized).toEqual(input);
    expect(normalized).not.toBe(input);
    normalized.contextWindowTokens = null;
    expect(input.contextWindowTokens).toBe(4096);
    expect(Object.isFrozen(DEFAULT_ASSISTANT_CONTEXT_PREFERENCES)).toBe(true);
  });
});
