import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposition, createLayerOfKind } from '@ograf-editor/scene-model';
import { editableSvgLayers, SVG_NAMESPACE, XMLNS_NAMESPACE } from './editableSvgImport';
import { prepareEditableSvg } from './svgRasterFallback';

const inkscapeNamespace = 'http://www.inkscape.org/namespaces/inkscape';
const sodipodiNamespace = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd';
const xlinkNamespace = 'http://www.w3.org/1999/xlink';
const unrelatedNamespace = 'https://example.test/metadata';
const prefixes: Record<string, string> = {
  inkscape: inkscapeNamespace,
  editor: inkscapeNamespace,
  sodipodi: sodipodiNamespace,
  linked: xlinkNamespace,
};

class TestElement {
  children: TestElement[] = [];
  textContent = '';
  localName: string;
  namespaceURI: string | null;
  private values: Record<string, string>;
  constructor(
    localName: string,
    values: Record<string, string> = {},
    namespaceURI: string | null = SVG_NAMESPACE,
  ) {
    this.localName = localName;
    this.values = values;
    this.namespaceURI = namespaceURI;
  }
  get tagName() {
    return this.localName;
  }
  get attributes() {
    return Object.entries(this.values).map(([name, value]) => {
      const colon = name.indexOf(':');
      const prefix = colon < 0 ? '' : name.slice(0, colon);
      return {
        name,
        value,
        localName: name.slice(colon + 1),
        namespaceURI: name === 'xmlns' || prefix === 'xmlns' ? XMLNS_NAMESPACE : prefixes[prefix],
      };
    });
  }
  getAttribute(name: string) {
    return this.values[name] ?? null;
  }
  getAttributeNS(namespace: string, name: string) {
    return (
      this.attributes.find(
        (attribute) => attribute.namespaceURI === namespace && attribute.localName === name,
      )?.value ?? null
    );
  }
  hasAttribute(name: string) {
    return Object.hasOwn(this.values, name);
  }
  setAttribute(name: string, value: string) {
    this.values[name] = value;
  }
  appendChild(child: TestElement) {
    this.children.push(child);
  }
  cloneNode(deep: boolean): TestElement {
    const clone = new TestElement(this.localName, { ...this.values }, this.namespaceURI);
    if (deep) clone.children = this.children.map((child) => child.cloneNode(true));
    return clone;
  }
  querySelectorAll(selector: string): TestElement[] {
    return this.children.flatMap((child) => [
      ...(selector === '*' || child.localName === selector ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
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

  it('keeps layered Inkscape-style exports editable with namespace metadata and simple inline paints', async () => {
    const root = new TestElement('svg', {
      viewBox: '0 0 200 100',
      width: '200',
      height: '100',
      xmlns: SVG_NAMESPACE,
      'xmlns:svg': SVG_NAMESPACE,
      'xmlns:inkscape': inkscapeNamespace,
      'xmlns:editor': inkscapeNamespace,
      'xmlns:sodipodi': sodipodiNamespace,
      'inkscape:version': '1.4.2',
      'sodipodi:docname': 'graphic.svg',
    });
    const group = new TestElement('g', {
      id: 'layer1',
      'inkscape:groupmode': 'layer',
      'inkscape:label': 'Foreground',
    });
    group.children = [
      new TestElement('rect', {
        id: 'rect1',
        'editor:label': 'Plate',
        width: '40',
        height: '20',
        fill: 'red',
        style: 'fill:#003355;stroke-width:0.25',
      }),
      new TestElement('circle', {
        id: 'circle1',
        'data-name': 'Badge',
        cx: '30',
        cy: '20',
        r: '5',
        style: 'fill:#ffcc33',
      }),
    ];
    root.children = [new TestElement('namedview', { id: 'namedview1' }, sodipodiNamespace), group];
    useDocument(root);
    const { layers, warnings } = await prepareEditableSvg('<svg/>', createComposition());
    expect(warnings).toEqual([]);
    expect(layers.map((layer) => [layer.name, layer.element.type])).toEqual([
      ['Plate', 'rectangle'],
      ['Badge', 'ellipse'],
    ]);
    expect(layers[0]!.groupId).toBeTruthy();
    expect(layers[1]!.groupId).toBe(layers[0]!.groupId);
    expect(layers[0]!.element).toMatchObject({ fill: '#003355', strokeWidth: 0.25 });
  });

  it('preserves one unsupported subtree as a named fallback with its ancestor and definitions', async () => {
    const root = new TestElement('svg', {
      viewBox: '0 0 100 100',
      xmlns: SVG_NAMESPACE,
      'xmlns:inkscape': inkscapeNamespace,
    });
    const defs = new TestElement('defs');
    defs.children = [new TestElement('filter', { id: 'blur' })];
    const group = new TestElement('g', { id: 'layer1', 'inkscape:groupmode': 'layer' });
    group.children = [
      new TestElement('rect', { id: 'editable', width: '20', height: '20' }),
      new TestElement('rect', {
        id: 'effect',
        'inkscape:label': 'Blurred plate',
        width: '20',
        height: '20',
        filter: 'url(#blur)',
      }),
    ];
    root.children = [defs, group];
    useDocument(root);
    const serialize = vi.fn((_element: TestElement) => '<svg/>');
    vi.stubGlobal(
      'XMLSerializer',
      class {
        serializeToString = serialize;
      },
    );
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => 'data:image/png;base64,cG5n',
      }),
    });
    const { layers, warnings } = await prepareEditableSvg('<svg/>', createComposition());
    expect(layers.map((layer) => layer.element.type)).toEqual(['rectangle', 'image']);
    expect(layers[1]!.groupId).toBe(layers[0]!.groupId);
    expect(layers[1]!.name).toBe('Blurred plate (image fallback)');
    expect(warnings).toEqual([expect.stringMatching(/Blurred plate.*filter/)]);
    expect(serialize).toHaveBeenCalledOnce();
    const [fallback] = serialize.mock.calls[0]!;
    expect(fallback.children.map((element) => element.localName)).toEqual(['defs', 'g']);
    expect(fallback.children[0]!.children[0]!.getAttribute('id')).toBe('blur');
    expect(fallback.children[1]!.children.map((element) => element.getAttribute('id'))).toEqual([
      'effect',
    ]);
  });

