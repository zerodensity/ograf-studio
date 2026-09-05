import { getLayerTransformAtFrame } from './layerAnimation';
import { clampCornerRadii } from './cornerRadii';
import type { Layer, PathElement } from './types';

export interface PathPoint {
  x: number;
  y: number;
}
export interface PathAnchor extends PathPoint {
  in?: PathPoint;
  out?: PathPoint;
}
export interface PathContour {
  closed: boolean;
  nodes: PathAnchor[];
}
export type EditablePath = PathContour[];
export type PathEdit = {
  action: 'convert' | 'move' | 'handles' | 'insert' | 'remove' | 'smooth' | 'corner';
  /** Required for point edits; rejects stale geometry even outside a revisioned session. */
  expectedD?: string;
  contour?: number;
  node?: number;
  x?: number;
  y?: number;
  incoming?: PathPoint | null;
  outgoing?: PathPoint | null;
  t?: number;
};
const MAX_NODES = 4096;
const point = (x: number, y: number): PathPoint => ({ x, y });
const mix = (a: PathPoint, b: PathPoint, t: number): PathPoint =>
  point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const equal = (a: PathPoint, b: PathPoint) =>
  Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8;
const reflected = (p: PathPoint, center: PathPoint) =>
  point(2 * center.x - p.x, 2 * center.y - p.y);
function finite(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9)
    throw new Error('Path coordinates must be finite and within ±1,000,000,000.');
  return value;
}

/** SVG endpoint arcs expanded into cubic segments of at most 90 degrees. */
function arc(
  from: PathPoint,
  to: PathPoint,
  rx: number,
  ry: number,
  degrees: number,
  large: number,
  sweep: number,
): [PathPoint, PathPoint, PathPoint][] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (equal(from, to)) return [];
  if (!rx || !ry) return [[from, to, to]];
  const phi = (degrees * Math.PI) / 180,
    cs = Math.cos(phi),
    sn = Math.sin(phi);
  const dx = (from.x - to.x) / 2,
    dy = (from.y - to.y) / 2;
  const xp = cs * dx + sn * dy,
    yp = -sn * dx + cs * dy;
  const scale = Math.sqrt((xp * xp) / (rx * rx) + (yp * yp) / (ry * ry));
  if (scale > 1) {
    rx *= scale;
    ry *= scale;
  }
  const f =
    (large === sweep ? -1 : 1) *
    Math.sqrt(
      Math.max(
        0,
        (rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp) /
          (rx * rx * yp * yp + ry * ry * xp * xp),
      ),
    );
  const cxp = (f * rx * yp) / ry,
    cyp = (-f * ry * xp) / rx;
  const cx = cs * cxp - sn * cyp + (from.x + to.x) / 2,
    cy = sn * cxp + cs * cyp + (from.y + to.y) / 2;
  const start = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  let delta = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - start;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  const count = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const at = (a: number) =>
    point(
      cx + cs * rx * Math.cos(a) - sn * ry * Math.sin(a),
      cy + sn * rx * Math.cos(a) + cs * ry * Math.sin(a),
    );
  const tangent = (a: number) =>
    point(
      -cs * rx * Math.sin(a) - sn * ry * Math.cos(a),
      -sn * rx * Math.sin(a) + cs * ry * Math.cos(a),
    );
  return Array.from({ length: count }, (_, i) => {
    const a = start + (delta * i) / count,
      b = start + (delta * (i + 1)) / count,
      k = (4 / 3) * Math.tan((b - a) / 4);
    const p = at(a),
      q = at(b),
      u = tangent(a),
      v = tangent(b);
    return [
      point(p.x + k * u.x, p.y + k * u.y),
      point(q.x - k * v.x, q.y - k * v.y),
      i === count - 1 ? to : q,
    ];
  });
}

