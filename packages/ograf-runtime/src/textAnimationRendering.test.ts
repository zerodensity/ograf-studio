import { describe, expect, it } from 'vitest';
import {
  createDefaultGradient,
  createShaderElement,
  createTextElement,
  sampleTextCountAnimation,
  sampleTextCountRoll,
  type TextAnimation,
} from '@ograf-editor/scene-model';
import {
  measureTextAnimationLayout,
  applyTextAnimationGradient,
  mountTextAnimationContent,
  renderTextAnimationAtFrame,
  setTextAnimationPrevious,
  updatePathCountGlyphs,
} from './textAnimationRendering';

describe('count path glyph updates', () => {
  it('keeps existing nodes when grapheme counts are stable and signals structural changes', () => {
    const glyphs = ['1', '2', '3'].map((text) => ({
      dataset: { ografTextPathGlyph: 'true' },
      textContent: text,
    }));
    const node = {
      dataset: { ografCountPath: 'true' },
      children: glyphs,
    } as unknown as HTMLElement;
    expect(updatePathCountGlyphs(node, '456', '')).toBe(true);
    expect(glyphs.map((glyph) => glyph.textContent)).toEqual(['4', '5', '6']);
    expect(updatePathCountGlyphs(node, '1234', '')).toBe(false);
  });
});

class TextNode {
  style = {} as CSSStyleDeclaration;
  dataset: Record<string, string> = {};
  children: TextNode[] = [];
  textContent = '';
  ownerDocument = { createElement: () => new TextNode() };
  attributes: Record<string, string> = {};

  appendChild(child: TextNode) {
    this.children.push(child);
    return child;
  }

