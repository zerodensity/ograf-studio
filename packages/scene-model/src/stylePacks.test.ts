import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createLayerOfKind,
  createProject,
  createLayerKeyframe,
  createDefaultTransform,
  createLayerPropertyKeyframe,
  createFieldDefinition,
  createLayerLoopClip,
} from './factory';
import { migrateProject } from './migrations';
import { validateProject } from '@ograf-editor/validation';
import {
  applyStylePack,
  removeStylePack,
  stylePackIdForComposition,
  getStylePack,
  STYLE_PACKS,
  STYLE_TOKEN_KEYS,
} from './stylePacks';

describe('broadcast style packs', () => {
  it('restores fonts, sizing and strokes across pack switches and source reloads, retaining text and layout edits', () => {
    const project = createProject(),
      c = project.compositions[0]!,
      layer = createLayerOfKind('text');
    if (layer.element.type !== 'text') throw Error('Expected text');
    Object.assign(layer.element, {
      content: 'Original',
      fontFamily: 'Georgia',
      fontSize: 46,
      minFontSize: 24,
      fontWeight: 500,
      strokeColor: '#112233',
      strokeWidth: 3,
    });
    layer.semantics.role = 'headline';
    layer.keyframes = [0, 12, 24].map((frame) =>
      createLayerKeyframe(frame, createDefaultTransform()),
    );
    layer.animationTracks.strokeWidth = [createLayerPropertyKeyframe(0, 3)];
    c.layers.push(layer);
    const original = structuredClone(layer.element);
    applyStylePack(c, 'news');
    applyStylePack(c, 'sports');
    applyStylePack(c, 'documentary');
    expect(layer.element.fontFamily).not.toBe('Georgia');
    layer.element.content = 'Updated live text';
    layer.keyframes[0]!.transform.x = 900;
    const recovered = migrateProject(JSON.parse(JSON.stringify(project))).compositions[0]!;
    removeStylePack(recovered);
    expect(recovered.layers[0]!.element).toEqual({ ...original, content: 'Updated live text' });
    expect(recovered.layers[0]!.keyframes[0]!.transform.x).toBe(900);
    expect(recovered.layers[0]!.animationTracks.strokeWidth?.[0]?.value).toBe(3);
    expect(recovered.designSystem.stylePackRestore).toBeUndefined();
  });
  it('preserves gradient reflection curves, masks and shared light layers through every pack', () => {
    const project = createProject(),
      c = project.compositions[0]!,
      reflection = createLayerOfKind('rectangle'),
      matte = createLayerOfKind('ellipse');
    if (reflection.element.type !== 'rectangle') throw Error('Expected rectangle');
    reflection.semantics.role = 'background';
    reflection.element.fill = {
      type: 'linear',
      angle: 115,
      stops: [
        { offset: 0, color: '#fff', opacity: 0 },
        { offset: 0.5, color: '#ccddee', opacity: 0.8 },
        { offset: 1, color: '#fff', opacity: 0 },
      ],
    };
    reflection.loop = createLayerLoopClip({
      tracks: {
        'fill.stops[1].offset': [
          createLayerPropertyKeyframe(0, 0.2),
          createLayerPropertyKeyframe(25, 0.8),
        ],
      },
    });
    matte.isMaskOnly = true;
    matte.semantics.role = 'mask';
    reflection.mask = { sourceLayerId: matte.id, mode: 'alpha', inverted: false };
    for (const layer of [reflection, matte])
      layer.keyframes = [0, 12, 24].map((frame) =>
        createLayerKeyframe(frame, createDefaultTransform()),
      );
    c.layers.push(reflection, matte);
    const original = structuredClone(c.layers);
    for (const pack of STYLE_PACKS) {
      applyStylePack(c, pack.id);
      expect(c.layers[1]).toEqual(original[1]);
      expect(c.layers[0]!.loop).toEqual(original[0]!.loop);
      expect(c.layers[0]!.mask).toEqual(original[0]!.mask);
      const fill = c.layers[0]!.element.type === 'rectangle' ? c.layers[0]!.element.fill : null;
      expect(
        fill && typeof fill !== 'string'
          ? fill.stops.map(({ color: _color, ...stop }) => stop)
          : null,
      ).toEqual([
        { offset: 0, opacity: 0 },
        { offset: 0.5, opacity: 0.8 },
        { offset: 1, opacity: 0 },
      ]);
      expect(() => migrateProject(project)).not.toThrow();
      expect(validateProject(project).valid).toBe(true);
    }
    removeStylePack(c);
    expect(c.layers).toEqual(original);
  });
  it('restores prior palette tokens and bound field defaults instead of deleting them', () => {
    const c = createComposition(),
      layer = createLayerOfKind('rectangle');
    layer.semantics.role = 'container';
    if (layer.element.type !== 'rectangle') throw Error('Expected rectangle');
    layer.element.fill = '#123456';
    c.designSystem.name = 'Station';
    c.updateTransitionFrames = 17;
    c.designSystem.tokens.push({
      id: 'surface-before',
      key: STYLE_TOKEN_KEYS.surface,
      name: 'Original surface',
      type: 'color',
      value: '#123456',
      description: '',
    });
    layer.designTokenBindings = [{ tokenId: 'surface-before', targetProperty: 'fill' }];
    c.layers.push(layer);
    c.dataFields.push(
      createFieldDefinition('color', {
        key: 'surface',
        defaultValue: '#123456',
        defaultTokenId: 'surface-before',
      }),
    );
    const before = structuredClone(c);
    applyStylePack(c, 'sports');
    expect(c.dataFields[0]!.defaultValue).not.toBe('#123456');
    removeStylePack(c);
    expect(c).toEqual(before);
  });
  it('does not claim restoration for older applied packs without a saved baseline', () => {
    const c = createComposition(),
      layer = createLayerOfKind('text');
    c.layers.push(layer);
    applyStylePack(c, 'sports');
    delete c.designSystem.stylePackRestore;
    const appearance = structuredClone(layer.element);
    expect(removeStylePack(c)?.restored).toBe(false);
    expect(layer.element).toEqual(appearance);
    expect(layer.designTokenBindings).toEqual([]);
  });
  it('restores pre-pack appearance and timing while retaining custom tokens', () => {
    const composition = createComposition(),
      panel = createLayerOfKind('rectangle');
    panel.semantics.role = 'container';
    composition.layers = [panel];
    const appearance = JSON.stringify({
      element: panel.element,
      tracks: panel.animationTracks,
      update: composition.updateTransitionFrames,
    });
    applyStylePack(composition, 'sports');
    composition.designSystem.tokens.push({
      id: 'custom',
      key: 'station.custom',
      name: 'Custom',
      type: 'color',
      value: '#abcdef',
      description: '',
    });
    composition.components = [
      { id: 'template', name: 'Template', layers: [structuredClone(panel)], dataFields: [] },
    ];
    const removed = removeStylePack(composition);
    expect(removed?.packId).toBe('sports');
    expect(stylePackIdForComposition(composition)).toBeNull();
    expect(composition.designSystem.name).toBe('Brand Kit');
    expect(composition.designSystem.tokens.map((token) => token.id)).toEqual(['custom']);
    expect(panel.designTokenBindings).toEqual([]);
    expect(composition.components[0]!.layers[0]!.designTokenBindings).toEqual([]);
    expect(
      JSON.stringify({
        element: panel.element,
        tracks: panel.animationTracks,
        update: composition.updateTransitionFrames,
      }),
    ).toBe(appearance);
  });
  it('preserves a renamed kit and is a no-op when there is no applied pack', () => {
    const composition = createComposition();
    applyStylePack(composition, 'news');
    composition.designSystem.name = 'My station';
    removeStylePack(composition);
    expect(composition.designSystem.name).toBe('My station');
    const before = JSON.stringify(composition);
    expect(removeStylePack(composition)).toBeNull();
    expect(JSON.stringify(composition)).toBe(before);
  });
  it('ships four immutable named definitions', () => {
    expect(STYLE_PACKS.map((pack) => pack.id)).toEqual([
      'news',
      'sports',
      'entertainment',
      'documentary',
    ]);
    for (const pack of STYLE_PACKS) {
      expect(Object.isFrozen(pack)).toBe(true);
      expect(Object.isFrozen(pack.tokens)).toBe(true);
      expect(Object.isFrozen(pack.motion)).toBe(true);
    }
  });

  it('copies editable tokens and materializes them onto semantic layers', () => {
    const composition = createComposition();
    const panel = createLayerOfKind('rectangle');
    const headline = createLayerOfKind('text');
    const score = createLayerOfKind('text');
    panel.semantics.role = 'container';
    headline.semantics.role = 'headline';
    score.semantics.role = 'score';
    composition.layers = [panel, headline, score];

    const applied = applyStylePack(composition, 'sports');

    expect(composition.designSystem.name).toBe('Sports Brand Kit');
    expect(applied.createdTokenIds).toHaveLength(getStylePack('sports').tokens.length);
    expect(applied.affectedLayerIds).toEqual([panel.id, headline.id, score.id]);
    expect(panel.element).toMatchObject({ type: 'rectangle', fill: '#13232A' });
    expect(headline.element).toMatchObject({
      type: 'text',
      color: '#FFFFFF',
      fontSize: 68,
      fontWeight: 800,
    });
    expect(score.element).toMatchObject({
      type: 'text',
      fontSize: 88,
      fontWeight: 900,
      strokeColor: '#000000',
      strokeWidth: 4,
    });
    expect(composition.updateTransitionFrames).toBe(5);

    const accent = composition.designSystem.tokens.find(
      (token) => token.key === STYLE_TOKEN_KEYS.accent,
    )!;
    accent.value = '#123456';
    expect(
      getStylePack('sports').tokens.find((token) => token.key === STYLE_TOKEN_KEYS.accent)?.value,
    ).toBe('#00E5FF');

    const switched = applyStylePack(composition, 'news', { bindLayerIds: [] });
    expect(panel.element).toMatchObject({ type: 'rectangle', fill: '#123A63' });
    expect(switched.affectedLayerIds).toEqual(
      expect.arrayContaining([panel.id, headline.id, score.id]),
    );
  });

  it('scales authored pixel tokens for UHD without changing motion-frame conventions', () => {
    const composition = createComposition({ height: 2160 });
    applyStylePack(composition, 'news');
    const value = (key: string) =>
      composition.designSystem.tokens.find((token) => token.key === key)?.value;

    expect(value(STYLE_TOKEN_KEYS.headlineSize)).toBe(128);
    expect(value(STYLE_TOKEN_KEYS.radius)).toBe(20);
    expect(value(STYLE_TOKEN_KEYS.entranceFrames)).toBe(10);
  });
});
