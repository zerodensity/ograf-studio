import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { computeKeyframeFrames, getLayerTransformAtFrame } from '@ograf-editor/scene-model';
import { createOGrafAuthoringHost } from './index';

describe('OGraf MCP authoring host', () => {
  const host = createOGrafAuthoringHost();
  const client = new Client({ name: 'ograf-mcp-test', version: '1.0.0' });
  let testEditorSocket: WebSocket | null = null;

  beforeAll(async () => {
    await new Promise<void>((resolve) => host.httpServer.listen(0, '127.0.0.1', resolve));
    const port = (host.httpServer.address() as AddressInfo).port;
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
    );
  });

  afterAll(async () => {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      host.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  });

  afterEach(async () => {
    const socket = testEditorSocket;
    testEditorSocket = null;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    socket.close();
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
  });

  it('advertises the safe authoring and certification surface', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'ograf_get_project',
        'ograf_apply_operations',
        'ograf_render_frame',
        'ograf_capture',
        'ograf_render_strip',
        'ograf_preview_operations',
        'ograf_propose_operations',
        'ograf_query_scene',
        'ograf_review_design',
        'ograf_import_asset',
        'ograf_import_svg_bundle',
        'ograf_measure_text',
        'ograf_sample_tracks',
        'ograf_get_changes',
        'ograf_reset_project',
        'ograf_delete_session',
        'ograf_certify_project',
        'ograf_save_project',
        'ograf_export_package',
      ]),
    );
  });

  it('explicitly deletes temporary sessions without allowing live-editor deletion', async () => {
    const sessionId = 'temporary-cleanup-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const deleted = await client.callTool({
      name: 'ograf_delete_session',
      arguments: { sessionId, confirm: true },
    });
    expect(deleted.isError).not.toBe(true);
    expect(host.workspace.sessions.has(sessionId)).toBe(false);

    const refused = await client.callTool({
      name: 'ograf_delete_session',
      arguments: { sessionId: 'editor', confirm: true },
    });
    expect(refused.isError).toBe(true);
    expect(host.workspace.sessions.has('editor')).toBe(true);
  });

  it('publishes complete element, binding, easing, and renderer semantics', async () => {
    const result = await client.callTool({ name: 'ograf_get_capabilities', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      editor: { certificationReady: false, certificationLikelyCause: expect.any(String) },
      elementSchemas: {
        rectangle: { borderRadius: { default: 0 } },
        ellipse: { strokeWidth: { default: 0 } },
        text: {
          textAlign: { values: ['left', 'center', 'right'] },
          autoFit: { values: ['auto-size', 'shrink-to-fit', 'fixed'] },
        },
        image: { src: { default: null } },
        path: { viewBoxWidth: { default: 100 } },
        'image-sequence': { fps: { default: 12 }, loop: { default: true } },
        lottie: { animationData: { default: null }, speed: { default: 1 } },
      },
      semantics: {
        layerPaintOrder: 'ascending-index-paints-later',
        easingApplies: 'incoming',
        textOrigin: 'top-left',
        rectOrigin: 'top-left',
        localLoops: expect.any(String),
        semanticAuthoring: expect.any(String),
      },
      semanticAuthoring: {
        operations: ['set_layer_semantics', 'create_lower_third', 'create_repeater'],
        roles: expect.arrayContaining(['headline', 'container', 'logo']),
        motionPresets: ['wipe-reveal', 'stagger-cascade', 'directional-slide'],
      },
      designSystem: {
        operations: expect.arrayContaining(['upsert_design_token', 'bind_design_token']),
      },
      aiReview: {
        query: 'ograf_query_scene',
        visualDryRun: 'ograf_preview_operations',
        humanProposal: 'ograf_propose_operations',
      },
      loopAnimation: {
        operations: ['set_layer_loop', 'set_loop_property_track', 'remove_layer_loop'],
        activations: ['lifecycle', 'step'],
      },
      bindings: {
        targetProperties: {
          text: ['content', 'color'],
          image: ['src'],
          'image-sequence': [],
          lottie: [],
        },
      },
      canvasLayout: {
        boundsModes: ['allow', 'contain'],
        overflowPreview: ['visible', 'clip'],
      },
    });
    expect((result.structuredContent as { easingPresets: string[] }).easingPresets).toContain(
      'elastic-in-out',
    );
  });

  it('creates a semantic lower third and exposes its intent through inspection', async () => {
    const sessionId = 'semantic-lower-third-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'create_lower_third',
            name: 'Breaking News',
            content: { headline: 'Major update', subheadline: 'Developing story' },
            motion: { style: 'wipe', entrance: 'left', exit: 'down' },
          },
        ],
      },
    });
    expect(applied.isError).not.toBe(true);
    expect(
      (applied.structuredContent as { summary: { semanticBlocks: unknown[] } }).summary
        .semanticBlocks,
    ).toHaveLength(1);

    const inspected = await client.callTool({
      name: 'ograf_inspect_scene',
      arguments: { sessionId },
    });
    const layers = (
      inspected.structuredContent as {
        compositions: Array<{
          layers: Array<{
            id: string;
            parentId: string | null;
            clipChildren: boolean;
            semantics: { role: string };
          }>;
        }>;
      }
    ).compositions[0]!.layers;
    expect(layers.map((layer) => layer.semantics.role)).toEqual([
      'container',
      'accent',
      'headline',
      'subheadline',
    ]);
    expect(layers[0]).toMatchObject({ clipChildren: true, parentId: null });
    expect(layers.slice(1).every((layer) => layer.parentId === layers[0]!.id)).toBe(true);

    const queried = await client.callTool({
      name: 'ograf_query_scene',
      arguments: { sessionId, roles: ['headline'], tagsAll: ['editable'] },
    });
    expect(queried.structuredContent).toMatchObject({
      matched: 1,
      returned: 1,
      layers: [
        {
          name: 'Breaking News · Headline',
          semantics: { role: 'headline' },
          bindings: [{ fieldKey: 'headline', targetProperty: 'content' }],
        },
      ],
    });
  });

  it('authors and inspects local multi-property loops through MCP', async () => {
    const sessionId = 'local-loop-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'text', name: 'Pulse' },
          {
            type: 'set_layer_loop',
            layerName: 'Pulse',
            durationFrames: 20,
            activation: { type: 'lifecycle' },
            repeatCount: null,
          },
          {
            type: 'set_loop_property_track',
            layerName: 'Pulse',
            property: 'opacity',
            keys: [
              { frame: 0, value: 0.2, easing: 'linear' },
              { frame: 10, value: 1, easing: 'sine-out' },
              { frame: 20, value: 0.2, easing: 'sine-in' },
            ],
          },
          {
            type: 'set_loop_property_track',
            layerName: 'Pulse',
            property: 'height',
            keys: [
              { frame: 0, value: 64, easing: 'linear' },
              { frame: 10, value: 72, easing: 'back-out' },
              { frame: 20, value: 64, easing: 'quad-in' },
            ],
          },
        ],
      },
    });
    expect(applied.isError).not.toBe(true);
    expect(
      (applied.structuredContent as { results: Array<{ type: string }> }).results.map(
        (result) => result.type,
      ),
    ).toContain('set_layer_loop');

    const timeline = await client.callTool({
      name: 'ograf_get_timeline',
      arguments: { sessionId },
    });
    const loop = (
      timeline.structuredContent as {
        layers: Array<{
          loop: { durationFrames: number; tracks: Record<string, Array<{ easing: string }>> };
        }>;
      }
    ).layers[0]!.loop;
    expect(loop.durationFrames).toBe(20);
    expect(loop.tracks.opacity![1]!.easing).toBe('sine-out');
    expect(loop.tracks.height![1]!.easing).toBe('back-out');

    const sampled = await client.callTool({
      name: 'ograf_sample_tracks',
      arguments: {
        sessionId,
        frames: [0],
        loopElapsedFrame: 10,
        properties: ['opacity', 'height'],
      },
    });
    const sample = (
      sampled.structuredContent as {
        frames: Array<{
          layers: Array<{
            opacity: number;
            bounds: { height: number };
            properties: Record<string, number>;
          }>;
        }>;
      }
    ).frames[0]!.layers[0]!;
    expect(sample.opacity).toBe(1);
    expect(sample.bounds.height).toBe(72);
    expect(sample.properties).toMatchObject({ opacity: 1, height: 72 });
  });

  it('imports workspace assets and portable SVG companion bundles atomically', async () => {
    const sessionId = 'workspace-import-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const asset = await client.callTool({
      name: 'ograf_import_asset',
      arguments: {
        sessionId,
        expectedRevision: 0,
        path: 'fixtures/mcp-import/note.txt',
      },
    });
    expect(asset.isError).not.toBe(true);
    expect(asset.structuredContent).toMatchObject({
      revision: 1,
      assets: [{ mimeType: 'text/plain' }],
    });

    const bundle = await client.callTool({
      name: 'ograf_import_svg_bundle',
      arguments: {
        sessionId,
        expectedRevision: 1,
        paths: ['fixtures/mcp-import/lower.svg', 'fixtures/mcp-import/lower.css'],
      },
    });
    expect(bundle.isError).not.toBe(true);
    expect(bundle.structuredContent).toMatchObject({
      revision: 2,
      svgAsset: { mimeType: 'image/svg+xml' },
      warnings: [],
    });
    const composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(composition.assets).toHaveLength(2);
    expect(atob(composition.assets[1]!.dataUri.split(',')[1]!)).toContain(
      '<style type="text/css">',
    );
  });

  it('preserves full project reads and supports animated-only projections', async () => {
    const sessionId = 'project-filter-test';
    await client.callTool({
      name: 'ograf_create_project',
      arguments: { sessionId, name: 'Project filter test' },
    });
    const createdRevision = host.workspace.get(sessionId).revision;
    await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: createdRevision,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Filtered rectangle' },
          { type: 'set_composition_layout', patch: { showTitleSafe: true } },
          { type: 'add_canvas_guide', axis: 'vertical', position: 960 },
        ],
      },
    });
    const layerId = host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers[0]!.id;
    await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: host.workspace.get(sessionId).revision,
        operations: [
          {
            type: 'set_property_track',
            layerId,
            property: 'opacity',
            keys: [
              { frame: 0, value: 0, easing: 'linear' },
              { frame: 12, value: 1, easing: 'quad-out' },
            ],
          },
        ],
      },
    });

    const full = await client.callTool({ name: 'ograf_get_project', arguments: { sessionId } });
    expect(full.structuredContent).toEqual(host.workspace.get(sessionId).snapshot());

    const before = host.workspace.get(sessionId).revision;
    const compact = await client.callTool({
      name: 'ograf_get_project',
      arguments: {
        sessionId,
        include: ['layers', 'elements', 'tracks', 'layout'],
        tracks: 'animated-only',
      },
    });
    const compactLayer = (
      compact.structuredContent as {
        project: { compositions: Array<{ layers: Array<Record<string, unknown>> }> };
      }
    ).project.compositions[0]!.layers[0]!;
    expect(compactLayer).toMatchObject({
      name: 'Filtered rectangle',
      element: { type: 'rectangle' },
      animationTracks: { opacity: expect.any(Array) },
    });
    expect(compactLayer).not.toHaveProperty('keyframes');
    expect(compactLayer).not.toHaveProperty('animationTracks.x');
    expect(
      (
        compact.structuredContent as {
          project: { compositions: Array<{ layout: { snappingEnabled: boolean } }> };
        }
      ).project.compositions[0]!.layout.snappingEnabled,
    ).toBe(true);
    expect(
      (
        compact.structuredContent as {
          project: {
            compositions: Array<{
              layout: { showTitleSafe: boolean; guides: Array<{ position: number }> };
            }>;
          };
        }
      ).project.compositions[0]!.layout,
    ).toMatchObject({ showTitleSafe: true, guides: [{ position: 960 }] });
    expect(host.workspace.get(sessionId).revision).toBe(before);
    expect(JSON.stringify(compact.structuredContent).length).toBeLessThan(
      JSON.stringify(full.structuredContent).length,
    );
  });

  it('supports asset creation plus exact layer-name, field-key, and wildcard selectors', async () => {
    const sessionId = 'selector-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'add_asset',
            name: 'Icon',
            mimeType: 'image/svg+xml',
            data: 'PHN2Zy8+',
          },
          { type: 'add_layer', kind: 'text', name: 'D1 High' },
          { type: 'add_layer', kind: 'text', name: 'D2 High' },
          { type: 'add_data_field', fieldType: 'text', key: 'd1_high' },
        ],
      },
    });
    expect(created.isError).not.toBe(true);
    expect(
      (created.structuredContent as { results: Array<{ type: string }> }).results.map(
        (result) => result.type,
      ),
    ).toContain('add_asset');

    const edited = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'set_layer_binding',
            layerName: 'D1 High',
            binding: { fieldKey: 'd1_high', targetProperty: 'content' },
          },
          { type: 'update_transform', layerName: 'D1 High', patch: { x: 456 } },
          {
            type: 'stagger_property_track',
            layerNamePattern: 'D* High',
            property: 'opacity',
            frameOffset: 2,
            keys: [
              { frame: 0, value: 0 },
              { frame: 5, value: 1 },
            ],
          },
        ],
      },
    });
    expect(edited.isError).not.toBe(true);
    const composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(composition.layers[0]!.bindings[0]?.fieldId).toBe(composition.dataFields[0]!.id);
    for (const { frame } of computeKeyframeFrames(composition)) {
      expect(getLayerTransformAtFrame(composition.layers[0]!, frame).x).toBe(456);
    }
    expect(composition.layers[0]!.animationTracks.opacity?.map((key) => key.frame)).toEqual([0, 5]);
    expect(composition.layers[1]!.animationTracks.opacity?.map((key) => key.frame)).toEqual([2, 7]);
  });

  it('resolves layers and fields created earlier in the same atomic batch', async () => {
    const sessionId = 'same-batch-selector-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'text', name: 'Same-batch headline' },
          {
            type: 'add_data_field',
            fieldType: 'text',
            key: 'same_batch_headline',
            defaultValue: 'Initial',
          },
          {
            type: 'set_layer_binding',
            layerName: 'Same-batch headline',
            binding: { fieldKey: 'same_batch_headline', targetProperty: 'content' },
          },
          {
            type: 'update_transform',
            layerName: 'Same-batch headline',
            patch: { x: 777 },
          },
          {
            type: 'update_data_field',
            fieldKey: 'same_batch_headline',
            defaultValue: 'Retargeted without a read',
          },
        ],
      },
    });

    expect(applied.isError).not.toBe(true);
    const layerId = (
      applied.structuredContent as { results: Array<{ type: string; id: string }> }
    ).results.find((result) => result.type === 'add_layer')!.id;
    const composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    const layer = composition.layers[0]!;
    const field = composition.dataFields[0]!;
    expect(layer.bindings[0]?.fieldId).toBe(field.id);
    expect(field.defaultValue).toBe('Retargeted without a read');
    for (const { frame } of computeKeyframeFrames(composition)) {
      expect(getLayerTransformAtFrame(layer, frame).x).toBe(777);
    }

    const duplicated = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'duplicate_group',
            source: { layerIds: [layerId] },
            count: 2,
            bindings: 'clone',
            fieldKeyRewrite: { from: 'same_batch', to: 'copy{n}' },
          },
        ],
      },
    });
    expect(duplicated.isError).not.toBe(true);
    const retargeted = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [
          { type: 'update_data_field', fieldKey: 'copy2_headline', defaultValue: 'Day two' },
          { type: 'update_data_field', fieldKey: 'copy3_headline', defaultValue: 'Day three' },
        ],
      },
    });
    expect(retargeted.isError).not.toBe(true);
    expect(
      Object.fromEntries(
        host.workspace
          .get(sessionId)
          .snapshot()
          .project.compositions[0]!.dataFields.map((item) => [item.key, item.defaultValue]),
      ),
    ).toMatchObject({ copy2_headline: 'Day two', copy3_headline: 'Day three' });
  });

  it('sets multiple independent bindings on one layer with field-key selectors', async () => {
    const sessionId = 'multiple-binding-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'text', name: 'Bound headline' },
          { type: 'add_data_field', fieldType: 'text', key: 'headline' },
          { type: 'add_data_field', fieldType: 'color', key: 'headline_color' },
          {
            type: 'set_layer_bindings',
            layerName: 'Bound headline',
            bindings: [
              { fieldKey: 'headline', targetProperty: 'content' },
              { fieldKey: 'headline_color', targetProperty: 'color' },
            ],
          },
        ],
      },
    });

    expect(applied.isError).not.toBe(true);
    const composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(composition.layers[0]!.bindings).toEqual([
      { fieldId: composition.dataFields[0]!.id, targetProperty: 'content' },
      { fieldId: composition.dataFields[1]!.id, targetProperty: 'color' },
    ]);
  });

  it('matches structural editor actions for lifecycle, canvas groups, custom actions, and assets', async () => {
    const sessionId = 'editor-parity-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Plate' },
          { type: 'add_layer', kind: 'text', name: 'Headline' },
          { type: 'add_lifecycle_step', name: 'Second state' },
          {
            type: 'add_custom_action',
            actionId: 'flash',
            name: 'Flash graphic',
            description: 'Operator-triggered accent.',
          },
          {
            type: 'add_asset',
            name: 'pixel.png',
            mimeType: 'image/png',
            data: 'iVBORw0KGgo=',
          },
        ],
      },
    });
    expect(created.isError).not.toBe(true);
    let composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    const layerIds = composition.layers.map((layer) => layer.id);
    const addedStep = composition.keyframes.find((keyframe) => keyframe.name === 'Second state')!;
    const assetId = composition.assets[0]!.id;

    const edited = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          { type: 'group_layers', layerIds },
          {
            type: 'rename_lifecycle_keyframe',
            keyframeId: addedStep.id,
            name: 'Renamed state',
          },
          { type: 'move_lifecycle_keyframe', keyframeId: addedStep.id, frame: 26 },
          {
            type: 'update_custom_action',
            actionId: 'flash',
            nextActionId: 'pulse',
            name: 'Pulse graphic',
          },
          { type: 'remove_asset', assetId },
        ],
      },
    });
    expect(edited.isError).not.toBe(true);
    composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(new Set(composition.layers.map((layer) => layer.groupId)).size).toBe(1);
    expect(composition.layers[0]!.groupId).toBeTruthy();
    expect(composition.keyframes.find((keyframe) => keyframe.id === addedStep.id)?.name).toBe(
      'Renamed state',
    );
    expect(
      computeKeyframeFrames(composition).find((keyframe) => keyframe.keyframeId === addedStep.id)
        ?.frame,
    ).toBe(26);
    expect(composition.customActions[0]).toMatchObject({
      actionId: 'pulse',
      name: 'Pulse graphic',
    });
    expect(composition.assets).toEqual([]);

    const removed = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [
          { type: 'ungroup_layers', layerIds: [layerIds[0]] },
          { type: 'remove_lifecycle_step', keyframeId: addedStep.id },
          { type: 'remove_custom_action', actionId: 'pulse' },
        ],
      },
    });
    expect(removed.isError).not.toBe(true);
    composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(composition.layers.every((layer) => layer.groupId === null)).toBe(true);
    expect(composition.keyframes.some((keyframe) => keyframe.id === addedStep.id)).toBe(false);
    expect(composition.customActions).toEqual([]);
  });

  it('saves and instantiates reusable components with complete generated mappings', async () => {
    const sessionId = 'component-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Row plate' },
          { type: 'add_layer', kind: 'text', name: 'Row label' },
        ],
      },
    });
    expect(created.isError).not.toBe(true);
    let composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    const sourceIds = composition.layers.map((layer) => layer.id);

    const saved = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [{ type: 'save_component', name: 'Score row', layerIds: sourceIds }],
      },
    });
    expect(saved.isError).not.toBe(true);
    composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    const componentId = composition.components[0]!.id;

    const inserted = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [{ type: 'instantiate_component', componentId, offset: { x: 120, y: 60 } }],
      },
    });
    expect(inserted.isError).not.toBe(true);
    const payload = inserted.structuredContent as { results: unknown[] };
    expect(payload.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'instantiate_component',
          componentId,
          groupId: expect.any(String),
          layers: expect.any(Object),
          fields: expect.any(Object),
        }),
      ]),
    );
    composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(composition.layers).toHaveLength(4);
    expect(new Set(composition.layers.slice(2).map((layer) => layer.groupId)).size).toBe(1);
  });

  it('duplicates a nine-layer cell with authored-key frame offsets and anchored lifecycle keys', async () => {
    const sessionId = 'duplicate-offset-acceptance-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const initialComposition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    const built = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'set_transition',
            transitionId: initialComposition.transitions[0]!.id,
            durationFrames: 30,
          },
          {
            type: 'set_transition',
            transitionId: initialComposition.transitions[1]!.id,
            durationFrames: 20,
          },
          ...Array.from({ length: 9 }, (_, index) => ({
            type: 'add_layer',
            kind: 'rectangle',
            name: `D1 Layer ${index + 1}`,
          })),
          ...Array.from({ length: 9 }, (_, index) => ({
            type: 'set_property_key',
            layerName: `D1 Layer ${index + 1}`,
            property: 'x',
            frame: 38,
            value: 500 + index,
          })),
        ],
      },
    });
    expect(built.isError).not.toBe(true);
    const sourceIds = (
      built.structuredContent as { results: Array<{ type: string; id: string }> }
    ).results
      .filter((result) => result.type === 'add_layer')
      .map((result) => result.id);

    const duplicated = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'duplicate_group',
            source: { layerIds: sourceIds },
            count: 6,
            frameOffset: 2,
            namePattern: 'D{n} ',
          },
        ],
      },
    });
    expect(duplicated.isError).not.toBe(true);
    const copies = (
      duplicated.structuredContent as {
        summary: {
          duplicateGroups: Array<{
            copies: Array<{ layers: Record<string, string> }>;
          }>;
        };
      }
    ).summary.duplicateGroups[0]!.copies;
    const d1 = sourceIds[0]!;
    const d4 = copies[2]!.layers[d1]!;
    const d7 = copies[5]!.layers[d1]!;
    const sampled = await client.callTool({
      name: 'ograf_sample_tracks',
      arguments: {
        sessionId,
        frames: [38, 44, 50],
        layerIds: [d1, d4, d7],
        properties: ['x'],
      },
    });
    const frames = (
      sampled.structuredContent as {
        frames: Array<{ frame: number; layers: Array<{ bounds: { x: number } }> }>;
      }
    ).frames;
    expect(frames.find((frame) => frame.frame === 38)!.layers[0]!.bounds.x).toBe(500);
    expect(frames.find((frame) => frame.frame === 44)!.layers[1]!.bounds.x).toBe(500);
    expect(frames.find((frame) => frame.frame === 50)!.layers[2]!.bounds.x).toBe(500);
  });

  it('includes actionable authoring warnings in committed and dry-run text responses', async () => {
    for (const [suffix, dryRun] of [
      ['commit', false],
      ['dry-run', true],
    ] as const) {
      const sessionId = `warning-text-${suffix}`;
      await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
      const result = await client.callTool({
        name: 'ograf_apply_operations',
        arguments: {
          sessionId,
          expectedRevision: 0,
          dryRun,
          operations: [
            {
              type: 'add_layer',
              kind: 'text',
              name: 'D1 Day',
              transform: { height: 40 },
              element: { fontSize: 34, autoFit: 'shrink-to-fit' },
            },
          ],
        },
      });
      const primaryText = (result.content as Array<{ text?: string }>)[0]?.text ?? '';
      expect(primaryText).toContain('warnings=3');
      expect(primaryText).toContain('Operation 0');
      expect(primaryText).toContain('D1 Day');
      expect(primaryText).toContain('height/fontSize ratio');
      expect(host.workspace.get(sessionId).revision).toBe(dryRun ? 0 : 1);
    }
  });

  it('applies an atomic operation with optimistic concurrency', async () => {
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId: 'editor',
        expectedRevision: 0,
        operations: [{ type: 'add_layer', kind: 'text', name: 'Agent title' }],
        reason: 'MCP integration test',
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ revision: 1, dryRun: false });

    const snapshot = await client.callTool({
      name: 'ograf_get_project',
      arguments: { sessionId: 'editor' },
    });
    expect(JSON.stringify(snapshot.structuredContent)).toContain('Agent title');
  });

  it('rejects stale revisions instead of overwriting concurrent editor work', async () => {
    const stale = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId: 'editor',
        expectedRevision: 0,
        operations: [{ type: 'set_project_metadata', name: 'Stale write' }],
      },
    });
    expect(stale.isError).toBe(true);
    expect(JSON.stringify(stale.content)).toContain('Revision conflict');
  });

  it('emits opt-in broadcast house-rule warnings without changing validity or revision', async () => {
    const before = host.workspace.get('editor').revision;
    const result = await client.callTool({
      name: 'ograf_validate_project',
      arguments: { sessionId: 'editor', broadcastLint: true, interlacedOutput: true },
    });
    expect(result.isError).not.toBe(true);
    const lint = result.structuredContent as {
      validation: { valid: boolean; warnings: string[] };
      broadcastLint: { warnings: string[] };
    };
    expect(lint.validation.valid).toBe(true);
    expect(lint.broadcastLint.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('title-safe')]),
    );
    expect(host.workspace.get('editor').revision).toBe(before);
  });

  it('exempts bleed layers independently on each safe-area axis', async () => {
    const sessionId = 'full-frame-lint-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'add_layer',
            kind: 'rectangle',
            name: 'Full frame backdrop',
            transform: { x: 0, y: 0, width: 1920, height: 1080 },
          },
          {
            type: 'add_layer',
            kind: 'rectangle',
            name: 'Full width header',
            transform: { x: 0, y: 200, width: 1920, height: 100 },
          },
          {
            type: 'add_layer',
            kind: 'rectangle',
            name: 'Full height side bar',
            transform: { x: 300, y: 0, width: 100, height: 1080 },
          },
          {
            type: 'add_layer',
            kind: 'rectangle',
            name: 'Unsafe partial panel',
            transform: { x: 0, y: 100, width: 400, height: 100 },
          },
        ],
      },
    });
    const result = await client.callTool({
      name: 'ograf_validate_project',
      arguments: { sessionId, broadcastLint: true },
    });
    const warnings = (result.structuredContent as { broadcastLint: { warnings: string[] } })
      .broadcastLint.warnings;
    expect(warnings.join('\n')).not.toContain('Full frame backdrop');
    expect(warnings.join('\n')).not.toContain('Full width header');
    expect(warnings.join('\n')).not.toContain('Full height side bar');
    expect(warnings.join('\n')).toContain('Unsafe partial panel');
    expect(warnings.join('\n')).toContain('horizontal axis');
  });

  it('returns creation IDs directly and supports a follow-up mutation without a project read', async () => {
    const sessionId = 'creation-results-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'text', name: 'Created headline' },
          { type: 'add_data_field', fieldType: 'text', key: 'headline' },
        ],
      },
    });
    const results = (
      created.structuredContent as {
        results: Array<{ index: number; type: string; id: string; name?: string; key?: string }>;
      }
    ).results;
    const layerId = results.find((result) => result.type === 'add_layer')!.id;
    const fieldId = results.find((result) => result.type === 'add_data_field')!.id;
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, id: layerId, name: 'Created headline' }),
        expect.objectContaining({ index: 1, id: fieldId, key: 'headline' }),
      ]),
    );
    expect(JSON.stringify(created.content)).toContain(layerId);

    const styled = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          { type: 'update_element', layerId, patch: { content: 'No intervening read' } },
          { type: 'set_layer_binding', layerId, binding: { fieldId, targetProperty: 'content' } },
        ],
      },
    });
    expect(styled.isError).not.toBe(true);

    const refused = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [{ type: 'remove_data_field', fieldId }],
      },
    });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toMatch(/Created headline.*force=true/);
    const removed = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [{ type: 'remove_data_field', fieldId, force: true }],
      },
    });
    expect(
      (removed.structuredContent as { summary: { clearedBindings: unknown[] } }).summary
        .clearedBindings,
    ).toHaveLength(1);
  });

  it('exposes timeline-only grouping as revisioned MCP operations', async () => {
    const sessionId = 'timeline-group-tool-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Panel' },
          { type: 'add_layer', kind: 'text', name: 'Title' },
        ],
      },
    });
    const layerIds = (
      created.structuredContent as { results: Array<{ type: string; id: string }> }
    ).results
      .filter((entry) => entry.type === 'add_layer')
      .map((entry) => entry.id);
    const grouped = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'create_timeline_group',
            layerIds,
            name: 'Forecast Day',
            color: '#31b7d4',
          },
        ],
      },
    });
    expect(grouped.isError).not.toBe(true);
    const groupResult = (
      grouped.structuredContent as {
        results: Array<{ type: string; id: string; name: string; layerIds: string[] }>;
      }
    ).results.find((entry) => entry.type === 'create_timeline_group')!;
    expect(groupResult).toMatchObject({ name: 'Forecast Day', layerIds });

    const inspected = await client.callTool({
      name: 'ograf_inspect_scene',
      arguments: { sessionId },
    });
    expect(inspected.structuredContent).toMatchObject({
      compositions: [
        {
          layout: {
            timelineGroups: [
              { id: groupResult.id, name: 'Forecast Day', color: '#31b7d4', layerIds },
            ],
          },
        },
      ],
    });

    const edited = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [
          {
            type: 'rename_timeline_group',
            groupId: groupResult.id,
            name: 'Day One',
          },
          {
            type: 'set_timeline_group_color',
            groupId: groupResult.id,
            color: '#7c6cff',
          },
        ],
      },
    });
    expect(edited.isError).not.toBe(true);
    expect(
      (
        edited.structuredContent as {
          project: {
            compositions: Array<{
              layout: { timelineFolders: Array<{ id: string; name: string; color: string }> };
            }>;
          };
        }
      ).project.compositions[0]!.layout.timelineFolders,
    ).toContainEqual(
      expect.objectContaining({ id: groupResult.id, name: 'Day One', color: '#7c6cff' }),
    );

    const ungrouped = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 3,
        operations: [{ type: 'ungroup_timeline_group', groupId: groupResult.id }],
      },
    });
    expect(ungrouped.isError).not.toBe(true);
    expect(
      (
        ungrouped.structuredContent as {
          project: { compositions: Array<{ layout: { timelineFolders: unknown[] } }> };
        }
      ).project.compositions[0]!.layout.timelineFolders,
    ).toEqual([]);
  });

  it('checks contrast against full and partial backing at each step frame', async () => {
    const sessionId = 'contrast-backing-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'add_layer',
            kind: 'rectangle',
            name: 'Opaque panel',
            transform: { x: 200, y: 300, width: 600, height: 100 },
            element: { fill: '#0e1420' },
          },
          {
            type: 'add_layer',
            kind: 'text',
            name: 'Role',
            transform: { x: 200, y: 300, width: 600, height: 100 },
            element: { color: '#a8b4c4', fontSize: 32 },
          },
        ],
      },
    });
    const panelId = (
      created.structuredContent as { results: Array<{ type: string; id: string }> }
    ).results.find((result) => result.type === 'add_layer')!.id;
    const full = await client.callTool({
      name: 'ograf_validate_project',
      arguments: { sessionId, broadcastLint: true },
    });
    expect(
      (full.structuredContent as { broadcastLint: { warnings: string[] } }).broadcastLint.warnings,
    ).not.toEqual(expect.arrayContaining([expect.stringContaining('text layer "Role"')]));

    await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'set_property_track',
            layerId: panelId,
            property: 'width',
            keys: [
              { frame: 0, value: 300 },
              { frame: 12, value: 300 },
              { frame: 24, value: 300 },
            ],
          },
        ],
      },
    });
    const partial = await client.callTool({
      name: 'ograf_validate_project',
      arguments: { sessionId, broadcastLint: true },
    });
    expect(
      (partial.structuredContent as { broadcastLint: { warnings: string[] } }).broadcastLint
        .warnings,
    ).toEqual(expect.arrayContaining([expect.stringMatching(/Role.*50% unbacked.*frame 12/)]));

    await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [{ type: 'remove_layer', layerId: panelId }],
      },
    });
    const unbacked = await client.callTool({
      name: 'ograf_validate_project',
      arguments: { sessionId, broadcastLint: true },
    });
    expect(
      (unbacked.structuredContent as { broadcastLint: { warnings: string[] } }).broadcastLint
        .warnings,
    ).toEqual(expect.arrayContaining([expect.stringMatching(/Role.*no opaque backing.*frame 12/)]));
  });

  it('samples complementary wipe tracks without a browser and preserves a constant right edge', async () => {
    const sessionId = 'sample-tracks-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Wipe slab' }],
      },
    });
    const layerId = (created.structuredContent as { results: Array<{ id: string }> }).results[0]!
      .id;
    await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'set_property_track',
            layerId,
            property: 'x',
            keys: [
              { frame: 9, value: 192, easing: 'linear' },
              { frame: 22, value: 1112, easing: 'linear' },
            ],
          },
          {
            type: 'set_property_track',
            layerId,
            property: 'width',
            keys: [
              { frame: 9, value: 920, easing: 'linear' },
              { frame: 22, value: 0, easing: 'linear' },
            ],
          },
        ],
      },
    });
    const before = host.workspace.get(sessionId).revision;
    const sampled = await client.callTool({
      name: 'ograf_sample_tracks',
      arguments: { sessionId, frames: [9, 13, 17, 22], layerIds: [layerId] },
    });
    const rightEdges = (
      sampled.structuredContent as {
        frames: Array<{ layers: Array<{ bounds: { right: number } }> }>;
      }
    ).frames.map((frame) => frame.layers[0]!.bounds.right);
    expect(rightEdges).toEqual([1112, 1112, 1112, 1112]);
    expect(host.workspace.get(sessionId).revision).toBe(before);
  });

  it('returns projected interlace lint and generated IDs from dry run without mutation', async () => {
    const sessionId = 'dry-run-diagnostics-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        dryRun: true,
        broadcastLint: true,
        interlacedOutput: true,
        operations: [
          {
            type: 'add_layer',
            kind: 'rectangle',
            name: 'Two-pixel divider',
            transform: { x: 200, y: 500, width: 800, height: 2 },
          },
        ],
      },
    });
    const structured = result.structuredContent as {
      results: Array<{ id: string }>;
      projectedDiagnostics: { broadcastLint: { warnings: string[] } };
    };
    expect(structured.results[0]!.id).toMatch(/^layer-/);
    expect(structured.projectedDiagnostics.broadcastLint.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Two-pixel divider')]),
    );
    expect(host.workspace.get(sessionId).revision).toBe(0);
    expect(host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers).toHaveLength(
      0,
    );
  });

  it('authors and samples animatable gradient-stop offsets through MCP', async () => {
    const sessionId = 'gradient-stop-animation';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'add_layer',
            kind: 'rectangle',
            name: 'Animated glint',
            element: {
              fill: {
                type: 'linear',
                angle: 90,
                stops: [
                  { offset: 0, color: '#ffffff', opacity: 0 },
                  { offset: 0.2, color: '#ffffff', opacity: 0.8 },
                  { offset: 0.4, color: '#ffffff', opacity: 0 },
                ],
              },
            },
          },
        ],
      },
    });
    const layerId = (
      created.structuredContent as { results: Array<{ type: string; id: string }> }
    ).results.find((entry) => entry.type === 'add_layer')!.id;
    const animated = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'set_property_track',
            layerId,
            property: 'fill.stops[1].offset',
            keys: [
              { frame: 0, value: 0.2, easing: 'linear' },
              { frame: 12, value: 0.8, easing: 'linear' },
            ],
          },
        ],
      },
    });
    expect(animated.isError).not.toBe(true);

    const sampled = await client.callTool({
      name: 'ograf_sample_tracks',
      arguments: {
        sessionId,
        frames: [6],
        layerIds: [layerId],
        properties: ['fill.stops[1].offset'],
      },
    });
    const value = (
      sampled.structuredContent as {
        frames: Array<{ layers: Array<{ properties: Record<string, number> }> }>;
      }
    ).frames[0]!.layers[0]!.properties['fill.stops[1].offset'];
    expect(value).toBeCloseTo(0.5);
  });

  it('computes safe-area pixels and exposes revision history and undoable reset', async () => {
    const sessionId = 'safe-history-reset-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Temporary' }],
      },
    });
    const inspected = await client.callTool({
      name: 'ograf_inspect_scene',
      arguments: { sessionId },
    });
    expect(
      (
        inspected.structuredContent as {
          compositions: Array<{ layout: { safeAreas: Record<string, unknown> } }>;
        }
      ).compositions[0]!.layout.safeAreas,
    ).toEqual({
      actionSafe: { x: 96, y: 54, width: 1728, height: 972 },
      titleSafe: { x: 192, y: 108, width: 1536, height: 864 },
    });
    const changes = await client.callTool({
      name: 'ograf_get_changes',
      arguments: { sessionId, sinceRevision: 0 },
    });
    expect(
      (changes.structuredContent as { changes: Array<{ source: string }> }).changes.map(
        (change) => change.source,
      ),
    ).toEqual(['agent']);

    const reset = await client.callTool({
      name: 'ograf_reset_project',
      arguments: { sessionId, expectedRevision: 1, confirm: true },
    });
    expect((reset.structuredContent as { revision: number }).revision).toBe(2);
    expect(host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers).toHaveLength(
      0,
    );
    await client.callTool({
      name: 'ograf_undo',
      arguments: { sessionId, expectedRevision: 2 },
    });
    expect(host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers[0]!.name).toBe(
      'Temporary',
    );
  });

  it('distinguishes an open but unresponsive editor and returns actionable timeout details', async () => {
    const port = (host.httpServer.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`);
    testEditorSocket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(
      JSON.stringify({
        type: 'editor.hello',
        project: host.workspace.get('editor').snapshot().project,
      }),
    );
    await new Promise<void>((resolve) => socket.once('message', () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const capabilities = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: {},
    });
    expect(capabilities.structuredContent).toMatchObject({
      editor: { connected: true, responsive: false, likelyCause: 'tab-throttled' },
      liveEditorConnected: false,
    });

    await expect(
      host.bridge.capture(
        {
          target: 'composition',
          project: host.workspace.get('editor').snapshot().project,
          frame: 0,
          maxDimension: 64,
          matte: 'checker',
        },
        25,
      ),
    ).rejects.toThrow(
      /capture timed out after 25 ms.*heartbeat latency.*foreground and retry.*connected: true, responsive: false/i,
    );
  });

  it('keeps editor hello revision-neutral and surfaces divergent tab state as a conflict', async () => {
    const port = (host.httpServer.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`);
    testEditorSocket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const messages: Array<{ type: string; reason?: string; revision?: number }> = [];
    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()) as (typeof messages)[number]);
    });
    const before = host.workspace.get('editor').snapshot();
    socket.send(JSON.stringify({ type: 'editor.hello', project: before.project }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(host.workspace.get('editor').revision).toBe(before.revision);

    const divergent = structuredClone(before.project);
    divergent.name = 'Divergent second tab';
    socket.send(JSON.stringify({ type: 'editor.hello', project: divergent }));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(host.workspace.get('editor').revision).toBe(before.revision);
    expect(host.workspace.get('editor').snapshot().project.name).toBe(before.project.name);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'project.replace',
          revision: before.revision,
          reason: expect.stringContaining('handshake conflict'),
        }),
      ]),
    );
  });

  it('fails certification closed when no live browser editor is connected', async () => {
    const result = await client.callTool({
      name: 'ograf_certify_project',
      arguments: { sessionId: 'editor' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('requires OGraf Studio to be open');
  });

  it('fails PNG capture closed without mutating revision when no editor is connected', async () => {
    const before = host.workspace.get('editor').revision;
    const textLayerId = host.workspace
      .get('editor')
      .snapshot()
      .project.compositions[0]!.layers.find((layer) => layer.element.type === 'text')!.id;
    for (const [name, arguments_] of [
      ['ograf_capture', { sessionId: 'editor', target: 'composition', frame: 0 }],
      ['ograf_render_strip', { sessionId: 'editor', frames: [0] }],
      ['ograf_measure_text', { sessionId: 'editor', layerId: textLayerId }],
    ] as const) {
      const result = await client.callTool({ name, arguments: arguments_ });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('requires OGraf Studio to be open');
    }
    expect(host.workspace.get('editor').revision).toBe(before);
  });

  it('keeps certified save and export closed when the editor is disconnected', async () => {
    for (const [name, path] of [
      ['ograf_save_project', 'fixtures/disconnected-gate.ogeproj'],
      ['ograf_export_package', 'fixtures/disconnected-gate.ograf.zip'],
    ] as const) {
      const result = await client.callTool({
        name,
        arguments: { sessionId: 'editor', path, confirm: true },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('requires OGraf Studio to be open');
    }
  });

  it('reports certification readiness and certifies twice in one editor page session', async () => {
    const port = (host.httpServer.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`);
    testEditorSocket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    let certificationCount = 0;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; requestId?: string };
      if (!message.requestId) return;
      if (message.type === 'heartbeat.request') {
        socket.send(JSON.stringify({ type: 'heartbeat.result', requestId: message.requestId }));
      } else if (message.type === 'certification.request') {
        certificationCount++;
        socket.send(
          JSON.stringify({
            type: 'certification.result',
            requestId: message.requestId,
            result: { valid: true, checks: [], errors: [] },
          }),
        );
      }
    });
    socket.send(
      JSON.stringify({
        type: 'editor.hello',
        project: host.workspace.get('editor').snapshot().project,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const capabilities = await client.callTool({ name: 'ograf_get_capabilities', arguments: {} });
    expect(capabilities.structuredContent).toMatchObject({
      editor: { connected: true, certificationReady: true },
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const certified = await client.callTool({
        name: 'ograf_certify_project',
        arguments: { sessionId: 'editor' },
      });
      expect(certified.isError).not.toBe(true);
    }
    expect(certificationCount).toBe(2);
  });

  it('returns a short-lived PNG URL and optional inline image without mutating revision', async () => {
    const port = (host.httpServer.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`);
    testEditorSocket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(
      JSON.stringify({
        type: 'editor.hello',
        project: host.workspace.get('editor').snapshot().project,
      }),
    );
    await new Promise<void>((resolve) => socket.once('message', () => resolve()));
    const before = host.workspace.get('editor').revision;

    const transparentPixel =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcJR8QAAAABJRU5ErkJggg==';
    const capturedLayerNames: string[][] = [];
    let presentedProposalId: string | null = null;
    let resolveProposalDecision: ((result: { status: string; revision?: number }) => void) | null =
      null;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        requestId?: string;
        request?: {
          frame?: number;
          project?: { compositions: Array<{ layers: Array<{ name: string }> }> };
        };
        proposal?: { id: string };
        proposalId?: string;
        result?: { status: string; revision?: number };
      };
      if (message.type === 'proposal.present' && message.proposal) {
        presentedProposalId = message.proposal.id;
        return;
      }
      if (message.type === 'proposal.resolved' && message.result) {
        resolveProposalDecision?.(message.result);
        return;
      }
      if (!message.requestId) return;
      if (message.type === 'heartbeat.request') {
        socket.send(JSON.stringify({ type: 'heartbeat.result', requestId: message.requestId }));
      } else if (message.type === 'capture.request') {
        if (message.request?.project) {
          capturedLayerNames.push(
            message.request.project.compositions[0]!.layers.map((layer) => layer.name),
          );
        }
        socket.send(
          JSON.stringify({
            type: 'capture.result',
            requestId: message.requestId,
            result: {
              mimeType: 'image/png',
              data: transparentPixel,
              width: 1,
              height: 1,
              originalWidth: 1,
              originalHeight: 1,
              resolvedFonts: [],
            },
          }),
        );
      } else if (message.type === 'strip.request') {
        socket.send(
          JSON.stringify({
            type: 'strip.result',
            requestId: message.requestId,
            result: {
              mimeType: 'image/png',
              data: transparentPixel,
              width: 1,
              height: 1,
              originalWidth: 1,
              originalHeight: 1,
              resolvedFonts: [],
              frames: [0],
              columns: 1,
              rows: 1,
              tileWidth: 1,
              tileHeight: 1,
              compositionWidth: 1920,
              compositionHeight: 1080,
            },
          }),
        );
      } else if (message.type === 'measure-text.request') {
        socket.send(
          JSON.stringify({
            type: 'measure-text.result',
            requestId: message.requestId,
            result: {
              layerId: 'measured-layer',
              layerName: 'Measured layer',
              frame: message.request?.frame ?? 0,
              text: 'A long title',
              width: 280,
              height: 58,
              boxWidth: 200,
              boxHeight: 60,
              lines: 1,
              overflowsParent: true,
              appliedShrinkRatio: 0.5,
              degenerate: true,
              resolvedFont: {
                requestedFamily: 'Missing Font, system-ui',
                resolvedFamily: 'system-ui',
                resolution: 'inferred',
              },
              clippedAt: 8,
            },
          }),
        );
      }
    });

    const result = await client.callTool({
      name: 'ograf_capture',
      arguments: {
        sessionId: 'editor',
        target: 'composition',
        maxDimension: 64,
        enableBase64Response: true,
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image', mimeType: 'image/png' })]),
    );
    expect((result.structuredContent as { frame: number }).frame).toBeGreaterThan(0);
    const url = (result.structuredContent as { url: string }).url;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^image\/png/);
    expect(new Uint8Array(await response.arrayBuffer()).slice(1, 4)).toEqual(
      new Uint8Array([0x50, 0x4e, 0x47]),
    );
    expect(host.workspace.get('editor').revision).toBe(before);

    const projected = await client.callTool({
      name: 'ograf_preview_operations',
      arguments: {
        sessionId: 'editor',
        expectedRevision: before,
        render: 'frame',
        operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Dry-run preview panel' }],
      },
    });
    expect(projected.isError).not.toBe(true);
    expect(projected.structuredContent).toMatchObject({
      baseRevision: before,
      revisionUnchanged: true,
      dryRun: true,
    });
    expect(capturedLayerNames.at(-1)).toContain('Dry-run preview panel');
    expect(host.workspace.get('editor').revision).toBe(before);

    const strip = await client.callTool({
      name: 'ograf_render_strip',
      arguments: { sessionId: 'editor', frames: [0], enableBase64Response: true },
    });
    expect(strip.isError).not.toBe(true);
    expect(strip.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image', mimeType: 'image/png' })]),
    );
    expect(strip.structuredContent).toMatchObject({ frames: [0], columns: 1, rows: 1 });
    expect(host.workspace.get('editor').revision).toBe(before);

    const textLayer = host.workspace
      .get('editor')
      .snapshot()
      .project.compositions[0]!.layers.find((layer) => layer.element.type === 'text');
    expect(textLayer).toBeDefined();
    const measurement = await client.callTool({
      name: 'ograf_measure_text',
      arguments: { sessionId: 'editor', layerId: textLayer!.id, text: 'A long title' },
    });
    expect(measurement.isError).not.toBe(true);
    expect(measurement.structuredContent).toMatchObject({
      frame: expect.any(Number),
      overflowsParent: true,
      appliedShrinkRatio: 0.5,
      degenerate: true,
      clippedAt: 8,
      resolvedFont: { resolvedFamily: 'system-ui' },
    });
    expect(host.workspace.get('editor').revision).toBe(before);

    const overflowValidation = await client.callTool({
      name: 'ograf_validate_project',
      arguments: { sessionId: 'editor', browserTextOverflow: true },
    });
    expect(overflowValidation.isError).not.toBe(true);
    expect(
      (overflowValidation.structuredContent as { validation: { warnings: string[] } }).validation
        .warnings,
    ).toEqual(expect.arrayContaining([expect.stringContaining('overflows its 200×60 box')]));
    expect(
      (overflowValidation.structuredContent as { overflowSummary: { degenerate: number } })
        .overflowSummary.degenerate,
    ).toBeGreaterThan(0);
    expect(host.workspace.get('editor').revision).toBe(before);

    const proposed = await client.callTool({
      name: 'ograf_propose_operations',
      arguments: {
        sessionId: 'editor',
        expectedRevision: before,
        title: 'Add reviewed panel',
        render: 'frame',
        operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Accepted review panel' }],
      },
    });
    expect(proposed.isError).not.toBe(true);
    const proposalId = (proposed.structuredContent as { proposalId: string }).proposalId;
    for (let attempt = 0; attempt < 20 && presentedProposalId !== proposalId; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(presentedProposalId).toBe(proposalId);
    const decision = new Promise<{ status: string; revision?: number }>((resolve) => {
      resolveProposalDecision = resolve;
    });
    socket.send(JSON.stringify({ type: 'proposal.decision', proposalId, decision: 'accept' }));
    await expect(decision).resolves.toMatchObject({ status: 'accepted', revision: before + 1 });
    expect(
      host.workspace
        .get('editor')
        .snapshot()
        .project.compositions[0]!.layers.some((layer) => layer.name === 'Accepted review panel'),
    ).toBe(true);

    socket.close();
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    testEditorSocket = null;
  });
});
