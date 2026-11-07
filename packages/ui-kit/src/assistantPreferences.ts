/** Per-user assistant context policy. Null leaves model-aware planning in control. */
export interface AssistantContextPreferences {
  contextWindowTokens: number | null;
  maxHistoryTokens: number | null;
  maxToolResultTokens: number | null;
}

export const DEFAULT_ASSISTANT_CONTEXT_PREFERENCES: Readonly<AssistantContextPreferences> =
  Object.freeze({
    contextWindowTokens: null,
    maxHistoryTokens: null,
    maxToolResultTokens: null,
  });

export const ASSISTANT_CONTEXT_TOKEN_BOUNDS = {
  contextWindowTokens: { min: 4_096, max: 4_194_304 },
  maxHistoryTokens: { min: 1_024, max: 4_194_304 },
  maxToolResultTokens: { min: 256, max: 262_144 },
} as const;

/** Invalid old/imported values fall back to automatic planning, never an unlimited budget. */
export function normalizeAssistantContextPreferences(value: unknown): AssistantContextPreferences {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const tokenLimit = (key: keyof AssistantContextPreferences): number | null => {
    const tokens = candidate[key];
    const { min, max } = ASSISTANT_CONTEXT_TOKEN_BOUNDS[key];
    return typeof tokens === 'number' &&
      Number.isSafeInteger(tokens) &&
      tokens >= min &&
      tokens <= max
      ? tokens
      : null;
  };
  return {
    contextWindowTokens: tokenLimit('contextWindowTokens'),
    maxHistoryTokens: tokenLimit('maxHistoryTokens'),
    maxToolResultTokens: tokenLimit('maxToolResultTokens'),
  };
}
