import {
  computeKeyframeFrames,
  createAnimationTracksFromLegacyLayer,
  createDefaultTransform,
  createId,
  createLayerKeyframe,
  createLayerOfKind,
  type Composition,
  type Layer,
} from '@ograf-editor/scene-model';
import { isAvailableImportFont } from './importFontAvailability';

interface FigmaNode {
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  bounds?: { x: number; y: number; width: number; height: number } | null;
  imageBounds?: { x: number; y: number; width: number; height: number } | null;
  rotation?: number;
  clipsContent?: boolean;
  unsupported?: boolean;
  fills?: Array<{
    type: string;
    visible?: boolean;
    opacity?: number;
    color?: { r: number; g: number; b: number };
  }>;
  characters?: string;
  fontName?: { family: string; style: string };
  fontSize?: number;
  textAlignHorizontal?: string;
  children?: FigmaNode[];
  png?: string;
}
interface FigmaInterchange {
  format: 'ograf-figma';
  version: 1;
  nodes: FigmaNode[];
}

export async function prepareFigma(file: File, composition: Composition) {
  if (file.size > 64 * 1024 * 1024)
    throw new Error('Figma interchange files over 64 MB are not supported.');
  const data: unknown = JSON.parse(await file.text());
  const result = mapFigmaInterchange(data, composition, isAvailableImportFont);
  for (const layer of result.layers) {
    if (layer.element.type !== 'image' || !layer.element.src) continue;
    const source = layer.element.src;
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      const timeout = setTimeout(
        () => reject(new Error(`Figma image ${layer.name} timed out.`)),
        15000,
      );
      image.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Figma image ${layer.name} is corrupt.`));
      };
      image.src = source;
    });
  }
  return result;
}

export function mapFigmaInterchange(
  data: unknown,
  composition: Composition,
  hasFont: (family: string) => boolean = () => false,
): { layers: Layer[]; warnings: string[] } {
  if (
    !data ||
    typeof data !== 'object' ||
    (data as FigmaInterchange).format !== 'ograf-figma' ||
    (data as FigmaInterchange).version !== 1 ||
    !Array.isArray((data as FigmaInterchange).nodes)
  )
    throw new Error('Choose a JSON file exported by the OGraf Studio Figma plugin.');
  const roots = (data as FigmaInterchange).nodes;
  if (!roots.length) throw new Error('The Figma export contains no selected nodes.');
  let visited = 0;
  let fallbackPixels = 0;
  const frames = computeKeyframeFrames(composition),
    layers: Layer[] = [],
    warnings: string[] = [];
  const visit = (
    node: FigmaNode,
    groupId: string | null,
    parentVisible: boolean,
    depth: number,
  ) => {
    if (++visited > 512) throw new Error('Figma export exceeds the 512-node limit.');
    if (
      !node ||
      typeof node !== 'object' ||
      typeof node.name !== 'string' ||
      typeof node.type !== 'string' ||
      depth > 32
    )
      throw new Error('Invalid Figma node or nesting depth.');
    const box = node.bounds;
    if (
      !box ||
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.width > 16384 ||
      box.height > 16384
    )
      throw new Error(`Invalid bounds for Figma node ${node.name}.`);
    const visible = parentVisible && node.visible !== false;
    const isGroup = Array.isArray(node.children) && node.children.length > 0;
    const simpleGroup =
      isGroup &&
      node.type === 'GROUP' &&
      !node.unsupported &&
      !node.clipsContent &&
      (node.opacity ?? 1) === 1 &&
      (!node.blendMode || node.blendMode === 'PASS_THROUGH');
    if (simpleGroup) {
      if (depth > 0)
        warnings.push(
          `Nested group ${node.name} was flattened into its outer editable group; its independent group boundary is not retained.`,
        );
      const childGroup = groupId ?? createId('group');
      for (const child of node.children!) visit(child, childGroup, visible, depth + 1);
      return;
    }
    const fills = (node.fills ?? []).filter((fill) => fill.visible !== false);
    const fill = fills[0];
    const solid =
      fills.length === 1 &&
      fill?.type === 'SOLID' &&
      fill.color &&
      [fill.color.r, fill.color.g, fill.color.b].every(
        (n) => Number.isFinite(n) && n >= 0 && n <= 1,
      ) &&
      (fill.opacity ?? 1) === 1;
    const rotation = node.rotation ?? 0;
    const common =
      !node.unsupported &&
      !isGroup &&
      (!node.blendMode || node.blendMode === 'NORMAL') &&
      rotation === 0 &&
      solid;
    const textOk =
      node.type === 'TEXT' &&
      common &&
      typeof node.characters === 'string' &&
      node.fontName &&
      typeof node.fontName.family === 'string' &&
      hasFont(node.fontName.family) &&
      typeof node.fontSize === 'number' &&
      node.fontSize > 0 &&
      ['left', 'center', 'right'].includes((node.textAlignHorizontal ?? 'LEFT').toLowerCase());
    const kind =
      common && node.type === 'RECTANGLE'
        ? 'rectangle'
        : common && node.type === 'ELLIPSE'
          ? 'ellipse'
          : textOk
            ? 'text'
            : 'image';
    const layer = createLayerOfKind(kind);
    layer.name = node.name;
    layer.isVisible = visible;
    layer.groupId = groupId;
    if (layer.element.type === 'image') {
      if (
        typeof node.png !== 'string' ||
        !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(node.png)
      )
        throw new Error(
          `Figma node ${node.name} needs its embedded PNG fallback. Export it again using the current plugin.`,
        );
      const header = Uint8Array.from(
        atob(node.png.slice('data:image/png;base64,'.length, 'data:image/png;base64,'.length + 32)),
        (char) => char.charCodeAt(0),
      );
      if (header.length < 24) throw new Error(`Figma image ${node.name} is truncated.`);
      const view = new DataView(header.buffer);
      const pngWidth = view.getUint32(16),
        pngHeight = view.getUint32(20);
      fallbackPixels += pngWidth * pngHeight;
      if (
        !pngWidth ||
        !pngHeight ||
        pngWidth * pngHeight > 16_777_216 ||
        fallbackPixels > 134_217_728
      )
        throw new Error(`Figma image ${node.name} exceeds safe image limits.`);
      layer.element.src = node.png;
      warnings.push(
        `${node.name} was preserved as an image because its Figma styling is not fully editable.`,
      );
    } else {
      const c = fill!.color!,
        color = `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
      if (layer.element.type === 'text') {
        Object.assign(layer.element, {
          content: node.characters,
          color,
          fontFamily: node.fontName!.family,
          fontWeight: /bold/i.test(node.fontName!.style) ? 700 : 400,
          fontSize: node.fontSize,
          textAlign: (node.textAlignHorizontal ?? 'LEFT').toLowerCase(),
          autoFit: 'fixed',
        });
        warnings.push(`Editable text ${node.name} may differ in baseline or kerning from Figma.`);
      } else Object.assign(layer.element, { fill: color });
    }
    const placement = layer.element.type === 'image' ? (node.imageBounds ?? box) : box;
    if (
      ![placement.x, placement.y, placement.width, placement.height].every(Number.isFinite) ||
      placement.width <= 0 ||
      placement.height <= 0 ||
      placement.width > 16384 ||
      placement.height > 16384
    )
      throw new Error(`Invalid image bounds for ${node.name}.`);
    const opacity = layer.element.type === 'image' ? 1 : (node.opacity ?? 1);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw new Error(`Invalid opacity for ${node.name}.`);
    layer.keyframes = composition.keyframes.map((_, i) =>
      createLayerKeyframe(
        frames[i]?.frame ?? 0,
        createDefaultTransform({
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
          opacity,
        }),
      ),
    );
    layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
    layers.push(layer);
    if (layers.length > 512) throw new Error('Figma export exceeds the 512-layer limit.');
  };
  for (const node of roots) visit(node, null, true, 0);
  return { layers, warnings };
}
