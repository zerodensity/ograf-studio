import {
  editablePathBounds,
  getLayerTransformAtFrame,
  parseEditablePath,
  roundedRectangleSvgPath,
  serializeEditablePath,
  type EditablePath,
  type Layer,
  type PathPoint,
  type PatternSymbol,
} from '@ograf-editor/scene-model';

const MAX_BYTES = 262_144;
const MAX_NODES = 4096;
const MAX_ELEMENTS = 512;
const MAX_DIMENSION = 16_384;
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function fail(message: string): never {
  throw new Error(message);
}
function symbolKey(key: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key))
    fail('Symbol keys must contain 1–64 letters, numbers, underscores or hyphens.');
}
function dimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_DIMENSION)
    fail('Symbol dimensions must be greater than zero and at most 16,384 pixels.');
  return value;
}
function checkedPath(d: string): EditablePath {
  if (new TextEncoder().encode(d).length > MAX_BYTES) fail('Symbol path exceeds the 256 KB limit.');
  const path = parseEditablePath(d);
  if (!path.length || !path.some((contour) => contour.nodes.length >= 2))
    fail('The symbol needs filled vector geometry.');
  return path;
}
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function transformPath(path: EditablePath, matrix: Matrix): EditablePath {
  const point = ({ x, y }: PathPoint): PathPoint => {
    const result = {
      x: matrix[0] * x + matrix[2] * y + matrix[4],
      y: matrix[1] * x + matrix[3] * y + matrix[5],
    };
    if (
      !Number.isFinite(result.x) ||
      !Number.isFinite(result.y) ||
      Math.abs(result.x) > 1e9 ||
      Math.abs(result.y) > 1e9
    )
      fail('SVG transform produces invalid or excessively large coordinates.');
    return result;
  };
  return path.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...point(node),
      ...(node.in ? { in: point(node.in) } : {}),
      ...(node.out ? { out: point(node.out) } : {}),
    })),
  }));
}
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

/** Copies local fill geometry at the sampled size; scene transform, paint and effects are not copied. */
export function patternSymbolFromLayer(layer: Layer, frame: number, key: string): PatternSymbol {
  symbolKey(key);
  if (!Number.isFinite(frame)) fail('Choose a finite timeline frame for the source shape.');
  const element = layer.element;
  if (!['rectangle', 'ellipse', 'path'].includes(element.type))
    fail(
      'Choose a rectangle, ellipse or path as the symbol source. Convert text to a vector path before importing it.',
    );
  const { width, height } = getLayerTransformAtFrame(layer, frame);
  dimension(width);
  dimension(height);
  if (element.type === 'rectangle')
    return {
      key,
      d: roundedRectangleSvgPath(width, height, element.borderRadius),
      viewBoxWidth: width,
      viewBoxHeight: height,
      width,
      height,
      fillRule: 'nonzero',
    };
  if (element.type === 'ellipse')
    return {
      key,
      d: ellipsePath(width / 2, height / 2, width / 2, height / 2),
      viewBoxWidth: width,
      viewBoxHeight: height,
      width,
      height,
      fillRule: 'nonzero',
    };
  if (element.type !== 'path')
    fail(
      'Choose a rectangle, ellipse or path as the symbol source. Convert text to a vector path before importing it.',
    );
  dimension(element.viewBoxWidth);
  dimension(element.viewBoxHeight);
  const path = checkedPath(element.d);
  const bounds = editablePathBounds({ ...element, strokeWidth: 0 });
  const local = transformPath(path, [1, 0, 0, 1, -bounds.x, -bounds.y]);
  return {
    key,
    d: serializeEditablePath(local),
    viewBoxWidth: dimension(bounds.width),
    viewBoxHeight: dimension(bounds.height),
    width: dimension((width * bounds.width) / element.viewBoxWidth),
    height: dimension((height * bounds.height) / element.viewBoxHeight),
    fillRule: element.fillRule ?? 'nonzero',
  };
}

interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
}
function decodeXml(value: string): string {
  return value.replace(/&([^;\s]+);/g, (_, entity: string) => {
    const known: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (known[entity]) return known[entity];
    if (/^#(?:x[0-9a-f]+|[0-9]+)$/i.test(entity)) {
      const code = Number.parseInt(
        entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1),
        entity[1]?.toLowerCase() === 'x' ? 16 : 10,
      );
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff))
        return String.fromCodePoint(code);
    }
    return fail('SVG entities and external references are unsupported.');
  });
}
/** Strict, bounded XML subset: it never creates DOM nodes or loads referenced resources. */
function parseSvg(text: string): XmlNode {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    fail('SVG exceeds the 256 KB symbol limit.');
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(text))
    fail('SVG document types, entities and embedded styles/scripts are unsupported.');
  let cursor = 0,
    count = 0;
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  while (cursor < text.length) {
    if (text.startsWith('<!--', cursor)) {
      const end = text.indexOf('-->', cursor + 4);
      if (end < 0) fail('Invalid SVG comment.');
      cursor = end + 3;
      continue;
    }
    if (text.startsWith('<?xml ', cursor) && !root) {
      const end = text.indexOf('?>', cursor + 6);
      if (end < 0) fail('Invalid XML declaration.');
      cursor = end + 2;
      continue;
    }
    if (text[cursor] !== '<') {
      const end = text.indexOf('<', cursor),
        stop = end < 0 ? text.length : end;
      if (text.slice(cursor, stop).trim() && !['title', 'desc'].includes(stack.at(-1)?.name ?? ''))
        fail('SVG must contain vector shapes, without embedded text or styles.');
      cursor = stop;
      continue;
    }
    let end = cursor + 1,
      quote = '';
    for (; end < text.length; end++) {
      const char = text[end]!;
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === text.length) fail('Invalid SVG markup.');
    const tag = text.slice(cursor + 1, end);
    cursor = end + 1;
    const close = /^\/([A-Za-z][\w:.-]*)\s*$/.exec(tag);
    if (close) {
      if (stack.pop()?.name !== close[1]) fail('SVG elements are not properly nested.');
      continue;
    }
    const opening = /^([A-Za-z][\w:.-]*)/.exec(tag);
    if (!opening) fail('Unsupported or invalid SVG markup.');
    const name = opening[1]!,
      attributes: Record<string, string> = {};
    const selfClosing = /\/\s*$/.test(tag);
    let remaining = tag.slice(opening[0].length, selfClosing ? tag.lastIndexOf('/') : undefined);
    while (remaining.trim()) {
      const attribute = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/.exec(remaining);
      if (!attribute) fail('SVG attributes must be quoted and well formed.');
      if (Object.hasOwn(attributes, attribute[1]!))
        fail(`Duplicate SVG attribute ${attribute[1]}.`);
      if (/&(?![^;\s]+;)/.test(attribute[3]!)) fail('Invalid SVG entity.');
      attributes[attribute[1]!] = decodeXml(attribute[3]!);
      remaining = remaining.slice(attribute[0].length);
    }
    const node = { name, attributes, children: [] };
    if (++count > MAX_ELEMENTS || stack.length >= 32)
      fail('SVG exceeds the 512-element or 32-level symbol limit.');
    if (stack.length) stack.at(-1)!.children.push(node);
    else if (root) fail('SVG must have a single root element.');
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (stack.length || root?.name !== 'svg') fail('Choose a complete, well-formed SVG document.');
  return root;
}

