import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createProject, type Project } from '@ograf-editor/scene-model';
import { describe, expect, it, vi } from 'vitest';
import { parseProjectSource } from '../state/studioDocument';
import { AgentChatPanel } from './AgentChatPanel';

const fixture = vi.hoisted(() => ({ project: null as Project | null }));

vi.mock('../state/projectStore', () => ({
  useProjectStore: (select: (state: { project: Project }) => unknown) =>
    select({ project: fixture.project! }),
  useActiveComposition: () => fixture.project!.compositions[0]!,
}));
vi.mock('../state/agentBridge', () => ({
  cancelAgentChat: vi.fn(),
  sendAgentChat: vi.fn(),
  setAgentChatExclusive: vi.fn(),
  useAgentBridgeStatus: (
    select: (state: { connected: boolean; authoritative: boolean }) => unknown,
  ) => select({ connected: false, authoritative: true }),
  useAgentChatStore: () => ({
    configured: false,
    entries: [],
    sessionUsage: { input: 0, output: 0, cacheRead: 0 },
    projectUsage: { input: 0, output: 0, cacheRead: 0 },
  }),
}));
vi.mock('./AgentReviewPanel', () => ({ AgentReviewPanel: () => null }));
vi.mock('../components/AreaReferenceCapture', () => ({ AreaReferenceCapture: () => null }));

describe('AI Assistant saved prompts', () => {
  it('shows a reopened template’s saved prompts in order with an empty editable composer', () => {
    fixture.project = parseProjectSource(
      JSON.stringify(
        createProject({
          authoringPrompts: [
            { id: 'first', text: 'Make a lower third.' },
            { id: 'second', text: 'Use a muted blue.' },
          ],
        }),
      ),
    );
    const markup = renderToStaticMarkup(createElement(AgentChatPanel));
    expect(markup).toContain('Saved prompts (2)');
    expect(markup.indexOf('Original prompt')).toBeLessThan(markup.indexOf('Follow-up 1'));
    expect(markup.indexOf('Make a lower third.')).toBeLessThan(markup.indexOf('Use a muted blue.'));
    expect(markup).toMatch(/<button[^>]*aria-label="Copy original prompt"[^>]*>Copy<\/button>/);
    expect(markup).toMatch(/<button[^>]*aria-label="Copy follow-up 1"[^>]*>Copy<\/button>/);
    expect(markup).toMatch(/<textarea[^>]*placeholder="Ask OGraf Studio…" rows="3"><\/textarea>/);
    expect(markup).toContain('disabled="">Send</button>');

    fixture.project = createProject();
    const anotherTemplate = renderToStaticMarkup(createElement(AgentChatPanel));
    expect(anotherTemplate).not.toContain('Saved prompts');
    expect(anotherTemplate).not.toContain('Make a lower third.');
  });
});
