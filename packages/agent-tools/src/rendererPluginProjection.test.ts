import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { AuthoringSession } from '@ograf-editor/authoring-core';
import {
  createChartLayer,
  createLayerKeyframe,
  createProject,
  createRendererPluginSnapshot,
  createAnimationPresetPluginSnapshot,
  studioPluginReference,
  defaultTransformFor,
} from '@ograf-editor/scene-model';
import { createOGrafToolRecords } from './toolRecords';
import { providerToolDefinitions } from './inAppTools';
import type { AuthoringWorkspacePort, EditorBridgePort } from './ports';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const plugin = createRendererPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'chart',
      id: 'test.chart',
      version: '1.0.0',
      name: 'Pinned chart',
      presets: ['bar'],
      license: 'MIT',
    },
    source: 'export default { apiVersion: 1, create() {} }; // exact_source_ö_marker\n',
    licenseText: 'MIT license exact_license_ö_marker\n',
  });
  const layer = createChartLayer();
  layer.keyframes = [createLayerKeyframe(0, defaultTransformFor('chart'))];
  if (layer.element.type !== 'chart') throw new Error('Expected chart');
  layer.element.provider = {
    id: plugin.manifest.id,
    version: plugin.manifest.version,
    sha256: plugin.sha256,
  };
  composition.layers = [layer];
  composition.rendererPlugins = [plugin];
  const motion = createAnimationPresetPluginSnapshot({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      kind: 'animation-presets',
      id: 'test.motion',
      version: '1.0.0',
      name: 'Motion pack',
      license: 'MIT',
    },
    licenseText: 'exact_motion_license_marker',
    presets: [
      {
        id: 'fade',
        name: 'Fade',
        tracks: {
          in: [
            {
              property: 'opacity',
              mode: 'absolute',
              keys: [
                { at: 0, value: 0 },
                { at: 1, value: 'on-air' },
              ],
            },
          ],
        },
      },
    ],
  });
  composition.animationPresetPlugins = [motion];
  layer.animationPresets = {
    in: {
      reference: studioPluginReference(motion),
      presetId: 'fade',
      durationFrames: 12,
      parameters: {},
    },
  };
  const session = new AuthoringSession(project, 'editor');
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
  const call = async (name: string, input: Record<string, unknown>) => {
    const tool = records.find((record) => record.name === name)!;
    const result = await tool.handler(z.object(tool.config.inputSchema).parse(input));
    return (result as { structuredContent: Record<string, unknown> }).structuredContent;
  };
  return { call, plugin, motion, records };
}

function projectedPlugins(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const project = payload.project as { compositions: Array<Record<string, unknown>> };
  return project.compositions[0]!.rendererPlugins as Array<Record<string, unknown>>;
}

