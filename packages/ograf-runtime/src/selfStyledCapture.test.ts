import { describe, expect, it } from 'vitest';
import {
  canCaptureSelfStyled,
  embedStyleUrls,
  keyframePropertyName,
  selfStyledCaptureObstacle,
} from './selfStyledCapture';

describe('canCaptureSelfStyled', () => {
  it.each([
    ['url("#layer-mask")', true],
    ['url("data:image/svg+xml,clip"), url("#layer-mask")', false],
  ])('checks support for the mounted layer mask %s', (maskImage, supported) => {
    const layer = { dataset: { ografLayerMaskId: 'layer-mask' }, style: { maskImage } };
    const root = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => (selector === 'use' ? [] : [layer]),
      getAnimations: () => [],
    } as unknown as HTMLElement;

    expect(canCaptureSelfStyled(root)).toBe(supported);
  });
});

describe('selfStyledCaptureObstacle', () => {
  const tree = (parts: {
    unsupported?: string;
    shadow?: boolean;
    use?: string;
    pseudo?: boolean;
  }) =>
    ({
      querySelector: (selector: string) =>
        selector.startsWith('video') && parts.unsupported ? { localName: parts.unsupported } : null,
      querySelectorAll: (selector: string) =>
        selector === '*'
          ? [{ shadowRoot: parts.shadow ? {} : null }]
          : selector === 'use' && parts.use
            ? [{ getAttribute: (name: string) => (name === 'href' ? parts.use : null) }]
            : [],
      getAnimations: () => (parts.pseudo ? [{ effect: { pseudoElement: '::before' } }] : []),
    }) as unknown as HTMLElement;

  it('names what a layer holds that its own markup cannot draw', () => {
    expect(selfStyledCaptureObstacle(tree({}))).toBeNull();
    expect(selfStyledCaptureObstacle(tree({ unsupported: 'iframe' }))).toBe('<iframe> content');
    expect(selfStyledCaptureObstacle(tree({ shadow: true }))).toBe(
      'an element with its own shadow tree',
    );
    expect(selfStyledCaptureObstacle(tree({ use: 'icons.svg#star' }))).toBe(
      'an SVG symbol defined outside the layer',
    );
    expect(selfStyledCaptureObstacle(tree({ pseudo: true }))).toBe('an animated pseudo-element');
  });
});

describe('embedStyleUrls', () => {
  it('embeds what a declaration block loads from elsewhere, once for each address', async () => {
    const asked: string[] = [];
    const embed = async (url: string) => {
      asked.push(url);
      return `data:image/png;base64,${url.length}`;
    };
    await expect(
      embedStyleUrls(
        `background-image: url("/a.png"), url(/a.png); mask-image: url('https://x.test/m.svg')`,
        embed,
      ),
    ).resolves.toBe(
      'background-image: url("data:image/png;base64,6"), url("data:image/png;base64,6"); mask-image: url("data:image/png;base64,20")',
    );
    expect(asked).toEqual(['/a.png', 'https://x.test/m.svg']);
  });

  it('leaves embedded resources and references into the same document as they are', async () => {
    const style =
      'clip-path: url("#clip"); background: url("data:image/png;base64,AAAA"); filter: url(#blur)';
    await expect(
      embedStyleUrls(style, async () => {
        throw new Error('nothing here loads from elsewhere');
      }),
    ).resolves.toBe(style);
  });

  it('fails with the reason when a resource cannot be read', async () => {
    await expect(
      embedStyleUrls('background: url(/gone.png)', async () => {
        throw new Error('An image of the graphic could not be read (404): /gone.png');
      }),
    ).rejects.toThrow('could not be read (404)');
  });
});

describe('keyframePropertyName', () => {
  it('names a property as a style declaration does', () => {
    expect(
      ['transform', 'backgroundColor', 'cssFloat', 'cssOffset', '--myValue'].map(
        keyframePropertyName,
      ),
    ).toEqual(['transform', 'background-color', 'float', 'offset', '--myValue']);
  });
});
