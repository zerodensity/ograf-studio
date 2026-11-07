import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposition, createLayerOfKind } from '@ograf-editor/scene-model';
import { editableSvgLayers } from './editableSvgImport';

class TestElement {
  children: TestElement[] = [];
  textContent = '';
  localName: string;
  private values: Record<string, string>;
  constructor(localName: string, values: Record<string, string> = {}) {
    this.localName = localName;
    this.values = values;
  }
  get attributes() {
    return Object.entries(this.values).map(([name, value]) => ({ name, value }));
  }
  getAttribute(name: string) {
    return this.values[name] ?? null;
  }
  hasAttribute(name: string) {
    return Object.hasOwn(this.values, name);
  }
}

function useDocument(root: TestElement) {
  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return { documentElement: root, querySelector: () => null };
      }
    },
  );
}

describe('editable SVG import', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps nested editable artwork in the selectable outer group without changing transforms', () => {
    const root = new TestElement('svg', { viewBox: '0 0 200 100' });
    const outer = new TestElement('g', { id: 'outer', transform: 'translate(10 20)' });
    const inner = new TestElement('g', { id: 'inner', transform: 'translate(5 4)' });
    const a = new TestElement('rect', { id: 'a', x: '1', y: '2', width: '5', height: '6' });
    const b = new TestElement('rect', { id: 'b', x: '3', y: '7', width: '8', height: '9' });
    inner.children = [b];
    outer.children = [a, inner];
    root.children = [outer];
    useDocument(root);
    const layers = editableSvgLayers('<svg/>', createComposition());
    expect(layers).toHaveLength(2);
    expect(layers[0]!.groupId).toBeTruthy();
    expect(layers[1]!.groupId).toBe(layers[0]!.groupId);
    expect(layers[0]!.keyframes[0]!.transform).toMatchObject({ x: 11, y: 22, width: 5, height: 6 });
    expect(layers[1]!.keyframes[0]!.transform).toMatchObject({ x: 18, y: 31, width: 8, height: 9 });
  });
  it('keeps an unsupported nested item in its outer group as an explicit image fallback', () => {
    const root = new TestElement('svg', { viewBox: '0 0 100 100' });
    const outer = new TestElement('g', { id: 'outer' }),
      inner = new TestElement('g', { id: 'inner' });
    const ordinary = new TestElement('rect', { id: 'ordinary', width: '10', height: '10' });
    const unsupported = new TestElement('rect', {
      id: 'effect',
      width: '10',
      height: '10',
      filter: 'url(#blur)',
    });
    inner.children = [unsupported];
    outer.children = [ordinary, inner];
    root.children = [outer];
    useDocument(root);
    const fallbackLayer = createLayerOfKind('image');
    const fallback = vi.fn(() => fallbackLayer);
    const layers = editableSvgLayers('<svg/>', createComposition(), fallback);
    expect(layers).toHaveLength(2);
    expect(layers[1]!.element.type).toBe('image');
    expect(layers[1]!.groupId).toBe(layers[0]!.groupId);
    expect(fallback).toHaveBeenCalledWith(
      unsupported,
      [root, outer, inner],
      expect.stringMatching(/filter/),
    );
  });

  it('places SVG text using the measured CSS baseline and caches repeated metrics', () => {
    const root = new TestElement('svg', { viewBox: '0 0 200 100' });
    root.children = [
      new TestElement('text', { x: '20', y: '50', 'font-size': '20', 'font-family': 'Arial' }),
      new TestElement('text', { x: '20', y: '75', 'font-size': '20', 'font-family': 'Arial' }),
    ];
    root.children[0]!.textContent = 'Headline';
    root.children[1]!.textContent = 'Second';
    useDocument(root);
    const measure = vi.fn(() => 18);
    const layers = editableSvgLayers('<svg/>', createComposition(), undefined, measure);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(layers[0]?.keyframes[0]?.transform).toMatchObject({ x: 20, y: 32, height: 24 });
    expect(layers[1]?.keyframes[0]?.transform.y).toBe(57);
  });

  it('uses an explicit image fallback if font metrics are unavailable', () => {
    const root = new TestElement('svg', { viewBox: '0 0 200 100' });
    root.children = [new TestElement('text', { id: 'missing-font', x: '20', y: '50' })];
    useDocument(root);
    const fallbackLayer = createLayerOfKind('image');
    const fallback = vi.fn(() => fallbackLayer);
    expect(editableSvgLayers('<svg/>', createComposition(), fallback, () => null)).toEqual([
      fallbackLayer,
    ]);
    expect(fallback).toHaveBeenCalledWith(
      root.children[0],
      [root],
      expect.stringMatching(/baseline cannot be measured/),
    );
  });

  it('converts thirty named shapes into editable, initially visible layers', () => {
    const root = new TestElement('svg', { viewBox: '0 0 200 100' });
    root.children = Array.from(
      { length: 30 },
      (_, i) =>
        new TestElement('rect', {
          id: `shape-${i}`,
          x: String(i * 5),
          y: '10',
          width: '4',
          height: '12',
          fill: '#ff0000',
        }),
    );
    useDocument(root);
    const layers = editableSvgLayers('<svg/>', createComposition());
    expect(layers).toHaveLength(30);
    expect(layers[0]?.name).toBe('shape-0');
    expect(layers[0]?.element).toMatchObject({ type: 'rectangle', fill: '#ff0000' });
    expect(layers[0]?.keyframes[0]?.transform).toMatchObject({
      x: 0,
      y: 10,
      width: 4,
      height: 12,
      opacity: 1,
    });
  });

  it('rejects unsupported visual effects before creating layers', () => {
    const root = new TestElement('svg', { viewBox: '0 0 100 100' });
    root.children = [new TestElement('rect', { width: '10', height: '10', filter: 'url(#f)' })];
    useDocument(root);
    expect(() => editableSvgLayers('<svg/>', createComposition())).toThrow(/filter/);
  });

  it('rejects a viewport size that would silently scale the imported design', () => {
    const root = new TestElement('svg', { viewBox: '0 0 100 100', width: '200' });
    useDocument(root);
    expect(() => editableSvgLayers('<svg/>', createComposition())).toThrow(/viewport/);
  });

  it('maps a simple linear SVG gradient to editable paint stops', () => {
    const root = new TestElement('svg', { viewBox: '0 0 100 100' });
    const defs = new TestElement('defs');
    const gradient = new TestElement('linearGradient', { id: 'sky' });
    gradient.children = [
      new TestElement('stop', { offset: '0%', 'stop-color': '#000000' }),
      new TestElement('stop', { offset: '100%', 'stop-color': '#ffffff' }),
    ];
    defs.children = [gradient];
    root.children = [
      defs,
      new TestElement('rect', { width: '10', height: '20', fill: 'url(#sky)' }),
    ];
    useDocument(root);
    expect(editableSvgLayers('<svg/>', createComposition())[0]?.element).toMatchObject({
      fill: {
        type: 'linear',
        angle: 90,
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#ffffff' },
        ],
      },
    });
  });

  it('retains translated and rotated groups as editable shapes', () => {
    const root = new TestElement('svg', { viewBox: '0 0 100 100' });
    const group = new TestElement('g', { transform: 'translate(10 20) rotate(90)' });
    group.children = [new TestElement('rect', { x: '2', y: '3', width: '4', height: '6' })];
    root.children = [group];
    useDocument(root);
    const layer = editableSvgLayers('<svg/>', createComposition())[0]!;
    expect(layer.keyframes[0]?.transform).toMatchObject({
      x: 7,
      y: 22,
      width: 4,
      height: 6,
      rotation: 90,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    expect(layer.groupId).toBeTruthy();
  });

  it('uses an in-order fallback for an unsupported subtree and keeps siblings editable', () => {
    const root = new TestElement('svg', { viewBox: '0 0 100 100' });
    root.children = [
      new TestElement('rect', { id: 'first', width: '10', height: '10' }),
      new TestElement('rect', { id: 'filter', width: '10', height: '10', filter: 'url(#blur)' }),
      new TestElement('rect', { id: 'last', width: '10', height: '10' }),
    ];
    useDocument(root);
    const layers = editableSvgLayers('<svg/>', createComposition(), () =>
      createLayerOfKind('image'),
    );
    expect(layers.map((layer) => layer.element.type)).toEqual(['rectangle', 'image', 'rectangle']);
  });
});
