import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addEffect,
  createAsset,
  createChartLayer,
  createDefaultGradient,
  createFieldDefinition,
  createImageLayer,
  createProject,
  createRectangleLayer,
  createLayerKeyframe,
  createDefaultTransform,
  getLayerTransformAtFrame,
  createShaderPaint,
  createTextLayer,
  effectParameterValue,
  effectProperty,
  getElementShaderPaint,
  type FieldDefinition,
  type Layer,
} from '@ograf-editor/scene-model';
import {
  resolveDesignerElement,
  resolveDesignerEffects,
  resolveDesignerTransform,
} from './dataBinding';
import { getActiveComposition, useProjectStore } from './projectStore';
import { resolvePreviewFieldValue } from './previewFieldValue';
import { useTestDataStore } from './testDataStore';
import { useTimelineStore } from './timelineStore';

function composition() {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
}

function seed(layers: Layer[], fields: FieldDefinition[]) {
  const project = createProject();
  project.compositions[0]!.layers = layers;
  project.compositions[0]!.dataFields = fields;
  useProjectStore.setState({ project, activeCompositionId: project.mainCompositionId });
}

function currentLayer(id: string) {
  return composition().layers.find((layer) => layer.id === id)!;
}

function currentField(id: string) {
  return composition().dataFields.find((field) => field.id === id)!;
}

function displayedElement(id: string) {
  return resolveDesignerElement(
    currentLayer(id),
    useTestDataStore.getState().values,
    composition().dataFields,
  );
}

