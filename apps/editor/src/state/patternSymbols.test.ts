import { describe, expect, it } from 'vitest';
import {
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  parseEditablePath,
  roundedRectangleSvgPath,
} from '@ograf-editor/scene-model';
import { importPatternSvg, patternSymbolFromLayer } from './patternSymbols';

const svg = (body: string, attributes = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
const anchors = (d: string) =>
  parseEditablePath(d).flatMap((contour) => contour.nodes.map(({ x, y }) => ({ x, y })));

describe('pattern symbols copied from layer geometry', () => {
  it('samples rounded-rectangle size without copying scene transform, stroke or style', () => {
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type !== 'rectangle') throw Error();
    layer.element.borderRadius = { topLeft: 10, topRight: 20, bottomRight: 30, bottomLeft: 40 };
    layer.element.strokeWidth = 8;
    layer.keyframes = [
      createLayerKeyframe(
        0,
        createDefaultTransform({ x: 450, y: 230, width: 100, height: 100, rotation: 45 }),
      ),
    ];
    layer.animationTracks.width = [
      { id: 'a', frame: 0, value: 100, easing: 'linear' },
      { id: 'b', frame: 10, value: 200, easing: 'linear' },
    ];
    const before = structuredClone(layer);
    const symbol = patternSymbolFromLayer(layer, 5, 'existing-key');
    expect(symbol).toEqual({
      key: 'existing-key',
      d: roundedRectangleSvgPath(150, 100, layer.element.borderRadius),
      width: 150,
      height: 100,
      viewBoxWidth: 150,
      viewBoxHeight: 100,
      fillRule: 'nonzero',
    });
    expect(layer).toEqual(before);
  });

  it('copies ellipse geometry and preserves compound-path holes', () => {
    const ellipse = createLayerOfKind('ellipse');
    ellipse.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 80, height: 40 }))];
    const oval = patternSymbolFromLayer(ellipse, 0, 'O');
    const points = anchors(oval.d);
    expect(Math.min(...points.map((point) => point.x))).toBe(0);
    expect(Math.max(...points.map((point) => point.x))).toBe(80);
    const layer = createLayerOfKind('path');
    if (layer.element.type !== 'path') throw Error();
    layer.element.d = 'M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z';
    layer.element.fillRule = 'evenodd';
    layer.element.viewBoxWidth = layer.element.viewBoxHeight = 100;
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 200, height: 50 }))];
    const ring = patternSymbolFromLayer(layer, 0, 'ring');
    expect(ring).toMatchObject({
      fillRule: 'evenodd',
      width: 200,
      height: 50,
      viewBoxWidth: 100,
      viewBoxHeight: 100,
    });
    expect(parseEditablePath(ring.d)).toHaveLength(2);
  });

  it('normalizes paths extending beyond their original box while retaining sampled scale', () => {
    const layer = createLayerOfKind('path');
    if (layer.element.type !== 'path') throw Error();
    layer.element.d = 'M-20 -10 H100 V100 H-20 Z';
    layer.element.viewBoxWidth = layer.element.viewBoxHeight = 100;
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ width: 200, height: 100 }))];
    expect(patternSymbolFromLayer(layer, 0, 'A')).toMatchObject({
      width: 240,
      height: 110,
      viewBoxWidth: 120,
      viewBoxHeight: 110,
    });
    expect(anchors(patternSymbolFromLayer(layer, 0, 'A').d)[0]).toEqual({ x: 0, y: 0 });
  });

  it('rejects unsupported source kinds, invalid keys and malformed paths without mutation', () => {
    expect(() => patternSymbolFromLayer(createLayerOfKind('text'), 0, 'A')).toThrow(
      /rectangle, ellipse or path/,
    );
    expect(() => patternSymbolFromLayer(createLayerOfKind('rectangle'), 0, 'bad key')).toThrow(
      /Symbol keys/,
    );
    expect(() => patternSymbolFromLayer(createLayerOfKind('rectangle'), Number.NaN, 'A')).toThrow(
      /finite timeline/,
    );
    const path = createLayerOfKind('path');
    if (path.element.type !== 'path') throw Error();
    path.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    path.element.d = 'M 0 C broken';
    expect(() => patternSymbolFromLayer(path, 0, 'A')).toThrow();
  });
});

