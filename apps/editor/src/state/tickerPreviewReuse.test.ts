import { describe, expect, it } from 'vitest';
import { compileDescriptor } from '@ograf-editor/codegen';
import { createComposition, createLayerOfKind, createTextElement } from '@ograf-editor/scene-model';
import { canReusePreviewForTickerElements } from './tickerPreviewReuse';

function fixture() {
  const composition = createComposition();
  composition.layers = [createLayerOfKind('ticker'), createLayerOfKind('text')];
  return compileDescriptor(composition);
}

describe('ticker authoring preview reuse', () => {
  it('reuses item edits, insertion, removal and playback settings without a lifecycle restart', () => {
    const before = fixture();
    const next = structuredClone(before);
    if (next.layers[0]!.element.type !== 'ticker') throw new Error('Expected ticker.');
    next.layers[0]!.element.items = [
      { id: 'new-entry', width: 440, element: createTextElement({ content: 'Latest headline' }) },
    ];
    next.layers[0]!.element.speedPixelsPerSecond = 210;
    next.layers[0]!.element.entryFade = 32;
    expect(canReusePreviewForTickerElements(before, next)).toBe(true);
    next.layers[0]!.element.items = [];
    expect(canReusePreviewForTickerElements(before, next)).toBe(true);
  });

  it('rebuilds for simultaneous Rules, binding, data-schema, timing, layout or other layer edits', () => {
    const before = fixture();
    const next = structuredClone(before);
    if (next.layers[0]!.element.type !== 'ticker') throw new Error('Expected ticker.');
    next.layers[0]!.element.items[0]!.width += 20;
    const changes = [
      (copy: typeof next) => {
        copy.layers[0]!.isVisible = false;
      },
      (copy: typeof next) => {
        copy.layers[0]!.bindings.push({ dataKey: 'feed', targetProperty: 'items' });
      },
      (copy: typeof next) => {
        copy.frameRate += 1;
      },
      (copy: typeof next) => {
        copy.width += 32;
      },
      (copy: typeof next) => {
        copy.stepCount += 1;
      },
      (copy: typeof next) => {
        copy.layers[1]!.element = createTextElement({ content: 'Other text' });
      },
      (copy: typeof next) => {
        copy.layers[0]!.animationTracks.opacity = [
          { id: 'test-opacity', frame: 0, value: 0, easing: 'linear' },
        ];
      },
      (copy: typeof next) => {
        copy.dataDefaults = { ...copy.dataDefaults, news: 'Changed default' };
      },
      (copy: typeof next) => {
        copy.layers[0]!.visualRules = [
          {
            id: 'new-rule',
            name: 'Rule #1',
            enabled: true,
            dataKey: 'ready',
            sourcePath: [],
            operator: 'equals',
            value: true,
            actions: [],
          },
        ];
      },
    ];
    for (const change of changes) {
      const edited = structuredClone(next);
      change(edited);
      expect(canReusePreviewForTickerElements(before, edited)).toBe(false);
    }
  });

  it('does not mask replacing a ticker or its layer with another kind', () => {
    const before = fixture();
    expect(canReusePreviewForTickerElements(before, structuredClone(before))).toBe(false);
    const next = structuredClone(before);
    next.layers[0]!.element = createTextElement();
    expect(canReusePreviewForTickerElements(before, next)).toBe(false);
  });
});
