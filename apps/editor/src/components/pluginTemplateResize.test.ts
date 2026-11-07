import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE_DETAIL_WIDTH,
  MAX_TEMPLATE_DETAIL_WIDTH,
  MIN_TEMPLATE_GALLERY_WIDTH,
  TEMPLATE_SPLITTER_WIDTH,
  clampTemplateDetailWidth,
  draggedTemplateDetailWidth,
  keyedTemplateDetailWidth,
  storedTemplateDetailWidth,
  templateDetailBounds,
} from './pluginTemplateResize';

describe('shared plugin template column widths', () => {
  it('loads one safe pixel preference, rejecting corrupt, missing and unbounded values', () => {
    for (const raw of [null, '', '  ', 'NaN', 'Infinity', '{}'])
      expect(storedTemplateDetailWidth(raw)).toBe(DEFAULT_TEMPLATE_DETAIL_WIDTH);
    expect(storedTemplateDetailWidth('410')).toBe(410);
    expect(storedTemplateDetailWidth('120')).toBe(180);
    expect(storedTemplateDetailWidth('9000')).toBe(640);
  });

  it('caps the right column while reserving at least 160px for templates and the splitter', () => {
    expect(templateDetailBounds()).toEqual({ min: 180, max: MAX_TEMPLATE_DETAIL_WIDTH });
    expect(templateDetailBounds(800)).toEqual({ min: 180, max: 632 });
    expect(clampTemplateDetailWidth(640, 800)).toBe(632);
    expect(clampTemplateDetailWidth(100, 800)).toBe(180);
    expect(clampTemplateDetailWidth(640, 1000)).toBe(640);
    expect(clampTemplateDetailWidth(640, 800.5)).toBe(632);
    expect(800 - clampTemplateDetailWidth(640, 800) - TEMPLATE_SPLITTER_WIDTH).toBe(
      MIN_TEMPLATE_GALLERY_WIDTH,
    );
    expect(clampTemplateDetailWidth(320, 320)).toBe(180); // Narrow mode stacks instead of forcing columns.
  });

  it('dragging left expands details and right shrinks them within current container bounds', () => {
    expect(draggedTemplateDetailWidth(320, -60, 1000)).toBe(380);
    expect(draggedTemplateDetailWidth(320, 60, 1000)).toBe(260);
    expect(draggedTemplateDetailWidth(320, -1000, 800)).toBe(632);
    expect(draggedTemplateDetailWidth(320, 1000, 1000)).toBe(180);
  });

  it('supports arrow/fast-arrow adjustment and bounded Home/End without consuming unrelated keys', () => {
    expect(keyedTemplateDetailWidth(320, 'ArrowLeft', false, 1000)).toBe(330);
    expect(keyedTemplateDetailWidth(320, 'ArrowRight', false, 1000)).toBe(310);
    expect(keyedTemplateDetailWidth(320, 'ArrowLeft', true, 1000)).toBe(370);
    expect(keyedTemplateDetailWidth(320, 'ArrowRight', true, 1000)).toBe(270);
    expect(keyedTemplateDetailWidth(620, 'ArrowLeft', true, 800)).toBe(632);
    expect(keyedTemplateDetailWidth(185, 'ArrowRight', true, 1000)).toBe(180);
    expect(keyedTemplateDetailWidth(320, 'Home', false, 1000)).toBe(180);
    expect(keyedTemplateDetailWidth(320, 'End', false, 800)).toBe(632);
    expect(keyedTemplateDetailWidth(320, 'Enter', false, 1000)).toBeUndefined();
  });
});
