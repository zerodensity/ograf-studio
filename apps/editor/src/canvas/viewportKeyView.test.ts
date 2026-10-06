import { describe, expect, it } from 'vitest';
import { KEY_VIEW_COLOR_MATRIX, isKeyViewShortcut } from './viewportKeyView';

/** Applies an SVG feColorMatrix (4×5, row-major) to straight RGBA in 0..1. */
function applyColorMatrix(matrix: string, [r, g, b, a]: [number, number, number, number]) {
  const m = matrix.trim().split(/\s+/).map(Number);
  expect(m).toHaveLength(20);
  return [0, 1, 2, 3].map(
    (row) =>
      m[row * 5]! * r +
      m[row * 5 + 1]! * g +
      m[row * 5 + 2]! * b +
      m[row * 5 + 3]! * a +
      m[row * 5 + 4]!,
  );
}

describe('viewport key view', () => {
  it('renders alpha as opaque greyscale, ignoring colour', () => {
    expect(applyColorMatrix(KEY_VIEW_COLOR_MATRIX, [1, 0, 0, 1])).toEqual([1, 1, 1, 1]);
    expect(applyColorMatrix(KEY_VIEW_COLOR_MATRIX, [0.2, 0.4, 0.9, 0.5])).toEqual([
      0.5, 0.5, 0.5, 1,
    ]);
    expect(applyColorMatrix(KEY_VIEW_COLOR_MATRIX, [0, 0, 0, 0])).toEqual([0, 0, 0, 1]);
  });

  it('toggles with a plain K press only', () => {
    const press = (modifiers: Record<string, boolean> = {}, code = 'KeyK') => ({
      code,
      shiftKey: modifiers.shift ?? false,
      ctrlKey: modifiers.ctrl ?? false,
      metaKey: modifiers.meta ?? false,
      altKey: modifiers.alt ?? false,
      repeat: modifiers.repeat ?? false,
    });
    expect(isKeyViewShortcut(press())).toBe(true);
    expect(isKeyViewShortcut(press({ shift: true }))).toBe(false);
    expect(isKeyViewShortcut(press({ meta: true }))).toBe(false);
    expect(isKeyViewShortcut(press({ ctrl: true }))).toBe(false);
    expect(isKeyViewShortcut(press({ alt: true }))).toBe(false);
    expect(isKeyViewShortcut(press({ repeat: true }))).toBe(false);
    expect(isKeyViewShortcut(press({}, 'KeyL'))).toBe(false);
  });
});