describe('designer data-binding edits through projectStore', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useTestDataStore.getState().resetAll();
    useTimelineStore.getState().setAutoKeyframe(false);
  });

  it('commits a drag/property edit to bound geometry instead of invisible animation keys', () => {
    const layer = createRectangleLayer();
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ x: 10, y: 20 }))];
    const field = createFieldDefinition('object', {
      key: 'actor',
      properties: [
        createFieldDefinition('number', { key: 'x', defaultValue: 100 }),
        createFieldDefinition('number', { key: 'y', defaultValue: 200 }),
      ],
      defaultValue: { x: 100, y: 200 },
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'layer.x', sourcePath: ['x'] }];
    seed([layer], [field]);
    useTestDataStore.getState().setValue(field.id, { x: 150, y: 250 });
    const beforeKeys = structuredClone(currentLayer(layer.id).keyframes);
    useTimelineStore.getState().setAutoKeyframe(true);
    useProjectStore.getState().updateLayerTransform(layer.id, 5, { x: 180 });
    expect(currentLayer(layer.id).keyframes).toEqual(beforeKeys);
    expect(currentField(field.id).defaultValue).toEqual({ x: 180, y: 200 });
    const displayed = resolveDesignerTransform(
      currentLayer(layer.id),
      getLayerTransformAtFrame(currentLayer(layer.id), 5),
      useTestDataStore.getState().values,
      composition().dataFields,
    );
    expect(displayed.x).toBe(180);
    expect(
      resolvePreviewFieldValue(
        currentField(field.id),
        useTestDataStore.getState().values[field.id],
      ),
    ).toEqual({ x: 180, y: 250 });
  });

  it('keeps mixed-style controls editable while text content remains bound', () => {
    const layer = createTextLayer();
    const field = createFieldDefinition('text', { defaultValue: 'Styled headline' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    seed([layer], [field]);
    const runs = [
      { text: 'Styled ', color: '#ff0000' },
      { text: 'headline', fontWeight: 800 },
    ];
    useProjectStore.getState().updateLayerElement(layer.id, { content: 'Styled headline', runs });
    expect(displayedElement(layer.id)).toMatchObject({ content: 'Styled headline', runs });
    const revised = [{ ...runs[0]!, color: '#00ff00' }, runs[1]!];
    useProjectStore.getState().updateLayerElement(layer.id, { runs: revised });
    expect(displayedElement(layer.id)).toMatchObject({ runs: revised });
    expect(currentField(field.id).defaultValue).toBe('Styled headline');
    expect(currentLayer(layer.id).bindings).toHaveLength(1);

    useProjectStore.getState().updateLayerElement(layer.id, { content: 'Styled headline' });
    expect(displayedElement(layer.id)).toMatchObject({ runs: revised });
    useProjectStore.getState().updateLayerElement(layer.id, { content: 'New headline' });
    expect(currentLayer(layer.id).element).toMatchObject({ content: 'New headline', runs: [] });
    expect(currentField(field.id).defaultValue).toBe('New headline');
    expect(currentLayer(layer.id).bindings).toHaveLength(1);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('persists a bound text edit and updates every object sharing that field', () => {
    const first = createTextLayer();
    const second = createTextLayer();
    const field = createFieldDefinition('text', { defaultValue: 'Original' });
    const binding = { fieldId: field.id, targetProperty: 'content' };
    first.bindings = [binding];
    second.bindings = [{ ...binding }];
    seed([first, second], [field]);
    useTestDataStore.getState().setValue(field.id, 'Temporary preview');

    useProjectStore.getState().updateLayerElement(first.id, { content: 'Designer name', runs: [] });

    expect(currentLayer(first.id).element).toMatchObject({ content: 'Designer name', runs: [] });
    expect(currentField(field.id).defaultValue).toBe('Designer name');
    expect(currentLayer(first.id).bindings).toEqual([binding]);
    expect(displayedElement(second.id)).toMatchObject({ content: 'Designer name' });
    expect(Object.hasOwn(useTestDataStore.getState().values, field.id)).toBe(false);
  });

  it('commits an explicitly entered value even when the authored value already matches', () => {
    const layer = createTextLayer();
    if (layer.element.type !== 'text') throw new Error('Expected text.');
    layer.element.content = 'Keep this';
    const field = createFieldDefinition('text', { defaultValue: 'Different bound default' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
    seed([layer], [field]);

    useProjectStore.getState().updateLayerElement(layer.id, { content: 'Keep this' });

    expect(currentField(field.id).defaultValue).toBe('Keep this');
    expect(displayedElement(layer.id)).toMatchObject({ content: 'Keep this' });
  });

  it('preserves nested preview siblings and restores the authored leaf when undo restores a snapshot', () => {
    const layer = createTextLayer();
    const field = createFieldDefinition('object', {
      properties: [
        createFieldDefinition('text', { key: 'name' }),
        createFieldDefinition('integer', { key: 'score' }),
      ],
      defaultValue: { name: 'Original default', score: 1 },
    });
    const unrelated = createFieldDefinition('text', { defaultValue: 'Other default' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    seed([layer], [field, unrelated]);
    useTestDataStore.getState().setValues({
      [field.id]: { name: 'Preview name', score: 99 },
      [unrelated.id]: 'Other preview',
    });
    const before = structuredClone(useProjectStore.getState().project);

    useProjectStore.getState().updateLayerElement(layer.id, { content: 'Authored name', runs: [] });

    expect(currentField(field.id).defaultValue).toEqual({ name: 'Authored name', score: 1 });
    expect(useTestDataStore.getState().values[field.id]).toEqual({ score: 99 });
    expect(useTestDataStore.getState().values[unrelated.id]).toBe('Other preview');
    expect(displayedElement(layer.id)).toMatchObject({ content: 'Authored name' });
    useProjectStore.setState({ project: before });
    expect(displayedElement(layer.id)).toMatchObject({ content: 'Original default' });
    expect(
      resolvePreviewFieldValue(
        currentField(field.id),
        useTestDataStore.getState().values[field.id],
      ),
    ).toEqual({ name: 'Original default', score: 99 });
  });

  it('releases only the first collection item leaf while keeping later preview items', () => {
    const layer = createTextLayer();
    const field = createFieldDefinition('array', {
      items: createFieldDefinition('object', {
        key: 'item',
        properties: [
          createFieldDefinition('text', { key: 'name' }),
          createFieldDefinition('integer', { key: 'score' }),
        ],
      }),
      defaultValue: [
        { name: 'First default', score: 1 },
        { name: 'Second default', score: 2 },
      ],
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    seed([layer], [field]);
    useTestDataStore.getState().setValue(field.id, [
      { name: 'First preview', score: 11 },
      { name: 'Second preview', score: 22 },
    ]);

    useProjectStore.getState().updateLayerElement(layer.id, { content: 'Designer first' });

    expect(currentField(field.id).defaultValue).toEqual([
      { name: 'Designer first', score: 1 },
      { name: 'Second default', score: 2 },
    ]);
    expect(
      resolvePreviewFieldValue(
        currentField(field.id),
        useTestDataStore.getState().values[field.id],
      ),
    ).toEqual([
      { name: 'Designer first', score: 11 },
      { name: 'Second preview', score: 22 },
    ]);
  });

  it('edits the active select mapping without replacing its selected preview key', () => {
    const layer = createRectangleLayer();
    const field = createFieldDefinition('select', {
      defaultValue: 'home',
      options: [
        { value: 'home', label: 'Home' },
        { value: 'away', label: 'Away' },
      ],
    });
    layer.bindings = [
      {
        fieldId: field.id,
        targetProperty: 'fill',
        valueMap: { home: '#00ff00', away: '#0000ff' },
      },
    ];
    seed([layer], [field]);
    useTestDataStore.getState().setValue(field.id, 'away');

    useProjectStore.getState().updateLayerPaint(layer.id, 0, '#ff0000');

    expect(currentLayer(layer.id).bindings[0]!.valueMap).toEqual({
      home: '#00ff00',
      away: '#ff0000',
    });
    expect(currentField(field.id).defaultValue).toBe('home');
    expect(useTestDataStore.getState().values[field.id]).toBe('away');
    expect(displayedElement(layer.id)).toMatchObject({ fill: '#ff0000' });
  });

  it('persists chart table edits as exposed JSON and releases the old JSON preview', () => {
    const layer = createChartLayer();
    if (layer.element.type !== 'chart') throw new Error('Expected chart.');
    const field = createFieldDefinition('textarea', {
      defaultValue: JSON.stringify(layer.element.data),
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'data' }];
    seed([layer], [field]);
    const preview = structuredClone(layer.element.data);
    preview.datasets[0]!.data[0] = 3;
    useTestDataStore.getState().setValue(field.id, JSON.stringify(preview));
    const data = structuredClone(preview);
    data.datasets[0]!.data[0] = 99;

    useProjectStore.getState().updateLayerElement(layer.id, { data });

    expect(JSON.parse(String(currentField(field.id).defaultValue))).toEqual(data);
    expect(displayedElement(layer.id)).toMatchObject({ data });
    expect(Object.hasOwn(useTestDataStore.getState().values, field.id)).toBe(false);
  });

  it('updates bound gradient stop colors without clearing another stop preview', () => {
    const layer = createRectangleLayer();
    const gradient = createDefaultGradient();
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    layer.element.fill = gradient;
    const first = createFieldDefinition('color', { defaultValue: gradient.stops[0]!.color });
    const second = createFieldDefinition('color', { defaultValue: gradient.stops[1]!.color });
    layer.bindings = [
      { fieldId: first.id, targetProperty: 'fill.stops[0].color' },
      { fieldId: second.id, targetProperty: 'fill.stops[1].color' },
    ];
    seed([layer], [first, second]);
    useTestDataStore.getState().setValues({ [first.id]: '#ff00ff', [second.id]: '#ffff00' });
    const edited = structuredClone(gradient);
    edited.stops[0]!.color = '#ff0000';
    edited.stops[1]!.color = '#ffff00';

    useProjectStore.getState().updateLayerPaint(layer.id, 0, edited);

    expect(currentField(first.id).defaultValue).toBe('#ff0000');
    expect(currentField(second.id).defaultValue).toBe(second.defaultValue);
    expect(Object.hasOwn(useTestDataStore.getState().values, first.id)).toBe(false);
    expect(useTestDataStore.getState().values[second.id]).toBe('#ffff00');
    expect(displayedElement(layer.id)).toMatchObject({
      fill: { stops: [{ color: '#ff0000' }, { color: '#ffff00' }] },
    });
  });

  it('replaces a bound solid fill default and immediately reveals it on the canvas', () => {
    const layer = createRectangleLayer();
    const field = createFieldDefinition('color', { defaultValue: '#ff0000' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'fill' }];
    seed([layer], [field]);
    useTestDataStore.getState().setValue(field.id, '#0000ff');

    useProjectStore.getState().updateLayerPaint(layer.id, 0, '#00ff00');

    expect(currentField(field.id).defaultValue).toBe('#00ff00');
    expect(displayedElement(layer.id)).toMatchObject({ fill: '#00ff00' });
    expect(Object.hasOwn(useTestDataStore.getState().values, field.id)).toBe(false);
  });

  it('synchronizes a complete bound gradient after editing its type, angle and stops', () => {
    const layer = createRectangleLayer();
    const field = createFieldDefinition('gradient', { defaultValue: createDefaultGradient() });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'fill' }];
    seed([layer], [field]);
    useTestDataStore.getState().setValue(field.id, createDefaultGradient('radial'));
    const gradient = createDefaultGradient();
    gradient.angle = 45;
    gradient.stops[0]!.color = '#ff0000';

    useProjectStore.getState().updateLayerPaint(layer.id, 0, gradient);

    expect(currentField(field.id).defaultValue).toEqual(gradient);
    expect(displayedElement(layer.id)).toMatchObject({ fill: gradient });
    expect(Object.hasOwn(useTestDataStore.getState().values, field.id)).toBe(false);
  });

  it('updates bound stack effect and shadow controls and releases their masking previews', () => {
    const layer = createRectangleLayer();
    const glow = addEffect(layer, 'glow');
    const target = effectProperty(glow, 'radius');
    const radius = createFieldDefinition('number', { defaultValue: 5 });
    const shadow = createFieldDefinition('color', { defaultValue: '#000000' });
    layer.bindings = [
      { fieldId: radius.id, targetProperty: target },
      { fieldId: shadow.id, targetProperty: 'dropShadowColor' },
    ];
    seed([layer], [radius, shadow]);
    useTestDataStore.getState().setValues({ [radius.id]: 15, [shadow.id]: '#00ff00' });

    useProjectStore.getState().updateLayerEffect(layer.id, glow.id, { params: { radius: 20 } }, 0);
    useProjectStore.getState().updateLayerEffects(layer.id, 0, { dropShadowColor: '#ff00ff' });

    expect(currentField(radius.id).defaultValue).toBe(20);
    expect(currentField(shadow.id).defaultValue).toBe('#ff00ff');
    expect(useTestDataStore.getState().values).toEqual({});
    const resolved = resolveDesignerEffects(
      currentLayer(layer.id),
      currentLayer(layer.id).effects,
      {},
      composition().dataFields,
    );
    expect(effectParameterValue(resolved, target)).toBe(20);
    expect(resolved.dropShadowColor).toBe('#ff00ff');
  });

  it('allows exposed shader controls to replace an active parameter test value', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().updateLayerPaint(
      id,
      0,
      createShaderPaint({
        fragmentSource: `#pragma ograf strength slider min(0) max(100) step(1)
const float strength = 10.0;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(vec3(strength / 100.0), 1.0); }`,
      }),
    );
    const field = composition().dataFields.find(
      (entry) => entry.generatedShaderParameter?.name === 'strength',
    )!;
    useTestDataStore.getState().setValue(field.id, 80);

    useProjectStore.getState().updateLayerShaderParameter(id, 0, 'fill', 'strength', 30);

    expect(currentField(field.id).defaultValue).toBe(30);
    expect(getElementShaderPaint(displayedElement(id))!.parameters.strength).toBe(30);
    expect(Object.hasOwn(useTestDataStore.getState().values, field.id)).toBe(false);
  });

  it('edits and clears a bound image source without disconnecting its playout field', () => {
    const layer = createImageLayer();
    const field = createFieldDefinition('image-url', {
      defaultValue: 'https://example.test/original.png',
    });
    const binding = { fieldId: field.id, targetProperty: 'src' };
    layer.bindings = [binding];
    seed([layer], [field]);
    useTestDataStore.getState().setValue(field.id, 'https://example.test/preview.png');

    useProjectStore.getState().updateLayerElement(layer.id, {
      src: 'https://example.test/designer.png',
    });
    expect(currentField(field.id).defaultValue).toBe('https://example.test/designer.png');
    expect(displayedElement(layer.id)).toMatchObject({ src: 'https://example.test/designer.png' });
    useTestDataStore.getState().setValue(field.id, 'https://example.test/preview-again.png');

    useProjectStore.getState().updateLayerElement(layer.id, { src: null });

    expect(currentField(field.id).defaultValue).toBe('');
    expect(currentLayer(layer.id).element).toMatchObject({ src: null });
    expect(displayedElement(layer.id)).toMatchObject({ src: '' });
    expect(currentLayer(layer.id).bindings).toEqual([binding]);
    expect(Object.hasOwn(useTestDataStore.getState().values, field.id)).toBe(false);
  });

  it('replaces a bound image from Resources while preserving its field and removing the old preview', async () => {
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 320;
        naturalHeight = 180;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_source: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const layer = createImageLayer();
    const field = createFieldDefinition('image-url', {
      defaultValue: 'https://example.test/original.png',
    });
    const binding = { fieldId: field.id, targetProperty: 'src' };
    layer.bindings = [binding];
    seed([layer], [field]);
    const asset = createAsset({
      name: 'Replacement.png',
      kind: 'image',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,YQ==',
    });
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        compositions: state.project.compositions.map((entry) => ({
          ...entry,
          assets: [...entry.assets, asset],
        })),
      },
    }));
    useTestDataStore.getState().setValue(field.id, 'https://example.test/preview.png');

    const ids = await useProjectStore
      .getState()
      .placeImageSource({ assetId: asset.id }, { replaceLayerId: layer.id });

    expect(ids).toEqual([layer.id]);
    expect(currentField(field.id).defaultValue).toBe(`asset:${asset.id}`);
    expect(displayedElement(layer.id)).toMatchObject({ src: `asset:${asset.id}` });
    expect(currentLayer(layer.id).bindings).toEqual([binding]);
    expect(composition().assets).toHaveLength(1);
    expect(Object.hasOwn(useTestDataStore.getState().values, field.id)).toBe(false);
  });

  it('unmasks a generated shader field after editing its parameter in Edit Shader', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().updateLayerPaint(
      id,
      0,
      createShaderPaint({
        fragmentSource: `#pragma ograf gain slider min(0) max(1) step(0.1)
const float gain = 0.2;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(vec3(gain), 1.0); }`,
      }),
    );
    const field = composition().dataFields.find(
      (entry) => entry.generatedShaderParameter?.name === 'gain',
    )!;
    useTestDataStore.getState().setValue(field.id, 0.9);

    useProjectStore
      .getState()
      .updateShaderResource(
        { compositionId: composition().id, layerId: id, slot: 'fill' },
        { parameters: { gain: 0.4 } },
      );

    expect(currentField(field.id).defaultValue).toBe(0.4);
    expect(getElementShaderPaint(displayedElement(id))!.parameters.gain).toBe(0.4);
    expect(Object.hasOwn(useTestDataStore.getState().values, field.id)).toBe(false);
  });
});
