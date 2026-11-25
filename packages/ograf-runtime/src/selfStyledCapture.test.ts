import { describe, expect, it } from 'vitest';
import {
  canCaptureSelfStyled,
  embedStyleUrls,
  keyframePropertyName,
  selfStyledCaptureObstacle,
  splitList,
  withMaskListItem,
} from './selfStyledCapture';

describe('selfStyledCaptureObstacle', () => {
  interface Parts {
    unsupported?: string;
    shadow?: Parts;
    use?: string;
    pseudo?: boolean;
  }
  const tree = (parts: Parts, host = false): HTMLElement =>
    ({
      ...(host ? { host: {} } : {}),
      querySelector: (selector: string) =>
        selector.startsWith('video') && parts.unsupported ? { localName: parts.unsupported } : null,
      querySelectorAll: (selector: string) =>
        selector.startsWith('*')
          ? [{ shadowRoot: parts.shadow ? tree(parts.shadow, true) : null }]
          : selector === 'use' && parts.use
            ? [{ getAttribute: (name: string) => (name === 'href' ? parts.use : null) }]
            : [],
      getAnimations: () => (parts.pseudo ? [{ effect: { pseudoElement: '::before' } }] : []),
    }) as unknown as HTMLElement;

  it('names what a layer holds that its own markup cannot draw', () => {
    expect(selfStyledCaptureObstacle(tree({}))).toBeNull();
    expect(selfStyledCaptureObstacle(tree({ unsupported: 'iframe' }))).toBe('<iframe> content');
    expect(selfStyledCaptureObstacle(tree({ use: 'icons.svg#star' }))).toBe(
      'an SVG symbol defined outside the layer',
    );
    expect(selfStyledCaptureObstacle(tree({ pseudo: true }))).toBe('an animated pseudo-element');
  });

  it('holds a shadow tree to the same, since it is copied with its host', () => {
    expect(canCaptureSelfStyled(tree({ shadow: {} }))).toBe(true);
    expect(selfStyledCaptureObstacle(tree({ shadow: { shadow: { unsupported: 'slot' } } }))).toBe(
      '<slot> content',
    );
  });
});

describe('mask lists', () => {
  it('splits a list at its own commas only', () => {
    expect(splitList('url("data:image/svg+xml,a,b"), url("#mask"), rgb(1, 2, 3)')).toEqual([
      'url("data:image/svg+xml,a,b")',
      'url("#mask")',
      'rgb(1, 2, 3)',
    ]);
  });

  it('replaces the item of one mask image and leaves a crop image beside it as it is', () => {
    const crop = 'url("data:image/svg+xml,crop")';
    expect(withMaskListItem(`${crop}, url("#mask")`, 2, 1, 'url("data:baked")', 'none')).toBe(
      `${crop}, url("data:baked")`,
    );
    expect(withMaskListItem('alpha, match-source', 2, 1, 'alpha', 'match-source')).toBe(
      'alpha, alpha',
    );
  });

  it('repeats a shorter list as CSS reads it, and fills an empty one', () => {
    expect(withMaskListItem('no-repeat', 2, 1, 'repeat-x', 'repeat')).toBe('no-repeat, repeat-x');
    expect(withMaskListItem('', 2, 0, '100% 100%', 'auto')).toBe('100% 100%, auto');
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