  it('rejects foreign root namespaces before attempting editable or raster import', async () => {
    const root = new TestElement('svg', { viewBox: '0 0 100 100' }, unrelatedNamespace);
    useDocument(root);
    expect(() => editableSvgLayers('<svg/>', createComposition())).toThrow(/well-formed SVG/);
    await expect(prepareEditableSvg('<svg/>', createComposition())).rejects.toThrow(
      /well-formed SVG/,
    );
  });

  it('does not interpret foreign-namespace paint definitions as SVG gradients', () => {
    const root = new TestElement('svg', { viewBox: '0 0 100 100' });
    const defs = new TestElement('defs');
    const gradient = new TestElement('linearGradient', { id: 'foreign' }, unrelatedNamespace);
    gradient.children = [
      new TestElement('stop', { offset: '0', 'stop-color': '#000000' }),
      new TestElement('stop', { offset: '1', 'stop-color': '#ffffff' }),
    ];
    defs.children = [gradient];
    const rect = new TestElement('rect', { width: '10', height: '10', fill: 'url(#foreign)' });
    root.children = [defs, rect];
    useDocument(root);
    const fallback = vi.fn(() => createLayerOfKind('image'));
    const layers = editableSvgLayers('<svg/>', createComposition(), fallback);
    expect(layers.map((layer) => layer.element.type)).toEqual(['image']);
    expect(fallback).toHaveBeenCalledWith(
      rect,
      [root],
      expect.stringMatching(/unsupported gradient/),
    );
  });

  it('checks aliased hrefs and scripts even inside skipped authoring metadata', async () => {
    const root = new TestElement('svg', { viewBox: '0 0 100 100', 'xmlns:linked': xlinkNamespace });
    const namedview = new TestElement('namedview', {}, sodipodiNamespace);
    root.children = [namedview];
    useDocument(root);
    namedview.children = [
      new TestElement('image', { 'linked:href': 'https://example.test/art.png' }),
    ];
    await expect(prepareEditableSvg('<svg/>', createComposition())).rejects.toThrow(
      /external resources/,
    );
    namedview.children = [new TestElement('script')];
    await expect(prepareEditableSvg('<svg/>', createComposition())).rejects.toThrow(/scripts/);
  });

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

  it('keeps numeric SVG letter spacing editable and scales inherited pixel spacing with text', () => {
    const root = new TestElement('svg', { viewBox: '0 0 1920 1080' });
    const group = new TestElement('g', { 'letter-spacing': '0.36px', transform: 'scale(2)' });
    const subtitle = new TestElement('text', {
      id: 'subtitle',
      x: '304',
      y: '952',
      'font-family': 'Arial',
      'font-size': '24',
      'letter-spacing': '0.48',
      fill: '#f3f0e8',
    });
    subtitle.textContent = 'ADDITIONAL TEXT INFORMATION';
    const label = new TestElement('text', { id: 'breaking-text', 'font-size': '24' });
    label.textContent = 'BREAKING NEWS';
    group.children = [label];
    root.children = [subtitle, group];
    useDocument(root);

    const layers = editableSvgLayers('<svg/>', createComposition(), undefined, () => 18);
    expect(layers[0]!.element).toMatchObject({
      type: 'text',
      content: 'ADDITIONAL TEXT INFORMATION',
      fontFamily: 'Arial',
      fontSize: 24,
      letterSpacing: 0.48,
    });
    expect(layers[1]!.element).toMatchObject({
      type: 'text',
      content: 'BREAKING NEWS',
      fontSize: 48,
      letterSpacing: 0.72,
    });
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
