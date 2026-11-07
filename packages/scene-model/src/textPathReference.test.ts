import { describe, expect, it } from 'vitest';
import { createComposition, createLayerOfKind, createTextElement } from './factory';
import { createDefaultGradient } from './paint';
import { buildComponentDefinition, instantiateComponentDefinition } from './components';
import {
  remapTextPathReference,
  textPathCompatibilityErrors,
  textPathReferenceErrors,
} from './textPathReference';

describe('text path references', () => {
  it('requires a same-composition path and validates offset and alignment', () => {
    const text = createLayerOfKind('text');
    const path = createLayerOfKind('path');
    const link = { sourceLayerId: path.id, startOffset: 0, alignment: 'start' as const };
    expect(textPathReferenceErrors(text, link, [text, path])).toEqual([]);
    if (path.element.type !== 'path') throw new Error('Expected path');
    path.element.stretchInsets = { left: 1, right: 1, top: 1, bottom: 1 };
    expect(textPathReferenceErrors(text, link, [text, path]).join(' ')).toMatch(/nine-slice/);
    delete path.element.stretchInsets;
    path.element.d = 'M0 0 L0 0';
    expect(textPathReferenceErrors(text, link, [text, path]).join(' ')).toMatch(/nonzero length/);
    path.element.d = 'M0 0 L10 0 M20 0 L30 0';
    expect(textPathReferenceErrors(text, link, [text, path]).join(' ')).toMatch(/single contour/);
    expect(textPathReferenceErrors(text, link, [text]).join(' ')).toMatch(/Choose a path/);
    expect(
      textPathReferenceErrors(text, { ...link, startOffset: Infinity }, [text, path]).join(' '),
    ).toMatch(/finite/);
  });
  it('remaps copied paths and removes dangling cross-composition references', () => {
    const link = { sourceLayerId: 'old', startOffset: 2, alignment: 'center' as const };
    expect(remapTextPathReference(link, new Map([['old', 'new']]), new Set())).toMatchObject({
      sourceLayerId: 'new',
    });
    expect(remapTextPathReference(link, new Map(), new Set(['old']))).toEqual(link);
    expect(remapTextPathReference(link, new Map(), new Set())).toBeNull();
  });
  it('requires and remaps the path when creating reusable component instances', () => {
    const composition = createComposition();
    const text = createLayerOfKind('text');
    const path = createLayerOfKind('path');
    text.textPath = { sourceLayerId: path.id, startOffset: 0, alignment: 'start' };
    composition.layers = [path, text];
    expect(() => buildComponentDefinition(composition, [text.id], 'Bad')).toThrow(
      /Include the text path/,
    );
    const component = buildComponentDefinition(composition, [path.id, text.id], 'Heading');
    const instance = instantiateComponentDefinition(composition, component);
    const clonedText = instance.layers.find((layer) => layer.element.type === 'text')!;
    const clonedPath = instance.layers.find((layer) => layer.element.type === 'path')!;
    expect(clonedText.textPath?.sourceLayerId).toBe(clonedPath.id);
  });
  it('guards overlong, contextual, negative-tracking and unsupported case input', () => {
    expect(
      textPathCompatibilityErrors(createTextElement({ content: 'WORD', autoFit: 'squeeze' })).join(
        ' ',
      ),
    ).toMatch(/automatic fitting or squeeze/);
    expect(
      textPathCompatibilityErrors(createTextElement({ content: 'A'.repeat(513) })).join(' '),
    ).toMatch(/512 graphemes/);
    expect(textPathCompatibilityErrors(createTextElement({ content: 'مرحبا' })).join(' ')).toMatch(
      /contextual-shaping/,
    );
    expect(
      textPathCompatibilityErrors(createTextElement({ content: 'WORD', letterSpacing: -1 })).join(
        ' ',
      ),
    ).toMatch(/Negative tracking/);
    expect(
      textPathCompatibilityErrors(
        createTextElement({ content: 'test', textTransform: 'capitalize' }),
      ).join(' '),
    ).toMatch(/Capitalize/);
    expect(
      textPathCompatibilityErrors(
        createTextElement({ content: 'test', textTransform: 'uppercase' }),
      ),
    ).toEqual([]);
  });
  it('allows word reveal and validated count animators on text paths', () => {
    const word = createTextElement({ content: 'WORD REVEAL' });
    word.textAnimation.type = 'word-reveal';
    expect(textPathCompatibilityErrors(word)).toEqual([]);
    const count = createTextElement({ content: '9999' });
    count.textAnimation.type = 'count-up';
    count.textAnimation.countRoll = 'up';
    count.textAnimation.animators = [
      {
        id: 'a',
        enabled: true,
        unit: 'character',
        start: 0,
        end: 1,
        offset: 0,
        offsetKeyframes: [],
        shape: 'square',
        easing: 'linear',
        order: 'forward',
        seed: 1,
        durationFrames: 10,
        properties: { x: 40, color: '#ff0000' },
      },
    ];
    expect(textPathCompatibilityErrors(count)).toEqual([]);
    count.textAnimation.countRoll = 'none';
    expect(textPathCompatibilityErrors(count)).toEqual([]);
    count.textAnimation.animators[0]!.properties = { opacity: 0.5 };
    expect(textPathCompatibilityErrors(count)).toEqual([]);
    word.fill = createDefaultGradient();
    word.textAnimation.animators = count.textAnimation.animators;
    expect(textPathCompatibilityErrors(word)).toEqual([]);
  });
  it('only admits simple shaped Devanagari and Arabic word-reveal content', () => {
    const hindi = createTextElement({ content: 'भारत समाचार', direction: 'ltr' });
    hindi.textAnimation.type = 'word-reveal';
    expect(textPathCompatibilityErrors(hindi)).toEqual([]);
    const arabic = createTextElement({ content: 'مرحبا بالعالم', direction: 'rtl' });
    arabic.textAnimation.type = 'word-reveal';
    expect(textPathCompatibilityErrors(arabic)).toEqual([]);
    arabic.content = '';
    expect(textPathCompatibilityErrors(arabic)).toEqual([]);
    arabic.content = 'مرحبا ABC';
    expect(textPathCompatibilityErrors(arabic).join(' ')).toMatch(/right-to-left/);
    arabic.content = 'مرحبا ١٢';
    expect(textPathCompatibilityErrors(arabic).join(' ')).toMatch(/right-to-left/);
    arabic.content = 'مرحبا بالعالم';
    arabic.runs = [{ text: 'مرحبا' }, { text: ' بالعالم' }];
    expect(textPathCompatibilityErrors(arabic).join(' ')).toMatch(/right-to-left/);
  });
});
