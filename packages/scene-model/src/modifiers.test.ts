import { describe, expect, it } from 'vitest';
import {
  addLayerModifier,
  createLayerModifier,
  duplicateLayerModifier,
  evaluateLayerModifiers,
  evaluateModifierVisibility,
  layerModifiersErrors,
  modifierParameterValue,
  modifierProperty,
  modifierStackErrors,
  modifierTransformBounds,
  modifierValueIsEmpty,
  numericModifierProperties,
  remapLayerModifierReferences,
  removeLayerModifier,
  reorderLayerModifiers,
  sampleLayerModifiers,
  updateLayerModifier,
  withModifierParameter,
  type ModifierVisualState,
} from './modifiers';
import { buildComponentDefinition, instantiateComponentDefinition } from './components';
import { reconcileComponentInstances } from './componentInheritance';
import {
  createDefaultTransform,
  createFieldDefinition,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createProject,
} from './factory';
import {
  getLayerAnimatableProperties,
  getLayerPropertyValueAtFrame,
  getResolvedLayerAnimationTracks,
  isAnimatableLayerPropertyApplicable,
} from './layerAnimation';
import type { Layer } from './types';

const reference = (layer: Layer) => ({ kind: 'layer' as const, layerId: layer.id });
function fixture() {
  const text = createLayerOfKind('text'),
    panel = createLayerOfKind('rectangle'),
    logo = createLayerOfKind('rectangle');
  text.id = 'text';
  panel.id = 'panel';
  logo.id = 'logo';
  if (text.element.type !== 'text') throw new Error('Expected text.');
  text.element.content = 'Headline';
  text.element.fontSize = 40;
  const layers = [logo, panel, text];
  const states = new Map<string, ModifierVisualState>([
    [
      text.id,
      {
        transform: createDefaultTransform({ x: 100, y: 200, width: 80, height: 40 }),
        element: text.element,
        isVisible: true,
      },
    ],
    [
      panel.id,
      {
        transform: createDefaultTransform({ x: 90, y: 190, width: 500, height: 60 }),
        element: panel.element,
        isVisible: true,
      },
    ],
    [
      logo.id,
      {
        transform: createDefaultTransform({ x: 0, y: 0, width: 30, height: 30 }),
        element: logo.element,
        isVisible: true,
      },
    ],
  ]);
  const measureText = () => ({ width: 320, height: 40 });
  return { text, panel, logo, layers, states, measureText };
}

