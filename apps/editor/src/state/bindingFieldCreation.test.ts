import { beforeEach, describe, expect, it } from 'vitest';
import {
  createClockLayer,
  createDefaultGradient,
  createMediaPaint,
  createRectangleLayer,
  createLayerKeyframe,
  createDefaultTransform,
} from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { createNextBinding, nextBindingProperty } from './bindingFieldCreation';
import { resolveEffectiveElement } from './dataBinding';
import { bindableProperties } from './dataBinding';
import { getActiveComposition, useProjectStore } from './projectStore';

function activeComposition() {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
}

describe('Add Binding field creation', () => {
  beforeEach(() => useProjectStore.getState().newProject());
  it('seeds geometry from the displayed frame and opacity as a neutral bounded factor', () => {
    const layer = createRectangleLayer();
    layer.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: -100 })),
      createLayerKeyframe(10, createDefaultTransform({ x: 300 })),
    ];
    const targets = bindableProperties(layer.element);
    layer.bindings = targets
      .filter((target) => target.value !== 'layer.x')
      .map((target) => ({ fieldId: 'existing', targetProperty: target.value }));
    const geometry = createNextBinding(layer, [], 10);
    expect(geometry?.binding.targetProperty).toBe('layer.x');
    expect(geometry?.field.defaultValue).toBe(300);
    layer.bindings = targets
      .filter((target) => target.value !== 'layer.opacity')
      .map((target) => ({ fieldId: 'existing', targetProperty: target.value }));
    const alpha = createNextBinding(layer, [], 0);
    expect(alpha?.field.defaultValue).toBe(1);
    expect(alpha?.field.constraints).toEqual({ minimum: 0, maximum: 1 });
  });

  it('creates and binds a text field in one action when the project has no fields', () => {
    const layerId = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().updateLayerElement(layerId, { content: 'Live score' });
    expect(activeComposition().dataFields).toHaveLength(0);

    const fieldId = useProjectStore.getState().addLayerBinding(layerId);
    const composition = activeComposition();
    const layer = composition.layers.find((candidate) => candidate.id === layerId)!;
    const field = composition.dataFields[0]!;

    expect(fieldId).toBe(field.id);
    expect(field).toMatchObject({
      key: 'text_content',
      label: 'Text: Text Content',
      type: 'text',
      defaultValue: 'Live score',
    });
    expect(layer.bindings).toEqual([{ fieldId, targetProperty: 'content' }]);
    expect(resolveEffectiveElement(layer, {}, [], composition.dataFields)).toMatchObject({
      content: 'Live score',
    });
    expect(validateProject(useProjectStore.getState().project).valid).toBe(true);
  });

  it('creates a fresh compatible field even when unrelated fields already exist', () => {
    useProjectStore.getState().addDataField('number');
    const layerId = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().updateLayerElement(layerId, { fill: '#aa3355' });

    const fieldId = useProjectStore.getState().addLayerBinding(layerId);
    const composition = activeComposition();
    const field = composition.dataFields.find((candidate) => candidate.id === fieldId);
    const layer = composition.layers.find((candidate) => candidate.id === layerId)!;

    expect(composition.dataFields).toHaveLength(2);
    expect(field).toMatchObject({ type: 'color', defaultValue: '#aa3355' });
    expect(layer.bindings).toEqual([{ fieldId, targetProperty: 'fill' }]);
    expect(resolveEffectiveElement(layer, {}, [], composition.dataFields)).toMatchObject({
      fill: '#aa3355',
    });
  });

  it('creates unique keys for repeated names and moves to the next free property', () => {
    const firstId = useProjectStore.getState().addLayer('text');
    const secondId = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().addLayerBinding(firstId);
    useProjectStore.getState().addLayerBinding(secondId);
    const nextFieldId = useProjectStore.getState().addLayerBinding(secondId);
    const composition = activeComposition();
    expect(composition.dataFields.map((field) => field.key)).toEqual([
      'text_content',
      'text_content_2',
      'text_color',
    ]);
    expect(composition.dataFields.find((field) => field.id === nextFieldId)).toMatchObject({
      type: 'color',
      defaultValue: '#ffffff',
    });
  });

  it('keeps locked layers unchanged', () => {
    const layerId = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().toggleLayerLock(layerId);
    expect(useProjectStore.getState().addLayerBinding(layerId)).toBeNull();
    expect(activeComposition().dataFields).toHaveLength(0);
    expect(activeComposition().layers[0]?.bindings).toHaveLength(0);
  });

  it('copies a gradient default and skips unsupported media paint bindings', () => {
    const layer = createRectangleLayer();
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    layer.element.fill = createDefaultGradient();
    const created = createNextBinding(layer, []);
    expect(created?.field.type).toBe('gradient');
    expect(created?.field.defaultValue).toEqual(layer.element.fill);
    expect(created?.field.defaultValue).not.toBe(layer.element.fill);

    layer.element.fill = createMediaPaint({ source: { kind: 'live', tag: 'camera' } });
    expect(nextBindingProperty(layer)?.value).toBe('dropShadowColor');
  });

  function projectWithClock(mode: 'clock' | 'count-down') {
    const project = structuredClone(useProjectStore.getState().project);
    const composition = project.compositions.find(
      (candidate) => candidate.id === project.mainCompositionId,
    )!;
    const layer = createClockLayer();
    if (layer.element.type !== 'text' || !layer.element.clock) throw new Error('Not a clock.');
    layer.element.clock = { ...layer.element.clock, mode };
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    composition.layers.push(layer);
    return { project, composition, layer };
  }

  it.each([
    ['clock', ['clock.format', 'clock.timeZone', 'clock.hourCycle', 'clock.showAmPm']],
    ['count-down', ['clock.format', 'clock.initialValueMs', 'clock.endBehavior']],
  ] as const)('offers valid data-driven settings on a %s', (mode, expected) => {
    const { project, composition, layer } = projectWithClock(mode);
    for (let next = createNextBinding(layer, composition.dataFields); next;) {
      composition.dataFields.push(next.field);
      layer.bindings.push(next.binding);
      next = createNextBinding(layer, composition.dataFields);
    }
    expect(layer.bindings.map((binding) => binding.targetProperty)).toEqual(
      expect.arrayContaining([...expected]),
    );
    expect(validateProject(project).errors).toEqual([]);
  });

  it('rejects a clock setting whose field default the setting cannot take', () => {
    const { project, composition, layer } = projectWithClock('clock');
    const seeded = createNextBinding(layer, composition.dataFields)!;
    const field = { ...seeded.field, type: 'text' as const, defaultValue: 'Mars/Olympus' };
    composition.dataFields.push(field);
    layer.bindings = [{ fieldId: field.id, targetProperty: 'clock.timeZone' }];
    expect(JSON.stringify(validateProject(project).errors)).toContain('clock.timeZone');
  });
});
