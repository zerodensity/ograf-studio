import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Photoshop import license notices', () => {
  it('ships the installed upstream ag-psd, pako and base64-js licenses', () => {
    for (const [source, shipped] of [
      ['node_modules/ag-psd/LICENSE', 'apps/editor/public/third-party/ag-psd-LICENSE.txt'],
      [
        'node_modules/ag-psd/node_modules/pako/LICENSE',
        'apps/editor/public/third-party/pako-LICENSE.txt',
      ],
      ['node_modules/base64-js/LICENSE', 'apps/editor/public/third-party/base64-js-LICENSE.txt'],
    ])
      expect(readFileSync(shipped!, 'utf8')).toBe(readFileSync(source!, 'utf8'));
    const zlib = readFileSync('apps/editor/public/third-party/pako-zlib-LICENSE.txt', 'utf8');
    expect(zlib).toContain('Jean-loup Gailly and Mark Adler');
    expect(zlib).toContain('This notice may not be removed or altered');
  });
});