describe('modifier contracts and authoring', () => {
  it('requires complete safe references and rejects malformed params without throwing validation', () => {
    expect(modifierStackErrors(null)).toEqual(['Modifiers must be an array.']);
    expect(
      modifierStackErrors([null, { id: 'bad', type: 'script', params: {} }]).length,
    ).toBeGreaterThan(0);
    expect(() => createLayerModifier('auto-follow')).toThrow(/reference/);
    expect(() =>
      createLayerModifier('hide-empty', {
        source: { kind: 'field', fieldId: 'f', sourcePath: ['__proto__'] },
      }),
    ).toThrow(/sourcePath/);
    const entry = createLayerModifier('max-text-width');
    expect(
      modifierStackErrors([{ ...entry, params: { ...entry.params, injected: 'code' } }]),
    ).toContain('Unknown max-text-width parameter.');
    expect(
      modifierStackErrors([{ ...entry, params: { ...entry.params, maxWidth: Infinity } }]).join(
        ' ',
      ),
    ).toContain('maxWidth');
    expect(modifierStackErrors([entry, entry]).join(' ')).toContain('unique');
  });
  it('adds, updates and reorders stable entries atomically', () => {
    const { text } = fixture();
    const max = addLayerModifier(text, 'max-text-width', { maxWidth: 200 }, undefined, 'cap');
    const hide = addLayerModifier(
      text,
      'hide-empty',
      { source: { kind: 'layer', layerId: text.id, property: 'content' } },
      undefined,
      'hide',
    );
    const before = structuredClone(text);
    expect(() => updateLayerModifier(text, max.id, { params: { maxWidth: -2 } })).toThrow();
    expect(text).toEqual(before);
    updateLayerModifier(text, max.id, { name: 'Caption cap', params: { maxWidth: 240 } });
    reorderLayerModifiers(text, [hide.id, max.id]);
    expect(text.modifiers?.map((entry) => entry.id)).toEqual(['hide', 'cap']);
    expect(() => reorderLayerModifiers(text, ['cap', 'cap'])).toThrow(/every modifier/);
  });
  it('duplicates disabled entries with independent own tracks and bindings and removes only owned paths', () => {
    const { text } = fixture();
    const entry = addLayerModifier(text, 'max-text-width', {}, undefined, 'cap');
    const path = modifierProperty(entry, 'maxWidth');
    text.animationTracks[path] = [
      createLayerPropertyKeyframe(0, 100),
      createLayerPropertyKeyframe(20, 300),
    ];
    text.bindings = [
      { fieldId: 'width', targetProperty: path },
      { fieldId: 'title', targetProperty: 'content' },
    ];
    const copy = duplicateLayerModifier(text, entry.id, 'cap-copy');
    expect(copy.enabled).toBe(false);
    const copiedPath = modifierProperty(copy, 'maxWidth');
    expect(text.animationTracks[copiedPath]?.map((key) => key.value)).toEqual([100, 300]);
    expect(text.animationTracks[copiedPath]?.[0]?.id).not.toBe(text.animationTracks[path]?.[0]?.id);
    expect(text.bindings).toContainEqual({ fieldId: 'width', targetProperty: copiedPath });
    removeLayerModifier(text, entry.id);
    expect(text.animationTracks[path]).toBeUndefined();
    expect(text.animationTracks[copiedPath]).toHaveLength(2);
    expect(text.bindings).toContainEqual({ fieldId: 'title', targetProperty: 'content' });
  });
  it('exposes only applicable numeric modifier paths and samples composition and local tracks without mutation', () => {
    const { text } = fixture();
    const entry = addLayerModifier(text, 'max-text-width', { maxWidth: 200 }, undefined, 'cap');
    const path = modifierProperty(entry, 'maxWidth');
    expect(numericModifierProperties(text)).toContain(path);
    expect(getLayerAnimatableProperties(text)).toContain(path);
    expect(isAnimatableLayerPropertyApplicable(text, 'modifiers.missing.maxWidth')).toBe(false);
    expect(getResolvedLayerAnimationTracks(text)[path]?.[0]?.value).toBe(200);
    text.animationTracks[path] = [
      createLayerPropertyKeyframe(0, 100),
      createLayerPropertyKeyframe(20, 300),
    ];
    expect(getLayerPropertyValueAtFrame(text, path, 10)).toBe(200);
    expect(
      modifierParameterValue(
        sampleLayerModifiers(text, (_property, fallback) => fallback * 2),
        path,
      ),
    ).toBe(400);
    expect(modifierParameterValue(text, path)).toBe(200);
    expect(modifierParameterValue(withModifierParameter(text, path, -100), path)).toBe(1);
    expect(withModifierParameter(text, path, NaN)).toBe(text);
  });
  it('validates field paths and leaves values 0 and false meaningful', () => {
    const { text, layers } = fixture();
    const root = createFieldDefinition('object', { id: 'record', key: 'record' });
    root.properties = [createFieldDefinition('text', { key: 'name' })];
    addLayerModifier(text, 'hide-empty', {
      source: { kind: 'field', fieldId: root.id, sourcePath: ['name'] },
    });
    expect(layerModifiersErrors(layers, [root])).toEqual([]);
    updateLayerModifier(text, text.modifiers![0]!.id, {
      params: { source: { kind: 'field', fieldId: root.id, sourcePath: ['missing'] } },
    });
    expect(layerModifiersErrors(layers, [root]).join(' ')).toContain('sourcePath');
    for (const value of [false, 0, '0', {}]) expect(modifierValueIsEmpty(value)).toBe(false);
    for (const value of [null, undefined, '', [], ' \t '])
      expect(modifierValueIsEmpty(value)).toBe(true);
    expect(modifierValueIsEmpty(' ', false)).toBe(false);
  });
  it('samples related size limits together and ignores invalid external minimum values safely', () => {
    const { panel, text } = fixture();
    const modifier = addLayerModifier(panel, 'auto-size', {
      source: reference(text),
      minWidth: 100,
      maxWidth: 200,
    });
    const min = modifierProperty(modifier, 'minWidth'),
      max = modifierProperty(modifier, 'maxWidth');
    expect(withModifierParameter(panel, min, 300)).toBe(panel);
    const sampled = sampleLayerModifiers(panel, (property, fallback) =>
      property === min ? 300 : property === max ? 400 : fallback,
    );
    expect(modifierParameterValue(sampled, min)).toBe(300);
    expect(modifierParameterValue(sampled, max)).toBe(400);
    expect(
      modifierStackErrors(
        sampleLayerModifiers(panel, (property, fallback) => (property === min ? 500 : fallback)),
      ),
    ).toEqual([]);
  });
});

