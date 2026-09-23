import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from './timelineStore';
import {
  getLayerPropertyValueAtFrame,
  createShaderPaint,
  getElementShaderPaint,
  getEffectStack,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';

describe('project store authoring', () => {
  beforeEach(() => useProjectStore.getState().newProject());
  it('keeps editable text and independent fill/outline fields when either paint changes', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('text');
    const current = () => useProjectStore.getState().project.compositions[0]!;
    const text = () => current().layers.find((layer) => layer.id === id)!;
    store.updateLayerPaint(id, 0, createShaderPaint());
    const fillFields = current().dataFields.map((field) => field.id);
    store.updateLayerTextStroke(id, 0, { strokePaint: createShaderPaint(), strokeWidth: 24 });
    expect(current().dataFields).toHaveLength(6);
    expect(new Set(current().dataFields.map((field) => field.key)).size).toBe(6);
    store.updateLayerElement(id, { content: 'Editable headline' });
    expect(text().element).toMatchObject({
      type: 'text',
      content: 'Editable headline',
      strokeWidth: 24,
    });
    expect(getElementShaderPaint(text().element, 'stroke')).toBeDefined();
    store.updateLayerTextStroke(id, 0, { strokeColor: '#ffaa00' });
    expect(getElementShaderPaint(text().element, 'stroke')).toBeUndefined();
    expect(getElementShaderPaint(text().element)).toBeDefined();
    expect(current().dataFields.map((field) => field.id)).toEqual(fillFields);
    store.updateLayerTextStroke(id, 0, { strokePaint: createShaderPaint() });
    const strokeFields = current()
      .dataFields.filter((field) => field.generatedShaderParameter?.paintSlot === 'stroke')
      .map((field) => field.id);
    store.updateLayerPaint(id, 0, '#ffffff');
    expect(current().dataFields.map((field) => field.id)).toEqual(strokeFields);
    expect(text().element.type).toBe('text');
  });
  it('applies shader paint without changing object kinds and cleans its fields when removed', () => {
    for (const kind of [
      'rectangle',
      'ellipse',
      'path',
      'pattern',
      'text',
      'image',
      'image-sequence',
      'lottie',
    ] as const) {
      const store = useProjectStore.getState();
      store.newProject();
      const id = store.addLayer(kind);
      store.updateLayerPaint(id, 0, createShaderPaint());
      const current = () => useProjectStore.getState().project.compositions[0]!;
      const painted = current().layers.find((layer) => layer.id === id)!;
      expect(painted.element.type).toBe(kind);
      expect(getElementShaderPaint(painted.element)).toBeDefined();
      expect(
        painted.bindings.every((binding) => binding.targetProperty.startsWith('fill.parameters.')),
      ).toBe(true);
      expect(current().dataFields).toHaveLength(3);
      const media = kind === 'image' || kind === 'image-sequence' || kind === 'lottie';
      store.updateLayerPaint(id, 0, media ? undefined : '#123456');
      expect(
        getElementShaderPaint(current().layers.find((layer) => layer.id === id)!.element),
      ).toBeUndefined();
      expect(current().dataFields).toHaveLength(0);
      expect(current().layers.find((layer) => layer.id === id)!.bindings).toHaveLength(0);
    }
  });
  it('keeps pragma controls and generated field defaults coherent through editing and duplication', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('shader');
    const fragmentSource = `#pragma ograf gain slider min(0.0) max(1.0) step(0.1)
const float gain = 0.5;
#pragma ograf tint color
vec3 tint = vec3(0.2, 0.4, 0.6);
void mainImage(out vec4 c, in vec2 p) { c = vec4(tint * gain, 1.0); }`;
    store.updateLayerPaint(id, 0, createShaderPaint({ fragmentSource, parameters: {} }));
    const composition = () => useProjectStore.getState().project.compositions[0]!;
    const gainField = () =>
      composition().dataFields.find(
        (field) =>
          field.generatedShaderParameter?.layerId === id &&
          field.generatedShaderParameter.name === 'gain',
      )!;
    expect(composition().dataFields).toHaveLength(2);
    store.updateLayerPaint(
      id,
      0,
      createShaderPaint({ fragmentSource, parameters: { gain: 0.8, tint: [0.2, 0.4, 0.6] } }),
    );
    expect(gainField().defaultValue).toBe(0.8);
    store.updateDataField(gainField().id, { defaultValue: 0.3 });
    expect(
      getElementShaderPaint(composition().layers.find((layer) => layer.id === id)!.element),
    ).toMatchObject({
      parameters: { gain: 0.3 },
    });
    const [copy] = store.duplicateLayers([id]);
    expect(composition().dataFields).toHaveLength(4);
    expect(new Set(composition().dataFields.map((field) => field.key)).size).toBe(4);
    store.removeLayer(copy!);
    expect(composition().dataFields).toHaveLength(2);
    const before = structuredClone(composition());
    expect(() =>
      store.updateLayerPaint(id, 0, createShaderPaint({ fragmentSource, parameters: { gain: 5 } })),
    ).toThrow();
    expect(composition()).toEqual(before);
    store.updateLayerPaint(
      id,
      0,
      createShaderPaint({
        fragmentSource: fragmentSource.replace('#pragma ograf tint color\n', ''),
        parameters: { gain: 0.3 },
      }),
    );
    expect(composition().dataFields).toHaveLength(1);
    expect(gainField().defaultValue).toBe(0.3);
  });
  it('edits and duplicates shader effects through Immer without structuredClone proxy failures', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.addLayerEffect(id, 'shader');
    const layer = () =>
      useProjectStore.getState().project.compositions[0]!.layers.find((item) => item.id === id)!;
    const effect = () => getEffectStack(layer().effects).find((item) => item.type === 'shader')!;
    const fragmentSource = `#pragma ograf waveFrequency slider min(0.0) max(16.0) step(0.1)
const float waveFrequency = 8.0;
#pragma ograf backgroundColor color
vec3 backgroundColor = vec3(0.025, 0.045, 0.10);
#pragma ograf highlightColor color
vec3 highlightColor = vec3(0.10, 0.38, 0.55);
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float wave = 0.5 + 0.5 * sin(uv.x * waveFrequency + uv.y * 4.0 - iTime);
  fragColor = vec4(mix(backgroundColor, highlightColor, wave * 0.6 + uv.y * 0.2), 1.0);
}`;
    expect(() =>
      store.updateLayerEffect(
        id,
        effect().id,
        { shader: createShaderPaint({ fragmentSource }) },
        0,
      ),
    ).not.toThrow();
    expect(effect().shader?.fragmentSource).toBe(fragmentSource);
    expect(() => store.duplicateLayerEffect(id, effect().id)).not.toThrow();
    expect(getEffectStack(layer().effects).filter((item) => item.type === 'shader')).toHaveLength(
      2,
    );
  });
  it('applies and removes a pack through Immer with existing token links and rounded shapes', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.setLayerSemantics(id, { role: 'container' });
    store.updateLayerElement(id, {
      borderRadius: { topLeft: 4, topRight: 7, bottomLeft: 2, bottomRight: 3 },
    });
    const before = structuredClone(
      useProjectStore.getState().project.compositions[0]!.layers[0]!.element,
    );
    expect(() => store.applyStylePack('sports')).not.toThrow();
    expect(() => store.removeStylePack()).not.toThrow();
    expect(useProjectStore.getState().project.compositions[0]!.layers[0]!.element).toEqual(before);
  });
  it('removes the applied Brand Kit pack through the Resources action', () => {
    const store = useProjectStore.getState();
    store.applyStylePack('news');
    store.removeStylePack();
    const state = useProjectStore.getState(),
      c = getActiveComposition(state.project, state.activeCompositionId);
    expect(c.designSystem.tokens.some((token) => token.key === 'brand.pack.id')).toBe(false);
    expect(c.designSystem.name).toBe('Brand Kit');
  });

  it('authors path paints and prevents mask-source deletion or cyclic Inspector edits', () => {
    const store = useProjectStore.getState(),
      target = store.addLayer('path'),
      source = store.addLayer('ellipse');
    useProjectStore.getState().updateLayerPaint(target, 0, {
      type: 'radial',
      angle: 0,
      stops: [
        { offset: 0, color: '#fff', opacity: 1 },
        { offset: 1, color: '#000', opacity: 0 },
      ],
    });
    useProjectStore
      .getState()
      .setLayerMask(target, { sourceLayerId: source, mode: 'alpha', inverted: false });
    const current = useProjectStore.getState(),
      c = getActiveComposition(current.project, current.activeCompositionId);
    expect(c.layers.find((l) => l.id === target)!.element).toMatchObject({
      type: 'path',
      fill: { type: 'radial' },
    });
    expect(c.layers.find((l) => l.id === source)!.isMaskOnly).toBe(true);
    expect(() =>
      useProjectStore
        .getState()
        .setLayerMask(source, { sourceLayerId: target, mode: 'alpha', inverted: false }),
    ).toThrow('cyclic');
    expect(() => useProjectStore.getState().removeLayer(source)).toThrow('Detach masks');
    useProjectStore.getState().setLayerMask(target, null);
    useProjectStore.getState().removeLayer(source);
    expect(
      getActiveComposition(
        useProjectStore.getState().project,
        current.activeCompositionId,
      ).layers.find((l) => l.id === source),
    ).toBeUndefined();
  });

  it('creates new projects with an opaque black canvas and 20% gray outside-canvas fill', () => {
    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);

    expect(composition.backgroundColor).toBe('#000000');
    expect(composition.layout.dimOutsideCanvas).toBe(true);
  });

  it('authors stroke colour statically and stroke width on the current frame', () => {
    useTimelineStore.getState().setAutoKeyframe(true);
    const layerId = useProjectStore.getState().addLayer('text');

    useProjectStore.getState().updateLayerTextStroke(layerId, 6, {
      strokeColor: '#101820',
      strokeWidth: 5,
    });

    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);
    const layer = composition.layers.find((candidate) => candidate.id === layerId)!;
    expect(layer.element).toMatchObject({
      type: 'text',
      strokeColor: '#101820',
      strokeWidth: 5,
    });
    expect(getLayerPropertyValueAtFrame(layer, 'strokeWidth', 6)).toBe(5);
    expect(layer.animationTracks.strokeWidth?.some((key) => key.frame === 6)).toBe(true);
  });

  it('applies style packs and adds portable broadcast recipes from the editor store', () => {
    const applied = useProjectStore.getState().applyStylePack('documentary');
    const ticker = useProjectStore.getState().addTicker();
    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);

    expect(applied.packId).toBe('documentary');
    expect(composition.designSystem.name).toBe('Documentary Brand Kit');
    expect(ticker.recipe).toBe('ticker');
    expect(
      composition.layers.find((layer) => layer.id === ticker.layers.crawl)?.loop,
    ).not.toBeNull();
  });
});