  append(value: string) {
    this.textContent += value;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  replaceChildren() {
    this.children = [];
    this.textContent = '';
  }

  querySelectorAll(selector: string): TextNode[] {
    if (selector.includes(',')) {
      return [
        ...new Set(selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()))),
      ];
    }
    const match = /^\[data-([^=\]]+)(?:="([^"]*)")?\](?::not\(.*\))?$/.exec(selector);
    if (!match) throw new Error(`Unsupported selector ${selector}`);
    const key = match[1]!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return this.children.flatMap((child) => [
      ...(key in child.dataset && (match[2] === undefined || child.dataset[key] === match[2])
        ? [child]
        : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function textContents(node: TextNode, visibleOnly = false): string {
  if (visibleOnly && (node.style.visibility === 'hidden' || node.style.display === 'none'))
    return '';
  return node.textContent + node.children.map((child) => textContents(child, visibleOnly)).join('');
}

const newEffects = ['flip', 'blur', 'rotate', 'stretch'] as const;

function fixture(type: TextAnimation['type'], paint: 'gradient' | 'shader', content = 'A') {
  const node = new TextNode();
  const host = node as unknown as HTMLElement;
  const element = createTextElement({
    content,
    fill: paint === 'gradient' ? createDefaultGradient() : createShaderElement(),
  });
  element.textAnimation = { ...element.textAnimation, type, durationFrames: 20, cursor: 'none' };
  mountTextAnimationContent(host, element);
  const segments = node.querySelectorAll('[data-ograf-text-segment]');
  const sample = (frame: number) => {
    renderTextAnimationAtFrame(host, element, frame);
    return segments.map((segment) => ({ ...segment.style }));
  };
  return { node, host, element, segments, sample };
}

describe.each(['gradient', 'shader'] as const)('%s text entrance sampling', (paint) => {
  it.each(newEffects)(
    'keeps %s deterministic through completion, backward seeks and replay',
    (type) => {
      const { sample, segments, node } = fixture(type, paint);
      const original = segments[0];
      expect(sample(0)[0]!.opacity).toBe('0');
      const halfway = sample(10)[0]!;
      expect(halfway.opacity).toBe('0.875');
      expect(halfway.visibility).toBe('inherit');
      const expected = {
        flip: { transform: 'rotateX(11.25deg)', filter: '', backfaceVisibility: 'hidden' },
        blur: { transform: '', filter: 'blur(1px)', backfaceVisibility: '' },
        rotate: { transform: 'rotate(-11.25deg)', filter: '', backfaceVisibility: '' },
        stretch: { transform: 'scaleX(0.89375)', filter: '', backfaceVisibility: '' },
      }[type];
      expect(halfway).toMatchObject(expected);
      expect(sample(20)[0]).toMatchObject({
        opacity: '1',
        transform: '',
        filter: '',
        transformOrigin: '',
        backfaceVisibility: '',
      });
      expect(sample(100)[0]).toEqual(sample(20)[0]);
      expect(sample(10)[0]).toEqual(halfway);
      expect(sample(0)[0]!.opacity).toBe('0');
      expect(node.querySelector('[data-ograf-text-segment]')).toBe(original);
    },
  );

  it.each(newEffects)('preserves grapheme count and staggered glyph layout for %s', (type) => {
    const { sample, segments } = fixture(type, paint, 'Ae\u0301😀');
    expect(segments.map((segment) => segment.textContent)).toEqual(['A', 'é', '😀']);
    expect(sample(10).map((style) => style.opacity)).toEqual(['1', '0.875', '0']);
    expect(sample(20).map((style) => style.opacity)).toEqual(['1', '1', '1']);
    expect(sample(0).map((style) => style.opacity)).toEqual(['0', '0', '0']);
  });

  it('clears the previous effect filter and transform when sampling another effect', () => {
    const { host, element, sample, segments } = fixture('blur', paint);
    sample(10);
    expect(segments[0]!.style.filter).toBe('blur(1px)');
    element.textAnimation.type = 'flip';
    renderTextAnimationAtFrame(host, element, 10);
    expect(segments[0]!.style.filter).toBe('');
    expect(segments[0]!.style.transform).toBe('rotateX(11.25deg)');
    element.textAnimation.type = 'blur';
    renderTextAnimationAtFrame(host, element, 10);
    expect(segments[0]!.style.transform).toBe('');
    expect(segments[0]!.style.backfaceVisibility).toBe('');
  });
});

describe('stable text layout measurement', () => {
  it.each([...newEffects, 'word-reveal'] as const)(
    'temporarily removes %s transforms and restores the sampled pose',
    (type) => {
      const { host, node, sample } = fixture(type, 'gradient', 'AB');
      sample(5);
      node.style.transform = 'scale(0.8, 0.6)';
      const glyphs = node.querySelectorAll(
        '[data-ograf-text-segment], [data-ograf-text-segment-inner]',
      );
      const before = glyphs.map((glyph) => ({ ...glyph.style }));
      const result = { width: 120, height: 40 };
      expect(
        measureTextAnimationLayout(host, () => {
          glyphs.forEach((glyph, index) => {
            expect(glyph.style.transform).toBe('none');
            expect(glyph.style.opacity).toBe(before[index]!.opacity);
            expect(glyph.style.filter).toBe(before[index]!.filter);
            expect(glyph.style.visibility).toBe(before[index]!.visibility);
            expect(glyph.style.transformOrigin).toBe(before[index]!.transformOrigin);
          });
          expect(node.style.transform).toBe('scale(0.8, 0.6)');
          return result;
        }),
      ).toBe(result);
      expect(glyphs.map((glyph) => ({ ...glyph.style }))).toEqual(before);
    },
  );

  it.each([...newEffects, 'word-reveal'] as const)(
    'restores %s transforms when a native measurement throws',
    (type) => {
      const { host, node, sample } = fixture(type, 'shader', 'AB');
      sample(5);
      const glyphs = node.querySelectorAll(
        '[data-ograf-text-segment], [data-ograf-text-segment-inner]',
      );
      const before = glyphs.map((glyph) => ({ ...glyph.style }));
      const failure = new Error('Layout unavailable');
      expect(() =>
        measureTextAnimationLayout(host, () => {
          expect(glyphs.every((glyph) => glyph.style.transform === 'none')).toBe(true);
          throw failure;
        }),
      ).toThrow(failure);
      expect(glyphs.map((glyph) => ({ ...glyph.style }))).toEqual(before);
    },
  );

  it('measures unanimated content without changing its authored transform', () => {
    const node = new TextNode();
    node.style.transform = 'translateY(12px)';
    let calls = 0;
    expect(
      measureTextAnimationLayout(node as unknown as HTMLElement, () => {
        calls += 1;
        return 42;
      }),
    ).toBe(42);
    expect(calls).toBe(1);
    expect(node.style.transform).toBe('translateY(12px)');
  });
});

describe.each(['gradient', 'shader'] as const)('%s counting text rendering', (paint) => {
  it('retains per-character count slots when the starting value is wider than the target', () => {
    const node = new TextNode();
    Object.assign(node.ownerDocument, { createTreeWalker: () => ({ nextNode: () => null }) });
    const host = node as unknown as HTMLElement;
    const element = createTextElement({ content: '99' });
    element.textAnimation = {
      ...element.textAnimation,
      type: 'count-up',
      countFrom: -10000,
      durationFrames: 20,
      animators: [
        {
          id: 'a',
          enabled: true,
          unit: 'character',
          start: 0,
          end: 1,
          offset: 0,
          offsetKeyframes: [],
          shape: 'square',
          easing: 'linear',
          order: 'forward',
          seed: 1,
          durationFrames: 20,
          properties: { opacity: 0.5 },
        },
      ],
    };
    mountTextAnimationContent(host, element);
    const value = node.querySelector('[data-ograf-text-count-value]')!;
    const parts = value.querySelectorAll('[data-ograf-text-count-part]');
    expect(parts).toHaveLength(6);
    for (const frame of [0, 10, 20, 0]) {
      renderTextAnimationAtFrame(host, element, frame);
      expect(textContents(value)).toBe(
        sampleTextCountAnimation('99', element.textAnimation, frame),
      );
      expect(value.querySelectorAll('[data-ograf-text-count-part]')).toEqual(parts);
    }
  });
  it.each(['count-up', 'count-down'] as const)(
    'updates %s without replacing its paint host and restores exact authored text',
    (type) => {
      const source = 'Total: 1,250.00 pts';
      const { host, element, node } = fixture(type, paint, source);
      const flow = node.querySelector('[data-ograf-text-flow]')!;
      const value = flow.querySelector('[data-ograf-text-count-value]')!;
      const spacer = flow.querySelector('[data-ograf-text-count-spacer]')!;
      const originalChildren = [...value.children];
      element.textAnimation.countFrom = type === 'count-up' ? 0 : 2500;
      const sample = (frame: number) => {
        renderTextAnimationAtFrame(host, element, frame);
        return textContents(flow, true);
      };
      expect(sample(0)).toBe(sampleTextCountAnimation(source, element.textAnimation, 0));
      const halfway = sample(10);
      expect(halfway).toBe(sampleTextCountAnimation(source, element.textAnimation, 10));
      expect(halfway).not.toBe(source);
      expect(sample(20)).toBe(source);
      expect(sample(100)).toBe(source);
      expect(sample(10)).toBe(halfway);
      expect(sample(0)).toBe(sampleTextCountAnimation(source, element.textAnimation, 0));
      expect(flow.querySelector('[data-ograf-text-count-value]')).toBe(value);
      expect(value.children).toEqual(originalChildren);
      expect(value.style.opacity).toBe('1');
      expect(value.style.position).toBe('absolute');
      expect(textContents(spacer)).toBe(source);
      expect(spacer.style.visibility).toBe('hidden');
      expect(node.attributes['aria-label']).toBe(source);
    },
  );

  it('keeps nonnumeric text fully visible', () => {
    const { host, element, node } = fixture('count-up', paint, 'BREAKING NEWS');
    renderTextAnimationAtFrame(host, element, 0);
    expect(textContents(node, true)).toBe('BREAKING NEWS');
    expect(node.querySelector('[data-ograf-text-count-value]')).toBeNull();
    expect(node.querySelector('[data-ograf-text-segment]')!.style.opacity).toBe('1');
  });

  it('measures only the authored spacer and restores the sampled count even after an error', () => {
    const { host, element, node } = fixture('count-down', paint, '12');
    element.textAnimation.countFrom = 100000;
    renderTextAnimationAtFrame(host, element, 0);
    const value = node.querySelector('[data-ograf-text-count-value]')!;
    const spacer = node.querySelector('[data-ograf-text-count-spacer]')!;
    const before = textContents(value);
    expect(() =>
      measureTextAnimationLayout(host, () => {
        expect(value.style.display).toBe('none');
        expect(spacer.style.display).toBe('block');
        expect(textContents(spacer)).toBe('12');
        throw new Error('Measurement interrupted');
      }),
    ).toThrow('Measurement interrupted');
    expect(value.style.display).toBe('block');
    expect(textContents(value)).toBe(before);
  });

  it('retains prefix, suffix and numeric run typography while the count changes width', () => {
    const node = new TextNode();
    const host = node as unknown as HTMLElement;
    const element = createTextElement({
      content: '$123.00 USD',
      runs: [
        { text: '$', fontStyle: 'italic' },
        { text: '123', fontWeight: 800 },
        { text: '.00', fontWeight: 400 },
        { text: ' USD', fontFamily: 'Serif' },
      ],
      fill: paint === 'gradient' ? createDefaultGradient() : createShaderElement(),
    });
    element.textAnimation = {
      ...element.textAnimation,
      type: 'count-up',
      countFrom: 0,
      durationFrames: 20,
    };
    mountTextAnimationContent(host, element);
    const value = node.querySelector('[data-ograf-text-count-value]')!;
    expect(value.children[0]!.children[0]!.style.fontStyle).toBe('italic');
    expect(value.children[1]!.style.fontWeight).toBe('800');
    expect(value.children[2]!.style.fontWeight).toBe('400');
    expect(value.children[3]!.children[0]!.style.fontFamily).toBe('Serif');
    renderTextAnimationAtFrame(host, element, 0);
    expect(textContents(value)).toBe('$0.00 USD');
    expect(value.children[1]!.textContent).toBe('0');
    expect(value.children[2]!.textContent).toBe('.00');
    renderTextAnimationAtFrame(host, element, 20);
    expect(textContents(value)).toBe('$123.00 USD');
    expect(value.children[1]!.textContent).toBe('123');
  });
});

describe.each(['gradient', 'shader'] as const)('%s rolling text rendering', (paint) => {
  const rolling = (
    type: TextAnimation['type'],
    source: string,
    previous?: string,
    countRoll: TextAnimation['countRoll'] = 'none',
  ) => {
    const node = new TextNode();
    const host = node as unknown as HTMLElement;
    const element = createTextElement({
      content: source,
      fill: paint === 'gradient' ? createDefaultGradient() : createShaderElement(),
    });
    element.textAnimation = { ...element.textAnimation, type, durationFrames: 20, countRoll };
    mountTextAnimationContent(
      host,
      element,
      previous === undefined ? null : createTextElement({ content: previous }),
    );
    const slots = () =>
      node
        .querySelectorAll('[data-ograf-text-roll-slot]')
        .filter((slot) => slot.style.display !== 'none');
    const snapshot = (frame: number) => {
      renderTextAnimationAtFrame(host, element, frame);
      return slots().map((slot) => ({
        old: textContents(slot.querySelector('[data-ograf-text-roll-old]')!),
        incoming: textContents(slot.querySelector('[data-ograf-text-roll-new]')!),
        oldStyle: { ...slot.querySelector('[data-ograf-text-roll-old]')!.style },
        newStyle: { ...slot.querySelector('[data-ograf-text-roll-new]')!.style },
      }));
    };
    return { host, node, element, slots, snapshot };
  };

  it('places the paint again when a finished roll collapses the cells it emptied', () => {
    if (paint !== 'gradient') return;
    const { node, host, element, slots } = rolling('roll-up', '08:11 PM', '08:11:39 PM');
    Object.assign(node, { clientWidth: 400, clientHeight: 80, isConnected: true });
    Object.assign(node.querySelector('[data-ograf-text-flow="true"]')!, { parentElement: node });
    applyTextAnimationGradient(host, 'linear-gradient(red, blue)');
    const row = slots().at(-1)!.querySelector('[data-ograf-text-roll-new]')!;
    let layoutReads = 0;
    Object.defineProperty(row, 'offsetLeft', {
      get: () => {
        layoutReads += 1;
        return 0;
      },
    });
    renderTextAnimationAtFrame(host, element, 5);
    const midRoll = layoutReads;
    renderTextAnimationAtFrame(host, element, 6);
    expect(layoutReads).toBe(midRoll);
    renderTextAnimationAtFrame(host, element, 20);
    expect(layoutReads).toBeGreaterThan(midRoll);
  });

  it('lets a hidden layer hide its rolling digits', () => {
    // A forced `visible` row would paint through a hidden shared proxy or staged playout copy.
    const { snapshot } = rolling('roll-up', '12:59', '12:58');
    const rows = snapshot(10).flatMap((slot) => [slot.oldStyle, slot.newStyle]);
    expect(rows.some((style) => style.visibility === 'inherit')).toBe(true);
    expect(rows.every((style) => style.visibility !== 'visible')).toBe(true);
  });

  it.each(['roll-up', 'roll-down'] as const)('rolls only changed clock digits with %s', (type) => {
    const { snapshot, slots } = rolling(type, '12:59', '12:58');
    const start = snapshot(0);
    const direction = type === 'roll-up' ? 1 : -1;
    expect(start.map((slot) => slot.old).join('')).toBe('12:58');
    expect(start.map((slot) => slot.incoming).join('')).toBe('12:59');
    expect(
      start
        .slice(0, 4)
        .every((slot) => slot.newStyle.transform === '' && slot.oldStyle.visibility === 'hidden'),
    ).toBe(true);
    expect(start[4]!.oldStyle.transform).toBe('translateY(0%)');
    expect(start[4]!.newStyle.transform).toBe(`translateY(${direction * 100}%)`);
    const stableSlots = [...slots()];
    const halfway = snapshot(10);
    expect(halfway[4]!.oldStyle.transform).toBe(`translateY(${-direction * 87.5}%)`);
    expect(halfway[4]!.newStyle.transform).toBe(`translateY(${direction * 12.5}%)`);
    expect(
      snapshot(20).every(
        (slot) => slot.oldStyle.visibility === 'hidden' && slot.newStyle.transform === '',
      ),
    ).toBe(true);
    expect(snapshot(10)).toEqual(halfway);
    expect(slots()).toEqual(stableSlots);
    expect(slots().every((slot) => slot.style.overflow === 'hidden')).toBe(true);
  });

  it('aligns carries to the right while prefixes and suffixes stay still', () => {
    const { snapshot } = rolling('roll-up', '$10 pts', '$9 pts');
    const sample = snapshot(10);
    expect(sample.map((slot) => [slot.old, slot.incoming])).toEqual([
      ['$', '$'],
      ['', '1'],
      ['9', '0'],
      [' ', ' '],
      ['p', 'p'],
      ['t', 't'],
      ['s', 's'],
    ]);
    expect(sample[0]!.newStyle.transform).toBe('');
    expect(sample.slice(3).every((slot) => slot.newStyle.transform === '')).toBe(true);
  });

  it('releases removed leading cells when a shorter replacement finishes and restores them on seek', () => {
    const { snapshot } = rolling('roll-down', '$9 pts', '$10 pts');
    expect(
      snapshot(0)
        .map((slot) => slot.old)
        .join(''),
    ).toBe('$10 pts');
    expect(snapshot(20).map((slot) => slot.incoming)).toEqual(['$', '9', ' ', 'p', 't', 's']);
    expect(
      snapshot(0)
        .map((slot) => slot.old)
        .join(''),
    ).toBe('$10 pts');
  });

  it('starts from blank, supports explicit logical predecessors, and resets after backwards seeks', () => {
    const { host, snapshot, node } = rolling('roll-up', '42');
    expect(
      snapshot(0)
        .map((slot) => slot.old)
        .join(''),
    ).toBe('');
    expect(
      snapshot(20)
        .map((slot) => slot.incoming)
        .join(''),
    ).toBe('42');
    setTextAnimationPrevious(host, createTextElement({ content: '41' }));
    expect(
      snapshot(0)
        .map((slot) => slot.old)
        .join(''),
    ).toBe('41');
    const once = snapshot(5);
    setTextAnimationPrevious(host, createTextElement({ content: '41' }));
    expect(snapshot(5)).toEqual(once);
    setTextAnimationPrevious(host, createTextElement({ content: '42' }));
    expect(snapshot(0).every((slot) => slot.newStyle.transform === '')).toBe(true);
    setTextAnimationPrevious(host, null);
    expect(
      snapshot(0)
        .map((slot) => slot.old)
        .join(''),
    ).toBe('');
    const value = node.querySelector('[data-ograf-text-roll-value]')!;
    measureTextAnimationLayout(host, () => expect(value.style.display).toBe('none'));
    expect(value.style.display).toBe('block');
  });

  it.each(['up', 'down'] as const)(
    'samples count rolling %s independently of frame order',
    (countRoll) => {
      const { element, snapshot, slots } = rolling('count-up', '$10.00', undefined, countRoll);
      element.textAnimation.countFrom = 9;
      const expected = sampleTextCountRoll(element.content, element.textAnimation, 3)!;
      const sample = snapshot(3);
      expect(sample.map((slot) => slot.old).join('')).toBe(expected.from);
      expect(sample.map((slot) => slot.incoming).join('')).toBe(expected.to);
      const direction = countRoll === 'up' ? 1 : -1;
      const changed = sample.filter((slot) => slot.old !== slot.incoming);
      expect(changed.length).toBeGreaterThan(0);
      expect(changed[0]!.newStyle.transform).toBe(
        `translateY(${direction * (1 - expected.progress) * 100}%)`,
      );
      const originalSlots = [...slots()];
      expect(
        snapshot(20)
          .map((slot) => slot.incoming)
          .join(''),
      ).toBe('$10.00');
      expect(snapshot(3)).toEqual(sample);
      expect(slots()).toEqual(originalSlots);
    },
  );

  it('preserves multiline breaks as text flow rather than tall rolling cells', () => {
    const { snapshot, slots } = rolling('roll-up', 'A\nB', 'A\nC');
    snapshot(10);
    const lineBreak = slots()[1]!;
    expect(lineBreak.style.display).toBe('contents');
    expect(lineBreak.querySelector('[data-ograf-text-roll-new]')!.style).toMatchObject({
      display: 'inline',
      position: 'static',
      transform: '',
    });
  });

  it('clears retired count cells so complete DOM snapshots do not depend on the prior frame', () => {
    const { element, snapshot, node } = rolling('count-down', '99', undefined, 'down');
    element.textAnimation.countFrom = 100;
    const allSlots = () =>
      node.querySelectorAll('[data-ograf-text-roll-slot]').map((slot) => ({
        style: { ...slot.style },
        spacer: textContents(slot.querySelector('[data-ograf-text-roll-slot-spacer]')!),
        old: textContents(slot.querySelector('[data-ograf-text-roll-old]')!),
        incoming: textContents(slot.querySelector('[data-ograf-text-roll-new]')!),
        oldStyle: { ...slot.querySelector('[data-ograf-text-roll-old]')!.style },
        newStyle: { ...slot.querySelector('[data-ograf-text-roll-new]')!.style },
      }));
    snapshot(0);
    snapshot(20);
    const fromStart = allSlots();
    snapshot(10);
    snapshot(20);
    expect(allSlots()).toEqual(fromStart);
    const retired = fromStart.filter((slot) => slot.style.display === 'none');
    expect(retired).toHaveLength(1);
    expect(retired[0]).toMatchObject({
      spacer: '',
      old: '',
      incoming: '',
      oldStyle: { transform: '', visibility: 'hidden' },
      newStyle: { transform: '', visibility: 'hidden' },
    });
    expect(
      snapshot(0)
        .map((slot) => slot.old)
        .join(''),
    ).toBe('100');
  });
});