const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
function numbers(value: string): number[] {
  if (/^\s*,|,\s*,|,\s*$/.test(value)) fail('Invalid numeric SVG attribute.');
  const expression = new RegExp(NUMBER, 'g');
  let end = 0;
  const result: number[] = [];
  for (const match of value.matchAll(expression)) {
    if (!/^[\s,]*$/.test(value.slice(end, match.index))) fail('Invalid numeric SVG attribute.');
    const n = Number(match[0]);
    if (!Number.isFinite(n) || Math.abs(n) > 1e9)
      fail('SVG numbers must be finite and within ±1,000,000,000.');
    result.push(n);
    end = match.index + match[0].length;
  }
  if (!/^[\s,]*$/.test(value.slice(end)))
    fail('SVG geometry must use numbers or pixel dimensions, without percentages or other units.');
  return result;
}
function number(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const result = numbers(value.trim().replace(/px$/, ''));
  if (result.length !== 1) fail('Invalid numeric SVG attribute.');
  return result[0]!;
}
function transform(value: string | undefined): Matrix {
  if (!value) return [...IDENTITY];
  const expression = /([A-Za-z]+)\s*\(([^()]*)\)/g;
  let result: Matrix = [...IDENTITY],
    end = 0,
    count = 0;
  for (const match of value.matchAll(expression)) {
    if (!/^[\s,]*$/.test(value.slice(end, match.index)) || ++count > 64)
      fail('Unsupported SVG transform.');
    const args = numbers(match[2]!),
      [a = 0, b = 0, c = 0] = args;
    let matrix: Matrix;
    if (match[1] === 'matrix' && args.length === 6) matrix = args as Matrix;
    else if (match[1] === 'translate' && [1, 2].includes(args.length)) matrix = [1, 0, 0, 1, a, b];
    else if (match[1] === 'scale' && [1, 2].includes(args.length))
      matrix = [a, 0, 0, args[1] ?? a, 0, 0];
    else if (match[1] === 'rotate' && [1, 3].includes(args.length)) {
      const angle = (a * Math.PI) / 180,
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      matrix = multiply(multiply([1, 0, 0, 1, b, c], [cos, sin, -sin, cos, 0, 0]), [
        1,
        0,
        0,
        1,
        -b,
        -c,
      ]);
    } else if (['skewX', 'skewY'].includes(match[1]!) && args.length === 1) {
      const tangent = Math.tan((a * Math.PI) / 180);
      matrix = match[1] === 'skewX' ? [1, 0, tangent, 1, 0, 0] : [1, tangent, 0, 1, 0, 0];
    } else fail('Unsupported SVG transform. Use matrix, translate, scale, rotate, skewX or skewY.');
    result = multiply(result, matrix);
    end = match.index + match[0].length;
  }
  if (
    !/^[\s,]*$/.test(value.slice(end)) ||
    !count ||
    !result.every(Number.isFinite) ||
    Math.abs(result[0] * result[3] - result[1] * result[2]) < 1e-12
  )
    fail('SVG transform is invalid or collapses its geometry.');
  return result;
}

