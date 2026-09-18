import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() =>
  vi.stubGlobal('window', {
    location: { protocol: 'http:', host: 'localhost:5173' },
    clearTimeout,
  }),
);
afterAll(() => vi.unstubAllGlobals());

vi.mock('./agentCapture', () => ({
  captureAgentPng: vi.fn(),
  measureAgentText: vi.fn(),
  renderAgentStripPng: vi.fn(),
}));
vi.mock('./ografCompatibility', () => ({ certifyExportArtifacts: vi.fn() }));
import {
  finishAgentChatTurn,
  updateAgentChatActivity,
  useAgentChatStore,
  useAgentReviewStore,
} from './agentBridge';

describe('single-line assistant activity', () => {
  beforeEach(() => {
    useAgentChatStore.setState({
      entries: [{ id: 'user', turnId: 'turn', kind: 'user', text: 'Fix this' }],
      activeTurnId: 'turn',
      activeTurnStartedAt: Date.now(),
      pendingAssistantText: '',
      progress: null,
      sessionUsage: { input: 0, output: 0, cacheRead: 0 },
    });
    useAgentReviewStore.setState({ proposals: [] });
  });

  it('updates tool status without changing transcript identity or adding scrolling rows', () => {
    const entries = useAgentChatStore.getState().entries;
    for (let i = 0; i < 10; i++) {
      for (const status of ['running', 'ok'] as const)
        updateAgentChatActivity({
          type: 'chat.tool',
          turnId: 'turn',
          callId: `call-${i}`,
          name: 'ograf_query_scene',
          summary: `Query ${i}`,
          status,
        });
    }
    expect(useAgentChatStore.getState().entries).toBe(entries);
    expect(useAgentChatStore.getState().progress?.message).toBe('Done: Query 9');
  });

  it('keeps intermediate text and proposal notices in status, then adds the final reply once', () => {
    updateAgentChatActivity({ type: 'chat.text', turnId: 'turn', text: 'I will check the scene.' });
    updateAgentChatActivity({ type: 'chat.proposal', turnId: 'turn', proposalId: 'proposal' });
    expect(useAgentChatStore.getState().entries).toHaveLength(1);
    expect(useAgentChatStore.getState().progress?.message).toBe('Proposal ready for review');
    updateAgentChatActivity({ type: 'chat.text', turnId: 'turn', text: 'The proposal is ready.' });
    const end = {
      type: 'chat.turn.end' as const,
      turnId: 'turn',
      stopReason: 'stop',
      usage: { input: 10, output: 5, cacheRead: 2 },
    };
    finishAgentChatTurn(end);
    finishAgentChatTurn(end);
    expect(useAgentChatStore.getState().entries).toHaveLength(2);
    expect(useAgentChatStore.getState().entries[1]).toMatchObject({
      kind: 'assistant',
      text: 'The proposal is ready.',
      usage: end.usage,
    });
    expect(useAgentChatStore.getState().sessionUsage).toEqual(end.usage);
  });

  it('ignores stale activity from another turn', () => {
    updateAgentChatActivity({ type: 'chat.text', turnId: 'old-turn', text: 'Old progress' });
    expect(useAgentChatStore.getState().pendingAssistantText).toBe('');
    expect(useAgentChatStore.getState().progress).toBeNull();
  });
});