describe('deterministic modifier evaluation', () => {
  it('follows the sampled scaled source edge instead of its unscaled authored edge', () => {
    const input = fixture();
    input.states.get('logo')!.transform = createDefaultTransform({
      x: 100,
      y: 200,
      width: 100,
      height: 50,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    input.states.get('logo')!.scale = 2;
    addLayerModifier(input.panel, 'auto-follow', {
      source: reference(input.logo),
      sourceAnchorX: 1,
      axisY: false,
    });
    const result = evaluateLayerModifiers(input);
    expect(result.states.get('panel')!.transform.x).toBe(300);
    expect(result.states.get('logo')!.scale).toBe(2);
    expect(input.states.get('panel')!.transform.x).toBe(90);
  });
  it('uses uniform scale around the unscaled pivot when measuring rotated source bounds', () => {
    const transform = createDefaultTransform({
      x: 100,
      y: 200,
      width: 100,
      height: 50,
      rotation: 90,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    });
    const bounds = modifierTransformBounds(transform, 2);
    expect(bounds.x).toBeCloseTo(100);
    expect(bounds.y).toBeCloseTo(125);
    expect(bounds.width).toBeCloseTo(100);
    expect(bounds.height).toBeCloseTo(200);
    const input = fixture();
    input.states.get('logo')!.transform = transform;
    input.states.get('logo')!.scale = 2;
    addLayerModifier(input.panel, 'auto-follow', {
      source: reference(input.logo),
      sourceAnchorX: 1,
      sourceAnchorY: 1,
    });
    const followed = evaluateLayerModifiers(input).states.get('panel')!.transform;
    expect(followed.x).toBeCloseTo(200);
    expect(followed.y).toBeCloseTo(325);
  });
  it('compensates the scaled rotated follower anchor while leaving offsets in composition pixels', () => {
    const input = fixture();
    input.states.get('logo')!.transform = createDefaultTransform({
      x: 100,
      y: 200,
      width: 100,
      height: 50,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    input.states.get('logo')!.scale = 2;
    input.states.get('panel')!.transform = createDefaultTransform({
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      rotation: 90,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    });
    input.states.get('panel')!.scale = 3;
    addLayerModifier(input.panel, 'auto-follow', {
      source: reference(input.logo),
      sourceAnchorX: 1,
      sourceAnchorY: 1,
      targetAnchorX: 1,
      targetAnchorY: 1,
      offsetX: 7,
      offsetY: -9,
    });
    const followed = evaluateLayerModifiers(input).states.get('panel')!;
    expect(followed.transform.x).toBeCloseTo(257);
    expect(followed.transform.y).toBeCloseTo(221);
    const bounds = modifierTransformBounds(followed.transform, followed.scale);
    expect(bounds.x + bounds.width).toBeCloseTo(307);
    expect(bounds.y + bounds.height).toBeCloseTo(291);
  });
  it('converts source world bounds to owner local dimensions before applying local padding and clamps', () => {
    const input = fixture();
    input.states.get('logo')!.transform = createDefaultTransform({
      width: 100,
      height: 50,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    input.states.get('logo')!.scale = 3;
    input.states.get('panel')!.scale = 2;
    addLayerModifier(input.panel, 'auto-size', {
      source: reference(input.logo),
      paddingLeft: 10,
      paddingRight: 20,
      paddingTop: 5,
      paddingBottom: 15,
      minWidth: 170,
      maxWidth: 175,
      minHeight: 100,
      maxHeight: 110,
    });
    const result = evaluateLayerModifiers(input).states.get('panel')!;
    expect(result.transform).toMatchObject({ width: 175, height: 100 });
    expect(modifierTransformBounds(result.transform, result.scale)).toMatchObject({
      width: 350,
      height: 200,
    });
    expect(input.states.get('panel')!.transform).toMatchObject({ width: 500, height: 60 });
  });
  it('preserves the selected scaled rotated anchor while changing Auto Size dimensions', () => {
    const input = fixture();
    input.states.get('logo')!.transform = createDefaultTransform({ width: 400, height: 40 });
    input.states.get('panel')!.transform = createDefaultTransform({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 90,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    input.states.get('panel')!.scale = 2;
    addLayerModifier(input.panel, 'auto-size', {
      source: reference(input.logo),
      minHeight: 60,
      anchorX: 1,
      anchorY: 1,
    });
    const result = evaluateLayerModifiers(input).states.get('panel')!.transform;
    expect(result).toMatchObject({ width: 200, height: 60 });
    expect(result.x).toBeCloseTo(20);
    expect(result.y).toBeCloseTo(-100);
    // Local bottom-right after rotate(90) scale(2) still maps to the original world (-100,300).
    expect(result.x - result.height * 2).toBeCloseTo(-100);
    expect(result.y + result.width * 2).toBeCloseTo(300);
  });
  it('handles collapsed source and owner scales without division by zero or alpha-based visibility changes', () => {
    const input = fixture();
    input.states.get('logo')!.transform = createDefaultTransform({
      x: 100,
      y: 200,
      width: 100,
      height: 50,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    input.states.get('logo')!.scale = 0;
    input.states.get('panel')!.scale = 0;
    const before = structuredClone(input.states.get('panel')!.transform);
    addLayerModifier(input.panel, 'auto-size', {
      source: reference(input.logo),
      paddingLeft: 10,
      minWidth: 800,
    });
    let result = evaluateLayerModifiers(input).states.get('panel')!;
    expect(result.transform).toEqual(before);
    expect(result.isVisible).toBe(true);
    addLayerModifier(input.panel, 'auto-follow', {
      source: reference(input.logo),
      sourceAnchorX: 1,
      sourceAnchorY: 1,
      targetAnchorX: 1,
      targetAnchorY: 1,
    });
    result = evaluateLayerModifiers(input).states.get('panel')!;
    const bounds = modifierTransformBounds(result.transform, result.scale);
    expect(bounds).toMatchObject({ x: 100, y: 200, width: 0, height: 0 });
    expect(Object.values(result.transform).every(Number.isFinite)).toBe(true);
    input.states.get('panel')!.scale = Number.MIN_VALUE;
    input.states.get('logo')!.scale = 1;
    expect(
      Object.values(evaluateLayerModifiers(input).states.get('panel')!.transform).every(
        Number.isFinite,
      ),
    ).toBe(true);
  });
  it('unions sampled scaled group member bounds rather than unscaled dimensions', () => {
    const input = fixture();
    input.logo.groupId = 'scaled-sources';
    input.text.groupId = 'scaled-sources';
    input.states.get('logo')!.transform = createDefaultTransform({
      x: 100,
      y: 100,
      width: 100,
      height: 40,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    input.states.get('logo')!.scale = 2;
    input.states.get('text')!.isVisible = false;
    addLayerModifier(input.panel, 'auto-size', {
      source: { kind: 'group', groupId: 'scaled-sources' },
    });
    expect(evaluateLayerModifiers(input).states.get('panel')!.transform).toMatchObject({
      width: 200,
      height: 80,
    });
  });
  it('measures text, caps width, sizes a background and follows its final right edge independent of paint order', () => {
    const input = fixture();
    addLayerModifier(input.text, 'max-text-width', { maxWidth: 200 });
    addLayerModifier(input.panel, 'auto-size', {
      source: reference(input.text),
      paddingLeft: 10,
      paddingRight: 20,
      paddingTop: 5,
      paddingBottom: 5,
    });
    addLayerModifier(input.logo, 'auto-follow', {
      source: reference(input.panel),
      sourceAnchorX: 1,
      offsetX: 12,
      axisY: false,
    });
    const before = structuredClone(input.states),
      authored = structuredClone(input.layers);
    const result = evaluateLayerModifiers(input);
    expect(result.states.get('text')?.transform).toMatchObject({ width: 200, height: 40 });
    expect(result.states.get('panel')?.transform).toMatchObject({
      x: 90,
      y: 190,
      width: 230,
      height: 50,
    });
    expect(result.states.get('logo')?.transform.x).toBe(332);
    expect(result.textFits.get('text')).toEqual({ scaleX: 0.625, scaleY: 1, fontSize: 40 });
    expect(input.states).toEqual(before);
    expect(input.layers).toEqual(authored);
    expect(evaluateLayerModifiers(input)).toEqual(result);
    expect(evaluateLayerModifiers({ ...input, layers: [...input.layers].reverse() })).toEqual(
      result,
    );
  });
  it('Auto Size uses data-resolved natural text even without a Max Text Width modifier', () => {
    const input = fixture();
    addLayerModifier(input.panel, 'auto-size', {
      source: reference(input.text),
      width: true,
      height: false,
      paddingLeft: 8,
      paddingRight: 8,
    });
    expect(evaluateLayerModifiers(input).states.get('panel')?.transform.width).toBe(336);
    expect(
      evaluateLayerModifiers({
        ...input,
        measureText: () => ({ width: 48, height: 40 }),
      }).states.get('panel')?.transform.width,
    ).toBe(64);
    expect(evaluateLayerModifiers(input).states.get('panel')?.transform.width).toBe(336);
  });
  it('supports proportional shrink and honors the minimum size floor without scaling the authored transform', () => {
    const input = fixture();
    addLayerModifier(input.text, 'max-text-width', {
      maxWidth: 80,
      mode: 'shrink',
      minFontSize: 20,
    });
    const result = evaluateLayerModifiers(input);
    expect(result.states.get('text')?.transform).toMatchObject({
      width: 160,
      height: 20,
      opacity: 1,
    });
    expect(result.textFits.get('text')).toEqual({ scaleX: 0.5, scaleY: 0.5, fontSize: 20 });
    expect(input.text.element).toMatchObject({ fontSize: 40 });
  });
  it('never enlarges short text to fill the maximum width', () => {
    const input = fixture();
    addLayerModifier(input.text, 'max-text-width', { maxWidth: 1000 });
    const result = evaluateLayerModifiers(input);
    expect(result.textFits.get('text')?.scaleX).toBe(1);
    expect(result.states.get('text')?.transform.width).toBe(320);
  });
  it('keeps a chosen rotated anchor fixed while resizing dimensions and honors both size clamps', () => {
    const input = fixture();
    input.states.get('panel')!.transform = createDefaultTransform({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      rotation: 90,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    addLayerModifier(input.panel, 'auto-size', {
      source: reference(input.text),
      minWidth: 80,
      maxWidth: 200,
      minHeight: 60,
      maxHeight: 70,
      anchorX: 1,
      anchorY: 1,
    });
    const result = evaluateLayerModifiers(input).states.get('panel')!.transform;
    expect(result.width).toBe(200);
    expect(result.height).toBe(60);
    expect(result.x).toBeCloseTo(60);
    expect(result.y).toBeCloseTo(0);
  });
  it('reads rotated final group union bounds, excluding hidden members but not zero-alpha members', () => {
    const input = fixture();
    input.text.groupId = 'sources';
    input.logo.groupId = 'sources';
    input.states.get('text')!.transform = createDefaultTransform({
      x: 100,
      y: 100,
      width: 100,
      height: 40,
      rotation: 90,
      transformOriginX: 0,
      transformOriginY: 0,
      opacity: 0,
    });
    input.states.get('logo')!.isVisible = false;
    if (input.text.element.type === 'text') input.text.element.autoFit = 'fixed';
    addLayerModifier(input.panel, 'auto-size', { source: { kind: 'group', groupId: 'sources' } });
    const result = evaluateLayerModifiers(input).states.get('panel')!.transform;
    expect(result.width).toBeCloseTo(40);
    expect(result.height).toBeCloseTo(100);
    expect(modifierTransformBounds(input.states.get('text')!.transform)).toMatchObject({
      x: 60,
      y: 100,
    });
  });
  it('preserves valid property-level size/follow chains, while rejecting actual cycles and duplicate writers', () => {
    const input = fixture();
    addLayerModifier(input.panel, 'auto-size', { source: reference(input.text), height: false });
    addLayerModifier(input.text, 'auto-follow', { source: reference(input.panel), axisY: false });
    expect(layerModifiersErrors(input.layers)).toEqual([]);
    expect(() => evaluateLayerModifiers(input)).not.toThrow();
    addLayerModifier(input.panel, 'auto-follow', { source: reference(input.text), axisY: false });
    expect(layerModifiersErrors(input.layers).join(' ')).toContain('cycle');
    expect(() => evaluateLayerModifiers(input)).toThrow(/cycle/);
    const second = fixture();
    addLayerModifier(second.text, 'max-text-width');
    addLayerModifier(second.text, 'auto-size', { source: reference(second.panel) });
    expect(layerModifiersErrors(second.layers).join(' ')).toContain('conflicting');
  });
  it('does not invent a cycle when opposite layers follow independent X and Y axes', () => {
    const input = fixture();
    addLayerModifier(input.panel, 'auto-follow', {
      source: reference(input.logo),
      axisY: false,
      offsetX: 20,
    });
    addLayerModifier(input.logo, 'auto-follow', {
      source: reference(input.panel),
      axisX: false,
      offsetY: 30,
    });
    expect(layerModifiersErrors(input.layers)).toEqual([]);
    const result = evaluateLayerModifiers(input);
    expect(result.states.get('panel')!.transform.x).toBe(20);
    expect(result.states.get('logo')!.transform.y).toBe(220);
  });
  it('rejects owner-containing group dependencies and missing references without depending on visibility', () => {
    const input = fixture();
    input.panel.groupId = 'all';
    input.text.groupId = 'all';
    addLayerModifier(input.panel, 'auto-size', { source: { kind: 'group', groupId: 'all' } });
    expect(layerModifiersErrors(input.layers).join(' ')).toContain('cycle');
    updateLayerModifier(input.panel, input.panel.modifiers![0]!.id, {
      enabled: false,
      params: { source: { kind: 'layer', layerId: 'missing' } },
    });
    expect(layerModifiersErrors(input.layers).join(' ')).toContain('missing');
  });
  it('hides layer/group targets from resolved text, nested data, trim and invert without overwriting alpha or manual visibility', () => {
    const input = fixture();
    input.panel.groupId = 'lower-third';
    input.logo.groupId = 'lower-third';
    addLayerModifier(input.text, 'hide-empty', {
      source: { kind: 'layer', layerId: input.text.id, property: 'content' },
      target: { kind: 'group', groupId: 'lower-third' },
    });
    if (input.text.element.type === 'text') input.text.element.content = '  ';
    expect(evaluateModifierVisibility(input).get('panel')).toBe(false);
    expect(evaluateLayerModifiers(input).states.get('panel')?.transform.opacity).toBe(1);
    updateLayerModifier(input.text, input.text.modifiers![0]!.id, {
      params: { trimWhitespace: false, invert: true },
    });
    expect(evaluateModifierVisibility(input).get('panel')).toBe(false);
    updateLayerModifier(input.text, input.text.modifiers![0]!.id, {
      params: { source: { kind: 'field', fieldId: 'row', sourcePath: ['score'] }, invert: false },
    });
    expect(
      evaluateModifierVisibility({ ...input, dataByFieldId: { row: { score: 0 } } }).get('panel'),
    ).toBe(true);
    expect(
      evaluateModifierVisibility({ ...input, dataByFieldId: { row: { score: null } } }).get(
        'panel',
      ),
    ).toBe(false);
    input.states.get('panel')!.isVisible = false;
    expect(
      evaluateModifierVisibility({ ...input, dataByFieldId: { row: { score: 12 } } }).get('panel'),
    ).toBe(false);
  });
});

describe('portable modifier references in components', () => {
  it('preserves local parameter overrides by stable modifier ID through master edits and reorder', () => {
    const composition = createProject().compositions[0]!,
      text = createLayerOfKind('text');
    addLayerModifier(text, 'max-text-width', { maxWidth: 200 }, undefined, 'cap');
    addLayerModifier(
      text,
      'hide-empty',
      { source: { kind: 'layer', layerId: text.id, property: 'content' } },
      undefined,
      'empty',
    );
    composition.layers = [text];
    const definition = buildComponentDefinition(composition, [text.id], 'Caption');
    composition.components = [definition];
    const instance = instantiateComponentDefinition(composition, definition);
    composition.layers.push(...instance.layers);
    const actual = instance.layers[0]!;
    updateLayerModifier(actual, 'cap', { params: { minFontSize: 16 } });
    const master = definition.layers[0]!;
    updateLayerModifier(master, 'cap', { params: { maxWidth: 500 } });
    reorderLayerModifiers(master, ['empty', 'cap']);
    reconcileComponentInstances(composition);
    expect(actual.modifiers?.map((modifier) => modifier.id)).toEqual(['empty', 'cap']);
    expect(actual.modifiers?.find((modifier) => modifier.id === 'cap')).toMatchObject({
      params: { maxWidth: 500, minFontSize: 16 },
    });
    expect(actual.componentLink?.overridePaths).toContain('/modifiers/@cap/params/minFontSize');
  });
  it('remaps source/target layer, group and data field references without changing stable layer-local modifier IDs', () => {
    const input = fixture();
    addLayerModifier(
      input.panel,
      'auto-size',
      { source: reference(input.text) },
      undefined,
      'size',
    );
    addLayerModifier(
      input.panel,
      'hide-empty',
      {
        source: { kind: 'field', fieldId: 'f', sourcePath: ['name'] },
        target: { kind: 'group', groupId: 'g' },
      },
      undefined,
      'empty',
    );
    const copy = remapLayerModifierReferences(input.panel.modifiers, {
      layers: { text: 'new-text' },
      groups: new Map([['g', 'new-group']]),
      fields: { f: 'new-field' },
    })!;
    expect(copy[0]).toMatchObject({ id: 'size', params: { source: { layerId: 'new-text' } } });
    expect(copy[1]).toMatchObject({
      id: 'empty',
      params: { source: { fieldId: 'new-field' }, target: { groupId: 'new-group' } },
    });
    expect(input.panel.modifiers?.[0]).toMatchObject({ params: { source: { layerId: 'text' } } });
  });
  it('round-trips internal geometry sources and modifier-only fields through component instances', () => {
    const composition = createProject().compositions[0]!,
      input = fixture();
    composition.layers = input.layers;
    const field = createFieldDefinition('text', { key: 'headline', defaultValue: 'Name' });
    composition.dataFields = [field];
    addLayerModifier(input.panel, 'auto-size', { source: reference(input.text) });
    addLayerModifier(input.panel, 'hide-empty', {
      source: { kind: 'field', fieldId: field.id, sourcePath: [] },
    });
    const definition = buildComponentDefinition(
      composition,
      input.layers.map((layer) => layer.id),
      'Smart Lower Third',
    );
    expect(definition.dataFields).toHaveLength(1);
    const instance = instantiateComponentDefinition(composition, definition);
    const panel = instance.layers.find(
      (layer) => layer.componentLink?.sourceLayerId === input.panel.id,
    )!;
    expect(panel.modifiers?.[0]).toMatchObject({
      params: { source: { layerId: instance.layerIds[input.text.id] } },
    });
    expect(panel.modifiers?.[1]).toMatchObject({
      params: { source: { fieldId: instance.fieldIds[field.id] } },
    });
  });
  it('requires included modifier sources and rejects subgroup widening while preserving complete component group targets', () => {
    const composition = createProject().compositions[0]!,
      input = fixture();
    composition.layers = input.layers;
    addLayerModifier(input.panel, 'auto-size', { source: reference(input.text) });
    expect(() => buildComponentDefinition(composition, [input.panel.id], 'Incomplete')).toThrow(
      /modifier source/,
    );
    input.text.groupId = 'text-group';
    updateLayerModifier(input.panel, input.panel.modifiers![0]!.id, {
      params: { source: { kind: 'group', groupId: 'text-group' } },
    });
    expect(() =>
      buildComponentDefinition(
        composition,
        input.layers.map((layer) => layer.id),
        'Subgroup',
      ),
    ).toThrow(/Subgroup references/);
    for (const layer of input.layers) layer.groupId = 'component-group';
    removeLayerModifier(input.panel, input.panel.modifiers![0]!.id);
    addLayerModifier(input.text, 'hide-empty', {
      source: { kind: 'layer', layerId: input.text.id, property: 'content' },
      target: { kind: 'group', groupId: 'component-group' },
    });
    const definition = buildComponentDefinition(
      composition,
      input.layers.map((layer) => layer.id),
      'Whole Group',
    );
    const instance = instantiateComponentDefinition(composition, definition);
    const text = instance.layers.find(
      (layer) => layer.componentLink?.sourceLayerId === input.text.id,
    )!;
    expect(text.modifiers?.[0]).toMatchObject({
      params: { target: { kind: 'group', groupId: instance.groupId } },
    });
  });
});
