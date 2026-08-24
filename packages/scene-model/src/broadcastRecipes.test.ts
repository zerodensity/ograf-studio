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

  it('creates a clipped ticker whose crawl uses only a deterministic local loop', () => {
    const composition = createComposition();
    const result = materializeTicker(composition, { speedPixelsPerSecond: 240 });
    const window = composition.layers.find((layer) => layer.id === result.layers.window)!;
    const crawl = composition.layers.find((layer) => layer.id === result.layers.crawl)!;

    expect(window.clipChildren).toBe(true);
    expect(crawl.parentId).toBe(window.id);
    expect(crawl.loop).toMatchObject({
      activation: { type: 'lifecycle' },
      repeatCount: null,
    });
    expect(crawl.loop?.tracks.x).toHaveLength(2);
    expect(new Set(getResolvedLayerAnimationTracks(crawl).x?.map((key) => key.value))).toHaveLength(
      1,
    );
    expect(crawl.semantics.tags).toEqual(
      expect.arrayContaining(['qa:allow-loop-seam', 'qa:allow-offcanvas']),
    );
    expect(Object.keys(result.fields)).toEqual(['label', 'text']);
  });

  it('keeps field keys unique when one recipe receives repeated requested keys', () => {
    const composition = createComposition();
    materializeTicker(composition, { fieldKeys: { label: 'ticker', text: 'ticker' } });
    expect(composition.dataFields.map((field) => field.key)).toEqual(['ticker', 'ticker_2']);
  });

  it('creates an outlined four-field scoreboard using the sports pack', () => {
    const composition = createComposition();
    const result = materializeScoreboard(composition, {
      content: { homeName: 'ANK', homeScore: 2, awayScore: 1, awayName: 'IZM' },
    });
    const scores = composition.layers.filter((layer) => layer.semantics.role === 'score');

    expect(result.stylePack).toBe('sports');
    expect(Object.keys(result.fields)).toEqual(['homeName', 'homeScore', 'awayScore', 'awayName']);
    expect(scores).toHaveLength(2);
    expect(
      scores.every((layer) => layer.element.type === 'text' && layer.element.strokeWidth === 4),
    ).toBe(true);
    expect(composition.dataFields.filter((field) => field.type === 'integer')).toHaveLength(2);
  });

  it('keeps existing linked recipe layers synchronized when an explicit pack changes', () => {
    const composition = createComposition();
    const bug = materializeBug(composition, { stylePack: 'news' });
    const bugPanel = composition.layers.find((layer) => layer.id === bug.layers.panel)!;
    expect(bugPanel.element).toMatchObject({ type: 'rectangle', fill: '#123A63' });

    materializeScoreboard(composition, { stylePack: 'sports' });

    expect(bugPanel.element).toMatchObject({ type: 'rectangle', fill: '#13232A' });
  });

  it('creates a clock with two constrained fields and static punctuation', () => {
    const composition = createComposition();
    const result = materializeClock(composition, { stylePack: 'documentary' });
    const separator = composition.layers.find((layer) => layer.id === result.layers.separator)!;

    expect(Object.keys(result.fields)).toEqual(['hours', 'minutes']);
    expect(composition.dataFields.map((field) => field.constraints.pattern)).toEqual([
      '^([01][0-9]|2[0-3])$',
      '^[0-5][0-9]$',
    ]);
    expect(separator.bindings).toEqual([]);
    expect(separator.semantics.tags).toContain('qa:static-text');
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
