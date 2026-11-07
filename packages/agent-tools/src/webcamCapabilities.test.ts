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

describe('local webcam capability discovery', () => {
  it('projects the same session settings guidance for live tags and presentation backgrounds', async () => {
    const { capabilities } = fixture();
    const elements = await capabilities(['elements']);
    const editor = await capabilities(['editor']);
    const liveTag = (elements.paintSchemas as { media: { liveTag: { webcamPreview: unknown } } })
      .media.liveTag;
    const backgrounds = (
      editor.canvasLayout as { presentationBackgrounds: { webcamSettings: unknown } }
    ).presentationBackgrounds;

    expect(liveTag.webcamPreview).toEqual(backgrounds.webcamSettings);
    expect(liveTag.webcamPreview).toMatchObject({
      ui: expect.stringContaining('Camera Settings beside Start webcam'),
      activation: expect.stringContaining('Opening settings does not start capture'),
      capture: expect.stringContaining('Actual resolution and FPS'),
      nativeConstraints: expect.stringContaining('resolution/FPS constraints before image-control'),
      sharedStream: expect.stringContaining('share one local camera stream'),
      imageControls: expect.stringContaining('only image controls advertised'),
      failure: expect.stringContaining('keep the active stream'),
      reset: expect.stringContaining('not a camera factory reset'),
      persistence: expect.stringContaining('outside projects, .ogs, exports and workspace presets'),
    });
    expect(elements).not.toHaveProperty('canvasLayout');
    expect(editor).not.toHaveProperty('elementSchemas');
  });

  it('requires actual track readback after the ordered native settings phases', async () => {
    const { capabilities } = fixture();
    const result = await capabilities(['elements']);
    const webcam = (
      result.paintSchemas as { media: { liveTag: { webcamPreview: Record<string, string> } } }
    ).media.liveTag.webcamPreview;

    expect(webcam.nativeConstraints).toContain('Actual values come from getSettings()');
    expect(webcam.nativeConstraints).toContain('getConstraints() describes requests');
    expect(webcam.nativeConstraints).toContain('attempt to restore prior capture/image settings');
    expect(webcam.failure).toContain('Stop and camera switches invalidate stale settings results');
  });

  it('preserves the export renderer hook and authoring-only background boundary', async () => {
    const { capabilities } = fixture();
    const result = await capabilities(['elements', 'editor']);
    expect(result.paintSchemas).toMatchObject({
      media: {
        liveTag: {
          element: 'zd-ograf-media',
          version: 1,
          sourceAttribute: 'data-source-tag',
          manifestEngineRequirement: 'ZeroDensityHTML >= 1.0',
          webcamPreview: {
            persistence: expect.stringContaining('target renderer source hook'),
          },
        },
      },
    });
    expect(result.canvasLayout).toMatchObject({
      presentationBackgrounds: {
        values: expect.arrayContaining(['webcam']),
        authoringOnly: true,
        exported: false,
        webcamSettings: {
          persistence: expect.stringContaining('session-only'),
        },
      },
    });
  });

  it('does not introduce an MCP camera activation or settings tool', async () => {
    const { capabilities, records } = fixture();
    const result = await capabilities(['editor']);
    expect(result.canvasLayout).toMatchObject({
      presentationBackgrounds: {
        webcamSettings: {
          activation: expect.stringContaining('MCP does not activate or configure'),
        },
      },
    });
    expect(
      records.map((record) => record.name).filter((name) => /webcam|camera/.test(name)),
    ).toEqual([]);
  });
});
