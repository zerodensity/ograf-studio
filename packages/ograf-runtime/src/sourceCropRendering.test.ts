import { describe, expect, it } from 'vitest';
import {
  disposeCroppedImage,
  mountCroppedImage,
  refreshCroppedImages,
} from './sourceCropRendering';

describe('image source cropping', () => {
  it('clips pixels outside the crop even with contain letterboxing and refreshes after source replacement', () => {
    const image = Object.assign(new EventTarget(), {
      naturalWidth: 1000,
      naturalHeight: 500,
      style: {} as Record<string, string>,
    });
    const container = {
      clientWidth: 200,
      clientHeight: 100,
      style: { overflow: 'visible' },
      dataset: {} as Record<string, string>,
      querySelectorAll: () => [],
    };
    mountCroppedImage(
      container as unknown as HTMLElement,
      image as unknown as HTMLImageElement,
      { x: 0.25, y: 0, width: 0.5, height: 1 },
      'contain',
    );
    expect(image.style).toMatchObject({
      left: '0px',
      top: '0px',
      width: '200px',
      height: '100px',
      clipPath: 'inset(0% 25% 0% 25%)',
    });
    expect(container.style.overflow).toBe('hidden');
    image.naturalWidth = 500;
    image.naturalHeight = 1000;
    image.dispatchEvent(new Event('load'));
    expect(image.style).toMatchObject({ left: '75px', width: '50px', height: '100px' });
    refreshCroppedImages(container as unknown as ParentNode);
    disposeCroppedImage(container as unknown as HTMLElement);
    expect(container.style.overflow).toBe('visible');
    image.naturalWidth = 1000;
    image.dispatchEvent(new Event('load'));
    expect(image.style.left).toBe('75px');
  });
});
