import { describe, expect, it } from 'vitest';
import { createFieldDefinition, createLayerOfKind, createProject } from './factory';
import { createLayerModifier } from './modifiers';
import { createLayerVisualRule } from './visualRules';
import { inspectDataFieldUsage } from './dataFieldUsage';

describe('advisory data field usage', () => {
  it('distinguishes unused controls, hidden bindings, excluded guides and live masks', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const fields = ['unused', 'hidden', 'guide', 'mask', 'paint'].map((key) =>
      createFieldDefinition('color', { key }),
    );
    composition.dataFields.push(...fields);
    const layers = fields.slice(1).map((field) => {
      const layer = createLayerOfKind('rectangle');
      layer.bindings = [{ fieldId: field.id, targetProperty: 'fill' }];
      return layer;
    });
    layers[0]!.isVisible = false;
    layers[1]!.isGuide = true;
    layers[2]!.isVisible = false;
    layers[2]!.isMaskOnly = true;
    // Shader/media/effect targets are still regular bindings; never whitelist paint properties.
    layers[3]!.bindings[0]!.targetProperty = 'effects.surface.shader.parameters.ink';
    composition.layers.push(...layers);
    const before = JSON.stringify(project);
    const result = inspectDataFieldUsage(project);
    expect(result.fields.map((field) => field.status)).toEqual([
      'unreferenced',
      'hidden-bindings-only',
      'guide-bindings-only',
      'referenced',
      'referenced',
    ]);
    expect(result.warnings).toHaveLength(3);
    expect(result.fields[4]!.references[0]).toMatchObject({
      kind: 'binding',
      targetProperty: 'effects.surface.shader.parameters.ink',
    });
    expect(JSON.stringify(project)).toBe(before);
  });

  it('recognizes rule conditions, comparisons and custom-action writes, modifier, collection, timing and connection uses', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const fields = ['condition', 'compare', 'write', 'empty', 'items', 'hold', 'connection'].map(
      (key) => createFieldDefinition('text', { key }),
    );
    composition.dataFields.push(...fields);
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        trigger: 'custom-action',
        eventId: 'refresh',
        conditions: [
          {
            fieldId: fields[0]!.id,
            sourcePath: [],
            operator: 'equals',
            compareFieldId: fields[1]!.id,
          },
        ],
        actions: [{ type: 'set-data', fieldId: fields[2]!.id, mode: 'set', value: 'ready' }],
      }),
    ];
    layer.modifiers = [
      createLayerModifier('hide-empty', {
        source: { kind: 'field', fieldId: fields[3]!.id, sourcePath: [] },
      }),
    ];
    layer.loop = {
      id: 'loop',
      name: 'Headlines',
      activation: { type: 'lifecycle' },
      durationFrames: 100,
      phaseOffsetFrames: 0,
      repeatCount: null,
      tracks: {},
      timing: {
        groupId: 'headlines',
        holdFieldId: fields[5]!.id,
        holdRanges: [{ startFrame: 0, endFrame: 50 }],
      },
    };
    composition.layers.push(layer);
    composition.runtimeCollections = [
      {
        id: 'list',
        name: 'List',
        fieldId: fields[4]!.id,
        prototypeLayerIds: [layer.id],
        offsetPerItem: { x: 0, y: 40 },
        capacity: 3,
        overflow: 'truncate',
      },
    ];
    composition.dataConnections = [
      {
        id: 'feed',
        name: 'Feed',
        format: 'json',
        source: 'embedded',
        url: '',
        embeddedText: '{}',
        refreshMs: 0,
        missing: 'default',
        enabled: false,
        mappings: [{ fieldId: fields[6]!.id, sourcePath: 'value' }],
      },
    ];
    const result = inspectDataFieldUsage(project);
    expect(result.warnings).toEqual([]);
    expect(result.fields.map((field) => field.references[0]!.kind)).toEqual([
      'rule',
      'rule',
      'rule',
      'modifier',
      'collection',
      'loop-timing',
      'connection',
    ]);
    expect(result.fields.at(-1)!.references[0]!.enabled).toBe(false);
  });

  it('does not mistake a retained component baseline for a live consumer', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const field = createFieldDefinition('text', { key: 'old_label' });
    composition.dataFields.push(field);
    const layer = createLayerOfKind('text');
    const baseline = structuredClone(layer);
    baseline.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    layer.componentLink = {
      componentId: 'component',
      instanceId: 'instance',
      sourceLayerId: layer.id,
      baseline,
    };
    composition.layers.push(layer);
    expect(inspectDataFieldUsage(project).fields[0]!.status).toBe('unreferenced');
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    expect(inspectDataFieldUsage(project).fields[0]!.status).toBe('referenced');
  });
});