describe('renderer plugin MCP discovery and projections', () => {
  it('discovers chart paint frame consistency without dropping standard fill capabilities', async () => {
    const { call } = fixture();
    const capabilities = await call('ograf_get_capabilities', { sections: ['elements'] });
    expect(capabilities.elementSchemas).toMatchObject({
      chart: {
        fill: {
          optional: true,
          type: 'Paint',
          supported: ['solid', 'linear', 'radial', 'conic', 'shader', 'media'],
          requiredFeature: 'mark-paint-v1',
          coverage: expect.any(String),
          frameConsistency: expect.any(String),
          media: expect.any(String),
          trust: expect.any(String),
        },
        markAnimations: { requiredFeature: 'mark-animation-v1' },
      },
    });
    expect(capabilities).not.toHaveProperty('rendererPlugins');
  });

  it('discovers declarative animation packs without exposing license bytes or detailed key data', async () => {
    const { call, motion } = fixture();
    const capabilities = await call('ograf_get_capabilities', { sections: ['plugins'] });
    expect(capabilities.animationPresetPlugins).toMatchObject({
      kinds: ['animation-presets'],
      operation: 'apply_animation_preset',
      packageFiles: ['manifest.json', 'presets.json', 'LICENSE.txt'],
    });
    const payload = await call('ograf_get_project', {
      include: ['plugins', 'layers'],
      tracks: 'none',
    });
    const project = payload.project as {
      compositions: Array<{
        animationPresetPlugins: Array<Record<string, unknown>>;
        layers: Array<Record<string, unknown>>;
      }>;
    };
    const projected = project.compositions[0]!.animationPresetPlugins[0]!;
    expect(projected).toMatchObject({
      manifest: motion.manifest,
      sha256: motion.sha256,
      presets: [{ id: 'fade', name: 'Fade', sides: ['in'] }],
    });
    expect(JSON.stringify(projected)).not.toContain('"keys"');
    expect(JSON.stringify(payload)).not.toContain(motion.licenseText);
    expect(project.compositions[0]!.layers[0]!.animationPresets).toMatchObject({
      in: { presetId: 'fade' },
    });
    const full = await call('ograf_get_project', {});
    const complete = full.project as { compositions: Array<{ animationPresetPlugins: unknown }> };
    expect(complete.compositions[0]!.animationPresetPlugins).toEqual([motion]);
  });
  it('discovers the plugin contract separately and keeps installation/trust human-controlled', async () => {
    const { call, records } = fixture();
    const capabilities = await call('ograf_get_capabilities', { sections: ['plugins'] });
    expect(Object.keys(capabilities).sort()).toEqual([
      'animationPresetPlugins',
      'defaultSessionId',
      'protocolVersion',
      'rendererPlugins',
      'shaderPacks',
    ]);
    expect(capabilities.rendererPlugins).toMatchObject({
      apiVersion: 1,
      kinds: ['chart'],
      packageFiles: ['manifest.json', 'renderer.js', 'LICENSE.txt'],
      installation: expect.stringMatching(
        /requires human Review saved bundle > Trust & Install\. MCP cannot install or grant trust\./,
      ),
      selection: expect.stringMatching(/cannot install or trust code/),
      portability: expect.stringMatching(/selected exact versions/),
    });
    expect(
      records.map((record) => record.name).filter((name) => /plugin|trust|install/.test(name)),
    ).toEqual([]);
  });

  it('returns plugin manifest, identity and UTF-8 sizes without executable/license bytes', async () => {
    const { call, plugin } = fixture();
    const payload = await call('ograf_get_project', { include: ['plugins'], tracks: 'none' });
    expect(projectedPlugins(payload)).toEqual([
      {
        manifest: plugin.manifest,
        sha256: plugin.sha256,
        sourceBytes: Buffer.byteLength(plugin.source, 'utf8'),
        licenseBytes: Buffer.byteLength(plugin.licenseText, 'utf8'),
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain('exact_source_ö_marker');
    expect(JSON.stringify(payload)).not.toContain('exact_license_ö_marker');
    expect(projectedPlugins(payload)[0]).not.toHaveProperty('source');
    expect(projectedPlugins(payload)[0]).not.toHaveProperty('licenseText');
  });

  it('shows a selected pin alongside editable chart controls without leaking its bundle', async () => {
    const { call, plugin } = fixture();
    const payload = await call('ograf_get_project', {
      include: ['plugins', 'elements'],
      tracks: 'none',
    });
    const project = payload.project as {
      compositions: Array<{ layers: Array<{ element: unknown }> }>;
    };
    expect(project.compositions[0]!.layers[0]!.element).toMatchObject({
      type: 'chart',
      provider: { id: plugin.manifest.id, version: plugin.manifest.version, sha256: plugin.sha256 },
    });
    expect(projectedPlugins(payload)[0]).toMatchObject({ sha256: plugin.sha256 });
    expect(JSON.stringify(payload)).not.toContain(plugin.source);
    expect(JSON.stringify(payload)).not.toContain(plugin.licenseText);
  });

  it('projects plugin metadata for a narrow all-section query but preserves explicit full snapshots', async () => {
    const { call, plugin } = fixture();
    expect(
      projectedPlugins(await call('ograf_get_project', { tracks: 'none' }))[0],
    ).not.toHaveProperty('source');
    const full = await call('ograf_get_project', {});
    expect(projectedPlugins(full)).toEqual([plugin]);
    expect(projectedPlugins(full)[0]!.source).toBe(plugin.source);
    expect(projectedPlugins(full)[0]!.licenseText).toBe(plugin.licenseText);
  });

  it('advertises plugin discovery and metadata projection in provider-neutral tool schemas', () => {
    const { records } = fixture();
    const definitions = providerToolDefinitions(records);
    const capabilities = definitions.find(
      (definition) => definition.name === 'ograf_get_capabilities',
    )!;
    const getProject = definitions.find((definition) => definition.name === 'ograf_get_project')!;
    expect(capabilities.inputSchema).toMatchObject({
      properties: {
        sections: { items: { enum: expect.arrayContaining(['plugins']) } },
      },
    });
    expect(getProject.inputSchema).toMatchObject({
      properties: {
        include: { items: { enum: expect.arrayContaining(['plugins']) } },
      },
    });
    expect(
      definitions
        .map((definition) => definition.name)
        .filter((name) => /plugin|trust|install/.test(name)),
    ).toEqual([]);
  });
});
