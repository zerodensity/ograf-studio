import { describe, expect, it } from 'vitest';
import {
  createImageSequenceElement,
  createRectangleElement,
  createShaderPaint,
  createTextElement,
  type Element,
  type ImageElement,
  type MediaPaint,
  type TickerElement,
} from '@ograf-editor/scene-model';
import { animatesItsOwnUpdate, classifyElementDataChange } from './inPlaceData';

const image = (src: string | null, extra: Partial<ImageElement> = {}): ImageElement => ({
  type: 'image',
  src,
  ...extra,
});
const media = (src: string) => ({ type: 'media', source: { kind: 'clip', src } }) as MediaPaint;
const ticker = (src: string, gap = 0) =>
  ({
    type: 'ticker',
    gap,
    items: [{ id: 'item', width: 100, element: image(src) }],
  }) as unknown as TickerElement;

describe('classifying a data change on an element', () => {
  it('sees nothing when the resolved element is the same', () => {
    expect(
      classifyElementDataChange(
        createTextElement({ content: 'A' }),
        createTextElement({ content: 'A' }),
      ),
    ).toBe('none');
  });

  it('calls text and color changes content, because they load nothing', () => {
    expect(
      classifyElementDataChange(
        createTextElement({ content: 'A' }),
        createTextElement({ content: 'B' }),
      ),
    ).toBe('content');
    expect(
      classifyElementDataChange(
        createRectangleElement({ fill: '#ff0000' }),
        createRectangleElement({ fill: '#00ff00' }),
      ),
    ).toBe('content');
  });

  it('can stage a plain image source, but not one under a fill', () => {
    expect(classifyElementDataChange(image('a.png'), image('b.png'))).toBe('image');
    expect(classifyElementDataChange(image(null), image('b.png'))).toBe('image');
    const fill = media('clip.webm');
    expect(classifyElementDataChange(image('a.png', { fill }), image('b.png', { fill }))).toBe(
      'resource',
    );
  });

  it('treats clearing an image and other image settings as content', () => {
    expect(classifyElementDataChange(image('a.png'), image(null))).toBe('content');
    expect(classifyElementDataChange(image('a.png'), image('a.png', { fit: 'cover' }))).toBe(
      'content',
    );
  });

  it('asks for a real Take when a resource only a new mount can prepare changes', () => {
    const before = createImageSequenceElement();
    expect(classifyElementDataChange(before, { ...before, frames: ['one.png'] })).toBe('resource');
    expect(
      classifyElementDataChange(
        { type: 'lottie', animationData: { v: '1' }, speed: 1 } as unknown as Element,
        { type: 'lottie', animationData: { v: '2' }, speed: 1 } as unknown as Element,
      ),
    ).toBe('resource');
    expect(
      classifyElementDataChange(
        { type: 'audio', src: 'a.mp3', volume: 1 } as Element,
        { type: 'audio', src: 'b.mp3', volume: 1 } as Element,
      ),
    ).toBe('resource');
    expect(
      classifyElementDataChange(
        createRectangleElement({ fill: media('a.webm') }),
        createRectangleElement({ fill: media('b.webm') }),
      ),
    ).toBe('resource');
    expect(classifyElementDataChange(ticker('a.png'), ticker('b.png'))).toBe('resource');
    expect(
      classifyElementDataChange(createRectangleElement(), createTextElement({ content: 'A' })),
    ).toBe('resource');
  });

  it('asks for a real Take when a shader source or input image changes', () => {
    const paint = createShaderPaint();
    expect(
      classifyElementDataChange(createRectangleElement({ fill: paint }), {
        ...createRectangleElement({ fill: { ...paint, fragmentSource: 'void main(){}' } }),
      }),
    ).toBe('resource');
    expect(
      classifyElementDataChange(createRectangleElement({ fill: paint }), {
        ...createRectangleElement({
          fill: {
            ...paint,
            inputImage: { source: 'in.png', wrap: 'clamp', filter: 'linear' },
          },
        }),
      }),
    ).toBe('resource');
  });

  it('calls shader parameters uniforms, on a paint and on a shader element', () => {
    const paint = createShaderPaint();
    expect(
      classifyElementDataChange(
        createRectangleElement({ fill: { ...paint, parameters: { amount: 0 } } }),
        createRectangleElement({ fill: { ...paint, parameters: { amount: 1 } } }),
      ),
    ).toBe('uniforms');
    expect(
      classifyElementDataChange(
        { ...paint, parameters: { amount: 0 } },
        { ...paint, parameters: { amount: 1 } },
      ),
    ).toBe('uniforms');
  });

  it('does not excuse another change that comes with shader parameters', () => {
    const paint = createShaderPaint();
    expect(
      classifyElementDataChange(
        createRectangleElement({ fill: { ...paint, speed: 1, parameters: { amount: 0 } } }),
        createRectangleElement({ fill: { ...paint, speed: 2, parameters: { amount: 1 } } }),
      ),
    ).toBe('content');
  });

  it('treats a ticker setting that loads nothing as content', () => {
    expect(classifyElementDataChange(ticker('a.png', 0), ticker('a.png', 8))).toBe('content');
  });
});

describe('elements that show their own update', () => {
  it('names tickers, charts, clocks and replaying text, not plain text', () => {
    expect(animatesItsOwnUpdate(ticker('a.png'))).toBe(true);
    expect(animatesItsOwnUpdate({ type: 'chart' } as Element)).toBe(true);
    expect(animatesItsOwnUpdate(createTextElement({ content: 'A' }))).toBe(false);
    expect(
      animatesItsOwnUpdate({
        ...createTextElement({ content: 'A' }),
        clock: { mode: 'clock' },
      } as Element),
    ).toBe(true);
    expect(
      animatesItsOwnUpdate({
        ...createTextElement({ content: 'A' }),
        textAnimation: { type: 'typewriter', replayOnUpdate: true },
      } as Element),
    ).toBe(true);
    expect(
      animatesItsOwnUpdate({
        ...createTextElement({ content: 'A' }),
        textAnimation: { type: 'typewriter', replayOnUpdate: false },
      } as Element),
    ).toBe(false);
  });
});
