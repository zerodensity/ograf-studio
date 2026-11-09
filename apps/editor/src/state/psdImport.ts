import { readPsd, type Layer as PsdLayer, type PixelData, type Psd } from 'ag-psd';
import { isAvailableImportFont } from './importFontAvailability';
import {
  computeKeyframeFrames,
  createAnimationTracksFromLegacyLayer,
  createDefaultTransform,
  createId,
  createLayerKeyframe,
  createLayerOfKind,
  type BlendMode,
  type Composition,
  type Layer,
} from '@ograf-editor/scene-model';

const blendModes = new Set<BlendMode>([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
]);

/** A solid Photoshop rectangle uses a vector mask as its shape, without clipping other artwork. */
function psdRectangle(node: PsdLayer) {
  const mask = node.vectorMask;
  const fill = node.vectorFill;
  if (
    !mask ||
    mask.invert ||
    mask.disable ||
    mask.notLink ||
    mask.fillStartsWithAllPixels ||
    mask.paths.length !== 1 ||
    node.children ||
    node.text ||
    node.vectorStroke ||
    fill?.type !== 'color'
  )
    return null;

  const path = mask.paths[0]!;
  if (path.open || (path.operation && path.operation !== 'combine') || path.knots.length !== 4)
    return null;
  const corners = path.knots.map((knot) => knot.points);
  if (
    corners.some(
      (points) =>
        points.length !== 6 ||
        points.some((value, index) => !Number.isFinite(value) || value !== points[index % 2]),
    )
  )
    return null;

  // The knots contain incoming handle, anchor and outgoing handle in document pixels.
  const xs = corners.map((points) => points[2]!);
  const ys = corners.map((points) => points[3]!);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  if (
    left === right ||
    top === bottom ||
    new Set(xs).size !== 2 ||
    new Set(ys).size !== 2 ||
    new Set(xs.map((x, index) => `${x},${ys[index]}`)).size !== 4 ||
    xs.some((x, index) => (x === xs[(index + 1) % 4]) === (ys[index] === ys[(index + 1) % 4]))
  )
    return null;

  const color = fill.color;
  if (!('r' in color && 'g' in color && 'b' in color) || ('a' in color && color.a !== 255))
    return null;
  return {
    fill: `rgb(${color.r}, ${color.g}, ${color.b})`,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/** Import supported Photoshop objects as layers. Unsupported compositing uses the merged preview. */
export async function preparePsd(
  file: File,
  composition: Composition,
): Promise<{ layers: Layer[]; warnings: string[] }> {
  if (file.size > 64 * 1024 * 1024)
    throw new Error('PSD files over 64 MB are not supported by this importer.');
  const bytes = await file.arrayBuffer();
  const psd = readPsd(bytes, {
    useImageData: true,
    skipThumbnail: true,
    totalMemoryLimit: 256 * 1024 * 1024,
  });
  return mapPsdLayers(psd, composition, pixelsToPng, isAvailableImportFont);
}

export function mapPsdLayers(
  psd: Psd,
  composition: Composition,
  png: (pixels: PixelData) => string,
  hasFont: (family: string) => boolean = () => false,
): { layers: Layer[]; warnings: string[] } {
  if (
    !Number.isFinite(psd.width) ||
    !Number.isFinite(psd.height) ||
    psd.width <= 0 ||
    psd.height <= 0 ||
    psd.width > 8192 ||
    psd.height > 8192
  )
    throw new Error('PSD dimensions are invalid or too large.');
  const warnings: string[] = [];
  const layers: Layer[] = [];
  const frames = computeKeyframeFrames(composition);
  const supportedBlend = (mode: PsdLayer['blendMode']) =>
    blendModes.has((mode ?? 'normal').replaceAll(' ', '-') as BlendMode);
  const unsupported = (nodes: PsdLayer[]): boolean =>
    nodes.some((node) => {
      const group = Boolean(node.children);
      return Boolean(
        node.effects ||
        node.mask ||
        node.realMask ||
        node.filterMask ||
        (node.vectorMask && !psdRectangle(node)) ||
        node.knockout ||
        node.clipping ||
        node.adjustment ||
        (!group && !supportedBlend(node.blendMode)) ||
        (group &&
          ((node.blendMode && !['normal', 'pass through'].includes(node.blendMode)) ||
            (node.opacity ?? 1) !== 1)) ||
        (node.children && unsupported(node.children)),
      );
    });
  const imageLayer = (
    name: string,
    image: PixelData,
    x: number,
    y: number,
    opacity: number,
    visible: boolean,
    blend: BlendMode,
    groupId: string | null,
  ) => {
    if (!image.width || !image.height) throw new Error(`PSD layer ${name} has no usable pixels.`);
    const layer = createLayerOfKind('image');
    if (layer.element.type !== 'image') throw new Error('Could not create image layer.');
    layer.name = name;
    layer.element.src = png(image);
    layer.isVisible = visible;
    layer.blendMode = blend;
    layer.groupId = groupId;
    layer.keyframes = composition.keyframes.map((_, i) =>
      createLayerKeyframe(
        frames[i]?.frame ?? 0,
        createDefaultTransform({ x, y, width: image.width, height: image.height, opacity }),
      ),
    );
    layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
    layers.push(layer);
  };
  if (unsupported(psd.children ?? [])) {
    if (!psd.imageData)
      throw new Error(
        'This PSD uses effects or compositing that cannot be preserved without its merged image.',
      );
    if (psd.imageData.width !== psd.width || psd.imageData.height !== psd.height)
      throw new Error('The PSD merged image does not match its document dimensions.');
    imageLayer('PSD merged image', psd.imageData, 0, 0, 1, true, 'normal', null);
    warnings.push(
      'Unsupported masks, effects or compositing were preserved in the merged image; individual layers are not editable.',
    );
    return { layers, warnings };
  }
  const visit = (
    nodes: PsdLayer[],
    groupId: string | null,
    parentVisible: boolean,
    depth: number,
  ) => {
    if (depth > 32) throw new Error('PSD groups exceed the 32-level limit.');
    // Photoshop lists topmost first; Studio's layer list is back-to-front.
    for (const node of [...nodes].reverse()) {
      const visible = parentVisible && !node.hidden;
      if (node.children) {
        if (depth === 0)
          warnings.push(`Group ${node.name ?? 'Group'} was imported as an unnamed Studio group.`);
        if (depth > 0)
          warnings.push(
            `Nested group ${node.name ?? 'Group'} is flattened to its nearest editable group.`,
          );
        visit(node.children, createId('group'), visible, depth + 1);
        continue;
      }
      const rectangle = psdRectangle(node);
      if (rectangle) {
        const { fill, ...bounds } = rectangle;
        const layer = createLayerOfKind('rectangle');
        if (layer.element.type !== 'rectangle') throw new Error('Could not create rectangle layer.');
        layer.name = node.name || 'PSD rectangle';
        layer.element.fill = fill;
        layer.isVisible = visible;
        layer.blendMode = (node.blendMode ?? 'normal').replaceAll(' ', '-') as BlendMode;
        layer.groupId = groupId;
        layer.keyframes = composition.keyframes.map((_, i) =>
          createLayerKeyframe(
            frames[i]?.frame ?? 0,
            createDefaultTransform({
              ...bounds,
              opacity: (node.opacity ?? 1) * (node.fillOpacity ?? 1),
            }),
          ),
        );
        layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
        layers.push(layer);
        if (layers.length > 512) throw new Error('PSD exceeds the 512-layer import limit.');
        continue;
      }
      if (!node.imageData) {
        if ((node.right ?? 0) === (node.left ?? 0) || (node.bottom ?? 0) === (node.top ?? 0))
          continue;
        throw new Error(`PSD layer ${node.name ?? 'unnamed'} has no saved pixels.`);
      }
      const blend = (node.blendMode ?? 'normal').replaceAll(' ', '-') as BlendMode;
      const text = node.text;
      const style = text?.style;
      const color = style?.fillColor;
      const face = style?.font?.name;
      // Photoshop stores PostScript face names, but CSS looks up the family plus weight.
      const arialFace = face?.toLowerCase();
      const family = arialFace === 'arialmt' || arialFace === 'arial-boldmt' ? 'Arial' : face;
      const fontWeight = style?.fauxBold || arialFace === 'arial-boldmt' ? 700 : 400;
      const transform = text?.transform;
      const warp = text?.warp;
      const canEditText = Boolean(
        text &&
        style &&
        family &&
        hasFont(family) &&
        style.fontSize &&
        style.fontSize > 0 &&
        color &&
        'r' in color &&
        'g' in color &&
        'b' in color &&
        !style.fauxItalic &&
        !style.strokeFlag &&
        style.fillFlag !== false &&
        !style.underline &&
        !style.strikethrough &&
        (!style.horizontalScale || style.horizontalScale === 1) &&
        (!style.verticalScale || style.verticalScale === 1) &&
        (!('a' in color) || color.a === 1 || color.a === 255) &&
        !text.textPath &&
        text.orientation !== 'vertical' &&
        // The PSD text decoder returns a warp descriptor even when no warp is applied.
        (!warp ||
          ((!warp.style || warp.style === 'none') &&
            (warp.value ?? 0) === 0 &&
            (warp.perspective ?? 0) === 0 &&
            (warp.perspectiveOther ?? 0) === 0 &&
            !warp.values?.some((value) => value !== 0) &&
            !warp.customEnvelopeWarp)) &&
        (!text.styleRuns || text.styleRuns.length <= 1) &&
        (!text.paragraphStyleRuns || text.paragraphStyleRuns.length <= 1) &&
        (!transform ||
          (transform.length === 6 &&
            transform[0] === 1 &&
            transform[1] === 0 &&
            transform[2] === 0 &&
            transform[3] === 1)),
      );
      if (
        canEditText &&
        text &&
        style &&
        family &&
        color &&
        'r' in color &&
        'g' in color &&
        'b' in color
      ) {
        const layer = createLayerOfKind('text');
        if (layer.element.type !== 'text') throw new Error('Could not create text layer.');
        layer.name = node.name || 'PSD text';
        layer.isVisible = visible;
        layer.blendMode = blend;
        layer.groupId = groupId;
        const fontSize = style.fontSize!;
        Object.assign(layer.element, {
          content: text.text,
          fontFamily: family,
          fontSize,
          fontWeight,
          color: `rgb(${color.r}, ${color.g}, ${color.b})`,
          letterSpacing: ((style.tracking ?? 0) * fontSize) / 1000,
          lineHeight: style.leading ? style.leading / fontSize : 1.2,
          textAlign: ['left', 'center', 'right'].includes(text.paragraphStyle?.justification ?? '')
            ? text.paragraphStyle!.justification
            : 'left',
          autoFit: 'fixed',
        });
        layer.keyframes = composition.keyframes.map((_, i) =>
          createLayerKeyframe(
            frames[i]?.frame ?? 0,
            createDefaultTransform({
              x: node.left ?? 0,
              y: node.top ?? 0,
              width: node.imageData!.width,
              height: node.imageData!.height,
              opacity: node.opacity ?? 1,
            }),
          ),
        );
        layer.animationTracks = createAnimationTracksFromLegacyLayer(layer);
        layers.push(layer);
        warnings.push(
          `Editable text ${layer.name} may differ in baseline or kerning from Photoshop.`,
        );
      } else {
        if (node.text)
          warnings.push(
            `Text layer ${node.name ?? 'unnamed'} was preserved as an image because its font or styling could not be reproduced.`,
          );
        imageLayer(
          node.name || 'PSD layer',
          node.imageData,
          node.left ?? 0,
          node.top ?? 0,
          node.opacity ?? 1,
          visible,
          blend,
          groupId,
        );
      }
      if (layers.length > 512) throw new Error('PSD exceeds the 512-layer import limit.');
    }
  };
  visit(psd.children ?? [], null, true, 0);
  if (!layers.length) {
    if (!psd.imageData) throw new Error('The PSD contains no saved layer or merged pixels.');
    imageLayer('PSD merged image', psd.imageData, 0, 0, 1, true, 'normal', null);
    warnings.push('The PSD has no saved layers; its merged image was imported.');
  }
  return { layers, warnings };
}

function pixelsToPng(pixels: PixelData): string {
  if (
    !(pixels.data instanceof Uint8Array || pixels.data instanceof Uint8ClampedArray) ||
    pixels.data.length !== pixels.width * pixels.height * 4
  )
    throw new Error('This PSD uses an unsupported pixel format.');
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.putImageData(
    new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height),
    0,
    0,
  );
  return canvas.toDataURL('image/png');
}