/** Parses all standard SVG path commands, retaining compound contours and holes. */
export function parseEditablePath(d: string): EditablePath {
  if (d.length > 500_000) throw new Error('This path is too large for point editing.');
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  if (d.replace(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[\s,]/g, ''))
    throw new Error('Invalid SVG path syntax.');
  const paths: EditablePath = [];
  let index = 0,
    cmd = '',
    previous = '',
    current = point(0, 0),
    contour: PathContour | undefined,
    cubic: PathPoint | undefined,
    quadratic: PathPoint | undefined,
    count = 0;
  const number = () => {
    const token = tokens[index++];
    if (token === undefined || /^[a-z]$/i.test(token))
      throw new Error('Incomplete SVG path command.');
    return finite(Number(token));
  };
  const append = (end: PathPoint, c1?: PathPoint, c2?: PathPoint) => {
    if (!contour) throw new Error('A path must start with Move (M).');
    if (++count > MAX_NODES)
      throw new Error(`Point editing supports at most ${MAX_NODES} anchors.`);
    if (c1) contour.nodes.at(-1)!.out = c1;
    contour.nodes.push({ ...end, ...(c2 ? { in: c2 } : {}) });
    current = end;
  };
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index]!)) cmd = tokens[index++]!;
    else if (!cmd) throw new Error('Expected SVG path command.');
    const upper = cmd.toUpperCase(),
      rel = upper !== cmd,
      origin = current;
    if (contour?.closed && upper !== 'Z' && upper !== 'M') {
      contour = { closed: false, nodes: [{ ...current }] };
      paths.push(contour);
      count++;
    }
    const xy = () => {
      const x = number(),
        y = number();
      return point(x + (rel ? origin.x : 0), y + (rel ? origin.y : 0));
    };
    if (upper === 'Z') {
      if (!contour) throw new Error('Close requires a contour.');
      contour.closed = true;
      const first = contour.nodes[0]!,
        last = contour.nodes.at(-1)!;
      if (contour.nodes.length > 1 && equal(first, last)) {
        if (last.in) first.in = last.in;
        contour.nodes.pop();
      }
      current = point(first.x, first.y);
      cmd = '';
    } else if (upper === 'M') {
      current = xy();
      contour = { closed: false, nodes: [{ ...current }] };
      paths.push(contour);
      count++;
      cmd = rel ? 'l' : 'L';
    } else if (upper === 'L') append(xy());
    else if (upper === 'H') append(point(number() + (rel ? origin.x : 0), origin.y));
    else if (upper === 'V') append(point(origin.x, number() + (rel ? origin.y : 0)));
    else if (upper === 'C') {
      const a = xy(),
        b = xy(),
        end = xy();
      append(end, a, b);
      cubic = b;
    } else if (upper === 'S') {
      const a = (previous === 'C' || previous === 'S') && cubic ? reflected(cubic, origin) : origin,
        b = xy(),
        end = xy();
      append(end, a, b);
      cubic = b;
    } else if (upper === 'Q' || upper === 'T') {
      const q =
          upper === 'Q'
            ? xy()
            : (previous === 'Q' || previous === 'T') && quadratic
              ? reflected(quadratic, origin)
              : origin,
        end = xy();
      append(end, mix(origin, q, 2 / 3), mix(end, q, 2 / 3));
      quadratic = q;
    } else if (upper === 'A') {
      const flag = () => {
        const token = tokens[index];
        if (!token || (token[0] !== '0' && token[0] !== '1'))
          throw new Error('SVG arc flags must be 0 or 1.');
        const result = Number(token[0]);
        if (token.length === 1) index++;
        else tokens[index] = token.slice(1);
        return result;
      };
      const rx = number(),
        ry = number(),
        rotation = number(),
        large = flag(),
        sweep = flag(),
        end = xy();
      if (![0, 1].includes(large) || ![0, 1].includes(sweep))
        throw new Error('SVG arc flags must be 0 or 1.');
      for (const [a, b, p] of arc(origin, end, rx, ry, rotation, large, sweep)) append(p, a, b);
    } else throw new Error(`Unsupported SVG path command: ${cmd}`);
    previous = upper;
    if (count > MAX_NODES) throw new Error(`Point editing supports at most ${MAX_NODES} anchors.`);
    if (upper !== 'C' && upper !== 'S') cubic = undefined;
    if (upper !== 'Q' && upper !== 'T') quadratic = undefined;
  }
  if (!paths.length) throw new Error('The path has no anchors.');
  return paths;
}

export function serializeEditablePath(paths: EditablePath): string {
  const num = (n: number) => String(Number(finite(n).toFixed(6)));
  const xy = (p: PathPoint) => `${num(p.x)} ${num(p.y)}`;
  return paths
    .map(({ nodes, closed }) => {
      if (!nodes.length) throw new Error('A contour needs at least one anchor.');
      let d = `M ${xy(nodes[0]!)}`;
      for (let i = 1; i < nodes.length + (closed ? 1 : 0); i++) {
        const a = nodes[i - 1]!,
          b = nodes[i % nodes.length]!;
        if (a.out || b.in) d += ` C ${xy(a.out ?? a)} ${xy(b.in ?? b)} ${xy(b)}`;
        else if (i < nodes.length) d += ` L ${xy(b)}`;
      }
      return d + (closed ? ' Z' : '');
    })
    .join(' ');
}

