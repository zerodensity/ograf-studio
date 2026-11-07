import {
  computeKeyframeFrames,
  createAnimationTracksFromLegacyLayer,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createId,
  parseEditablePath,
  type Composition,
  type Layer,
  type NewLayerKind,
  type GradientPaint,
} from '@ograf-editor/scene-model';
import { multiplySvgMatrix, parseSvgTransform, SVG_IDENTITY, type SvgMatrix } from './svgTransform';
import { isAvailableImportFont } from './importFontAvailability';

/** Measure the baseline of the same CSS line box used by Studio's text renderer. */
function measureSvgTextBaseline(family: string, size: number, weight: number): number | null {
  if (typeof window === 'undefined' || !window.document.body) return null;
  // Do not trust FontFaceSet.check on its own: it succeeds for missing faces.
  const requested = family
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  try {
    if (!requested || !isAvailableImportFont(requested)) return null;
  } catch {
    return null;
  }
  const host = window.document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    fontFamily: family,
    fontSize: `${size}px`,
    fontWeight: String(weight),
    lineHeight: '1.2',
    whiteSpace: 'pre',
    padding: '0',
    border: '0',
    margin: '0',
  });
  const line = window.document.createElement('span');
  Object.assign(line.style, {
    all: 'initial',
    display: 'block',
    font: 'inherit',
    lineHeight: 'inherit',
    whiteSpace: 'inherit',
  });
  const marker = window.document.createElement('span');
  Object.assign(marker.style, {
    all: 'initial',
    display: 'inline-block',
    width: '0',
    height: '0',
    padding: '0',
    border: '0',
    margin: '0',
    verticalAlign: 'baseline',
  });
  line.append(window.document.createTextNode('Hg'), marker);
  host.append(line);
  window.document.body.append(host);
  try {
    const baseline = marker.getBoundingClientRect().top - host.getBoundingClientRect().top;
    return Number.isFinite(baseline) && baseline > 0 ? baseline : null;
  } finally {
    host.remove();
  }
}

/**
 * Conservative, loss-averse SVG import. Unknown visual features fail before any
 * project mutation, so the caller can offer the existing image import instead.
 */
