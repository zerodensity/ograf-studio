import { describe, expect, it } from 'vitest';
import { createComposition, createLayerOfKind } from './factory';
import { applyStylePack, getStylePack, STYLE_PACKS, STYLE_TOKEN_KEYS } from './stylePacks';

describe('broadcast style packs', () => {
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
