import { describe, expect, it } from 'vitest';
import { alphaToKeyPixels, snapshotFileName, snapshotMatte } from './frameSnapshot';

describe('frame snapshot', () => {
  it('names files after the project and zero-padded frame', () => {
    expect(snapshotFileName('Previsão do Tempo', 45)).toBe('previsao-do-tempo_f045.png');
    expect(snapshotFileName('Previsão do Tempo', 45, 'key')).toBe('previsao-do-tempo_f045_key.png');
    expect(snapshotFileName('  ', 7, 'fill')).toBe('ograf-frame_f007_fill.png');
    expect(snapshotFileName('Lower Third', 1234)).toBe('lower-third_f1234.png');
  });

  it('maps each snapshot kind to a capture matte', () => {
    expect(snapshotMatte('alpha')).toBe('transparent');
    expect(snapshotMatte('checker')).toBe('checker');
    expect(snapshotMatte('black')).toBe('#000000');
  });

  it('turns alpha into an opaque greyscale key without touching the input', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 128, 10, 20, 30, 0, 9, 9, 9, 255]);
    const key = alphaToKeyPixels(rgba);
    expect([...key]).toEqual([128, 128, 128, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    expect([...rgba]).toEqual([255, 0, 0, 128, 10, 20, 30, 0, 9, 9, 9, 255]);
  });
});