export function editableSvgLayers(
  source: string,
  composition: Composition,
  fallback?: (node: Element, ancestors: Element[], reason: string) => Layer,
  measureBaseline: (
    family: string,
    size: number,
    weight: number,
  ) => number | null = measureSvgTextBaseline,
): Layer[] {
  if (source.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error('This SVG is too large or contains a document type declaration.');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || document.querySelector('parsererror'))
    throw new Error('The file is not a well-formed SVG.');
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    viewBox.some((x) => !Number.isFinite(x)) ||
    viewBox[0] !== 0 ||
    viewBox[1] !== 0 ||
    viewBox[2]! <= 0 ||
    viewBox[3]! <= 0
  )
    throw new Error('Editable SVG import currently requires a viewBox starting at 0 0.');
  const width = viewBox[2]!,
    height = viewBox[3]!;
  const layers: Layer[] = [];
  const textBaselines = new Map<string, number | null>();
  const frameNumbers = computeKeyframeFrames(composition);
  const num = (node: Element, key: string, fallback = 0) => {
    const raw = node.getAttribute(key);
    if (raw == null) return fallback;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(raw.trim()))
      throw new Error(`Unsupported ${key} value: ${raw}`);
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000)
      throw new Error(`Invalid ${key} value.`);
    return value;
  };
  if (
    (root.hasAttribute('width') && num(root, 'width') !== width) ||
    (root.hasAttribute('height') && num(root, 'height') !== height)
  )
    throw new Error('An SVG viewport different from its viewBox is not yet supported.');
  const gradients = new Map<string, GradientPaint>();
  for (const defs of Array.from(root.children).filter((child) => child.localName === 'defs')) {
    for (const gradient of Array.from(defs.children)) {
      if (gradient.localName !== 'linearGradient' || !gradient.getAttribute('id')) continue;
      try {
        const allowed = new Set(['id', 'x1', 'y1', 'x2', 'y2']);
        if (Array.from(gradient.attributes).some((attribute) => !allowed.has(attribute.name)))
          throw new Error('This SVG gradient has unsupported settings.');
        const coordinate = (name: string, fallback: number) => {
          const raw = gradient.getAttribute(name);
          if (raw === null) return fallback;
          if (!/^(?:0|1|0%|100%)$/.test(raw.trim()))
            throw new Error('Only edge-to-edge SVG gradients are supported.');
          return raw.includes('%') ? Number.parseFloat(raw) / 100 : Number(raw);
        };
        const x1 = coordinate('x1', 0),
          y1 = coordinate('y1', 0),
          x2 = coordinate('x2', 1),
          y2 = coordinate('y2', 0);
        if ((x1 !== x2) === (y1 !== y2))
          throw new Error('Only horizontal or vertical SVG gradients are supported.');
        const stops = Array.from(gradient.children).map((stop) => {
          if (
            stop.localName !== 'stop' ||
            Array.from(stop.attributes).some(
              (a) => !['offset', 'stop-color', 'stop-opacity'].includes(a.name),
            )
          )
            throw new Error('This SVG gradient stop is not supported.');
          const raw = stop.getAttribute('offset') ?? '0';
          const offset = raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number(raw);
          const opacity = Number(stop.getAttribute('stop-opacity') ?? '1');
          if (
            !Number.isFinite(offset) ||
            offset < 0 ||
            offset > 1 ||
            !Number.isFinite(opacity) ||
            opacity < 0 ||
            opacity > 1
          )
            throw new Error('Invalid SVG gradient stop.');
          return { offset, color: stop.getAttribute('stop-color') ?? '#000000', opacity };
        });
        if (
          stops.length < 2 ||
          stops.some((stop, index) => index > 0 && stop.offset < stops[index - 1]!.offset)
        )
          throw new Error('SVG gradients need at least two ordered stops.');
        const angle = x1 !== x2 ? (x2 > x1 ? 90 : 270) : y2 > y1 ? 180 : 0;
        const id = gradient.getAttribute('id')!;
        if (gradients.has(id)) throw new Error('SVG gradient IDs must be unique.');
        gradients.set(id, { type: 'linear', angle, stops });
      } catch {
        // The referencing subtree will be preserved as an image, not flattened silently.
        gradients.delete(gradient.getAttribute('id')!);
      }
    }
  }
  type Style = {
    fill: string;
    stroke: string;
    strokeWidth: number;
    opacity: number;
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
  };
  const visit = (
    node: Element,
    inherited: Style,
    groupId: string | null,
    matrix: SvgMatrix,
    ancestors: Element[],
  ) => {
    const checkpoint = layers.length;
    try {
      const tag = node.localName;
      if (['title', 'desc', 'metadata', 'defs'].includes(tag)) return;
      if (!['svg', 'g', 'rect', 'ellipse', 'circle', 'path', 'text'].includes(tag))
        throw new Error(
          `Editable import does not yet support <${tag}>. Import it as an image instead.`,
        );
      const allowed = new Set([
        'id',
        'xmlns',
        'xmlns:xlink',
        'version',
        'width',
        'height',
        'viewBox',
        'x',
        'y',
        'cx',
        'cy',
        'rx',
        'ry',
        'r',
        'd',
        'fill',
        'fill-rule',
        'stroke',
        'stroke-width',
        'font-size',
        'font-family',
        'font-weight',
        'text-anchor',
        'transform',
      ]);
      for (const attribute of Array.from(node.attributes)) {
        const name = attribute.name;
        if (!allowed.has(name))
          throw new Error(
            `Editable import cannot faithfully represent ${name}; import as an image instead.`,
          );
      }
      const fill = node.getAttribute('fill') ?? inherited.fill;
      const stroke = node.getAttribute('stroke') ?? inherited.stroke;
      if (/currentcolor|context-fill|context-stroke|var\s*\(/i.test(fill + stroke))
        throw new Error('Context-dependent SVG colors are not yet supported.');
      if (/url\s*\(/i.test(stroke)) throw new Error('SVG gradient strokes are not yet supported.');
      const style: Style = {
        fill,
        stroke,
        strokeWidth: num(node, 'stroke-width', inherited.strokeWidth),
        opacity: inherited.opacity,
        fontSize: num(node, 'font-size', inherited.fontSize),
        fontFamily: node.getAttribute('font-family') ?? inherited.fontFamily,
        fontWeight: num(node, 'font-weight', inherited.fontWeight),
      };
      const transform = multiplySvgMatrix(
        matrix,
        parseSvgTransform(node.getAttribute('transform')),
      );
      if (tag === 'svg' || tag === 'g') {
        // The scene model has one group ID per layer. Preserve the selectable outer group;
        // nested group boundaries cannot be represented independently yet.
        const childGroup = tag === 'g' ? (groupId ?? createId('group')) : groupId;
        for (const child of Array.from(node.children))
          visit(child, style, childGroup, transform, [...ancestors, node]);
        return;
      }
      if (node.children.length) throw new Error(`Nested content in <${tag}> is not yet supported.`);
      if (layers.length >= 512) throw new Error('Editable import supports at most 512 layers.');
      const kind: NewLayerKind =
        tag === 'rect'
          ? 'rectangle'
          : tag === 'circle' || tag === 'ellipse'
            ? 'ellipse'
            : tag === 'text'
              ? 'text'
              : 'path';
      const layer = createLayerOfKind(kind);
      layer.name = node.getAttribute('id') || `${tag} ${layers.length + 1}`;
      layer.groupId = groupId;
      let x = 0,
        y = 0,
        w = width,
        h = height;
      const color = (value: string) => (value === 'none' ? 'transparent' : value);
      const gradientId = /^url\(#([^)]+)\)$/.exec(fill)?.[1];
      if (/url\s*\(/i.test(fill) && (!gradientId || !gradients.has(gradientId)))
        throw new Error('This SVG fill references an unsupported gradient or pattern.');
      const fillPaint = gradientId ? gradients.get(gradientId)! : color(fill);
      if (layer.element.type === 'rectangle') {
        x = num(node, 'x');
        y = num(node, 'y');
        w = num(node, 'width');
        h = num(node, 'height');
        if (node.hasAttribute('rx') || node.hasAttribute('ry'))
          throw new Error('Rounded SVG rectangles are not yet supported.');
        Object.assign(layer.element, {
          fill: fillPaint,
          strokeColor: color(stroke),
          strokeWidth: style.strokeWidth,
        });
      } else if (layer.element.type === 'ellipse') {
        const rx = tag === 'circle' ? num(node, 'r') : num(node, 'rx'),
          ry = tag === 'circle' ? rx : num(node, 'ry');
        x = num(node, 'cx') - rx;
        y = num(node, 'cy') - ry;
        w = rx * 2;
        h = ry * 2;
        Object.assign(layer.element, {
          fill: fillPaint,
          strokeColor: color(stroke),
          strokeWidth: style.strokeWidth,
        });
      } else if (layer.element.type === 'path') {
        const d = node.getAttribute('d') ?? '';
        parseEditablePath(d);
        Object.assign(layer.element, {
          d,
          fill: fillPaint,
          strokeColor: color(stroke),
          strokeWidth: style.strokeWidth,
          viewBoxWidth: width,
          viewBoxHeight: height,
          fillRule: node.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero',
        });
      } else if (layer.element.type === 'text') {
        if (node.getAttribute('text-anchor') && node.getAttribute('text-anchor') !== 'start')
          throw new Error('Only start-aligned SVG text is currently supported.');
        x = num(node, 'x');
        const metricKey = JSON.stringify([style.fontFamily, style.fontSize, style.fontWeight]);
        if (!textBaselines.has(metricKey))
          textBaselines.set(
            metricKey,
            measureBaseline(style.fontFamily, style.fontSize, style.fontWeight),
          );
        const baseline = textBaselines.get(metricKey);
        if (baseline == null)
          throw new Error(
            'The SVG text font or its baseline cannot be measured reliably; import this text as an image instead.',
          );
        y = num(node, 'y') - baseline;
        w = Math.max(1, width - x);
        h = style.fontSize * 1.2;
        Object.assign(layer.element, {
          content: node.textContent ?? '',
          color: typeof fillPaint === 'string' ? fillPaint : '#ffffff',
          fill: fillPaint,
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          strokeColor: color(stroke),
          strokeWidth: style.strokeWidth,
        });
      }
      if (w <= 0 || h <= 0) throw new Error(`Invalid dimensions for ${layer.name}.`);
      // OGraf layers represent a rotation and dimensions, but not skew or reflections.
      // Keep unrepresentable transforms in the image fallback instead of distorting them.
      const [a, b, c, d, e, f] = transform;
      const sx = Math.hypot(a, b),
        sy = Math.hypot(c, d);
      if (sx < 1e-9 || sy < 1e-9 || Math.abs(a * c + b * d) > 1e-7 * sx * sy || a * d - b * c <= 0)
        throw new Error('This SVG transform requires image fallback.');
      if (
        Math.abs(sx - sy) > 1e-7 &&
        ((style.strokeWidth > 0 && stroke !== 'none') || layer.element.type === 'text')
      )
        throw new Error('This non-uniform SVG transform requires image fallback.');
      const tx = a * x + c * y + e,
        ty = b * x + d * y + f;
      x = tx;
      y = ty;
      w *= sx;
      h *= sy;
      if (layer.element.type === 'text') layer.element.fontSize *= sx;
      if ('strokeWidth' in layer.element) layer.element.strokeWidth *= sx;
      layer.keyframes = composition.keyframes.map((_, i) =>
        createLayerKeyframe(
          frameNumbers[i]?.frame ?? 0,
          createDefaultTransform({
            x,
            y,
            width: w,
            height: h,
            opacity: style.opacity,
            rotation: (Math.atan2(b, a) * 180) / Math.PI,
            transformOriginX: 0,
            transformOriginY: 0,
          }),
        ),
      );
      layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
      layers.push(layer);
    } catch (error) {
      if (!fallback) throw error;
      layers.length = checkpoint;
      const result = fallback(
        node,
        ancestors,
        error instanceof Error ? error.message : String(error),
      );
      result.groupId = groupId;
      layers.push(result);
    }
  };
  visit(
    root,
    {
      fill: '#000000',
      stroke: 'none',
      strokeWidth: 1,
      opacity: 1,
      fontSize: 16,
      fontFamily: 'sans-serif',
      fontWeight: 400,
    },
    null,
    SVG_IDENTITY,
    [],
  );
  if (!layers.length) throw new Error('This SVG contains no editable shapes or text.');
  return layers;
}
