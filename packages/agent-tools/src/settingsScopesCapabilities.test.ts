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

describe('unified settings scope capability guidance', () => {
  it('discovers one window with explicit Studio, set and template entry points', async () => {
    const { capabilities } = fixture();
    const result = await capabilities(['editor']);
    expect(result.editorParity).toMatchObject({
      settingsScopes: {
        window: 'Settings & Preferences',
        search: expect.stringContaining('scope/category list'),
        entryPoints: {
          filePreferences: { scope: 'studio', section: 'workspace' },
          templateSetGear: { scope: 'template-set', section: 'output' },
          templateContextSettings: { scope: 'template', section: 'output' },
          propertiesSettings: { scope: 'template', section: 'output' },
        },
        scopes: {
          studio: { sections: ['workspace', 'export', 'assistant', 'plugins', 'nodos'] },
          'template-set': { sections: ['output', 'timing', 'canvas', 'inheritance', 'plugins'] },
          template: { sections: ['output', 'background', 'canvas', 'guides', 'plugins'] },
        },
        informationalOnly: true,
      },
    });
  });

  it('separates local autosaved preferences, staged defaults and immediate undoable edits', async () => {
    const { capabilities } = fixture();
    const result = await capabilities(['editor']);
    expect(result.editorParity).toMatchObject({
      settingsScopes: {
        scopes: {
          studio: {
            changes: 'immediate-user-preferences',
            storage: 'browser-origin-profile-or-standalone-user-workspace-profile',
            detail: expect.stringContaining('do not enter .ogs'),
          },
          'template-set': {
            changes: 'staged-until-apply-or-ok',
            storage: 'template-set-.ogs',
            mcp: {
              tool: 'ograf_update_template_set',
              operations: ['set_defaults', 'set_inheritance', 'set_setting_override'],
            },
          },
          template: {
            changes: 'immediate-undoable-authoring',
            storage: 'canonical-project-and-composition-in-.ogs',
            detail: expect.stringContaining('Reset restores inheritance'),
            mcp: {
              tool: 'ograf_apply_operations',
              operations: expect.arrayContaining([
                'set_composition',
                'set_composition_layout',
                'set_project_metadata',
                'add_canvas_guide',
              ]),
            },
          },
        },
        exportBoundary: expect.stringContaining('matching effective output dimensions'),
      },
    });
  });

  it('keeps settings discovery in editor capabilities and uses existing canonical tools', async () => {
    const { capabilities, records } = fixture();
    const elements = await capabilities(['elements']);
    expect(elements).not.toHaveProperty('editorParity');
    expect(records.map((record) => record.name)).toEqual(
      expect.arrayContaining(['ograf_apply_operations', 'ograf_update_template_set']),
    );
    expect(
      records.filter((record) =>
        ['ograf_update_settings', 'ograf_update_preferences', 'ograf_settings'].includes(
          record.name,
        ),
      ),
    ).toEqual([]);
  });
});
