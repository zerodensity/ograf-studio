import { describe, expect, it } from 'vitest';
import {
  createLayerOfKind,
  createProject,
  createTextElement,
  PROJECT_DOCUMENT_VERSION,
} from './factory';
import { migrateProject } from './migrations';
import {
  DEFAULT_TEXT_ANIMATION,
  normalizeTextAnimation,
  segmentTextAnimationUnits,
  textAnimationErrors,
  textAnimationSegmentProgress,
  textAnimationSegmentVisual,
  textAnimationSplit,
  textAnimationVisibleText,
  visibleTextAnimationSegmentCount,
} from './textAnimation';

describe('text animation model', () => {
  it('creates text with a disabled deterministic animation contract', () => {
    expect(createTextElement().textAnimation).toEqual(DEFAULT_TEXT_ANIMATION);
  });

  it('normalizes partial and invalid persisted values', () => {
    expect(
      normalizeTextAnimation({
        type: 'typewriter',
        split: 'word',
        durationFrames: 12.6,
        cursor: 'block',
        cursorBlinkFrames: 0,
        replayOnUpdate: true,
        customActionId: ' replay ',
      }),
    ).toEqual({
      type: 'typewriter',
      split: 'word',
      durationFrames: 13,
      cursor: 'block',
      cursorBlinkFrames: DEFAULT_TEXT_ANIMATION.cursorBlinkFrames,
      replayOnUpdate: true,
      customActionId: 'replay',
      countFrom: null,
      countRoll: 'none',
    });
  });

  it('migrates older text elements to the current contract', () => {
    const project = createProject();
    project.documentVersion = PROJECT_DOCUMENT_VERSION - 1;
    const text = createLayerOfKind('text');
    project.compositions[0]!.layers.push(text);
    if (text.element.type !== 'text') throw new Error('Expected text layer.');
    delete (text.element as Partial<typeof text.element>).textAnimation;

    const migrated = migrateProject(project);
    const migratedText = migrated.compositions[0]!.layers.find(
      (layer) => layer.element.type === 'text',
    );
    expect(migrated.documentVersion).toBe(PROJECT_DOCUMENT_VERSION);
    expect(migratedText?.element.type === 'text' && migratedText.element.textAnimation).toEqual(
      DEFAULT_TEXT_ANIMATION,
    );
  });

  it('keeps emoji sequences and combining marks together as graphemes', () => {
    expect(
      segmentTextAnimationUnits('A👨‍👩‍👧‍👦e\u0301', 'grapheme').map((segment) => segment.text),
    ).toEqual(['A', '👨‍👩‍👧‍👦', 'é']);
  });

  it('preserves whitespace and explicit line breaks in word mode', () => {
    expect(
      segmentTextAnimationUnits('Hello world\nAgain', 'word').map((segment) => segment.text),
    ).toEqual(['Hello', ' ', 'world', '\n', 'Again']);
  });

  it('samples a deterministic visible prefix at any frame', () => {
    expect(visibleTextAnimationSegmentCount(10, -1, 20)).toBe(0);
    expect(visibleTextAnimationSegmentCount(10, 10, 20)).toBe(5);
    expect(visibleTextAnimationSegmentCount(10, 200, 20)).toBe(10);
    const element = createTextElement({
      content: 'ABCD',
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        type: 'typewriter',
        durationFrames: 20,
      },
    });
    expect(textAnimationVisibleText(element, 10)).toBe('AB');
  });

  it('keeps every entrance preset available through normalization', () => {
    for (const type of [
      'fade',
      'rise',
      'pop',
      'word-reveal',
      'flip',
      'blur',
      'rotate',
      'stretch',
      'roll-up',
      'roll-down',
    ] as const) {
      expect(normalizeTextAnimation({ type }).type).toBe(type);
      expect(textAnimationErrors({ type })).toEqual([]);
    }
    expect(textAnimationSplit(normalizeTextAnimation({ type: 'word-reveal' }))).toBe('word');
  });

  it.each([
    ['flip', 'rotateXDeg', 90, 11.25, 0],
    ['blur', 'blurPx', 8, 1, 0],
    ['rotate', 'rotateDeg', -90, -11.25, 0],
    ['stretch', 'scaleX', 0.15, 0.89375, 1],
  ] as const)(
    'samples %s entrance at start, midpoint, completion and backward seeks',
    (type, property, start, midpoint, complete) => {
      const sample = (frame: number) =>
        textAnimationSegmentVisual(type, textAnimationSegmentProgress(0, 1, frame, 20));
      expect(sample(-10).opacity).toBe(0);
      expect(sample(0)[property]).toBeCloseTo(start);
      const halfway = sample(10);
      expect(halfway[property]).toBeCloseTo(midpoint);
      expect(halfway.opacity).toBe(0.875);
      expect(sample(20)[property]).toBeCloseTo(complete);
      expect(sample(200).opacity).toBe(1);
      expect(sample(10)).toEqual(halfway);
      expect(sample(0)[property]).toBeCloseTo(start);
    },
  );

  it('rejects unknown effects and invalid timing without rejecting partial older options', () => {
    expect(textAnimationErrors(undefined)).toEqual([]);
    expect(textAnimationErrors({ type: 'flip', replayOnUpdate: true })).toEqual([]);
    expect(textAnimationErrors({ type: 'missing' })).toContain(
      'Text animation type is unsupported.',
    );
    expect(textAnimationErrors({ type: 'blur', durationFrames: 0 })).toContain(
      'Text animation durationFrames must be a positive frame count.',
    );
  });

  it('stagger samples identically after forward and backward seeks', () => {
    const sample = (frame: number) =>
      Array.from({ length: 5 }, (_, index) => textAnimationSegmentProgress(index, 5, frame, 20));
    const halfway = sample(10);
    expect(halfway[0]).toBe(1);
    expect(halfway[4]).toBe(0);
    expect(sample(20)).toEqual([1, 1, 1, 1, 1]);
    expect(sample(0)).toEqual([0, 0, 0, 0, 0]);
    expect(sample(10)).toEqual(halfway);
  });

  it('gives Fade, Rise, Pop, and Word reveal distinct midpoint motion', () => {
    const fade = textAnimationSegmentVisual('fade', 0.5);
    const rise = textAnimationSegmentVisual('rise', 0.5);
    const pop = textAnimationSegmentVisual('pop', 0.5);
    const words = textAnimationSegmentVisual('word-reveal', 0.5);
    expect(fade).toEqual({ opacity: 0.875, translateYEm: 0, scale: 1 });
    expect(rise.translateYEm).toBeGreaterThan(0);
    expect(words.translateYEm).toBeGreaterThan(rise.translateYEm);
    expect(pop.scale).toBeGreaterThan(1);
    for (const type of ['fade', 'rise', 'pop', 'word-reveal'] as const) {
      expect(textAnimationSegmentVisual(type, 0).opacity).toBe(0);
      expect(textAnimationSegmentVisual(type, 1)).toEqual({
        opacity: 1,
        translateYEm: 0,
        scale: 1,
      });
    }
  });
});
