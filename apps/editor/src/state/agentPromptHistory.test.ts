import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AgentAreaReference } from '@ograf-editor/agent-tools/chat-references';

const hooks = vi.hoisted(() => {
  vi.stubGlobal('window', {
    location: { protocol: 'http:', host: 'localhost:5173' },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    addEventListener: () => undefined,
  });
  vi.stubGlobal('document', { querySelector: () => null });
  return { effect: null as (() => void | (() => void)) | null };
});

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effect = effect;
  },
}));
vi.mock('./agentCapture', () => ({
  captureAgentPng: vi.fn(),
  measureAgentText: vi.fn(),
  renderAgentStripPng: vi.fn(),
}));
vi.mock('./ografCompatibility', () => ({ certifyExportArtifacts: vi.fn() }));

import { sendAgentChat, useAgentBridge, useAgentChatStore } from './agentBridge';
import { resetHistory } from './historyStore';
import { useProjectStore } from './projectStore';

class TestSocket extends EventTarget {
  static OPEN = 1;
  static current: TestSocket;
  readyState = TestSocket.OPEN;
  sent: Array<{ type: string; turnId?: string; authoringPromptText?: string }> = [];

  constructor() {
    super();
    TestSocket.current = this;
  }

  send(message: string) {
    this.sent.push(JSON.parse(message));
  }

  receive(message: object) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

afterAll(() => vi.unstubAllGlobals());

describe('Studio assistant prompt provenance', () => {
  it('archives accepted user text, flushes pending artwork edits before chat, and does not echo prompt metadata', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', TestSocket);
    useProjectStore.getState().newProject();
    resetHistory();
    useAgentBridge();
    const dispose = hooks.effect?.();
    const socket = TestSocket.current;
    socket.dispatchEvent(new Event('open'));
    try {
      useProjectStore.getState().setProjectMeta({ name: 'Recently edited template' });
      const projectId = useProjectStore.getState().project.id;
      const originalText = '  Build the initial graphic.\nUse navy.  ';
      sendAgentChat(originalText);
      expect(socket.sent.map(({ type }) => type)).toEqual([
        'editor.hello',
        'editor.project',
        'chat.send',
      ]);
      const first = socket.sent.at(-1)!;
      expect(first.authoringPromptText).toBe(originalText);
      expect(useProjectStore.getState().project.authoringPrompts).toBeUndefined();
      socket.receive({
        type: 'chat.turn.start',
        turnId: first.turnId,
        authoringPrompt: {
          projectId,
          prompt: { id: first.turnId, text: originalText },
          revision: 2,
        },
      });
      socket.receive({
        type: 'chat.turn.end',
        turnId: first.turnId,
        stopReason: 'stop',
        usage: { input: 1, output: 1, cacheRead: 0 },
      });
      const area: AgentAreaReference = {
        projectId,
        compositionId: useProjectStore.getState().activeCompositionId,
        frame: 0,
        revision: null,
        compositionWidth: 1920,
        compositionHeight: 1080,
        rect: { x: 0, y: 0, width: 100, height: 100 },
        instruction: '  Increase the label spacing.  ',
        image: { mimeType: 'image/png', data: 'not-prompt-history', width: 100, height: 100 },
      };
      sendAgentChat('', [], [area]);
      const second = socket.sent.at(-1)!;
      expect(second.authoringPromptText).toBe(area.instruction);
      const accepted = {
        type: 'chat.turn.start',
        turnId: second.turnId,
        authoringPrompt: {
          projectId,
          prompt: { id: second.turnId, text: area.instruction },
          revision: 3,
        },
      };
      socket.receive(accepted);
      socket.receive(accepted);
      socket.receive({
        type: 'chat.turn.end',
        turnId: second.turnId,
        stopReason: 'stop',
        usage: { input: 1, output: 1, cacheRead: 0 },
      });
      sendAgentChat('', [], [{ ...area, instruction: '' }]);
      const imageOnly = socket.sent.at(-1)!;
      expect(imageOnly.authoringPromptText).toBe('');
      socket.receive({ type: 'chat.turn.start', turnId: imageOnly.turnId });
      vi.advanceTimersByTime(200);
      expect(useProjectStore.getState().project.authoringPrompts).toEqual([
        { id: first.turnId, text: originalText },
        { id: second.turnId, text: area.instruction },
      ]);
      expect(socket.sent.map(({ type }) => type)).toEqual([
        'editor.hello',
        'editor.project',
        'chat.send',
        'chat.send',
        'chat.send',
      ]);
    } finally {
      if (typeof dispose === 'function') dispose();
      useAgentChatStore.getState().setState({ activeTurnId: null, entries: [] });
      resetHistory();
      vi.useRealTimers();
    }
  });
});
