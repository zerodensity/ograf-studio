import { describe, expect, it } from 'vitest';
import { generateInAppPrompt, STRIPPED_IN_APP_GUIDANCE } from './inAppPromptProjection';
import {
  IN_APP_SYSTEM_PROMPT,
  IN_APP_SYSTEM_PROMPT_ESTIMATED_TOKENS,
} from './generatedInAppPrompt';

describe('generated in-app authoring prompt', () => {
  it('is deterministic, current, and within the cached-prefix budget', async () => {
    const first = await generateInAppPrompt();
    const second = await generateInAppPrompt();
    expect(first).toBe(second);
    expect(first).toBe(IN_APP_SYSTEM_PROMPT);
    expect(IN_APP_SYSTEM_PROMPT_ESTIMATED_TOKENS).toBeLessThanOrEqual(9_000);
    expect(first).toContain('never bake tile copies');
    expect(first).toContain('rowOverrides');
    expect(first).toContain('patternRows');
    expect(first).toContain('reorder_effects');
    expect(first).toContain('effects.ID.PARAM');
    expect(first).toContain('lottieInspection');
    expect(first).toContain('byte-repeatable');
  });

  it('does not reintroduce out-of-process or unavailable-tool guidance', () => {
    const normalized = IN_APP_SYSTEM_PROMPT.toLowerCase();
    for (const stripped of STRIPPED_IN_APP_GUIDANCE) {
      expect(normalized).not.toContain(stripped.toLowerCase());
    }
  });
});
