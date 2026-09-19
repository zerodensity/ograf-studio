import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildComponentDefinition,
  createComposition,
  createDefaultTransform,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createProject,
  createShaderPaint,
  getElementShaderPaint,
  syncShaderParameterFields,
  type NewLayerKind,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';
import { collectShaderResources, type ShaderResourceTarget } from './shaderResources';

function fixture(kind: NewLayerKind = 'text') {
  const project = createProject();
  const composition = project.compositions[0]!;
  const layer = createLayerOfKind(kind);
  if (layer.element.type === 'shader') throw new Error('Expected canonical object.');
  layer.element.fill = createShaderPaint({ name: 'Shared name' });
  if (layer.element.type === 'text') {
    layer.element.content = 'Keep editable text';
    layer.element.color = '#123456';
    layer.element.strokeColor = '#abcdef';
    layer.element.strokeWidth = 14;
    layer.element.strokePaint = createShaderPaint({ name: 'Shared name' });
  }
  layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ x: 88, width: 720 }))];
  composition.layers = [layer];
  syncShaderParameterFields(composition, layer);
  return { project, composition, layer };
}

describe('shader resource removal', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useSelectionStore.getState().select(null);
  });

  it.each([
    'rectangle',
    'ellipse',
    'path',
    'pattern',
    'text',
    'image',
    'image-sequence',
    'lottie',
  ] as const)(
    'restores %s paint fallback while preserving its object, animation, and other paint',
    (kind) => {
      const { project } = fixture(kind);
      useProjectStore.getState().loadProject(project);
      const state = useProjectStore.getState();
      const target = collectShaderResources(state.project).find((item) => item.slot === 'fill')!;
      const before = structuredClone(state.project.compositions[0]!.layers[0]!);
      const otherFields = state.project.compositions[0]!.dataFields.filter(
        (field) => field.generatedShaderParameter?.paintSlot === 'stroke',
      );
      useSelectionStore.getState().select(target.layerId);
      useTimelineStore.getState().setCurrentFrame(12);
      useTimelineStore.getState().setPlaying(true);
      const activeCompositionId = state.activeCompositionId;
      const activeKeyframeId = state.activeKeyframeId;
      state.removeShaderResource(target);
      const after = useProjectStore.getState();
      const layer = after.project.compositions[0]!.layers[0]!;
      const expected = structuredClone(before.element);
      if (
        expected.type === 'rectangle' ||
        expected.type === 'ellipse' ||
        expected.type === 'path' ||
        expected.type === 'pattern'
      )
        expected.fill = '#3b3f4a';
      else if (expected.type !== 'shader') delete expected.fill;
      expect(layer.element).toEqual(expected);
      expect(layer.id).toBe(before.id);
      expect(layer.keyframes).toEqual(before.keyframes);
      expect(layer.animationTracks).toEqual(before.animationTracks);
      expect(getElementShaderPaint(layer.element)).toBeUndefined();
      expect(after.project.compositions[0]!.dataFields).toEqual(otherFields);
      expect(
        layer.bindings.every((binding) =>
          binding.targetProperty.startsWith('strokePaint.parameters.'),
        ),
      ).toBe(true);
      expect(after.activeCompositionId).toBe(activeCompositionId);
      expect(after.activeKeyframeId).toBe(activeKeyframeId);
      expect(useSelectionStore.getState().selectedLayerId).toBe(target.layerId);
      expect(useTimelineStore.getState()).toMatchObject({ currentFrame: 12, isPlaying: true });
    },
  );

  it('removes only an outline and retains the original solid stroke settings and fill controls', () => {
    useProjectStore.getState().loadProject(fixture().project);
    const before = useProjectStore.getState().project.compositions[0]!;
    const target = collectShaderResources(useProjectStore.getState().project).find(
      (item) => item.slot === 'stroke',
    )!;
    const fillFields = before.dataFields.filter(
      (field) => field.generatedShaderParameter?.paintSlot === 'fill',
    );
    const fill = getElementShaderPaint(before.layers[0]!.element);
    useProjectStore.getState().removeShaderResource(target);
    const after = useProjectStore.getState().project.compositions[0]!;
    expect(after.layers[0]!.element).toMatchObject({
      type: 'text',
      content: 'Keep editable text',
      strokeColor: '#abcdef',
      strokeWidth: 14,
    });
    expect(after.layers[0]!.element).not.toHaveProperty('strokePaint');
    expect(getElementShaderPaint(after.layers[0]!.element)).toEqual(fill);
    expect(after.dataFields).toEqual(fillFields);
  });

  it('cleans only the selected saved-component scope, retaining user fields and a field used elsewhere', () => {
    const { project, composition, layer } = fixture();
    const userField = createFieldDefinition('number', { key: 'ordinary' });
    composition.dataFields.push(userField);
    const reused = composition.dataFields.find(
      (field) => field.generatedShaderParameter?.paintSlot === 'fill',
    )!;
    const other = createLayerOfKind('text');
    other.name = layer.name;
    other.bindings = [
      { fieldId: reused.id, targetProperty: 'content' },
      { fieldId: userField.id, targetProperty: 'strokeWidth' },
    ];
    composition.layers.push(other);
    composition.components.push(
      buildComponentDefinition(composition, [layer.id, other.id], 'Saved shader', 'component'),
    );
    useProjectStore.getState().loadProject(project);
    const target = collectShaderResources(useProjectStore.getState().project).find(
      (item) => item.componentId && item.slot === 'fill',
    )!;
    const liveBefore = JSON.stringify(useProjectStore.getState().project.compositions[0]!.layers);
    const fieldsBefore = JSON.stringify(
      useProjectStore.getState().project.compositions[0]!.dataFields,
    );
    useProjectStore.getState().removeShaderResource(target);
    const after = useProjectStore.getState().project.compositions[0]!;
    const component = after.components[0]!;
    expect(component.layers[0]!.element).not.toHaveProperty('fill');
    expect(getElementShaderPaint(component.layers[0]!.element, 'stroke')).toBeDefined();
    expect(component.dataFields.some((field) => field.id === reused.id)).toBe(true);
    expect(component.dataFields.some((field) => field.id === userField.id)).toBe(true);
    expect(
      component.dataFields.filter((field) => field.generatedShaderParameter?.paintSlot === 'fill'),
    ).toHaveLength(1);
    expect(JSON.stringify(after.layers)).toBe(liveBefore);
    expect(JSON.stringify(after.dataFields)).toBe(fieldsBefore);
  });

  it('removes broken GLSL without inspecting or repairing another broken paint', () => {
    useProjectStore.getState().loadProject(fixture().project);
    const project = structuredClone(useProjectStore.getState().project);
    const layer = project.compositions[0]!.layers[0]!;
    getElementShaderPaint(layer.element)!.fragmentSource = 'broken fill';
    getElementShaderPaint(layer.element, 'stroke')!.fragmentSource = 'broken outline';
    useProjectStore.setState({ project });
    const outlineBefore = structuredClone(getElementShaderPaint(layer.element, 'stroke'));
    const outlineFields = project.compositions[0]!.dataFields.filter(
      (field) => field.generatedShaderParameter?.paintSlot === 'stroke',
    );
    const target = collectShaderResources(project).find((item) => item.slot === 'fill')!;
    expect(() => useProjectStore.getState().removeShaderResource(target)).not.toThrow();
    const after = useProjectStore.getState().project.compositions[0]!;
    expect(getElementShaderPaint(after.layers[0]!.element, 'stroke')).toEqual(outlineBefore);
    expect(after.dataFields).toEqual(outlineFields);
    useProjectStore.getState().removeShaderResource({ ...target, slot: 'stroke' });
    expect(useProjectStore.getState().project.compositions[0]!.dataFields).toEqual([]);
  });

  it('converts a deprecated shader object without parsing its source and prunes obsolete fill-stop tracks', () => {
    useProjectStore.getState().loadProject(fixture('rectangle').project);
    const project = structuredClone(useProjectStore.getState().project);
    const layer = project.compositions[0]!.layers[0]!;
    layer.element = { ...getElementShaderPaint(layer.element)!, fragmentSource: 'broken legacy' };
    layer.animationTracks['fill.stops[0].offset'] = [createLayerPropertyKeyframe(0, 0)];
    layer.bindings = layer.bindings.map((binding) => ({
      ...binding,
      targetProperty: binding.targetProperty.replace(/^fill\./, ''),
    }));
    useProjectStore.setState({ project });
    const before = structuredClone(layer);
    useProjectStore.getState().removeShaderResource(collectShaderResources(project)[0]!);
    const after = useProjectStore.getState().project.compositions[0]!.layers[0]!;
    expect(after.element).toMatchObject({ type: 'rectangle', fill: '#3b3f4a', strokeWidth: 0 });
    expect(after.id).toBe(before.id);
    expect(after.keyframes).toEqual(before.keyframes);
    expect(after.animationTracks).not.toHaveProperty('fill.stops[0].offset');
    expect(after.bindings).toEqual([]);
    expect(useProjectStore.getState().project.compositions[0]!.dataFields).toEqual([]);
  });

  it('rejects locked or stale targets and keeps same-ID objects in other compositions unchanged', () => {
    const { project, layer } = fixture();
    const secondary = createComposition({ layers: [structuredClone(layer)] });
    project.compositions.push(secondary);
    syncShaderParameterFields(secondary, secondary.layers[0]!);
    useProjectStore.getState().loadProject(project);
    const target = collectShaderResources(useProjectStore.getState().project)[0]!;
    useProjectStore.getState().toggleLayerLock(target.layerId);
    const lockedBefore = JSON.stringify(useProjectStore.getState().project);
    expect(() => useProjectStore.getState().removeShaderResource(target)).toThrow(/locked/);
    expect(() =>
      useProjectStore.getState().removeShaderResource({ ...target, layerId: 'gone' }),
    ).toThrow(/no longer exists/);
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(lockedBefore);
    useProjectStore.getState().toggleLayerLock(target.layerId);
    const secondaryBefore = JSON.stringify(useProjectStore.getState().project.compositions[1]);
    const otherTarget: ShaderResourceTarget = {
      ...target,
      compositionId: secondary.id,
      slot: 'stroke',
    };
    useProjectStore.getState().removeShaderResource(target);
    expect(JSON.stringify(useProjectStore.getState().project.compositions[1])).toBe(
      secondaryBefore,
    );
    expect(() => useProjectStore.getState().removeShaderResource(target)).toThrow(
      /no longer uses a shader/,
    );
    expect(() => useProjectStore.getState().removeShaderResource(otherTarget)).not.toThrow();
  });
});
