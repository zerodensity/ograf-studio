import { describe, expect, it } from 'vitest';
import {
  materializeBug,
  materializeClock,
  materializeScoreboard,
  materializeTicker,
} from './broadcastRecipes';
import { createComposition } from './factory';
import { getResolvedLayerAnimationTracks } from './layerAnimation';
import { reviewCompositionDesign } from './designQa';

describe('materialized broadcast recipes', () => {
  it('creates a compact editable bug with style-pack tokens and mappings', () => {
    const composition = createComposition();
    const result = materializeBug(composition, {
      stylePack: 'entertainment',
      content: { label: 'EXCLUSIVE' },
    });

    expect(result).toMatchObject({ recipe: 'bug', stylePack: 'entertainment' });
    expect(Object.keys(result.layers)).toEqual(['panel', 'accent', 'label']);
    expect(Object.keys(result.fields)).toEqual(['label']);
    expect(composition.layers.every((layer) => layer.groupId === result.groupId)).toBe(true);
    expect(composition.layers.every((layer) => layer.semantics.role !== 'none')).toBe(true);
    expect(composition.dataFields[0]).toMatchObject({ constraints: { maxLength: 24 } });
    expect(composition.layout.timelineFolders[0]!.id).toBe(result.timelineGroupId);
  });

  it('creates a clipped native ticker with frame-clock scrolling and safe item updates', () => {
    const composition = createComposition();
    const result = materializeTicker(composition, { speedPixelsPerSecond: 240 });
    const window = composition.layers.find((layer) => layer.id === result.layers.window)!;
    const crawl = composition.layers.find((layer) => layer.id === result.layers.crawl)!;

    expect(window.clipChildren).toBe(true);
    expect(crawl.parentId).toBe(window.id);
    expect(crawl.loop).toBeNull();
    expect(crawl.element).toMatchObject({
      type: 'ticker',
      speedPixelsPerSecond: 240,
      gap: 48,
      direction: 'left',
      updatePolicy: 'next-appearance',
      entryFade: 40,
      exitFade: 40,
    });
    expect(new Set(getResolvedLayerAnimationTracks(crawl).x?.map((key) => key.value))).toHaveLength(
      1,
    );
    expect(crawl.semantics.tags).toEqual(
      expect.arrayContaining(['qa:allow-loop-seam', 'native-ticker']),
    );
    expect(Object.keys(result.fields)).toEqual(['label', 'text']);
  });

  it('keeps field keys unique when one recipe receives repeated requested keys', () => {
    const composition = createComposition();
    materializeTicker(composition, { fieldKeys: { label: 'ticker', text: 'ticker' } });
    expect(
      composition.dataFields
        .filter((field) => !field.generatedShaderParameter)
        .map((field) => field.key),
    ).toEqual(['ticker', 'ticker_2']);
    const controls = composition.dataFields.filter((field) => field.generatedShaderParameter);
    expect(controls.map((field) => field.generatedShaderParameter!.name)).toEqual([
      'ink',
      'accent',
      'strength',
      'speed',
    ]);
    for (const field of controls) {
      const parameter = field.generatedShaderParameter!;
      expect(
        composition.layers.find((layer) => layer.id === parameter.layerId)?.bindings,
      ).toContainEqual({ fieldId: field.id, targetProperty: `fill.parameters.${parameter.name}` });
    }
    expect(new Set(composition.dataFields.map((field) => field.key)).size).toBe(
      composition.dataFields.length,
    );
  });

  it('creates a clean four-field scoreboard using the sports pack', () => {
    const composition = createComposition();
    const result = materializeScoreboard(composition, {
      content: { homeName: 'ANK', homeScore: 2, awayScore: 1, awayName: 'IZM' },
    });
    const scores = composition.layers.filter((layer) => layer.semantics.role === 'score');

    expect(result.stylePack).toBe('sports');
    expect(Object.keys(result.fields)).toEqual(['homeName', 'homeScore', 'awayScore', 'awayName']);
    expect(scores).toHaveLength(2);
    expect(scores.map((layer) => layer.element)).toEqual(
      Array.from({ length: 2 }, () =>
        expect.objectContaining({
          type: 'text',
          strokeWidth: 0,
          fill: expect.objectContaining({ type: 'linear' }),
          textAnimation: expect.objectContaining({ type: 'roll-up', replayOnUpdate: true }),
        }),
      ),
    );
    expect(composition.dataFields.filter((field) => field.type === 'integer')).toHaveLength(2);
  });

  it('keeps existing linked recipe layers synchronized when an explicit pack changes', () => {
    const composition = createComposition();
    const bug = materializeBug(composition, { stylePack: 'news' });
    const bugPanel = composition.layers.find((layer) => layer.id === bug.layers.panel)!;
    expect(bugPanel.element).toMatchObject({
      type: 'rectangle',
      fill: {
        type: 'shader',
        name: 'News / Signal grid',
        parameters: { ink: [18 / 255, 58 / 255, 99 / 255, 1] },
      },
    });

    materializeScoreboard(composition, { stylePack: 'sports' });

    expect(bugPanel.element).toMatchObject({
      type: 'rectangle',
      fill: {
        type: 'shader',
        name: 'Sports / Velocity diagonals',
        parameters: { ink: [19 / 255, 35 / 255, 42 / 255, 1] },
      },
    });
  });

  it('creates an automatic native clock with rolling digits in its own clipping window', () => {
    const composition = createComposition();
    const result = materializeClock(composition, { stylePack: 'documentary' });
    const value = composition.layers.find((layer) => layer.id === result.layers.value)!;
    const valueWindow = composition.layers.find((layer) => layer.id === result.layers.valueWindow)!;

    expect(Object.keys(result.fields)).toEqual([]);
    expect(value.element).toMatchObject({
      type: 'text',
      clock: { mode: 'clock', source: 'automatic', format: 'hh:mm:ss', hourCycle: '24' },
      textAnimation: { type: 'roll-up', replayOnUpdate: true },
    });
    expect(value).toMatchObject({ parentId: valueWindow.id, bindings: [] });
    expect(valueWindow).toMatchObject({
      parentId: result.layers.panel,
      clipChildren: true,
      element: { type: 'rectangle', fill: 'transparent', strokeWidth: 0 },
    });
  });

  it('keeps every default recipe above the deterministic quality threshold', () => {
    for (const materialize of [
      materializeBug,
      materializeTicker,
      materializeScoreboard,
      materializeClock,
    ]) {
      const composition = createComposition();
      materialize(composition as never);
      expect(reviewCompositionDesign(composition).score).toBeGreaterThanOrEqual(90);
    }
  });
});