interface Bounds {
  x: number;
  y: number;
  right: number;
  bottom: number;
}
function bounds(path: EditablePath): Bounds {
  const result = { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity };
  const include = ({ x, y }: PathPoint) => {
    result.x = Math.min(result.x, x);
    result.y = Math.min(result.y, y);
    result.right = Math.max(result.right, x);
    result.bottom = Math.max(result.bottom, y);
  };
  for (const contour of path) {
    for (const node of contour.nodes) include(node);
    for (let i = 0; i < contour.nodes.length - (contour.closed ? 0 : 1); i++) {
      const p = contour.nodes[i]!,
        q = contour.nodes[(i + 1) % contour.nodes.length]!,
        u = p.out ?? p,
        v = q.in ?? q;
      for (const axis of ['x', 'y'] as const) {
        const a = -p[axis] + 3 * u[axis] - 3 * v[axis] + q[axis],
          b = 2 * (p[axis] - 2 * u[axis] + v[axis]),
          c = u[axis] - p[axis],
          disc = b * b - 4 * a * c;
        const roots =
          Math.abs(a) < 1e-12
            ? Math.abs(b) < 1e-12
              ? []
              : [-c / b]
            : disc < 0
              ? []
              : [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)];
        for (const t of roots)
          if (t > 0 && t < 1) {
            const s = 1 - t;
            include({
              x: s * s * s * p.x + 3 * s * s * t * u.x + 3 * s * t * t * v.x + t * t * t * q.x,
              y: s * s * s * p.y + 3 * s * s * t * u.y + 3 * s * t * t * v.y + t * t * t * q.y,
            });
          }
      }
    }
  }
  return result;
}
const PRESENTATION = [
  'fill',
  'fill-rule',
  'stroke',
  'stroke-width',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'display',
  'visibility',
];
const SHAPE_ATTRIBUTES: Record<string, string[]> = {
  svg: ['viewBox', 'width', 'height', 'xmlns', 'xmlns:xlink', 'version', 'preserveAspectRatio'],
  g: [],
  path: ['d'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  polygon: ['points'],
  title: [],
  desc: [],
};
function presentation(node: XmlNode, inherited: Record<string, string>): Record<string, string> {
  const allowed = SHAPE_ATTRIBUTES[node.name];
  if (!allowed)
    fail(
      `SVG <${node.name}> is unsupported. Use filled vector paths/shapes; outline strokes and text, and remove clips, masks, filters and external content first.`,
    );
  for (const [name, value] of Object.entries(node.attributes)) {
    if (
      ![
        ...allowed,
        ...PRESENTATION,
        'id',
        'transform',
        'style',
        'role',
        'aria-label',
        'aria-hidden',
      ].includes(name)
    )
      fail(`SVG attribute "${name}" is unsupported. Flatten its visual effect before importing.`);
    if (/url\s*\(|(?:https?:|data:|javascript:)/i.test(value) && !name.startsWith('xmlns'))
      fail(
        'SVG paint servers and external references are unsupported. Use solid filled vector geometry.',
      );
  }
  const result = { ...inherited };
  for (const name of PRESENTATION)
    if (node.attributes[name] !== undefined) result[name] = node.attributes[name]!;
  if (node.attributes.style)
    for (const declaration of node.attributes.style.split(';')) {
      if (!declaration.trim()) continue;
      const match = /^\s*([a-z-]+)\s*:\s*(.*?)\s*(?:!important)?\s*$/.exec(declaration);
      if (!match || !PRESENTATION.includes(match[1]!))
        fail(
          'Only inline SVG fill, fill-rule, stroke, opacity, display and visibility styles are supported.',
        );
      result[match[1]!] = match[2]!;
    }
  for (const name of ['opacity', 'fill-opacity', 'stroke-opacity'])
    if (result[name] !== undefined && ![0, 1].includes(number(result[name])))
      fail(
        'Partial SVG opacity is unsupported for a reusable silhouette. Use fully opaque vector geometry.',
      );
  if (!['nonzero', 'evenodd'].includes(result['fill-rule'] ?? 'nonzero'))
    fail('SVG fill-rule must be nonzero or evenodd.');
  if (!['none', 'inline'].includes(result.display ?? 'inline'))
    fail('Unsupported SVG display style.');
  if (!['visible', 'hidden', 'collapse'].includes(result.visibility ?? 'visible'))
    fail('Unsupported SVG visibility style.');
  if (number(result['stroke-width'], 1) < 0) fail('SVG stroke width cannot be negative.');
  if (result.fill && !/^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+)$/i.test(result.fill))
    fail('SVG source fills must be opaque colors or none; the pattern supplies the final paint.');
  return result;
}
function shapePath(node: XmlNode): string {
  const a = node.attributes;
  if (node.name === 'path') return a.d ?? '';
  if (node.name === 'polygon') {
    const points = numbers(a.points ?? '');
    if (points.length < 6 || points.length % 2)
      fail('SVG polygon needs at least three complete coordinate pairs.');
    return `M ${points[0]} ${points[1]} ${points
      .slice(2)
      .map((value, i) => `${i % 2 ? '' : 'L '}${value}`)
      .join(' ')} Z`;
  }
  if (node.name === 'circle' || node.name === 'ellipse') {
    const rx = number(node.name === 'circle' ? a.r : a.rx),
      ry = number(node.name === 'circle' ? a.r : a.ry);
    if (rx <= 0 || ry <= 0) fail('SVG circles and ellipses need positive radii.');
    return ellipsePath(number(a.cx), number(a.cy), rx, ry);
  }
  const x = number(a.x),
    y = number(a.y),
    w = dimension(number(a.width)),
    h = dimension(number(a.height));
  const rx = Math.min(w / 2, number(a.rx, number(a.ry))),
    ry = Math.min(h / 2, number(a.ry, number(a.rx)));
  if (rx < 0 || ry < 0) fail('SVG rectangle corner radii cannot be negative.');
  if (!rx || !ry) return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
  return `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
}

/** Imports filled SVG silhouettes without executing markup, loading resources or altering the scene. */
export function importPatternSvg(text: string, key: string): PatternSymbol {
  symbolKey(key);
  const root = parseSvg(text);
  if (root.attributes.xmlns && root.attributes.xmlns !== 'http://www.w3.org/2000/svg')
    fail('Invalid SVG namespace.');
  if (root.attributes.transform) fail('Move the root SVG transform into a group before importing.');
  const viewBox = root.attributes.viewBox ? numbers(root.attributes.viewBox) : undefined;
  if (viewBox && viewBox.length !== 4) fail('SVG viewBox needs four numbers.');
  const authoredWidth =
    root.attributes.width === undefined ? undefined : number(root.attributes.width);
  const authoredHeight =
    root.attributes.height === undefined ? undefined : number(root.attributes.height);
  const width = dimension(
    authoredWidth ??
      (viewBox
        ? authoredHeight === undefined
          ? viewBox[2]!
          : (authoredHeight * viewBox[2]!) / viewBox[3]!
        : 0),
  );
  const height = dimension(
    authoredHeight ??
      (viewBox
        ? authoredWidth === undefined
          ? viewBox[3]!
          : (authoredWidth * viewBox[3]!) / viewBox[2]!
        : 0),
  );
  const [vx, vy, vw, vh] = viewBox ?? [0, 0, width, height];
  dimension(vw!);
  dimension(vh!);
  let sx = width / vw!,
    sy = height / vh!,
    tx = -vx! * sx,
    ty = -vy! * sy;
  const aspect = root.attributes.preserveAspectRatio ?? 'xMidYMid meet';
  if (aspect !== 'none') {
    const match = /^(xMin|xMid|xMax)(YMin|YMid|YMax)(?:\s+(meet|slice))?$/.exec(aspect.trim());
    if (!match || match[3] === 'slice')
      fail(
        'SVG preserveAspectRatio supports none or meet; crop/slice must be flattened before importing.',
      );
    sx = sy = Math.min(sx, sy);
    tx = -vx! * sx + (width - vw! * sx) * (match[1] === 'xMin' ? 0 : match[1] === 'xMid' ? 0.5 : 1);
    ty =
      -vy! * sy + (height - vh! * sy) * (match[2] === 'YMin' ? 0 : match[2] === 'YMid' ? 0.5 : 1);
  }
  const shapes: Array<{ path: EditablePath; bounds: Bounds; rule: 'nonzero' | 'evenodd' }> = [];
  let nodes = 0;
  const visit = (
    node: XmlNode,
    parentMatrix: Matrix,
    inherited: Record<string, string>,
    visible: boolean,
  ) => {
    if (node !== root && node.name === 'svg')
      fail('Nested SVG viewports are unsupported. Flatten them into groups first.');
    const styles = presentation(node, inherited);
    const shown = visible && styles.display !== 'none' && number(styles.opacity, 1) !== 0;
    const matrix = multiply(parentMatrix, transform(node.attributes.transform));
    if (['svg', 'g', 'title', 'desc'].includes(node.name)) {
      if (['title', 'desc'].includes(node.name) && node.children.length)
        fail('SVG titles and descriptions cannot contain markup.');
      for (const child of node.children) visit(child, matrix, styles, shown);
      return;
    }
    if (node.children.length) fail('SVG shapes cannot contain nested elements.');
    if (!shown || ['hidden', 'collapse'].includes(styles.visibility ?? 'visible')) return;
    if (
      styles.stroke &&
      styles.stroke !== 'none' &&
      styles.stroke !== 'transparent' &&
      number(styles['stroke-width'], 1) > 0 &&
      number(styles['stroke-opacity'], 1) !== 0
    )
      fail('SVG strokes must be converted to filled outlines before importing a symbol.');
    if (
      styles.fill === 'none' ||
      styles.fill === 'transparent' ||
      number(styles['fill-opacity'], 1) === 0
    )
      return;
    const path = transformPath(checkedPath(shapePath(node)), matrix);
    nodes += path.reduce((sum, contour) => sum + contour.nodes.length, 0);
    if (nodes > MAX_NODES) fail('SVG exceeds the 4,096-anchor symbol limit.');
    const box = bounds(path);
    if (box.x < -1e-5 || box.y < -1e-5 || box.right > width + 1e-5 || box.bottom > height + 1e-5)
      fail(
        'SVG geometry extends outside its viewport. Crop/flatten it or expand the viewBox before importing.',
      );
    if (box.right - box.x < 1e-6 || box.bottom - box.y < 1e-6)
      fail('SVG shape has no filled area.');
    const rule = (styles['fill-rule'] ?? 'nonzero') as 'nonzero' | 'evenodd';
    for (const previous of shapes) {
      if (previous.rule !== rule)
        fail(
          'SVG uses mixed fill rules. Combine the shapes into one compound path before importing.',
        );
      if (
        Math.min(box.right, previous.bounds.right) - Math.max(box.x, previous.bounds.x) > 1e-6 &&
        Math.min(box.bottom, previous.bounds.bottom) - Math.max(box.y, previous.bounds.y) > 1e-6
      )
        fail(
          'Separate SVG shapes have overlapping bounds. Combine them into one compound path to preserve their silhouette and holes.',
        );
    }
    shapes.push({ path, bounds: box, rule });
  };
  visit(root, [sx, 0, 0, sy, tx, ty], {}, true);
  if (!shapes.length) fail('SVG has no visible filled vector shapes.');
  const d = serializeEditablePath(shapes.flatMap((shape) => shape.path));
  if (new TextEncoder().encode(d).length > MAX_BYTES)
    fail('Converted SVG exceeds the 256 KB symbol limit.');
  return {
    key,
    d,
    viewBoxWidth: width,
    viewBoxHeight: height,
    width,
    height,
    fillRule: shapes[0]!.rule,
  };
}
