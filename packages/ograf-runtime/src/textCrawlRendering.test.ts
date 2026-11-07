import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextElement, normalizeTextCrawl } from '@ograf-editor/scene-model';
import { renderAnimatedElementAtTime } from './renderElement';
import { renderTextAnimationAtFrame, setTextAnimationPrevious } from './textAnimationRendering';
import {
  disposeTextCrawl,
  mountTextCrawl,
  renderTextCrawlAtTime,
  textCrawlPaintTargets,
} from './textCrawlRendering';

class Node {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: Node[] = [];
  parent?: Node;
  textContent = '';
  attributes: Record<string, string> = {};
  offsetWidth = 1172;
  scrollWidth = 1172;
  clientWidth = 1494;
  ownerDocument = { createElement: () => new Node() };
  get parentElement(): Node | null {
    return this.parent ?? null;
  }
  append(value: string | Node) {
    if (typeof value === 'string') this.textContent += value;
    else this.appendChild(value);
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  appendChild(child: Node) {
    this.children.push(child);
    child.parent = this;
    return child;
  }
  replaceChildren(...children: Node[]) {
    this.children = [];
    this.textContent = '';
    for (const child of children) this.appendChild(child);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }
  cloneNode() {
    const result = new Node();
    result.style = { ...this.style };
    result.dataset = { ...this.dataset };
    result.textContent = this.textContent;
    result.attributes = { ...this.attributes };
    result.ownerDocument = this.ownerDocument;
    result.offsetWidth = this.offsetWidth;
    result.scrollWidth = this.scrollWidth;
    for (const child of this.children) result.appendChild(child.cloneNode());
    return result;
  }
  querySelectorAll(selector: string): Node[] {
    if (selector.includes(',')) {
      return [
        ...new Set(selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()))),
      ];
    }
    const match = /^\[data-([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
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
const host = (node: Node) => node as unknown as HTMLElement;
afterEach(() => vi.unstubAllGlobals());

describe('mounted continuous text crawl', () => {
  it('repeats measured glyphs, retains paint/stroke, and samples backwards without history', () => {
    const container = new Node(),
      content = new Node();
    Object.assign(content.style, {
      background: 'linear-gradient(red,blue)',
      backgroundClip: 'text',
      webkitTextStrokeWidth: '2px',
    });
    container.appendChild(content);
    const element = createTextElement({ content: 'THE NEWS', crawl: normalizeTextCrawl({}) });
    mountTextCrawl(host(container), host(content), element);
    const copies = textCrawlPaintTargets(host(container))!;
    expect(copies).toHaveLength(4);
    expect(copies[0]!.style.background).toBe('linear-gradient(red,blue)');
    expect(copies[0]!.style.webkitTextStrokeWidth).toBe('2px');
    expect(content.style.background).toBe('none');
    expect(content.dataset.ografTextCrawlPeriod).toBe('1244');
    const track = content.children[0]!;
    renderTextCrawlAtTime(host(container), 1000);
    expect(track.style.transform).toBe('translateX(-140px)');
    renderTextCrawlAtTime(host(container), 100000);
    renderTextCrawlAtTime(host(container), 1000);
    expect(track.style.transform).toBe('translateX(-140px)');
    disposeTextCrawl(host(container));
    expect(textCrawlPaintTargets(host(container))).toBeUndefined();
    renderTextCrawlAtTime(host(container), 2000);
    expect(track.style.transform).toBe('translateX(-140px)');
  });
  it('fills the current box after short operator data replaces long data', () => {
    const container = new Node(),
      content = new Node();
    content.offsetWidth = content.scrollWidth = 26;
    container.appendChild(content);
    mountTextCrawl(
      host(container),
      host(content),
      createTextElement({ content: 'A', crawl: normalizeTextCrawl({}) }),
    );
    expect(content.dataset.ografTextCrawlPeriod).toBe('98');
    expect(textCrawlPaintTargets(host(container))).toHaveLength(18);
  });
  it('does not multiply empty text into hundreds of nodes', () => {
    const container = new Node(),
      content = new Node();
    container.appendChild(content);
    mountTextCrawl(
      host(container),
      host(content),
      createTextElement({ content: '', crawl: normalizeTextCrawl({}) }),
    );
    expect(textCrawlPaintTargets(host(container))).toHaveLength(1);
    expect(content.dataset.ografTextCrawlPeriod).toBe('0');
  });
  it('keeps fractional CSS repeat width instead of rounding the seam to whole pixels', () => {
    const container = new Node(),
      content = new Node();
    content.ownerDocument = {
      ...content.ownerDocument,
      defaultView: { getComputedStyle: () => ({ width: '1171.625px' }) },
    } as typeof content.ownerDocument;
    container.appendChild(content);
    mountTextCrawl(
      host(container),
      host(content),
      createTextElement({ content: 'THE NEWS', crawl: normalizeTextCrawl({}) }),
    );
    expect(content.dataset.ografTextCrawlPeriod).toBe('1243.625');
    renderTextCrawlAtTime(host(container), (1243.625 / 140) * 1000);
    expect(Number.parseFloat(content.children[0]!.style.transform!.slice(11))).toBeCloseTo(0);
  });
  it('keeps action/data replay frames independent from continuous travel and deterministic seeks', () => {
    const container = new Node(),
      content = new Node();
    container.appendChild(content);
    const element = createTextElement({ content: 'A', crawl: normalizeTextCrawl({}) });
    element.textAnimation = { ...element.textAnimation, type: 'flip', durationFrames: 20 };
    mountTextCrawl(host(container), host(content), element);
    const glyph = () => container.querySelector('[data-ograf-text-segment]')!;
    const sample = (frame: number, time: number) => {
      container.dataset.ografTextAnimationFrame = String(frame);
      renderAnimatedElementAtTime(host(container), element, time);
      return { ...glyph().style };
    };
    const halfway = sample(10, 10000);
    expect(halfway.opacity).toBe('0.875');
    expect(halfway.transform).toBe('rotateX(11.25deg)');
    expect(sample(0, 11000).opacity).toBe('0');
    expect(sample(20, 12000).opacity).toBe('1');
    expect(sample(10, 10000)).toEqual(halfway);
    delete container.dataset.ografTextAnimationFrame;
    renderAnimatedElementAtTime(host(container), element, 400);
    expect(glyph().style).toEqual(halfway);
  });
  it.each(['resize', 'font'] as const)(
    'new rolling copies retain their predecessor/frame when %s refreshes a paused crawl',
    (trigger) => {
      let resize: (() => void) | undefined;
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resize = callback;
          }
          observe() {}
          disconnect() {}
        },
      );
      const fontEvents = new EventTarget();
      const fonts = {
        ready: new Promise(() => undefined),
        addEventListener: fontEvents.addEventListener.bind(fontEvents),
        removeEventListener: fontEvents.removeEventListener.bind(fontEvents),
      };
      const container = new Node(),
        content = new Node();
      content.ownerDocument = { ...content.ownerDocument, fonts } as typeof content.ownerDocument;
      container.appendChild(content);
      const element = createTextElement({ content: '12', crawl: normalizeTextCrawl({}) });
      element.textAnimation = { ...element.textAnimation, type: 'roll-down', durationFrames: 20 };
      mountTextCrawl(host(container), host(content), element);
      setTextAnimationPrevious(host(container), { ...element, content: '11' });
      renderTextAnimationAtFrame(host(container), element, 10);
      renderTextCrawlAtTime(host(container), 4000);
      const copies = textCrawlPaintTargets(host(container))!;
      const beforeCount = copies.length;
      const pose = (copy: HTMLElement) => {
        const node = copy as unknown as Node;
        return node.querySelectorAll('[data-ograf-text-roll-new]').map((row) => ({
          style: { ...row.style },
          text: row.children.map((child) => child.textContent).join(''),
        }));
      };
      const before = pose(copies[0]!);
      expect(before[0]!.style.transform).toBe('');
      expect(before[1]!.style.transform).toBe('translateY(-12.5%)');
      if (trigger === 'resize') container.clientWidth = 5000;
      else {
        const first = copies[0] as unknown as Node;
        first.offsetWidth = first.scrollWidth = 100;
      }
      if (trigger === 'resize') resize!();
      else fontEvents.dispatchEvent(new Event('loadingdone'));
      expect(copies.length).toBeGreaterThan(beforeCount);
      for (const copy of copies) expect(pose(copy)).toEqual(before);
      const snapshot = {
        transform: content.children[0]!.style.transform,
        copies: copies.map(pose),
      };
      renderTextAnimationAtFrame(host(container), element, 20);
      renderTextCrawlAtTime(host(container), 10000);
      renderTextAnimationAtFrame(host(container), element, 10);
      renderTextCrawlAtTime(host(container), 4000);
      expect({ transform: content.children[0]!.style.transform, copies: copies.map(pose) }).toEqual(
        snapshot,
      );
      disposeTextCrawl(host(container));
    },
  );
});
