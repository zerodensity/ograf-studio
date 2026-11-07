import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { AuthoringSession } from '@ograf-editor/authoring-core';
import { createProject } from '@ograf-editor/scene-model';
import type { AuthoringWorkspacePort, EditorBridgePort } from './ports';
import { createOGrafToolRecords } from './toolRecords';

function fixture() {
  const session = new AuthoringSession(createProject(), 'editor');
  const workspace: AuthoringWorkspacePort = {
    root: 'C:/ograf-tool-tests',
    get: () => session,
    list: () => [],
    create: () => session,
    delete: vi.fn(),
    open: async () => session,
    resolveAllowedPath: (path) => path,
  };
  const bridge: EditorBridgePort = {
    health: {
      connected: false,
      responsive: false,
      latencyMs: null,
      lastHeartbeat: null,
      likelyCause: 'editor-disconnected',
      certificationReady: false,
      certificationLikelyCause: 'Disconnected',
    },
    certify: vi.fn(),
    capture: vi.fn(),
    renderStrip: vi.fn(),
    measureText: vi.fn(),
    presentProposal: vi.fn(),
  };
  const records = createOGrafToolRecords(workspace, bridge);
  const tool = records.find((record) => record.name === 'ograf_get_capabilities')!;
  return {
    records,
    capabilities: async (sections: string[]) => {
      const result = await tool.handler(z.object(tool.config.inputSchema).parse({ sections }));
      return (result as { structuredContent: Record<string, unknown> }).structuredContent;
    },
  };
}

describe('fullscreen preview MCP guidance', () => {
  it('discovers shared field-editing transparency and fullscreen context menu scope', async () => {
    const { capabilities } = fixture();
    const result = await capabilities(['editor']);
    expect(result.editorParity).toMatchObject({
      fullscreenPreview: {
        surfaces: ['single-template', 'coordinated-set'],
        fpsOverlay: {
          label: 'Preview FPS',
          defaultVisible: true,
          metric: expect.stringContaining('not authored frame rate or GPU throughput'),
          controls: expect.stringContaining('session-only'),
          offlineHtml: expect.stringContaining('completed Render FPS'),
          graphicOutput: false,
        },
        contextMenu: expect.stringContaining('throughout Studio'),
        controls: {
          normalBackgroundTransparency: 0.6,
          inactiveEditingTransparency: 1,
          activeField: expect.stringContaining('retaining focus and editability'),
          restoreOn: [
            'focus-leave',
            'edit-commit',
            'edit-cancel',
            'panel-hidden',
            'fullscreen-exit',
          ],
        },
        informationalOnly: true,
        exported: false,
      },
    });
    const preview = (result.editorParity as { fullscreenPreview: { contextMenu: string } })
      .fullscreenPreview;
    expect(preview.contextMenu).toContain('Native operating-system picker/popover menus');
    expect(preview.contextMenu).toContain('detached panes and fullscreen output');
  });

  it('keeps the guidance in editor discovery without adding a fullscreen mutation tool', async () => {
    const { capabilities, records } = fixture();
    const result = await capabilities(['elements']);
    expect(result).not.toHaveProperty('editorParity');
    expect(records.some((record) => /fullscreen/.test(record.name))).toBe(false);
  });
});
