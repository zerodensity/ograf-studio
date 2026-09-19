import { describe, expect, it, vi } from 'vitest';
import { createCertificationResourceUrls } from './certificationResources';

describe('certification package resources', () => {
  it('mounts exact ZIP binary/text bytes with MIME metadata and revokes every temporary URL', async () => {
    const blobs: Blob[] = [];
    const objectUrls = {
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return `blob:fixture-${blobs.length}`;
      }),
      revokeObjectURL: vi.fn(),
    };
    const resources = createCertificationResourceUrls(
      [
        { path: 'assets/image.png', data: 'AAEC//4=', base64: true },
        {
          path: 'custom/no-extension',
          data: '<svg>ö</svg>',
          base64: false,
          mimeType: 'image/svg+xml',
        },
      ],
      objectUrls,
    );
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 2, 255, 254]),
    );
    expect(await blobs[1]!.text()).toBe('<svg>ö</svg>');
    expect(blobs.map((blob) => blob.type)).toEqual(['image/png', 'image/svg+xml']);
    expect(resources.urls).toEqual({
      'assets/image.png': 'blob:fixture-1',
      'custom/no-extension': 'blob:fixture-2',
    });
    resources.dispose();
    resources.dispose();
    expect(objectUrls.revokeObjectURL.mock.calls).toEqual([['blob:fixture-1'], ['blob:fixture-2']]);
  });

  it('fails corrupt packaged bytes and releases resources already mounted before the failure', () => {
    const objectUrls = { createObjectURL: vi.fn(() => 'blob:created'), revokeObjectURL: vi.fn() };
    expect(() =>
      createCertificationResourceUrls(
        [
          { path: 'assets/first.txt', data: 'first', base64: false },
          { path: 'assets/broken.png', data: '%%invalid', base64: true },
        ],
        objectUrls,
      ),
    ).toThrow();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:created');
  });
});
