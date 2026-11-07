import { describe, expect, it, vi } from 'vitest';
import { ToolResultPager } from '@ograf-editor/agent-tools';
import { DEFAULT_ASSISTANT_CONTEXT_PREFERENCES } from '@ograf-editor/ui-kit/workspace-model';
import { estimateTextTokens, planContextBudget, selectActiveContext } from './contextManager';
import type { AgentMessage } from './types';

const budget = (historyTokens: number) => ({
  model: { model: 'test', contextWindowTokens: 128_000, source: 'provider' as const },
  overheadTokens: 100,
  inputTokens: 120_000,
  historyTokens,
  toolPageTokens: 256,
  outputReserveTokens: 4096,
});

describe('model-aware active conversation context', () => {
  it('keeps original intent, original selection and latest state while archiving a long chat intact', () => {
    const history: AgentMessage[] = [
      { role: 'system', content: 'Original selection: logo' },
      { role: 'user', content: 'Keep the logo red for this whole project.' },
    ];
    for (let index = 0; index < 150; index++)
      history.push(
        { role: 'user', content: `Turn ${index}: ${'detail '.repeat(100)}` },
        { role: 'assistant', content: 'Done '.repeat(100) },
      );
    history.push(
      { role: 'system', content: 'Current selection: title' },
      { role: 'user', content: 'Make the title larger.' },
    );
    const original = JSON.stringify(history);
    const pager = new ToolResultPager();
    const active = selectActiveContext(history, budget(2500), () =>
      pager.store(history, { sessionId: 'editor:p', toolName: 'conversation-history' }),
    );
    expect(active.messages).toContainEqual({ role: 'system', content: 'Original selection: logo' });
    expect(
      active.messages.some((m) => m.content === 'Keep the logo red for this whole project.'),
    ).toBe(true);
    expect(active.messages.some((m) => m.content.includes('Make the title larger.'))).toBe(true);
    expect(active.omittedMessages).toBeGreaterThan(200);
    expect(active.estimatedTokens).toBeLessThanOrEqual(2600);
    expect(JSON.stringify(history)).toBe(original);
    const recovered = pager.read({
      resultId: active.historyResultId!,
      sessionId: 'editor:p',
      path: [2, 'content'],
      maxTokens: 1000,
    });
    expect(recovered.node.value ?? recovered.node.chunk).toBe(history[2]!.content);
  });

  it('never separates tool calls from their results when older context is paged', () => {
    const history: AgentMessage[] = [{ role: 'user', content: 'Build this' }];
    for (let index = 0; index < 30; index++)
      history.push(
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: `c${index}`, name: 'read', arguments: {} }],
        },
        { role: 'tool', callId: `c${index}`, name: 'read', content: 'x'.repeat(600) },
      );
    const active = selectActiveContext(history, budget(2000), () => 'real-history-handle');
    const calls = new Set(
      active.messages.flatMap((m) =>
        m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.id) : [],
      ),
    );
    const replies = new Set(active.messages.flatMap((m) => (m.role === 'tool' ? [m.callId] : [])));
    expect(replies).toEqual(calls);
    expect(active.omittedMessages).toBeGreaterThan(0);
  });

  it('rejects a latest request that cannot fit instead of clipping it or discarding it', () => {
    const history: AgentMessage[] = [{ role: 'user', content: '界'.repeat(10000) }];
    const archive = vi.fn(() => 'unused');
    expect(() => selectActiveContext(history, budget(1024), archive)).toThrow(/latest request/);
    expect(history[0]!.content).toHaveLength(10000);
    expect(archive).not.toHaveBeenCalled();
    expect(estimateTextTokens(history[0]!.content)).toBe(10000);
  });

  it('does not send incomplete or orphaned tool pairs from cancelled requests', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: 'Previous' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 'read', arguments: {} },
          { id: 'b', name: 'read', arguments: {} },
        ],
      },
      { role: 'tool', callId: 'a', name: 'read', content: 'Already read' },
      { role: 'user', content: 'Continue' },
    ];
    const active = selectActiveContext(history, budget(4096), () => 'cancelled-history');
    expect(active.messages.some((m) => m.role === 'tool')).toBe(false);
    expect(active.messages.some((m) => m.role === 'assistant' && m.toolCalls?.length)).toBe(false);
    expect(active.historyResultId).toBe('cancelled-history');
  });

  it('accounts for instructions, tool schemas, response reserve and user limits', () => {
    const large = planContextBudget(
      { model: 'large', contextWindowTokens: 200000, source: 'provider' },
      DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
      'system',
      [],
    );
    const small = planContextBudget(
      { model: 'small', contextWindowTokens: 32000, source: 'provider' },
      DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
      'system',
      [],
    );
    expect(large.historyTokens).toBeGreaterThan(small.historyTokens);
    const limited = planContextBudget(
      large.model,
      { contextWindowTokens: null, maxHistoryTokens: 2000, maxToolResultTokens: 300 },
      'system',
      [],
    );
    expect(limited.historyTokens).toBe(2000);
    expect(limited.toolPageTokens).toBe(300);
    expect(limited.inputTokens).toBeLessThan(
      large.model.contextWindowTokens - limited.outputReserveTokens,
    );
    expect(() =>
      planContextBudget(
        { model: 'tiny', contextWindowTokens: 4096, source: 'provider' },
        DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
        'x'.repeat(20000),
        [],
      ),
    ).toThrow(/too small/);
  });
});