describe('safe SVG pattern symbol import', () => {
  it('normalizes nonzero viewBox origins and nested translate/scale transforms', () => {
    const result = importPatternSvg(
      svg(
        '<g transform="translate(15 30)"><g transform="scale(2 3)"><rect x="1" y="2" width="5" height="4"/></g></g>',
        'viewBox="10 20 100 200" width="200" height="400"',
      ),
      'A',
    );
    expect(result).toMatchObject({
      key: 'A',
      width: 200,
      height: 400,
      viewBoxWidth: 200,
      viewBoxHeight: 400,
    });
    expect(anchors(result.d)).toEqual([
      { x: 14, y: 32 },
      { x: 34, y: 32 },
      { x: 34, y: 56 },
      { x: 14, y: 56 },
    ]);
  });

  it('applies centered rotation, matrix and reflection without losing hole fill rules', () => {
    const rotated = importPatternSvg(
      svg('<rect x="10" y="10" width="20" height="10" transform="rotate(90 20 20)"/>'),
      'rotate',
    );
    expect(anchors(rotated.d)).toEqual([
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 20, y: 30 },
      { x: 20, y: 10 },
    ]);
    const mirrored = importPatternSvg(
      svg(
        '<g fill-rule="evenodd" transform="matrix(-1 0 0 1 100 0)"><path d="M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z"/></g>',
      ),
      'ring',
    );
    expect(mirrored.fillRule).toBe('evenodd');
    expect(parseEditablePath(mirrored.d)).toHaveLength(2);
    expect(anchors(mirrored.d)[0]).toEqual({ x: 100, y: 0 });
  });

  it('preserves meet/none viewport sizing and derives a missing dimension from viewBox aspect', () => {
    const body = '<rect width="100" height="100"/>';
    const meet = importPatternSvg(svg(body, 'viewBox="0 0 100 100" width="200" height="100"'), 'A');
    expect(anchors(meet.d)[0]).toEqual({ x: 50, y: 0 });
    expect(anchors(meet.d)[1]).toEqual({ x: 150, y: 0 });
    const stretched = importPatternSvg(
      svg(body, 'viewBox="0 0 100 100" width="200" height="100" preserveAspectRatio="none"'),
      'A',
    );
    expect(anchors(stretched.d)[1]).toEqual({ x: 200, y: 0 });
    expect(
      importPatternSvg(
        svg('<rect width="200" height="100"/>', 'viewBox="0 0 200 100" width="100px"'),
        'A',
      ),
    ).toMatchObject({ width: 100, height: 50 });
  });

  it('imports rounded rectangles, circles, ellipses and polygons as disjoint vector geometry', () => {
    const result = importPatternSvg(
      svg(
        '<rect x="1" y="1" width="20" height="20" rx="5" ry="3"/><circle cx="40" cy="10" r="8"/><ellipse cx="70" cy="10" rx="12" ry="6"/><polygon points="0,50 20,50 10,70"/>',
      ),
      'shapes',
    );
    expect(parseEditablePath(result.d)).toHaveLength(4);
    expect(result.d).toContain('C');
    expect(result.fillRule).toBe('nonzero');
  });

  it('supports inline fill-rule and skips hidden/unfilled content without mutating inherited visibility', () => {
    const result = importPatternSvg(
      svg(
        '<title>Original &amp; safe</title><g opacity="0.0"><rect width="100" height="100" opacity="1"/></g><rect width="100" height="100" fill="none"/><g style="fill-rule:evenodd;fill:#123456"><path d="M0 0 H100 V100 H0 Z M20 20 H80 V80 H20 Z"/></g>',
      ),
      'A',
    );
    expect(parseEditablePath(result.d)).toHaveLength(2);
    expect(result.fillRule).toBe('evenodd');
  });

  it.each([
    ['<text>Title</text>', /vector shapes/],
    ['<image href="image.png"/>', /unsupported/],
    ['<path d="M0 0 H100 V100 Z" clip-path="url(#clip)"/>', /unsupported/],
    ['<path d="M0 0 H100 V100 Z" mask="url(#mask)"/>', /unsupported/],
    ['<script>alert(1)</script>', /vector shapes/],
    ['<style>path{fill:red}</style>', /vector shapes/],
    ['<rect width="50" height="50" onload="alert(1)"/>', /unsupported/],
    ['<rect width="50" height="50" stroke="#ffffff"/>', /filled outlines/],
    ['<rect width="50" height="50" opacity="0.5"/>', /Partial SVG opacity/],
    ['<rect width="50" height="50" fill="url(https://example.com/a.svg)"/>', /external references/],
    ['<rect width="50" height="50" style="filter:blur(1px)"/>', /inline SVG/],
    ['<g><svg viewBox="0 0 10 10"/></g>', /Nested SVG/],
  ])('rejects unsupported visual or executable content: %s', (body, error) => {
    expect(() => importPatternSvg(svg(body), 'A')).toThrow(error);
  });

  it('rejects ambiguous overlapping or mixed-rule shapes instead of cancelling silhouettes', () => {
    expect(() =>
      importPatternSvg(
        svg('<rect width="50" height="50"/><rect x="25" y="25" width="50" height="50"/>'),
        'A',
      ),
    ).toThrow(/overlapping bounds/);
    expect(() =>
      importPatternSvg(
        svg(
          '<rect width="20" height="20" fill-rule="evenodd"/><rect x="30" width="20" height="20"/>',
        ),
        'A',
      ),
    ).toThrow(/mixed fill rules/);
  });

  it('rejects malformed XML, entities, invalid dimensions/transforms and implicit cropping', () => {
    for (const source of [
      svg('<g><rect width="10" height="10"/></path>'),
      svg('<rect width=10 height="10"/>'),
      '<!DOCTYPE svg><svg/>',
      svg('<rect width="&bad;" height="10"/>'),
      svg('<rect width="10%" height="10"/>'),
      svg('<rect width="10" height="10" transform="scale(0)"/>'),
      svg('<rect width="10" height="10" transform="translate(1,,2)"/>'),
    ]) {
      expect(() => importPatternSvg(source, 'A')).toThrow();
    }
    expect(() => importPatternSvg(svg('<rect x="95" width="10" height="10"/>'), 'A')).toThrow(
      /outside its viewport/,
    );
    expect(() =>
      importPatternSvg(
        svg(
          '<rect width="100" height="100"/>',
          'viewBox="0 0 100 100" width="200" height="100" preserveAspectRatio="xMidYMid slice"',
        ),
        'A',
      ),
    ).toThrow(/slice/);
    expect(() => importPatternSvg(svg('<g>'.repeat(33) + '</g>'.repeat(33)), 'A')).toThrow(
      /32-level/,
    );
    expect(() => importPatternSvg(svg(' '.repeat(262144)), 'A')).toThrow(/256 KB/);
  });
});
