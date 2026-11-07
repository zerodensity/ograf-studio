import { describe, expect, it } from 'vitest';
import {
  createChartElement,
  createFieldDefinition,
  createProject,
  createRendererPluginSnapshot,
  type FieldDefinition,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';
import { AuthoringSession } from './session';
import type { AuthoringOperation } from './types';

function sessionWith(
  fields: FieldDefinition[],
  operations: AuthoringOperation[],
  plugins: RendererPluginSnapshot[] = [],
) {
  const project = createProject();
  project.compositions[0]!.dataFields = fields;
  project.compositions[0]!.rendererPlugins = plugins;
  const session = new AuthoringSession(project);
  const initial = session.apply({ expectedRevision: 0, operations });
  expect(initial.validation.errors).toEqual([]);
  return { session, initial };
}

describe('designer binding edits through authoring operations', () => {
  it.each([
    {
      label: 'preserves existing mixed styles for unchanged content',
      patch: { content: 'Gold Medal' },
      expectedRuns: [
        { text: 'Gold ', color: '#d4af37' },
        { text: 'Medal', fontWeight: 800 },
      ],
    },
    {
      label: 'clears stale mixed styles when a content-only edit changes the text',
      patch: { content: 'New headline' },
      expectedRuns: [],
    },
    {
      label: 'retains matching new runs explicitly supplied with changed content',
      patch: {
        content: 'New headline',
        runs: [
          { text: 'New ', fontStyle: 'italic' },
          { text: 'headline', color: '#00ff00' },
        ],
      },
      expectedRuns: [
        { text: 'New ', fontStyle: 'italic' },
        { text: 'headline', color: '#00ff00' },
      ],
    },
  ])('$label', ({ patch, expectedRuns }) => {
    const field = createFieldDefinition('text', {
      id: 'headline',
      key: 'headline',
      defaultValue: 'Gold Medal',
    });
    const { session } = sessionWith(
      [field],
      [
        {
          type: 'add_layer',
          id: 'text',
          kind: 'text',
          element: {
            content: 'Gold Medal',
            runs: [
              { text: 'Gold ', color: '#d4af37' },
              { text: 'Medal', fontWeight: 800 },
            ],
          },
        },
        {
          type: 'set_layer_binding',
          layerId: 'text',
          binding: { fieldId: field.id, targetProperty: 'content' },
        },
      ],
    );
    const changed = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'update_element', layerId: 'text', patch }],
    });
    const composition = changed.project.compositions[0]!;
    expect(changed.validation.errors).toEqual([]);
    expect(composition.layers[0]!.element).toMatchObject({
      content: patch.content,
      runs: expectedRuns,
    });
    expect(composition.dataFields[0]!.defaultValue).toBe(patch.content);
    expect(composition.layers[0]!.bindings).toEqual([
      { fieldId: field.id, targetProperty: 'content' },
    ]);
  });

  it('updates exposed text/defaults atomically and restores both with undo and redo', () => {
    const field = createFieldDefinition('text', {
      id: 'headline',
      key: 'headline',
      defaultValue: 'Original',
    });
    const { session, initial } = sessionWith(
      [field],
      [
        { type: 'add_layer', id: 'text', kind: 'text', element: { content: 'Original' } },
        { type: 'add_layer', id: 'shared', kind: 'text', element: { content: 'Original' } },
        {
          type: 'set_layer_binding',
          layerId: 'text',
          binding: { fieldId: field.id, targetProperty: 'content' },
        },
        {
          type: 'set_layer_binding',
          layerId: 'shared',
          binding: { fieldId: field.id, targetProperty: 'content' },
        },
      ],
    );
    const changed = session.apply({
      expectedRevision: 1,
      operations: [
        { type: 'update_element', layerId: 'text', patch: { content: 'Designer headline' } },
      ],
    });
    const composition = changed.project.compositions[0]!;
    expect(changed.validation.errors).toEqual([]);
    expect(composition.dataFields[0]!.defaultValue).toBe('Designer headline');
    expect(composition.layers[0]!.element).toMatchObject({ content: 'Designer headline' });
    expect(composition.layers.every((layer) => layer.bindings[0]?.fieldId === field.id)).toBe(true);
    expect(session.undo(2).project).toEqual(initial.project);
    expect(session.redo(3).project).toEqual(changed.project);
  });

  it('updates nested defaults from a text edit while retaining other data properties', () => {
    const field = createFieldDefinition('object', {
      id: 'team',
      key: 'team',
      defaultValue: { name: 'Old', score: 3 },
      properties: [
        createFieldDefinition('text', { key: 'name', defaultValue: 'Old' }),
        createFieldDefinition('integer', { key: 'score', defaultValue: 3 }),
      ],
    });
    const { session } = sessionWith(
      [field],
      [
        { type: 'add_layer', id: 'text', kind: 'text' },
        {
          type: 'set_layer_binding',
          layerId: 'text',
          binding: {
            fieldId: field.id,
            targetProperty: 'content',
            sourcePath: ['name'],
          },
        },
      ],
    );
    const changed = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'update_element', layerId: 'text', patch: { content: 'Home' } }],
    });
    expect(changed.validation.errors).toEqual([]);
    const next = changed.project.compositions[0]!.dataFields[0]!;
    expect(next.defaultValue).toEqual({ name: 'Home', score: 3 });
    expect(next.properties[0]!.defaultValue).toBe('Home');
    expect(next.properties[1]!.defaultValue).toBe(3);
  });

  it('edits the default selector option mapping while keeping the field and other options', () => {
    const field = createFieldDefinition('select', {
      id: 'team',
      key: 'team',
      defaultValue: 'home',
      options: [
        { value: 'home', label: 'Home' },
        { value: 'away', label: 'Away' },
      ],
    });
    const { session } = sessionWith(
      [field],
      [
        { type: 'add_layer', id: 'text', kind: 'text' },
        {
          type: 'set_layer_binding',
          layerId: 'text',
          binding: {
            fieldId: field.id,
            targetProperty: 'color',
            valueMap: { home: '#ff0000', away: '#0000ff' },
          },
        },
      ],
    );
    const changed = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'update_element', layerId: 'text', patch: { color: '#00ff00' } }],
    });
    const composition = changed.project.compositions[0]!;
    expect(changed.validation.errors).toEqual([]);
    expect(composition.dataFields[0]!.defaultValue).toBe('home');
    expect(composition.layers[0]!.bindings[0]!.valueMap).toEqual({
      home: '#00ff00',
      away: '#0000ff',
    });
  });

  it('updates bound chart JSON in a dry run without changing the current session', () => {
    const plugin = createRendererPluginSnapshot({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        kind: 'chart',
        id: 'test.chart',
        version: '1.0.0',
        name: 'Chart provider',
        presets: ['bar'],
        license: 'MIT',
      },
      source:
        'export default {apiVersion:1,create(){return {renderAtFrame(){},update(){},dispose(){}}}};',
      licenseText: 'Test license',
    });
    const data = createChartElement().data;
    const field = createFieldDefinition('textarea', {
      id: 'chart-data',
      key: 'chart_data',
      defaultValue: JSON.stringify(data),
    });
    const { session, initial } = sessionWith(
      [field],
      [
        {
          type: 'add_layer',
          id: 'chart',
          kind: 'chart',
          element: {
            provider: {
              id: plugin.manifest.id,
              version: plugin.manifest.version,
              sha256: plugin.sha256,
            },
          },
        },
        {
          type: 'set_layer_binding',
          layerId: 'chart',
          binding: { fieldId: field.id, targetProperty: 'data' },
        },
      ],
      [plugin],
    );
    data.datasets[0]!.data[0] = 75;
    const proposed = session.apply({
      expectedRevision: 1,
      dryRun: true,
      operations: [{ type: 'update_element', layerId: 'chart', patch: { data } }],
    });
    expect(proposed.validation.errors).toEqual([]);
    expect(
      JSON.parse(String(proposed.project.compositions[0]!.dataFields[0]!.defaultValue)),
    ).toEqual(data);
    expect(session.revision).toBe(1);
    expect(session.snapshot().project).toEqual(initial.project);
  });

  it('updates bound stack effect defaults for frame edits while retaining unrelated tracks', () => {
    const field = createFieldDefinition('number', {
      id: 'radius',
      key: 'radius',
      defaultValue: 10,
    });
    const { session, initial } = sessionWith(
      [field],
      [
        { type: 'add_layer', id: 'rectangle', kind: 'rectangle' },
        {
          type: 'add_effect',
          layerId: 'rectangle',
          id: 'bloom',
          effectType: 'glow',
          patch: { params: { radius: 10 } },
        },
        {
          type: 'set_layer_binding',
          layerId: 'rectangle',
          binding: { fieldId: field.id, targetProperty: 'effects.bloom.radius' },
        },
      ],
    );
    const changed = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'update_effect',
          layerId: 'rectangle',
          effectId: 'bloom',
          scope: 'frame',
          frame: 5,
          patch: { params: { radius: 20 } },
        },
      ],
    });
    const composition = changed.project.compositions[0]!;
    expect(changed.validation.errors).toEqual([]);
    expect(composition.dataFields[0]!.defaultValue).toBe(20);
    expect(composition.layers[0]!.animationTracks['effects.bloom.radius']).toContainEqual(
      expect.objectContaining({ frame: 5, value: 20 }),
    );
    expect(composition.layers[0]!.animationTracks.x).toEqual(
      initial.project.compositions[0]!.layers[0]!.animationTracks.x,
    );
    expect(composition.layers[0]!.bindings[0]!.targetProperty).toBe('effects.bloom.radius');
  });

  it('updates a legacy shadow binding through update_effects', () => {
    const field = createFieldDefinition('color', {
      id: 'shadow',
      key: 'shadow',
      defaultValue: '#000000',
    });
    const { session } = sessionWith(
      [field],
      [
        { type: 'add_layer', id: 'rectangle', kind: 'rectangle' },
        {
          type: 'set_layer_binding',
          layerId: 'rectangle',
          binding: { fieldId: field.id, targetProperty: 'dropShadowColor' },
        },
      ],
    );
    const changed = session.apply({
      expectedRevision: 1,
      operations: [
        {
          type: 'update_effects',
          layerId: 'rectangle',
          patch: { dropShadowColor: '#ff00ff', dropShadowEnabled: true },
        },
      ],
    });
    expect(changed.validation.errors).toEqual([]);
    expect(changed.project.compositions[0]!.dataFields[0]!.defaultValue).toBe('#ff00ff');
    expect(changed.project.compositions[0]!.layers[0]!.bindings).toHaveLength(1);
  });

  it('clears exposed image URLs through update_element while retaining the binding', () => {
    const field = createFieldDefinition('image-url', {
      id: 'image-source',
      key: 'image_source',
      defaultValue: 'https://example.com/image.png',
    });
    const { session } = sessionWith(
      [field],
      [
        {
          type: 'add_layer',
          id: 'image',
          kind: 'image',
          element: { src: 'https://example.com/image.png' },
        },
        {
          type: 'set_layer_binding',
          layerId: 'image',
          binding: { fieldId: field.id, targetProperty: 'src' },
        },
      ],
    );
    const changed = session.apply({
      expectedRevision: 1,
      operations: [{ type: 'update_element', layerId: 'image', patch: { src: null } }],
    });
    expect(changed.project.compositions[0]!.dataFields[0]!.defaultValue).toBe('');
    expect(changed.project.compositions[0]!.layers[0]!.bindings).toEqual([
      { fieldId: field.id, targetProperty: 'src' },
    ]);
  });
});
