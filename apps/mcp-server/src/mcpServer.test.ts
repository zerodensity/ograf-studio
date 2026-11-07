import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import {
  computeKeyframeFrames,
  getEffectStack,
  getLayerTransformAtFrame,
  getLayerPropertyValueAtFrame,
  createLayerOfKind,
  createLayerKeyframe,
  createDefaultTransform,
  createLayerPropertyKeyframe,
  createProject,
  createShaderResource,
  createDefaultGradient,
  createShaderPaint,
} from '@ograf-editor/scene-model';
import { createOGrafAuthoringHost } from './index';
import {
  createOGrafToolRecords,
  filterInAppToolRecords,
  providerToolWireBytes,
} from '@ograf-editor/agent-tools';

describe('OGraf MCP authoring host', () => {
  const host = createOGrafAuthoringHost();
  const client = new Client({ name: 'ograf-mcp-test', version: '1.0.0' });
  let testEditorSocket: WebSocket | null = null;
  it('authors seeded text animators and experimental motion blur through existing operations', async () => {
    const sessionId = 'mcp-text-animators';
    const session = host.workspace.create(sessionId);
    const animator = {
      id: 'rise',
      unit: 'character',
      shape: 'ramp',
      order: 'random',
      seed: 42,
      durationFrames: 25,
      offsetKeyframes: [
        { frame: 0, value: -1 },
        { frame: 25, value: 1 },
      ],
      properties: { y: 30, opacity: 0 },
    };
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'text', name: 'Headline' },
          {
            type: 'update_element',
            layerName: 'Headline',
            patch: { textAnimation: { animators: [animator] } },
          },
          {
            type: 'set_layer_layout',
            layerName: 'Headline',
            motionBlur: { enabled: true, shutterAngle: 180 },
          },
        ],
      },
    });
    expect(applied.isError, JSON.stringify(applied.content)).not.toBe(true);
    const layer = session.snapshot().project.compositions[0]!.layers[0]!;
    expect(layer.element).toMatchObject({
      type: 'text',
      textAnimation: { animators: [{ ...animator, enabled: true }] },
    });
    expect(layer.motionBlur).toEqual({ enabled: true, shutterAngle: 180 });
    const before = session.snapshot();
    for (const bad of [
      {
        type: 'set_layer_layout',
        layerName: 'Headline',
        motionBlur: { enabled: true, shutterAngle: 361 },
      },
      {
        type: 'update_element',
        layerName: 'Headline',
        patch: { textAnimation: { animators: [{ ...animator, order: 'nonsense' }] } },
      },
    ]) {
      const rejected = await client.callTool({
        name: 'ograf_apply_operations',
        arguments: { sessionId, expectedRevision: 1, operations: [bad] },
      });
      expect(rejected.isError, `${JSON.stringify(bad)}: ${JSON.stringify(rejected.content)}`).toBe(
        true,
      );
      expect(session.snapshot()).toEqual(before);
    }
    const count = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'update_element',
            layerName: 'Headline',
            patch: { textAnimation: { type: 'count-up', countRoll: 'up' } },
          },
        ],
      },
    });
    expect(count.isError, JSON.stringify(count.content)).not.toBe(true);
    expect(session.snapshot().project.compositions[0]!.layers[0]!.element).toMatchObject({
      textAnimation: { type: 'count-up', countRoll: 'up', animators: [{ id: 'rise' }] },
    });
    const gradient = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [
          {
            type: 'update_element',
            layerName: 'Headline',
            patch: {
              fill: createDefaultGradient(),
              textAnimation: {
                animators: [
                  { ...animator, properties: { ...animator.properties, color: '#ff0000' } },
                ],
              },
            },
          },
        ],
      },
    });
    expect(gradient.isError, JSON.stringify(gradient.content)).not.toBe(true);
    const gradientBefore = session.snapshot();
    const invalidGradient = createDefaultGradient();
    invalidGradient.stops[0]!.color = 'not-a-color';
    const invalidPaint = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 3,
        operations: [
          { type: 'update_element', layerName: 'Headline', patch: { fill: invalidGradient } },
        ],
      },
    });
    expect(invalidPaint.isError).toBe(true);
    expect(session.snapshot()).toEqual(gradientBefore);
    const shader = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 3,
        operations: [
          { type: 'update_element', layerName: 'Headline', patch: { fill: createShaderPaint() } },
        ],
      },
    });
    expect(shader.isError).toBe(true);
    expect(session.snapshot()).toEqual(gradientBefore);
    const cleared = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 3,
        operations: [
          { type: 'set_layer_layout', layerName: 'Headline', motionBlur: null },
          {
            type: 'update_element',
            layerName: 'Headline',
            patch: { textAnimation: { animators: [] } },
          },
        ],
      },
    });
    expect(cleared.isError, JSON.stringify(cleared.content)).not.toBe(true);
    expect(session.snapshot().project.compositions[0]!.layers[0]!.motionBlur).toBeUndefined();
  });
  it('authors local review comments, versions and approval atomically through MCP', async () => {
    const sessionId = 'mcp-review';
    const session = host.workspace.create(sessionId);
    const compositionId = session.snapshot().project.mainCompositionId;
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'add_review_comment',
            id: 'comment-1',
            compositionId,
            text: 'Check spacing',
            author: 'Designer',
            frame: 0,
            x: 100,
            y: 50,
          },
          { type: 'set_review_comment_resolved', commentId: 'comment-1', resolved: true },
          { type: 'save_review_version', id: 'version-1', name: 'First review' },
          { type: 'set_review_approval', author: 'Designer' },
        ],
      },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const review = session.snapshot().project.review!;
    expect(review.comments[0]).toMatchObject({
      id: 'comment-1',
      text: 'Check spacing',
      resolved: true,
      compositionId,
      x: 100,
      y: 50,
    });
    expect(review.versions[0]).toMatchObject({ id: 'version-1', name: 'First review' });
    expect(review.versions[0]!.snapshot).not.toHaveProperty('review');
    expect(review.approval).toMatchObject({ author: 'Designer', fingerprint: expect.any(String) });
    const read = await client.callTool({
      name: 'ograf_get_project',
      arguments: { sessionId, include: ['review'], tracks: 'none' },
    });
    const projected = (
      read.structuredContent as {
        project: { review: { versions: Array<Record<string, unknown>> } };
      }
    ).project.review;
    expect(projected.versions[0]).not.toHaveProperty('snapshot');
    const reopen = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          { type: 'set_review_comment_resolved', commentId: 'comment-1', resolved: false },
          { type: 'set_review_approval', author: null },
        ],
      },
    });
    expect(reopen.isError, JSON.stringify(reopen.content)).not.toBe(true);
    expect(session.snapshot().project.review!.comments[0]!.resolved).toBe(false);
    expect(session.snapshot().project.review!.approval).toBeUndefined();
    const before = session.snapshot();
    const invalid = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [{ type: 'set_review_comment_resolved', commentId: 'missing', resolved: true }],
      },
    });
    expect(invalid.isError).toBe(true);
    expect(session.snapshot()).toEqual(before);
  });
  it('executes the documented broadcast examples without validation or design-QA issues', async () => {
    const guide = await readFile(
      new URL('../../../skills/ograf-authoring/references/broadcast-recipes.md', import.meta.url),
      'utf8',
    );
    const examples = guide.split('<!-- Tested authoring examples -->')[1]!;
    const recipes = examples
      .split(/^### /m)
      .slice(1)
      .map((section) => ({
        name: section.split('\n')[0]!.trim(),
        batches: [...section.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map((match) => match[1]!),
      }));
    expect(recipes.map((recipe) => recipe.name)).toEqual([
      'Premium lower third',
      'Breaking strap',
      'Live scoreboard',
    ]);
    for (const [index, recipe] of recipes.entries()) {
      const sessionId = `skill-broadcast-recipe-${index}`;
      host.workspace.create(sessionId);
      let revision = 0;
      for (const batch of recipe.batches) {
        const composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
        const operations = JSON.parse(
          batch.replace(/<field id: ([^>]+)>/g, (_, key: string) => {
            const field = composition.dataFields.find((candidate) => candidate.key === key);
            if (!field) throw new Error(`${recipe.name}: missing field ${key}`);
            return field.id;
          }),
        );
        const applied = await client.callTool({
          name: 'ograf_apply_operations',
          arguments: { sessionId, expectedRevision: revision, operations },
        });
        expect(applied.isError, `${recipe.name}: ${JSON.stringify(applied.content)}`).not.toBe(
          true,
        );
        revision++;
      }
      const validation = await client.callTool({
        name: 'ograf_validate_project',
        arguments: { sessionId, broadcastLint: true, detail: 'summary' },
      });
      expect(
        (validation.structuredContent as { validation: unknown }).validation,
        recipe.name,
      ).toEqual({ valid: true, errors: [], warnings: [] });
      const review = await client.callTool({
        name: 'ograf_review_design',
        arguments: { sessionId },
      });
      expect((review.structuredContent as { findings: unknown[] }).findings, recipe.name).toEqual(
        [],
      );
    }
  });
  it('stores and validates authoring-only test rundowns through MCP', async () => {
    const sessionId = 'mcp-test-rundown';
    const session = host.workspace.create(sessionId);
    session.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'add_data_field',
          id: 'headline-id',
          key: 'headline',
          fieldType: 'text',
          defaultValue: 'Headline',
        },
      ],
    });
    const rows = [{ id: 'row-1', values: { 'headline-id': 'Alice' } }];
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [{ type: 'set_test_rundowns', rundowns: [{ id: 'r1', name: 'Guests', rows }] }],
      },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(session.snapshot().project.compositions[0]!.testRundowns).toEqual([
      { id: 'r1', name: 'Guests', rows },
    ]);
    const before = session.snapshot();
    const invalid = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [
          {
            type: 'set_test_rundowns',
            rundowns: [{ id: 'r1', name: 'Guests', rows: [...rows, ...rows] }],
          },
        ],
      },
    });
    expect(invalid.isError).toBe(true);
    expect(session.snapshot()).toEqual(before);
  });
  it('resolves recipe-created layer and field selectors in the same atomic batch', async () => {
    const sessionId = 'mcp-recipe-same-batch';
    const session = host.workspace.create(sessionId);
    const operations = [
      { type: 'create_lower_third', name: 'Election', fieldKeys: { headline: 'electionTitle' } },
      {
        type: 'update_element',
        layerName: 'Election · Headline',
        patch: { content: 'LIVE RESULT' },
      },
      { type: 'update_data_field', fieldKey: 'electionTitle', defaultValue: 'LIVE RESULT' },
      {
        type: 'set_layer_bindings',
        layerName: 'Election · Headline',
        bindings: [{ fieldKey: 'electionTitle', targetProperty: 'content' }],
      },
      {
        type: 'set_layer_semantics',
        layerName: 'Election · Panel',
        patch: { description: 'Election background' },
      },
    ];
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: { sessionId, expectedRevision: 0, operations },
    });
    expect(applied.isError, JSON.stringify(applied.content)).not.toBe(true);
    const composition = session.snapshot().project.compositions[0]!;
    const headline = composition.layers.find((layer) => layer.name === 'Election · Headline')!;
    const field = composition.dataFields.find((item) => item.key === 'electionTitle')!;
    expect(headline.element).toMatchObject({ type: 'text', content: 'LIVE RESULT' });
    expect(field.defaultValue).toBe('LIVE RESULT');
    expect(headline.bindings).toContainEqual(
      expect.objectContaining({ fieldId: field.id, targetProperty: 'content' }),
    );
    expect(
      composition.layers.find((layer) => layer.name === 'Election · Panel')!.semantics.description,
    ).toBe('Election background');
    expect(session.revision).toBe(1);
    const before = session.snapshot();
    const rejected = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          { type: 'create_bug', name: 'Breaking' },
          { type: 'update_element', layerName: 'not a layer', patch: { content: 'bad' } },
        ],
      },
    });
    expect(rejected.isError).toBe(true);
    expect(session.snapshot()).toEqual(before);
  });
  it.each([
    ['create_bug', 'Panel'],
    ['create_ticker', 'Native ticker'],
    ['create_scoreboard', 'Home Score'],
    ['create_clock', 'Time'],
    ['create_countdown', 'Timer'],
  ])('resolves an object created by %s during the same batch', async (type, part) => {
    const sessionId = `mcp-batch-${type}`;
    const session = host.workspace.create(sessionId);
    const operations = [
      { type, name: 'Demo' },
      {
        type: 'set_layer_semantics',
        layerName: `Demo · ${part}`,
        patch: { description: 'Selected inside recipe' },
      },
    ];
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: { sessionId, expectedRevision: 0, operations },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(
      session
        .snapshot()
        .project.compositions[0]!.layers.find((layer) => layer.name === `Demo · ${part}`)?.semantics
        .description,
    ).toBe('Selected inside recipe');
  });
  it('keeps separate recipe identities stable when a batch contains component recipes and later selectors', async () => {
    const sessionId = 'mcp-batch-components';
    const session = host.workspace.create(sessionId);
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'create_lower_third', name: 'One', asComponent: true, stylePack: 'news' },
          { type: 'create_lower_third', name: 'Two', asComponent: true },
          {
            type: 'set_layer_semantics',
            layerName: 'One · Panel',
            patch: { description: 'First' },
          },
          {
            type: 'set_layer_semantics',
            layerName: 'Two · Panel',
            patch: { description: 'Second' },
          },
        ],
      },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const composition = session.snapshot().project.compositions[0]!;
    expect(
      composition.layers.find((layer) => layer.name === 'One · Panel')?.semantics.description,
    ).toBe('First');
    expect(
      composition.layers.find((layer) => layer.name === 'Two · Panel')?.semantics.description,
    ).toBe('Second');
    expect(new Set(composition.layers.map((layer) => layer.id)).size).toBe(
      composition.layers.length,
    );
  });
  it('resolves repeater-created layer names in the same batch', async () => {
    const sessionId = 'mcp-batch-repeater';
    const session = host.workspace.create(sessionId);
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Seed', id: 'seed' }],
    });
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          { type: 'create_repeater', layerIds: ['seed'], items: [{}, {}] },
          {
            type: 'set_layer_semantics',
            layerName: 'Item 2 — Seed',
            patch: { description: 'Second copy' },
          },
        ],
      },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(
      session
        .snapshot()
        .project.compositions[0]!.layers.find((layer) => layer.name === 'Item 2 — Seed')?.semantics
        .description,
    ).toBe('Second copy');
  });
  it('bakes and clears Animate In motion through MCP without a runtime-only preset', async () => {
    const sessionId = 'mcp-layer-motion';
    host.workspace.create(sessionId);
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Moving panel' },
          {
            type: 'set_layer_motion',
            layerName: 'Moving panel',
            side: 'in',
            spec: { style: 'fade', durationFrames: 8, easing: 'cubic-out' },
          },
        ],
      },
    });
    expect(applied.isError, JSON.stringify(applied.content)).not.toBe(true);
    const composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    const layer = composition.layers[0]!;
    expect(layer.motion?.in).toMatchObject({ style: 'fade', durationFrames: 8 });
    expect(getLayerPropertyValueAtFrame(layer, 'opacity', 0)).toBe(0);

    const cleared = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          { type: 'set_layer_motion', layerName: 'Moving panel', side: 'in', spec: null },
        ],
      },
    });
    expect(cleared.isError, JSON.stringify(cleared.content)).not.toBe(true);
    const settled = host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers[0]!;
    expect(settled.motion?.in).toBeNull();
    expect(getLayerPropertyValueAtFrame(settled, 'opacity', 0)).toBe(1);

    const tooLong = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [
          {
            type: 'set_layer_motion',
            layerName: 'Moving panel',
            side: 'in',
            spec: { style: 'fade', durationFrames: 1000 },
          },
        ],
      },
    });
    expect(tooLong.isError).toBe(true);
    expect(host.workspace.get(sessionId).revision).toBe(2);

    const wiped = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [
          {
            type: 'set_layer_motion',
            layerName: 'Moving panel',
            side: 'in',
            spec: { style: 'wipe', direction: 'center', durationFrames: 6, offsetFrames: 2 },
          },
        ],
      },
    });
    expect(wiped.isError, JSON.stringify(wiped.content)).not.toBe(true);
    const revealed = host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers[0]!;
    expect(revealed.motion?.in).toMatchObject({ style: 'wipe', offsetFrames: 2 });
    expect(getLayerPropertyValueAtFrame(revealed, 'clipLeft', 0)).toBe(0.5);

    for (const spec of [
      { style: 'swirl', durationFrames: 6 },
      { style: 'spin', direction: 'up', durationFrames: 6 },
    ]) {
      const rejected = await client.callTool({
        name: 'ograf_apply_operations',
        arguments: {
          sessionId,
          expectedRevision: 3,
          operations: [{ type: 'set_layer_motion', layerName: 'Moving panel', side: 'in', spec }],
        },
      });
      expect(rejected.isError).toBe(true);
    }
    expect(host.workspace.get(sessionId).revision).toBe(3);
  });
  it('authors a pointer rule without a Data field through the advertised MCP contract', async () => {
    const sessionId = 'pointer-visual-rule';
    host.workspace.create(sessionId);
    const capabilities = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['bindings'] },
    });
    expect(capabilities.structuredContent).toMatchObject({
      bindings: { visualRules: { triggers: expect.arrayContaining(['click', 'pointer-enter']) } },
    });

    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Button' },
          {
            type: 'set_layer_visual_rules',
            layerName: 'Button',
            rules: [
              {
                id: 'button-click',
                name: 'Highlight on click',
                enabled: true,
                trigger: 'click',
                actions: [{ type: 'property', targetProperty: 'fill', value: '#2680ff' }],
              },
            ],
          },
        ],
      },
    });
    expect(applied.isError, JSON.stringify(applied.content)).not.toBe(true);
    const composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(composition.dataFields).toHaveLength(0);
    expect(composition.layers[0]!.visualRules[0]).toMatchObject({
      id: 'button-click',
      trigger: 'click',
      fieldId: '',
      sourcePath: [],
      operator: 'equals',
    });

    const invalid = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'set_layer_visual_rules',
            layerName: 'Button',
            rules: [
              {
                id: 'invalid-data-rule',
                name: 'Missing field',
                enabled: true,
                trigger: 'data',
                actions: [{ type: 'visibility', visible: true }],
              },
            ],
          },
        ],
      },
    });
    expect(invalid.isError).toBe(true);
    expect(host.workspace.get(sessionId).revision).toBe(1);
  });
  it('authors the advertised visual pattern presets through their documented patch contract', async () => {
    const result = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['tiling'] },
    });
    const capabilities = result.structuredContent as {
      tiling: { presets: { entries: Array<{ id: string; patch: Record<string, unknown> }> } };
    };
    expect(result.structuredContent).not.toHaveProperty('elementSchemas');
    expect(capabilities.tiling.presets.entries.map((entry) => entry.id)).toEqual([
      'dots',
      'stripes',
      'chevrons',
      'diamonds',
      'checkerboard',
      'monogram',
    ]);
    for (const preset of capabilities.tiling.presets.entries) {
      const sessionId = `advertised-pattern-${preset.id}`;
      host.workspace.create(sessionId);
      const applied = await client.callTool({
        name: 'ograf_apply_operations',
        arguments: {
          sessionId,
          expectedRevision: 0,
          operations: [{ type: 'set_tiling_pattern', patch: preset.patch }],
        },
      });
      expect(applied.isError, JSON.stringify(applied.content)).not.toBe(true);
      const snapshot = host.workspace.get(sessionId).snapshot();
      expect(snapshot.validation.valid).toBe(true);
      expect(snapshot.project.compositions[0]!.patterns[0]).toMatchObject(preset.patch);
      expect(snapshot.project.compositions[0]!.layers[0]!.element).toMatchObject({
        type: 'pattern',
        patternId: snapshot.project.compositions[0]!.patterns[0]!.id,
      });
    }
  });

  it('executes the skill shader paint and loop examples with independent data defaults', async () => {
    const guide = await readFile(
      new URL(
        '../../../skills/ograf-authoring/references/shaders-and-patterns.md',
        import.meta.url,
      ),
      'utf8',
    );
    const examples = [...guide.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map((match) =>
      JSON.parse(match[1]!),
    );
    const sessionId = 'skill-shader-loop-example';
    host.workspace.create(sessionId);
    const capabilities = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['shaders'] },
    });
    expect(capabilities.structuredContent).toHaveProperty('paintSchemas.shader');
    expect(capabilities.structuredContent).not.toHaveProperty('tiling');
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'text', name: 'Title' },
          examples[0],
          ...examples[1],
        ],
      },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(composition.dataFields).toHaveLength(1);
    expect(composition.dataFields[0]!.defaultValue).toBe(1);
    const sample = await client.callTool({
      name: 'ograf_sample_tracks',
      arguments: {
        sessionId,
        layerIds: [composition.layers[0]!.id],
        frames: [12],
        loopElapsedFrame: 50,
        properties: ['fill.parameters.intensity'],
      },
    });
    expect(sample.isError).not.toBe(true);
    const sampled = sample.structuredContent as {
      frames: Array<{ layers: Array<{ properties: Record<string, number> }> }>;
    };
    expect(sampled.frames[0]!.layers[0]!.properties['fill.parameters.intensity']).toBe(0.25);
  });
  it('executes the advertised MCP shader-effect example', async () => {
    const capabilities = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['elements'] },
    });
    const example = (
      capabilities.structuredContent as {
        composableEffects: { shaderEffect: { example: Record<string, unknown> } };
      }
    ).composableEffects.shaderEffect.example;
    const sessionId = 'shader-effect-capability-example';
    host.workspace.create(sessionId);
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [{ type: 'add_layer', kind: 'text', name: 'Layer name' }, example],
      },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(
      host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers[0]!.effects.stack,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'shader',
          enabled: true,
          shader: expect.objectContaining({ fragmentSource: expect.stringContaining('iChannel0') }),
        }),
      ]),
    );
  });
  it('reads saved unused shaders as a project section without inventing layers or data fields', async () => {
    const resource = createShaderResource();
    resource.paint.name = 'Saved library shader';
    const project = createProject({ shaders: [resource] });
    host.workspace.create('shader-library-read', project);
    const result = await client.callTool({
      name: 'ograf_get_project',
      arguments: { sessionId: 'shader-library-read', include: ['shaders'], tracks: 'none' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      project: { shaders: [resource] },
      validation: { valid: true },
    });
    expect(
      host.workspace.get('shader-library-read').snapshot().project.compositions[0]!.layers,
    ).toEqual([]);
    expect(
      host.workspace.get('shader-library-read').snapshot().project.compositions[0]!.dataFields,
    ).toEqual([]);
  });
  it('applies and edits pack colors through existing GDD bindings and restores their defaults', async () => {
    const sessionId = 'pack-colors-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const session = host.workspace.get(sessionId);
    const apply = (operations: unknown[]) =>
      client.callTool({
        name: 'ograf_apply_operations',
        arguments: { sessionId, expectedRevision: session.revision, operations },
      });
    expect(
      (
        await apply([
          { type: 'add_layer', kind: 'rectangle', name: 'Accent', element: { fill: '#ff0000' } },
          { type: 'set_layer_semantics', layerName: 'Accent', patch: { role: 'accent' } },
          { type: 'add_data_field', key: 'color', fieldType: 'color', defaultValue: '#ff0000' },
          {
            type: 'set_layer_bindings',
            layerName: 'Accent',
            bindings: [{ fieldKey: 'color', targetProperty: 'fill' }],
          },
          { type: 'apply_style_pack', stylePack: 'sports' },
        ])
      ).isError,
    ).not.toBe(true);
    expect(session.snapshot().project.compositions[0]!.dataFields[0]!.defaultValue).toBe('#00E5FF');
    const tokenId = session
      .snapshot()
      .project.compositions[0]!.designSystem.tokens.find((t) => t.key === 'brand.color.accent')!.id;
    const recolored = await apply([
      {
        type: 'upsert_design_token',
        tokenId,
        key: 'brand.color.accent',
        tokenType: 'color',
        value: '#ff00ff',
      },
    ]);
    expect(recolored.isError, JSON.stringify(recolored.content)).not.toBe(true);
    const c = session.snapshot().project.compositions[0]!;
    expect(c.dataFields[0]!.defaultValue).toBe('#ff00ff');
    expect(c.layers[0]!.element).toMatchObject({ fill: '#ff00ff' });
    expect((await apply([{ type: 'remove_style_pack' }])).isError).not.toBe(true);
    expect(session.snapshot().project.compositions[0]!.dataFields[0]!.defaultValue).toBe('#ff0000');
  });
  it('exposes shared lighting, samples its clock and rejects broken links atomically', async () => {
    const sessionId = 'shared-lighting-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const session = host.workspace.get(sessionId);
    const apply = (operations: unknown[]) =>
      client.callTool({
        name: 'ograf_apply_operations',
        arguments: { sessionId, expectedRevision: session.revision, operations },
      });
    expect(
      (
        await apply([
          {
            type: 'set_tiling_pattern',
            patch: { name: 'Light rig', lighting: { cycleFrames: 200 } },
            createLayer: false,
          },
          { type: 'add_layer', kind: 'rectangle', name: 'Sweep', transform: { opacity: 0.8 } },
          {
            type: 'set_layer_loop',
            layerName: 'Sweep',
            durationFrames: 100,
            repeatCount: null,
            activation: { type: 'lifecycle' },
          },
          {
            type: 'set_loop_property_track',
            layerName: 'Sweep',
            property: 'x',
            keys: [
              { frame: 0, value: 0 },
              { frame: 50, value: 100 },
              { frame: 100, value: 0 },
            ],
          },
        ])
      ).isError,
    ).not.toBe(true);
    const c = session.snapshot().project.compositions[0]!,
      p = c.patterns[0]!,
      before = structuredClone(c.layers[0]!);
    expect(
      (
        await apply([
          {
            type: 'set_layer_lighting',
            layerName: 'Sweep',
            link: { patternId: p.id, role: 'light' },
          },
          {
            type: 'set_tiling_pattern',
            patternName: 'Light rig',
            patch: { lighting: { intensity: 0.5 } },
          },
        ])
      ).isError,
    ).not.toBe(true);
    expect(session.snapshot().project.compositions[0]!.layers[0]!.loop).toEqual(before.loop);
    const sample = await client.callTool({
      name: 'ograf_sample_tracks',
      arguments: { sessionId, frames: [12], loopElapsedFrame: 100, properties: ['x', 'opacity'] },
    });
    const result = sample.structuredContent as {
      frames: Array<{
        layers: Array<{
          properties: Record<string, number>;
          lighting: { sourceLoopFrame: number };
        }>;
      }>;
    };
    expect(result.frames[0]!.layers[0]!.properties).toMatchObject({ x: 100, opacity: 0.4 });
    expect(result.frames[0]!.layers[0]!.lighting.sourceLoopFrame).toBe(50);
    const prior = session.snapshot();
    expect((await apply([{ type: 'remove_tiling_pattern', patternId: p.id }])).isError).toBe(true);
    expect(session.snapshot()).toEqual(prior);
    expect(
      (
        await apply([
          { type: 'set_layer_lighting', layerName: 'Sweep', link: null },
          { type: 'remove_tiling_pattern', patternId: p.id },
        ])
      ).isError,
    ).not.toBe(true);
  });
  it('authors ordered effect instances with stable animation paths and atomic failures', async () => {
    const sessionId = 'effect-stack-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const session = host.workspace.get(sessionId);
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Tile' },
          {
            type: 'add_effect',
            layerName: 'Tile',
            effectType: 'glow',
            patch: { name: 'Bloom', params: { radius: 12 } },
          },
        ],
      },
    });
    expect(created.isError).not.toBe(true);
    const layer = session.snapshot().project.compositions[0]!.layers[0]!,
      effect = layer.effects.stack!.at(-1)!,
      property = `effects.${effect.id}.radius`;
    expect(created.structuredContent).toHaveProperty(
      'results',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'add_effect',
          id: effect.id,
          properties: expect.objectContaining({ radius: property }),
        }),
      ]),
    );
    const edited = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: session.revision,
        operations: [
          {
            type: 'set_property_track',
            layerName: 'Tile',
            property,
            keys: [
              { frame: 0, value: 2 },
              { frame: 10, value: 22 },
            ],
          },
          {
            type: 'reorder_effects',
            layerName: 'Tile',
            effectIds: [effect.id, 'base-shadow', 'base-blur'],
          },
        ],
      },
    });
    expect(edited.isError).not.toBe(true);
    const sampled = await client.callTool({
      name: 'ograf_sample_tracks',
      arguments: { sessionId, frames: [5], properties: [property] },
    });
    expect(sampled.structuredContent).toHaveProperty(
      'frames',
      expect.arrayContaining([
        expect.objectContaining({
          layers: expect.arrayContaining([
            expect.objectContaining({ properties: { [property]: 12 } }),
          ]),
        }),
      ]),
    );
    const revision = session.revision;
    const invalid = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: revision,
        operations: [
          {
            type: 'update_effect',
            layerName: 'Tile',
            effectId: effect.id,
            patch: { params: { unknown: 42 } },
          },
        ],
      },
    });
    expect(invalid.isError).toBe(true);
    expect(session.revision).toBe(revision);
  });
  it('materializes synchronized effects across a persistent canvas group', async () => {
    const sessionId = 'group-effect-stack-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const session = host.workspace.get(sessionId);
    const grouped = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Plate' },
          { type: 'add_layer', kind: 'text', name: 'Label' },
          { type: 'group_layers', layerIds: [] },
        ],
      },
    });
    expect(grouped.isError).toBe(true);
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Plate' },
          { type: 'add_layer', kind: 'text', name: 'Label' },
        ],
      },
    });
    expect(created.isError).not.toBe(true);
    const layerIds = session.snapshot().project.compositions[0]!.layers.map((layer) => layer.id);
    const groupResult = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: session.revision,
        operations: [{ type: 'group_layers', layerIds }],
      },
    });
    const groupId = (
      groupResult.structuredContent as { results: Array<{ type: string; id?: string }> }
    ).results.find((result) => result.type === 'group_layers')!.id!;
    const effectResult = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: session.revision,
        operations: [
          {
            type: 'add_effect',
            groupId,
            effectType: 'glow',
            patch: { enabled: true, params: { radius: 16 } },
          },
        ],
      },
    });
    expect(effectResult.isError).not.toBe(true);
    const layers = session.snapshot().project.compositions[0]!.layers,
      effectIds = layers.map(
        (layer) => getEffectStack(layer.effects).find((effect) => effect.type === 'glow')!.id,
      );
    expect(new Set(effectIds).size).toBe(1);
  });
  it('creates and edits a shared pattern by name and samples generated row motion', async () => {
    const sessionId = 'procedural-pattern-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const session = host.workspace.get(sessionId);
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: session.revision,
        operations: [
          {
            type: 'set_tiling_pattern',
            patch: { name: 'Rows', rows: 3, cycleFrames: 2400, spacingVariation: 0 },
          },
          { type: 'set_tiling_pattern', patternName: 'Rows', patch: { gap: 40 } },
        ],
      },
    });
    expect(created.isError).not.toBe(true);
    const c = session.snapshot().project.compositions[0]!;
    expect(c.layers).toHaveLength(1);
    expect(c.patterns[0]!.gap).toBe(40);
    const sampled = await client.callTool({
      name: 'ograf_sample_tracks',
      arguments: { sessionId, frames: [12], loopElapsedFrame: 100 },
    });
    expect(sampled.structuredContent).toHaveProperty('frames.0.layers.0.patternRows');
    const revision = session.revision;
    const bad = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: revision,
        operations: [
          {
            type: 'set_tiling_pattern',
            patternName: 'Rows',
            patch: { symbols: [{ key: 'O', d: 'M0 0', extra: true }] },
          },
        ],
      },
    });
    expect(bad.isError).toBe(true);
    expect(session.revision).toBe(revision);
    const caps = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['elements'] },
    });
    expect(caps.structuredContent).toHaveProperty(
      'elementSchemas.pattern.patternId.type',
      'string',
    );
  });

  it('links Brand Kit colors to gradient stops and shadows without flattening paint', async () => {
    const sessionId = 'gradient-brand-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const session = host.workspace.get(sessionId);
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: session.revision,
        operations: [
          {
            type: 'add_layer',
            kind: 'rectangle',
            name: 'Glint',
            element: {
              fill: {
                type: 'linear',
                angle: 110,
                stops: [
                  { offset: 0, color: '#ffffff', opacity: 0 },
                  { offset: 1, color: '#ffffff', opacity: 1 },
                ],
              },
            },
          },
          {
            type: 'upsert_design_token',
            key: 'brand.accent',
            tokenType: 'color',
            value: '#44bbcc',
          },
          {
            type: 'bind_design_token',
            layerName: 'Glint',
            tokenKey: 'brand.accent',
            targetProperty: 'fill.stops[1].color',
          },
          {
            type: 'bind_design_token',
            layerName: 'Glint',
            tokenKey: 'brand.accent',
            targetProperty: 'dropShadowColor',
          },
        ],
      },
    });
    expect(result.isError).not.toBe(true);
    const c = session.snapshot().project.compositions[0]!,
      token = c.designSystem.tokens[0]!;
    const fieldResult = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: session.revision,
        operations: [
          { type: 'add_data_field', fieldType: 'color', key: 'accent', defaultTokenId: token.id },
        ],
      },
    });
    expect(fieldResult.isError).not.toBe(true);
    const changed = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: session.revision,
        operations: [
          {
            type: 'upsert_design_token',
            tokenId: token.id,
            key: token.key,
            tokenType: 'color',
            value: '#cc8844',
          },
        ],
      },
    });
    expect(changed.isError).not.toBe(true);
    expect(session.snapshot().project.compositions[0]!.dataFields[0]!.defaultValue).toBe('#cc8844');
    const layer = session.snapshot().project.compositions[0]!.layers[0]!;
    expect(layer.element).toHaveProperty('fill.stops.0.opacity', 0);
    expect(layer.element).toHaveProperty('fill.stops.1.color', '#cc8844');
    expect(layer.effects.dropShadowColor).toBe('#cc8844');
    const revision = session.revision;
    const bad = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: revision,
        operations: [
          {
            type: 'bind_design_token',
            layerName: 'Glint',
            tokenKey: 'brand.accent',
            targetProperty: 'fill.stops[99].color',
          },
        ],
      },
    });
    expect(bad.isError).toBe(true);
    expect(session.revision).toBe(revision);
  });

  it('authors gradient paths and named mask sources atomically and exposes mask relationships', async () => {
    const sessionId = 'named-mask-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const session = host.workspace.get(sessionId);
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: session.revision,
        operations: [
          {
            type: 'add_layer',
            kind: 'path',
            name: 'Letters',
            element: {
              d: 'M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z',
              fillRule: 'evenodd',
              fill: {
                type: 'linear',
                angle: 90,
                stops: [
                  { offset: 0, color: '#ff6600', opacity: 1 },
                  { offset: 1, color: '#ffffff', opacity: 1 },
                ],
              },
            },
          },
          { type: 'add_layer', kind: 'ellipse', name: 'Soft window', element: { fill: '#000000' } },
          {
            type: 'set_property_track',
            layerName: 'Letters',
            property: 'fill.stops[1].offset',
            keys: [
              { frame: 0, value: 0.3 },
              { frame: 12, value: 1 },
            ],
          },
          {
            type: 'set_layer_mask',
            layerName: 'Letters',
            sourceLayerName: 'Soft window',
            mode: 'alpha',
          },
        ],
      },
    });
    expect(result.isError).not.toBe(true);
    const layers = session.snapshot().project.compositions[0]!.layers;
    expect(layers[0]!.mask!.sourceLayerId).toBe(layers[1]!.id);
    expect(layers[1]!.isMaskOnly).toBe(true);
    const query = await client.callTool({
      name: 'ograf_query_scene',
      arguments: { sessionId, nameContains: 'Letters' },
    });
    expect(JSON.stringify(query.structuredContent)).toContain(layers[1]!.id);
    const capabilities = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['elements'] },
    });
    expect(capabilities.structuredContent).toHaveProperty('masking.operation', 'set_layer_mask');
    const revision = session.revision;
    const cycle = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: revision,
        operations: [
          { type: 'set_layer_mask', layerName: 'Soft window', sourceLayerName: 'Letters' },
        ],
      },
    });
    expect(cycle.isError).toBe(true);
    expect(session.revision).toBe(revision);
  });

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
        'ograf_save_template_set',
        'ograf_export_package',
      ]),
    );
    expect(tools.tools.map((tool) => tool.name)).not.toContain('ograf_preview_operations');
    expect(tools.tools.map((tool) => tool.name)).not.toContain('ograf_propose_operations');
    expect(
      JSON.stringify(
        tools.tools.find((tool) => tool.name === 'ograf_apply_operations')?.inputSchema,
      ),
    ).toContain('iChannel0=input');
  });

  it('renders a bounded nineteen-tool in-app surface from the same canonical records', () => {
    const records = createOGrafToolRecords(host.workspace, host.bridge);
    const inApp = filterInAppToolRecords(records);
    expect(inApp).toHaveLength(19);
    expect(inApp.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining([
        'ograf_certify_project',
        'ograf_save_project',
        'ograf_export_package',
      ]),
    );
    expect(providerToolWireBytes(records)).toBeLessThanOrEqual(75_000);
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
      paintSchemas: {
        shader: {
          speed: { default: 1, minimum: 0, maximum: 10 },
          resolutionScale: { default: 1, minimum: 0.25, maximum: 1 },
          runtimeProfile: {
            renderer: 'WebGL2',
            passes: 1,
            supportedInputs: ['iTime', 'iResolution', 'iChannel0', 'iChannelResolution[0]'],
          },
        },
      },
      elementSchemas: {
        rectangle: {
          defaultTransform: { width: 200, height: 200, shape: 'square' },
          borderRadius: {
            default: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          },
        },
        ellipse: {
          defaultTransform: { width: 200, height: 200, shape: 'circle' },
          strokeWidth: { default: 0 },
        },
        text: {
          textAlign: { values: ['left', 'center', 'right'] },
          autoFit: {
            values: ['auto-size', 'shrink-to-fit', 'fit-to-width', 'squeeze', 'fixed'],
          },
          strokeColor: { default: 'transparent' },
          strokeWidth: { default: 0, minimum: 0, animatable: true },
        },
        image: { src: { default: null } },
        path: { viewBoxWidth: { default: 100 } },
        'image-sequence': { fps: { default: 12 }, loop: { default: true } },
        lottie: {
          animationData: { default: null },
          speed: { default: 1 },
          runtimeProfile: {
            renderer: 'lottie-web light Canvas',
            backingLimits: { maximumAxisPixels: 8192, maximumTotalPixels: 16777216 },
            readinessBudgetMs: 2500,
            sourceInPoint: expect.stringContaining('subtracts animationData.ip'),
            editor: expect.stringContaining('paused scrubbing rebuilds changed frames'),
            nonRealtime: expect.stringContaining('byte-identical Canvas pixels'),
            verification: expect.stringContaining('capture representative frames'),
          },
        },
      },
      semantics: {
        layerPaintOrder: 'ascending-index-paints-later',
        easingApplies: 'incoming',
        textOrigin: 'top-left',
        rectOrigin: 'top-left',
        localLoops: expect.any(String),
        semanticAuthoring: expect.any(String),
        layerBlending: expect.any(String),
      },
      semanticAuthoring: {
        operations: expect.arrayContaining([
          'set_layer_semantics',
          'create_lower_third',
          'create_bug',
          'create_ticker',
          'create_scoreboard',
          'create_clock',
          'create_repeater',
        ]),
        roles: expect.arrayContaining(['headline', 'container', 'logo']),
        motionPresets: ['wipe-reveal', 'stagger-cascade', 'directional-slide'],
      },
      designSystem: {
        operations: expect.arrayContaining([
          'apply_style_pack',
          'upsert_design_token',
          'bind_design_token',
        ]),
        targetProperties: expect.arrayContaining(['strokeColor', 'strokeWidth']),
        stylePacks: expect.arrayContaining([
          expect.objectContaining({ id: 'news', name: 'News' }),
          expect.objectContaining({ id: 'sports', name: 'Sports' }),
          expect.objectContaining({ id: 'entertainment', name: 'Entertainment' }),
          expect.objectContaining({ id: 'documentary', name: 'Documentary' }),
        ]),
      },
      aiReview: {
        query: 'ograf_query_scene',
        visualDryRun: 'ograf_apply_operations mode=preview',
        humanProposal: 'ograf_apply_operations mode=propose',
      },
      loopAnimation: {
        operations: ['set_layer_loop', 'set_loop_property_track', 'remove_layer_loop'],
        activations: ['lifecycle', 'step'],
      },
      bindings: {
        fieldTypes: expect.arrayContaining([
          'integer',
          'duration-ms',
          'percentage',
          'file-path',
          'select',
          'select-multiple',
        ]),
        gdd: expect.any(String),
        targetProperties: {
          text: [
            'content',
            'color',
            'fill',
            'fill.parameters.NAME',
            'strokePaint.parameters.NAME',
            'strokeColor',
            'dropShadowColor',
          ],
          image: ['src', 'fill.parameters.NAME', 'dropShadowColor'],
          'image-sequence': ['fill.parameters.NAME', 'dropShadowColor'],
          lottie: ['fill.parameters.NAME', 'dropShadowColor'],
        },
      },
      canvasLayout: {
        boundsModes: ['allow', 'contain'],
        overflowPreview: ['visible', 'clip'],
        outsideCanvasDimmer: {
          property: 'dimOutsideCanvas',
          color: '#333333',
          opacity: 1,
          grayLevel: 0.2,
          transparent: false,
          authoringOnly: true,
        },
        safeAreas: {
          standard: 'EBU R 95',
          aspectRatio: '16:9',
          actionSafeMarginPerAxis: 0.035,
          titleSafeMarginPerAxis: 0.05,
          pixelRounding: 'nearest-integer',
        },
      },
    });
    expect((result.structuredContent as { easingPresets: string[] }).easingPresets).toContain(
      'elastic-in-out',
    );
    expect((result.structuredContent as { blendModes: string[] }).blendModes).toContain('multiply');
    expect(
      (result.structuredContent as { animatableProperties: string[] }).animatableProperties,
    ).toContain('strokeWidth');
  });

  it('exposes editable path geometry and rejects unknown point-edit parameters', async () => {
    const sessionId = 'editable-path-mcp';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Panel' },
          { type: 'edit_path', layerName: 'Panel', edit: { action: 'convert' } },
        ],
      },
    });
    expect(created.isError).not.toBe(true);
    const inspected = await client.callTool({
      name: 'ograf_inspect_scene',
      arguments: { sessionId },
    });
    expect(inspected.structuredContent).toMatchObject({
      compositions: [
        {
          layers: [
            {
              pathEditing: {
                conversionError: null,
                d: 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
                contours: [
                  {
                    closed: true,
                    nodes: [
                      { x: 0, y: 0 },
                      { x: 200, y: 0 },
                      { x: 200, y: 200 },
                      { x: 0, y: 200 },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const bad = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          { type: 'edit_path', layerName: 'Panel', edit: { action: 'convert', typo: 5 } },
        ],
      },
    });
    expect(bad.isError).toBe(true);
  });

  it('authors and inspects a shader through canonical MCP operations', async () => {
    const sessionId = 'shader-inspection-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const created = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [{ type: 'add_layer', kind: 'shader', name: 'Shader background' }],
      },
    });
    expect(created.isError).not.toBe(true);
    const edited = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 1,
        operations: [
          {
            type: 'update_element',
            layerName: 'Shader background',
            patch: {
              speed: 0.5,
              resolutionScale: 0.5,
              fragmentSource: `#pragma ograf amount slider min(0) max(1) step(0.1)
const float amount = 0.5;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(amount); }`,
              parameters: { amount: 0.7 },
            },
          },
        ],
      },
    });
    expect(edited.isError).not.toBe(true);
    const shaderComposition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(shaderComposition.dataFields).toHaveLength(1);
    expect(shaderComposition.dataFields[0]).toMatchObject({
      type: 'number',
      defaultValue: 0.7,
      generatedShaderParameter: { name: 'amount' },
    });
    expect(shaderComposition.layers[0]!.bindings).toEqual([
      { fieldId: shaderComposition.dataFields[0]!.id, targetProperty: 'fill.parameters.amount' },
    ]);
    const inspected = await client.callTool({
      name: 'ograf_inspect_scene',
      arguments: { sessionId },
    });
    expect(inspected.structuredContent).toMatchObject({
      compositions: [
        { layers: [{ type: 'rectangle', shaderInspection: { valid: true, errors: [] } }] },
      ],
    });
    const queried = await client.callTool({
      name: 'ograf_query_scene',
      arguments: { sessionId, elementTypes: ['rectangle'] },
    });
    expect(queried.isError).not.toBe(true);
    const rejected = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 2,
        operations: [
          { type: 'update_element', layerName: 'Shader background', patch: { speed: -1 } },
        ],
      },
    });
    expect(rejected.isError).toBe(true);
    expect(host.workspace.get(sessionId).revision).toBe(2);
  });

  it('derives Lottie compatibility details during scene inspection', async () => {
    const sessionId = 'lottie-inspection-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'add_layer',
            kind: 'lottie',
            name: 'Nonzero in-point',
            element: {
              animationData: {
                v: '5.13.0',
                fr: 30,
                ip: 5,
                op: 35,
                w: 320,
                h: 180,
                layers: [{ ty: 4, x: 'time * 10' }],
              },
            },
          },
        ],
      },
    });
    expect(result.isError).not.toBe(true);

    const inspected = await client.callTool({
      name: 'ograf_inspect_scene',
      arguments: { sessionId },
    });
    expect(inspected.structuredContent).toMatchObject({
      compositions: [
        {
          layers: [
            {
              name: 'Nonzero in-point',
              lottieInspection: {
                valid: true,
                warnings: [expect.stringContaining('expressions are disabled')],
                width: 320,
                height: 180,
                frameRate: 30,
                inPoint: 5,
                outPoint: 35,
              },
            },
          ],
        },
      ],
    });
  });

  it('applies style packs and returns complete semantic recipe mappings', async () => {
    const sessionId = 'style-pack-recipe-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'apply_style_pack', stylePack: 'sports', bindLayers: false },
          {
            type: 'create_scoreboard',
            name: 'Match Score',
            content: { homeName: 'ANK', homeScore: 2, awayScore: 1, awayName: 'IZM' },
          },
          { type: 'create_ticker', name: 'Match Ticker', speedPixelsPerSecond: 240 },
        ],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ revision: 1, validation: { valid: true } });
    const results = (result.structuredContent as { results: Array<Record<string, unknown>> })
      .results;
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'apply_style_pack',
          stylePack: 'sports',
          tokenIds: expect.any(Object),
        }),
        expect.objectContaining({
          type: 'create_scoreboard',
          recipe: 'scoreboard',
          layers: expect.objectContaining({ homeScore: expect.any(String) }),
          fields: expect.objectContaining({ homeScore: expect.any(String) }),
        }),
        expect.objectContaining({
          type: 'create_ticker',
          recipe: 'ticker',
          layers: expect.objectContaining({ crawl: expect.any(String) }),
        }),
      ]),
    );
    const ticker = host.workspace
      .get(sessionId)
      .snapshot()
      .project.compositions[0]!.layers.find((layer) => layer.semantics.role === 'ticker');
    expect(ticker?.element).toMatchObject({
      type: 'ticker',
      direction: 'left',
      gap: 48,
      updatePolicy: 'next-appearance',
    });
  });

  it('projects only requested capability sections while retaining compact protocol metadata', async () => {
    const result = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['easing', 'bindings'] },
    });
    expect(result.isError).not.toBe(true);
    expect(Object.keys(result.structuredContent as Record<string, unknown>)).toEqual([
      'protocolVersion',
      'defaultSessionId',
      'easingPresets',
      'layerMotion',
      'bindings',
    ]);
    expect(result.structuredContent).toMatchObject({
      protocolVersion: 1,
      defaultSessionId: 'editor',
      easingPresets: expect.arrayContaining(['linear', 'cubic-in', 'cubic-out']),
      layerMotion: {
        operation: 'set_layer_motion',
        styles: ['fade', 'slide', 'fly', 'focus', 'wipe', 'scale', 'pop', 'grow', 'spin', 'drop'],
      },
      bindings: { fieldTypes: expect.arrayContaining(['text', 'object', 'array']) },
    });
    expect(result.structuredContent).not.toHaveProperty('elementSchemas');
    expect(result.structuredContent).not.toHaveProperty('editor');
  });

  it('applies and returns deterministic design QA when browser capture is unavailable', async () => {
    const sessionId = 'apply-review-browser-free-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const result = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        mode: 'apply',
        includeReview: true,
        sessionId,
        expectedRevision: 0,
        operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Reviewed panel' }],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      revision: 1,
      review: { score: expect.any(Number), findings: expect.any(Array) },
      capture: null,
      captureOmitted: expect.stringContaining('not connected'),
    });
    expect(host.workspace.get(sessionId).revision).toBe(1);
  });

  it('adds a capture URL to apply review and never fails the mutation when capture fails', async () => {
    const port = (host.httpServer.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`);
    testEditorSocket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const transparentPixel =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcJR8QAAAABJRU5ErkJggg==';
    let failCapture = false;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; requestId?: string };
      if (!message.requestId) return;
      if (message.type === 'heartbeat.request') {
        socket.send(JSON.stringify({ type: 'heartbeat.result', requestId: message.requestId }));
      } else if (message.type === 'capture.request') {
        socket.send(
          JSON.stringify({
            type: 'capture.result',
            requestId: message.requestId,
            ...(failCapture
              ? { error: 'Synthetic browser capture failure.' }
              : {
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

    const sessionId = 'apply-review-capture-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const captured = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        mode: 'apply',
        includeReview: true,
        sessionId,
        expectedRevision: 0,
        operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Captured panel' }],
      },
    });
    expect(captured.isError).not.toBe(true);
    expect(captured.structuredContent).toMatchObject({
      revision: 1,
      review: { score: expect.any(Number) },
      capture: { url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/) },
      captureOmitted: null,
    });

    failCapture = true;
    const failedSessionId = 'apply-review-failed-capture-test';
    await client.callTool({
      name: 'ograf_create_project',
      arguments: { sessionId: failedSessionId },
    });
    const degraded = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        mode: 'apply',
        includeReview: true,
        sessionId: failedSessionId,
        expectedRevision: 0,
        operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Still applied panel' }],
      },
    });
    expect(degraded.isError).not.toBe(true);
    expect(degraded.structuredContent).toMatchObject({
      revision: 1,
      review: { score: expect.any(Number) },
      capture: null,
      captureOmitted: expect.stringContaining('Synthetic browser capture failure'),
    });
    expect(host.workspace.get(failedSessionId).revision).toBe(1);
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
      'decorative',
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

  it('authors enriched GDD field metadata through the typed MCP operation schema', async () => {
    const sessionId = 'gdd-field-mcp-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'add_data_field',
            fieldType: 'select',
            key: 'theme',
            label: 'Theme',
            description: 'Operator theme selection.',
            options: [
              { value: 'news', label: 'News' },
              { value: 'sport', label: 'Sport' },
            ],
            defaultValue: 'news',
            constraints: { maxLength: 12 },
            required: true,
          },
          {
            type: 'add_data_field',
            fieldType: 'select-multiple',
            key: 'regions',
            options: [
              { value: 'eu', label: 'Europe' },
              { value: 'na', label: 'North America' },
            ],
            defaultValue: ['eu'],
          },
          {
            type: 'add_data_field',
            fieldType: 'file-path',
            key: 'document',
            fileExtensions: ['pdf'],
          },
        ],
      },
    });
    expect(applied.isError).not.toBe(true);
    expect(host.workspace.get(sessionId).snapshot().project.compositions[0]!.dataFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'theme',
          type: 'select',
          description: 'Operator theme selection.',
          constraints: { maxLength: 12 },
        }),
        expect.objectContaining({ key: 'regions', defaultValue: ['eu'] }),
        expect.objectContaining({ key: 'document', fileExtensions: ['pdf'] }),
      ]),
    );
  });

  it('authors recursive GDD data and a deterministic runtime collection by selectors', async () => {
    const sessionId = 'runtime-collection-mcp-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          {
            type: 'add_data_field',
            fieldType: 'array',
            key: 'leaderboard',
            label: 'Leaderboard',
            defaultValue: [
              { name: 'Ada', score: 10 },
              { name: 'Lin', score: 8 },
            ],
            items: {
              key: 'item',
              fieldType: 'object',
              defaultValue: { name: '', score: 0 },
              properties: [
                {
                  key: 'name',
                  label: 'Name',
                  fieldType: 'text',
                  required: true,
                  constraints: { maxLength: 40 },
                },
                { key: 'score', label: 'Score', fieldType: 'integer' },
              ],
            },
          },
          { type: 'add_layer', kind: 'rectangle', name: 'Row plate' },
          { type: 'add_layer', kind: 'text', name: 'Row name' },
          {
            type: 'set_layer_layout',
            layerName: 'Row plate',
            groupId: 'leaderboard-prototype',
          },
          {
            type: 'set_layer_layout',
            layerName: 'Row name',
            groupId: 'leaderboard-prototype',
          },
          {
            type: 'set_layer_bindings',
            layerName: 'Row name',
            bindings: [
              {
                fieldKey: 'leaderboard',
                targetProperty: 'content',
                sourcePath: ['name'],
              },
            ],
          },
          {
            type: 'create_runtime_collection',
            name: 'Leaderboard rows',
            fieldKey: 'leaderboard',
            layerNames: ['Row plate', 'Row name'],
            offsetPerItem: { x: 0, y: 72 },
            capacity: 4,
          },
        ],
      },
    });
    expect(applied.isError).not.toBe(true);
    const composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(composition.dataFields[0]).toMatchObject({
      key: 'leaderboard',
      type: 'array',
      constraints: { maxItems: 4 },
      items: {
        type: 'object',
        properties: [
          { key: 'name', type: 'text', constraints: { maxLength: 40 } },
          { key: 'score', type: 'integer' },
        ],
      },
    });
    expect(composition.runtimeCollections[0]).toMatchObject({
      name: 'Leaderboard rows',
      offsetPerItem: { x: 0, y: 72 },
      capacity: 4,
      overflow: 'truncate',
    });
    expect(composition.layers[1]!.bindings[0]!.sourcePath).toEqual(['name']);

    const inspected = await client.callTool({
      name: 'ograf_inspect_scene',
      arguments: { sessionId },
    });
    expect(inspected.structuredContent).toMatchObject({
      compositions: [
        {
          runtimeCollections: [{ name: 'Leaderboard rows', fieldKey: 'leaderboard', capacity: 4 }],
        },
      ],
    });
  });

  it('authors and inspects static composition-local blend modes', async () => {
    const sessionId = 'blend-mode-mcp-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    const applied = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_layer', kind: 'rectangle', name: 'Blend plate' },
          { type: 'set_layer_flags', layerName: 'Blend plate', blendMode: 'multiply' },
        ],
      },
    });
    expect(applied.isError).not.toBe(true);
    expect(
      host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers[0]!.blendMode,
    ).toBe('multiply');
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
    expect(asset.isError, JSON.stringify(asset.content)).not.toBe(true);
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
    expect(bundle.isError, JSON.stringify(bundle.content)).not.toBe(true);
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
          mode: dryRun ? 'dry-run' : 'apply',
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
        operations: [
          {
            type: 'add_layer',
            kind: 'text',
            name: 'Agent title',
            transform: { x: 67, y: 38 },
          },
        ],
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

  it('audits exposed data field usage without browser access or changing validity or revision', async () => {
    const sessionId = 'data-field-usage-test';
    await client.callTool({ name: 'ograf_create_project', arguments: { sessionId } });
    await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId,
        expectedRevision: 0,
        operations: [
          { type: 'add_data_field', fieldType: 'color', key: 'orphan_color' },
          { type: 'add_data_field', fieldType: 'text', key: 'headline' },
          { type: 'add_layer', kind: 'text', name: 'Headline' },
          {
            type: 'set_layer_bindings',
            layerName: 'Headline',
            bindings: [{ fieldKey: 'headline', targetProperty: 'content' }],
          },
        ],
      },
    });
    const before = host.workspace.get(sessionId).snapshot();
    const defaultResult = await client.callTool({
      name: 'ograf_validate_project',
      arguments: { sessionId },
    });
    expect(defaultResult.structuredContent).not.toHaveProperty('dataFieldUsage');
    const result = await client.callTool({
      name: 'ograf_validate_project',
      arguments: { sessionId, dataFieldUsage: true },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      revision: before.revision,
      validation: { valid: true },
      dataFieldUsage: {
        enabled: true,
        checked: 2,
        reported: 1,
        fields: [{ fieldKey: 'orphan_color', status: 'unreferenced', references: [] }],
      },
    });
    const full = await client.callTool({
      name: 'ograf_validate_project',
      arguments: { sessionId, dataFieldUsage: true, detail: 'full' },
    });
    expect(full.structuredContent).toMatchObject({ dataFieldUsage: { reported: 2 } });
    expect(host.workspace.get(sessionId).snapshot()).toEqual(before);
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
        mode: 'dry-run',
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
      actionSafe: { x: 67, y: 38, width: 1786, height: 1004 },
      titleSafe: { x: 96, y: 54, width: 1728, height: 972 },
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

  it('rejects malformed gradient edits without crashing or discarding the last valid project', async () => {
    const port = (host.httpServer.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`);
    testEditorSocket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const message = (type: string) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.off('message', receive);
          reject(Error(`No ${type}`));
        }, 2000);
        const receive = (raw: { toString(): string }) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === type) {
            clearTimeout(timeout);
            socket.off('message', receive);
            resolve(parsed);
          }
        };
        socket.on('message', receive);
      });
    const before = host.workspace.get('editor').snapshot();
    let reply = message('editor.ack');
    socket.send(JSON.stringify({ type: 'editor.hello', project: before.project }));
    await reply;
    const invalid = structuredClone(before.project),
      broken = createLayerOfKind('rectangle');
    broken.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    broken.animationTracks['fill.stops[1].offset'] = [createLayerPropertyKeyframe(0, 0.5)];
    invalid.compositions[0]!.layers.push(broken);
    reply = message('editor.error');
    socket.send(JSON.stringify({ type: 'editor.project', project: invalid }));
    expect((await reply).message).toContain('gradient stop');
    expect(host.workspace.get('editor').snapshot()).toEqual(before);
    expect(host.bridge.health.certificationReady).toBe(false);
    reply = message('editor.ack');
    socket.send(JSON.stringify({ type: 'editor.project', project: before.project }));
    await reply;
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(host.workspace.get('editor').snapshot()).toEqual(before);
    expect(host.bridge.health.certificationLikelyCause).not.toContain('gradient stop');
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

  it('requires the canonical .ogs extension for new MCP saves', async () => {
    const result = await client.callTool({
      name: 'ograf_save_project',
      arguments: {
        sessionId: 'editor',
        path: 'fixtures/legacy-output.ogeproj',
        confirm: true,
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Project path must end in .ogs');
  });

  it('exposes revision-checked compact and compatible set saves over MCP', async () => {
    const listed = await client.listTools();
    const tool = listed.tools.find((item) => item.name === 'ograf_save_template_set');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema).toMatchObject({
      required: expect.arrayContaining(['expectedRevision', 'path', 'confirm']),
      properties: { archiveMode: { default: 'compact', enum: ['compact', 'compatible'] } },
    });
    const capabilities = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['templateSets'] },
    });
    expect(capabilities.structuredContent).toMatchObject({
      templateSets: {
        save: 'ograf_save_template_set',
        storage: { archiveSchemaVersion: 6, compatibleArchiveSchemaVersion: 5 },
        transitionLogic: {
          definitionVersion: 6,
          readableDefinitionVersions: [1, 2, 3, 4, 5, 6],
          slotUpdateMode: {
            minimumDefinitionVersion: 6,
            field: 'slot.updateMode',
            values: ['transition', 'in-place'],
          },
          contentAnimations: {
            minimumDefinitionVersion: 5,
            fields: ['recipe.incomingAnimation', 'recipe.outgoingAnimation'],
            choices: ['template', 'builtin', 'plugin'],
            scope: 'whole-nonshared-template-content',
          },
          slotAdmission: {
            minimumDefinitionVersion: 4,
            field: 'slot.admission',
            fields: ['requireOnSlotIds', 'blockWhileActiveSlotIds'],
            requireOn: 'settled-on',
            blockingPhases: ['preparing', 'entering', 'on', 'leaving'],
            rejectedTakeQueued: false,
          },
          exportStartup: {
            defaults: 'compatible-baseline-in-stable-lane-order',
            dependentLanes: 'off',
            conflictingStates: 'excluded',
            takeSuggestions: 'independent-first-valid-state',
            playPlanning: 'whole-selection-preflight-and-resource-preparation-before-output',
            rejectedSelection: 'status-550-with-on-air-selections-unchanged',
          },
          preparationCache: {
            scope: 'realtime-pristine-dormant-template-instances-and-shared-probes',
            maximumInstances: 4,
            maximumEstimatedBytes: 67_108_864,
            admission: 'unchanged-take-conditions-and-transition-timing',
            nonRealtime: 'fresh-deterministic-replay-without-instance-cache',
          },
          statePresets: {
            minimumDefinitionVersion: 4,
            field: 'state.dataDefaults',
            precedenceLowToHigh: [
              'template-defaults',
              'state-defaults',
              'retained-state-data',
              'explicit-data',
            ],
          },
        },
      },
    });
    const result = await client.callTool({
      name: 'ograf_save_template_set',
      arguments: {
        expectedRevision: 'unopened-set:0',
        path: 'fixtures/disconnected-set.ogs',
        confirm: true,
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('live editor to be connected');
  });

  it('advertises asynchronous shader draws and explicit deterministic GPU completion', async () => {
    const capabilities = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['shaders'] },
    });
    expect(capabilities.structuredContent).toMatchObject({
      paintSchemas: {
        shader: {
          runtimeProfile: {
            frameCompletion: {
              realtime: 'asynchronous-gpu-submission-without-finish-or-per-draw-error-read',
              deterministic:
                'asynchronous-gpu-fence-at-content-readiness-seek-and-capture-boundaries',
            },
          },
        },
      },
    });
  });

  it('advertises chart mark Paint support with its explicit provider feature requirement', async () => {
    const capabilities = await client.callTool({
      name: 'ograf_get_capabilities',
      arguments: { sections: ['elements'] },
    });
    expect(capabilities.structuredContent).toMatchObject({
      elementSchemas: {
        chart: {
          fill: {
            optional: true,
            type: 'Paint',
            requiredFeature: 'mark-paint-v1',
            supported: ['solid', 'linear', 'radial', 'conic', 'shader', 'media'],
          },
        },
      },
      paintSchemas: { shader: { supportedElements: expect.arrayContaining(['chart']) } },
    });
  });

  it('keeps certified save and export closed when the editor is disconnected', async () => {
    for (const [name, path] of [
      ['ograf_save_project', 'fixtures/disconnected-gate.ogs'],
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

  it('includes the offline preview in an MCP-certified single-template export', async () => {
    const port = (host.httpServer.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`);
    testEditorSocket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const transparentPixel =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcJR8QAAAABJRU5ErkJggg==';
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; requestId?: string };
      if (!message.requestId) return;
      if (message.type === 'heartbeat.request') {
        socket.send(JSON.stringify({ type: 'heartbeat.result', requestId: message.requestId }));
      } else if (message.type === 'capture.request') {
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
      } else if (message.type === 'certification.request') {
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
    const name = `offline-preview-test-${randomUUID()}.ograf.zip`;
    const target = host.workspace.resolveAllowedPath(name);
    try {
      const exported = await client.callTool({
        name: 'ograf_export_package',
        arguments: { sessionId: 'editor', path: name, profile: 'dual', confirm: true },
      });
      expect(exported.isError, JSON.stringify(exported.content)).not.toBe(true);
      const zip = await JSZip.loadAsync(await readFile(target));
      const manifestFile = Object.keys(zip.files).find((path) => path.endsWith('.ograf.json'))!;
      const manifest = JSON.parse(await zip.file(manifestFile)!.async('string'));
      expect(manifest.main).toBe('main.js');
      expect(zip.file('main.js')).not.toBeNull();
      const previewFileName = (exported.structuredContent as { previewFileName: string })
        .previewFileName;
      expect(previewFileName).toBe(`${manifest.name}.html`);
      expect(zip.file('index.html')).toBeNull();
      const index = await zip.file(previewFileName)!.async('string');
      const licensePath = 'licenses/OGRAF-STUDIO-AGPL-3.0.txt';
      expect(index).toContain('<!doctype html>');
      expect(index).toContain(licensePath);
      expect(await zip.file('main.js')!.async('string')).toContain(licensePath);
      expect(await zip.file(licensePath)!.async('nodebuffer')).toEqual(
        await readFile(new URL('../../../LICENSE', import.meta.url)),
      );
      expect(await zip.file(manifest.thumbnails[0].file)!.async('base64')).toBe(transparentPixel);
    } finally {
      await unlink(target).catch(() => undefined);
    }
  });

  it('returns a short-lived PNG URL and optional inline image without mutating revision', async () => {
    const port = (host.httpServer.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`);
    testEditorSocket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const before = host.workspace.get('editor').revision;

    const transparentPixel =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcJR8QAAAABJRU5ErkJggg==';
    const capturedLayerNames: string[][] = [];
    let presentedProposalId: string | null = null;
    let presentedDraftLayers: string[] = [];
    let presentedRender: string | undefined;
    let presentedFrames: number[] | undefined;
    let stripRequestCount = 0;
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
        proposal?: {
          id: string;
          render?: string;
          frames?: number[];
          project?: { compositions: Array<{ layers: Array<{ name: string }> }> };
        };
        proposalId?: string;
        result?: { status: string; revision?: number };
      };
      if (message.type === 'proposal.present' && message.proposal) {
        presentedProposalId = message.proposal.id;
        presentedRender = message.proposal.render;
        presentedFrames = message.proposal.frames;
        presentedDraftLayers =
          message.proposal.project?.compositions[0]?.layers.map((layer) => layer.name) ?? [];
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
        stripRequestCount++;
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
              appliedFontSize: 24,
              appliedFitRatio: 0.5,
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

    // Install the heartbeat responder before hello: ack and the first heartbeat may share one
    // WebSocket read, so awaiting ack before installing this listener can lose the heartbeat.
    const acknowledged = new Promise<void>((resolve) => socket.once('message', () => resolve()));
    socket.send(
      JSON.stringify({
        type: 'editor.hello',
        project: host.workspace.get('editor').snapshot().project,
      }),
    );
    await acknowledged;

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
      name: 'ograf_apply_operations',
      arguments: {
        mode: 'preview',
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
    expect(measurement.isError, JSON.stringify(measurement.content)).not.toBe(true);
    expect(measurement.structuredContent).toMatchObject({
      frame: expect.any(Number),
      overflowsParent: true,
      appliedFontSize: 24,
      appliedFitRatio: 0.5,
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

    const stripsBeforeProposal = stripRequestCount;
    const proposed = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        mode: 'propose',
        sessionId: 'editor',
        expectedRevision: before,
        title: 'Add reviewed panel',
        render: 'strip',
        operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Accepted review panel' }],
      },
    });
    expect(proposed.isError).not.toBe(true);
    const proposalId = (proposed.structuredContent as { proposalId: string }).proposalId;
    for (let attempt = 0; attempt < 20 && presentedProposalId !== proposalId; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(presentedProposalId).toBe(proposalId);
    expect(presentedRender).toBe('frame');
    expect(presentedFrames).toHaveLength(1);
    expect(stripRequestCount).toBe(stripsBeforeProposal);
    expect(presentedDraftLayers).toContain('Accepted review panel');
    expect(host.workspace.get('editor').revision).toBe(before);
    expect(
      host.workspace
        .get('editor')
        .snapshot()
        .project.compositions[0]!.layers.some((layer) => layer.name === 'Accepted review panel'),
    ).toBe(false);
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
