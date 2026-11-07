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
    expect(IN_APP_SYSTEM_PROMPT_ESTIMATED_TOKENS).toBeLessThanOrEqual(9_300);
    expect(first).toContain('never bake tile copies');
    expect(first).toContain('rowOverrides');
    expect(first).toContain('patternRows');
    expect(first).toContain('reorder_effects');
    expect(first).toContain('effects.ID.PARAM');
    expect(first).toContain('lottieInspection');
    expect(first).toContain('byte-repeatable');
    expect(first).toContain('dataFieldUsage');
  });

  it('keeps a body under every section heading after stripping unavailable guidance', () => {
    const blocks = IN_APP_SYSTEM_PROMPT.split(/\n\s*\n/).map((block) => block.trim());
    const level = (block: string) => /^(#{1,6}) [^\n]+$/.exec(block)?.[1]!.length ?? 0;
    const empty = blocks.filter((block, index) => {
      const next = /^(#{1,6}) /.exec(blocks[index + 1] ?? '# end')?.[1]!.length ?? 0;
      return level(block) > 0 && next > 0 && next <= level(block);
    });
    expect(empty).toEqual([]);
  });

  it('does not reintroduce out-of-process or unavailable-tool guidance', () => {
    const normalized = IN_APP_SYSTEM_PROMPT.toLowerCase();
    for (const stripped of STRIPPED_IN_APP_GUIDANCE) {
      expect(normalized).not.toContain(stripped.toLowerCase());
    }
    expect(normalized).not.toContain('in ograf devtool');
    expect(normalized).not.toContain('independent graphic instance');
    expect(normalized).not.toContain('](./references/');
  });
});