/** Exact cubic extrema plus stroke padding, retaining the original box as the minimum extent. */
export function editablePathBounds(element: PathElement) {
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  const include = (p: PathPoint) => {
    x = Math.min(x, p.x);
    y = Math.min(y, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  };
  for (const contour of parseEditablePath(element.d)) {
    for (const node of contour.nodes) include(node);
    for (let i = 0; i < contour.nodes.length - (contour.closed ? 0 : 1); i++) {
      const p = contour.nodes[i]!,
        q = contour.nodes[(i + 1) % contour.nodes.length]!,
        u = p.out ?? p,
        v = q.in ?? q;
      for (const axis of ['x', 'y'] as const) {
        const a = -p[axis] + 3 * u[axis] - 3 * v[axis] + q[axis],
          b = 2 * (p[axis] - 2 * u[axis] + v[axis]),
          c = u[axis] - p[axis];
        const discriminant = b * b - 4 * a * c;
        const roots =
          Math.abs(a) < 1e-12
            ? Math.abs(b) < 1e-12
              ? []
              : [-c / b]
            : discriminant < 0
              ? []
              : [
                  (-b + Math.sqrt(discriminant)) / (2 * a),
                  (-b - Math.sqrt(discriminant)) / (2 * a),
                ];
        for (const t of roots)
          if (t > 0 && t < 1) {
            const l = mix(p, u, t),
              m = mix(u, v, t),
              r = mix(v, q, t);
            include(mix(mix(l, m, t), mix(m, r, t), t));
          }
      }
    }
  }
  const pad = element.strokeWidth / 2;
  x = Math.min(0, x - pad);
  y = Math.min(0, y - pad);
  right = Math.max(element.viewBoxWidth, right + pad);
  bottom = Math.max(element.viewBoxHeight, bottom + pad);
  return { x, y, width: right - x, height: bottom - y };
}

export function editPathGeometry(d: string, edit: PathEdit): string {
  if (edit.expectedD !== d)
    throw new Error('Path geometry changed. Read the path again before editing.');
  const paths = parseEditablePath(d);
  const ci = edit.contour,
    ni = edit.node;
  if (!Number.isInteger(ci) || !Number.isInteger(ni))
    throw new Error('Choose integer contour and node indices.');
  const contour = paths[ci!],
    nodes = contour?.nodes,
    n = nodes?.[ni!];
  if (!contour || !nodes || !n) throw new Error('Path anchor does not exist.');
  const prev = nodes[(ni! + nodes.length - 1) % nodes.length]!,
    next = nodes[(ni! + 1) % nodes.length]!;
  if (edit.action === 'move') {
    const x = finite(edit.x),
      y = finite(edit.y),
      dx = x - n.x,
      dy = y - n.y;
    if (n.in) n.in = point(n.in.x + dx, n.in.y + dy);
    if (n.out) n.out = point(n.out.x + dx, n.out.y + dy);
    n.x = x;
    n.y = y;
  } else if (edit.action === 'handles') {
    for (const [key, value] of [
      ['in', edit.incoming],
      ['out', edit.outgoing],
    ] as const) {
      if (value === null) delete n[key];
      else if (value !== undefined) n[key] = point(finite(value.x), finite(value.y));
    }
  } else if (edit.action === 'corner') {
    delete n.in;
    delete n.out;
  } else if (edit.action === 'smooth') {
    const before = ni! > 0 || contour.closed ? prev : n,
      after = ni! < nodes.length - 1 || contour.closed ? next : n;
    const dx = after.x - before.x,
      dy = after.y - before.y,
      len = Math.hypot(dx, dy) || 1;
    const a = Math.hypot(n.x - before.x, n.y - before.y) / 3,
      b = Math.hypot(after.x - n.x, after.y - n.y) / 3;
    if (before !== n) n.in = point(n.x - (dx / len) * a, n.y - (dy / len) * a);
    if (after !== n) n.out = point(n.x + (dx / len) * b, n.y + (dy / len) * b);
  } else if (edit.action === 'remove') {
    if (nodes.length <= (contour.closed ? 3 : 2))
      throw new Error(
        'Keep at least three anchors in a closed contour, or two in an open contour.',
      );
    nodes.splice(ni!, 1);
  } else if (edit.action === 'insert') {
    if (!contour.closed && ni === nodes.length - 1)
      throw new Error('The last anchor of an open contour has no following segment.');
    const t = edit.t ?? 0.5;
    if (!Number.isFinite(t) || t <= 0 || t >= 1)
      throw new Error('Segment position t must be between 0 and 1.');
    if (paths.reduce((sum, p) => sum + p.nodes.length, 0) >= MAX_NODES)
      throw new Error('Path anchor limit reached.');
    if (!n.out && !next.in) nodes.splice(ni! + 1, 0, mix(n, next, t));
    else {
      const a = mix(n, n.out ?? n, t),
        b = mix(n.out ?? n, next.in ?? next, t),
        c = mix(next.in ?? next, next, t),
        u = mix(a, b, t),
        v = mix(b, c, t),
        p = mix(u, v, t);
      n.out = a;
      next.in = c;
      nodes.splice(ni! + 1, 0, { ...p, in: u, out: v });
    }
  } else throw new Error('Choose a point edit action.');
  return serializeEditablePath(paths);
}

/** Explains conversion restrictions before changing any layer or animation. */
export function pathConversionError(layer: Layer): string | null {
  if (layer.isLocked) return 'Unlock the layer before editing its path.';
  if (!['rectangle', 'ellipse', 'path'].includes(layer.element.type))
    return 'Point editing supports rectangles, ellipses and paths.';
  if (layer.element.type === 'path') {
    try {
      parseEditablePath(layer.element.d);
    } catch (e) {
      return (e as Error).message;
    }
    return null;
  }
  if (
    layer.clipChildren &&
    layer.element.type === 'rectangle' &&
    Object.values(layer.element.borderRadius).some((r) => r > 0)
  )
    return 'This rounded rectangle clips children. Remove child clipping or use a separate path mask before converting.';
  if (layer.designTokenBindings.some((b) => b.targetProperty.startsWith('borderRadius')))
    return 'Unlink corner-radius Brand Kit tokens before converting; a path has editable corners instead.';
  return null;
}

export function convertLayerToPath(layer: Layer, frame = 0): void {
  const error = pathConversionError(layer);
  if (error) throw new Error(error);
  const el = layer.element;
  if (el.type === 'path') return;
  if (el.type !== 'rectangle' && el.type !== 'ellipse') throw new Error('Unsupported shape.');
  const { width, height } = getLayerTransformAtFrame(layer, frame);
  if (el.strokeWidth >= Math.min(width, height))
    throw new Error('Reduce the stroke below the shape dimensions before converting.');
  // CSS borders lie inside the box, whereas SVG strokes straddle the centerline.
  const inset = Math.min(el.strokeWidth / 2, width / 2, height / 2),
    w = width - 2 * inset,
    h = height - 2 * inset;
  let d: string;
  if (el.type === 'rectangle') {
    const r = clampCornerRadii(el.borderRadius, width, height);
    const tl = Math.max(0, r.topLeft - inset),
      tr = Math.max(0, r.topRight - inset),
      br = Math.max(0, r.bottomRight - inset),
      bl = Math.max(0, r.bottomLeft - inset);
    const corner = (radius: number, x: number, y: number) =>
      radius ? ` A ${radius} ${radius} 0 0 1 ${x} ${y}` : '';
    const contours = parseEditablePath(
      `M ${tl} 0 H ${w - tr}${corner(tr, w, tr)} V ${h - br}${corner(br, w - br, h)} H ${bl}${corner(bl, 0, h - bl)} V ${tl}${corner(tl, tl, 0)} Z`,
    );
    for (const contour of contours)
      for (const node of contour.nodes) {
        node.x += inset;
        node.y += inset;
        for (const key of ['in', 'out'] as const) {
          if (node[key]) {
            node[key]!.x += inset;
            node[key]!.y += inset;
          }
        }
      }
    d = serializeEditablePath(contours);
  } else
    d = serializeEditablePath(
      parseEditablePath(
        `M ${width / 2} ${inset} A ${w / 2} ${h / 2} 0 1 1 ${width / 2} ${height - inset} A ${w / 2} ${h / 2} 0 1 1 ${width / 2} ${inset} Z`,
      ),
    );
  layer.element = {
    type: 'path',
    overflow: 'visible',
    d,
    fill: el.fill,
    strokeColor: el.strokeColor,
    strokeWidth: el.strokeWidth,
    fillRule: 'nonzero',
    viewBoxWidth: width,
    viewBoxHeight: height,
  } satisfies PathElement;
}

export function applyPathEdit(layer: Layer, edit: PathEdit, frame = 0): void {
  const fields: Record<PathEdit['action'], string[]> = {
    convert: [],
    move: ['x', 'y'],
    handles: ['incoming', 'outgoing'],
    insert: ['t'],
    remove: [],
    smooth: [],
    corner: [],
  };
  if (!Object.hasOwn(fields, edit.action)) throw new Error('Unknown path edit action.');
  const allowed = new Set([
    'action',
    ...(edit.action === 'convert' ? [] : ['expectedD', 'contour', 'node']),
    ...fields[edit.action],
  ]);
  if (Object.keys(edit).some((key) => !allowed.has(key)))
    throw new Error('Unexpected field for this path edit action.');
  if (!Number.isFinite(frame) || frame < 0)
    throw new Error('Conversion frame must be nonnegative and finite.');
  if (layer.isLocked) throw new Error('Unlock the layer before editing its path.');
  if (edit.action === 'convert') {
    convertLayerToPath(layer, frame);
    return;
  }
  if (layer.element.type !== 'path')
    throw new Error('Convert the shape to a path before editing anchors.');
  layer.element.d = editPathGeometry(layer.element.d, edit);
  layer.element.overflow = 'visible';
}
