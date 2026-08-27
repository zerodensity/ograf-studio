import {
  getLayerEffectsAtFrame,
  getPaintAtFrame,
  getLayerPropertyValueAtFrame,
  getResolvedLayerAnimationTracks,
  getLayerTransformAtFrame,
  getTotalFrames,
  paintToCss,
  cornerRadiiToCss,
  clipPathSvgForParentBounds,
  roundedRectangleSvgPath,
  resolveElementAssetReferences,
  valueAtSourcePath,
  type Composition,
  type Element,
  type FieldValue,
  type Layer,
  type Project,
} from '@ograf-editor/scene-model';

const escapeXml = (value: unknown) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

function elementSvg(
  element: Element,
  width: number,
  height: number,
  frame: number,
  compositionFrameRate: number,
): string {
  switch (element.type) {
    case 'rectangle':
      return typeof element.fill === 'string'
        ? `<path d="${roundedRectangleSvgPath(width, height, element.borderRadius)}" fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.strokeColor)}" stroke-width="${element.strokeWidth}"/>`
        : `<foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;box-sizing:border-box;background:${escapeXml(paintToCss(element.fill))};border:${element.strokeWidth}px solid ${escapeXml(element.strokeColor)};border-radius:${cornerRadiiToCss(element.borderRadius)}"></div></foreignObject>`;
    case 'ellipse':
      return typeof element.fill === 'string'
        ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.strokeColor)}" stroke-width="${element.strokeWidth}"/>`
        : `<foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;box-sizing:border-box;background:${escapeXml(paintToCss(element.fill))};border:${element.strokeWidth}px solid ${escapeXml(element.strokeColor)};border-radius:50%"></div></foreignObject>`;
    case 'text': {
      const transformed =
        element.textTransform === 'uppercase'
          ? element.content.toUpperCase()
          : element.textTransform === 'lowercase'
            ? element.content.toLowerCase()
            : element.textTransform === 'capitalize'
              ? element.content.replace(/\b\p{L}/gu, (character) => character.toUpperCase())
              : element.content;
      const lines = transformed.split(/\r?\n/);
      const anchor =
        element.textAlign === 'center' ? 'middle' : element.textAlign === 'right' ? 'end' : 'start';
      const x =
        element.textAlign === 'center' ? width / 2 : element.textAlign === 'right' ? width : 0;
      const blockHeight = Math.max(1, lines.length) * element.fontSize * element.lineHeight;
      const verticalOffset =
        element.verticalAlign === 'middle'
          ? Math.max(0, (height - blockHeight) / 2)
          : element.verticalAlign === 'bottom'
            ? Math.max(0, height - blockHeight)
            : 0;
      return `<text x="${x}" y="${verticalOffset + element.baselineShift + element.fontSize}" fill="${escapeXml(element.color)}" stroke="${element.strokeWidth > 0 ? escapeXml(element.strokeColor) : 'none'}" stroke-width="${element.strokeWidth}" paint-order="stroke fill" font-family="${escapeXml(element.fontFamily)}" font-size="${element.fontSize}" font-weight="${element.fontWeight}" letter-spacing="${element.letterSpacing}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : element.fontSize * element.lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text>`;
    }
    case 'image':
      return element.src
        ? `<image width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(element.src)}"/>`
        : '';
    case 'path':
      return `<svg width="${width}" height="${height}" viewBox="0 0 ${element.viewBoxWidth} ${element.viewBoxHeight}" preserveAspectRatio="none"><path d="${escapeXml(element.d)}" fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.strokeColor)}" stroke-width="${element.strokeWidth}"/></svg>`;
    case 'image-sequence': {
      const elapsedSeconds = frame / compositionFrameRate;
      const rawIndex = Math.floor(elapsedSeconds * element.fps);
      const index = element.loop
        ? rawIndex % Math.max(1, element.frames.length)
        : Math.min(rawIndex, Math.max(0, element.frames.length - 1));
      const src = element.frames[index];
      return src
        ? `<image width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(src)}"/>`
        : '';
    }
    case 'lottie':
      // The authoritative DOM/canvas capture path renders the exact Lottie frame. This lightweight
      // pure-SVG authoring overview cannot run a Canvas2D player, so retain the layer bounds.
      return `<rect width="${width}" height="${height}" fill="transparent"/>`;
  }
}

function layerSvg(
  layer: Layer,
  frame: number,
  compositionFrameRate: number,
  composition: Composition,
  data: Record<string, FieldValue>,
  options: {
    itemValue?: FieldValue;
    collectionFieldId?: string;
    offsetX?: number;
    offsetY?: number;
    idSuffix?: string;
  } = {},
): string {
  if (!layer.isVisible || layer.isGuide) return '';
  const transform = { ...getLayerTransformAtFrame(layer, frame) };
  transform.x += options.offsetX ?? 0;
  transform.y += options.offsetY ?? 0;
  const effects = getLayerEffectsAtFrame(layer, frame);
  const filterId = `filter-${escapeXml(layer.id)}${escapeXml(options.idSuffix ?? '')}`;
  const filters = [
    effects.blur > 0 ? `<feGaussianBlur stdDeviation="${effects.blur}"/>` : '',
    effects.dropShadowEnabled
      ? `<feDropShadow dx="${effects.dropShadowOffsetX}" dy="${effects.dropShadowOffsetY}" stdDeviation="${effects.dropShadowBlur}" flood-color="${escapeXml(effects.dropShadowColor)}" flood-opacity="${effects.dropShadowOpacity}"/>`
      : '',
  ].join('');
  const originX = transform.transformOriginX * transform.width;
  const originY = transform.transformOriginY * transform.height;
  const boundElement = layer.bindings.reduce<Element>((resolved, binding) => {
    const field = composition.dataFields.find((candidate) => candidate.id === binding.fieldId);
    if (!field) return resolved;
    const root = options.collectionFieldId === field.id ? options.itemValue : data[field.key];
    const value = valueAtSourcePath(root, binding.sourcePath);
    if (value === undefined) return resolved;
    const mapped = binding.valueMap?.[String(value)] ?? value;
    return {
      ...resolved,
      [binding.targetProperty]:
        binding.targetProperty === 'fill' && mapped && typeof mapped === 'object'
          ? mapped
          : String(mapped),
    } as Element;
  }, layer.element);
  const resolvedElement = resolveElementAssetReferences(boundElement, composition.assets);
  const element =
    resolvedElement.type === 'text'
      ? {
          ...resolvedElement,
          strokeWidth: getLayerPropertyValueAtFrame(layer, 'strokeWidth', frame),
        }
      : (resolvedElement.type === 'rectangle' || resolvedElement.type === 'ellipse') &&
          typeof resolvedElement.fill !== 'string'
        ? {
            ...resolvedElement,
            fill: getPaintAtFrame(
              resolvedElement.fill,
              getResolvedLayerAnimationTracks(layer),
              frame,
            ),
          }
        : resolvedElement;
  const parent = layer.parentId
    ? composition.layers.find(
        (candidate) => candidate.id === layer.parentId && candidate.clipChildren,
      )
    : undefined;
  const clipId = `clip-${escapeXml(layer.id)}${escapeXml(options.idSuffix ?? '')}`;
  const parentTransform = parent ? { ...getLayerTransformAtFrame(parent, frame) } : null;
  if (parentTransform) {
    parentTransform.x += options.offsetX ?? 0;
    parentTransform.y += options.offsetY ?? 0;
  }
  const clip =
    parent && parentTransform
      ? `<clipPath id="${clipId}"><path d="${escapeXml(clipPathSvgForParentBounds(transform, parentTransform, parent.element.type === 'rectangle' ? parent.element.borderRadius : 0))}"/></clipPath>`
      : '';
  const content = elementSvg(
    element,
    transform.width,
    transform.height,
    frame,
    compositionFrameRate,
  );
  return `<defs>${filters ? `<filter id="${filterId}" x="-100%" y="-100%" width="300%" height="300%">${filters}</filter>` : ''}${clip}</defs><g transform="translate(${transform.x} ${transform.y}) rotate(${transform.rotation} ${originX} ${originY})" opacity="${transform.opacity}"${layer.blendMode === 'normal' ? '' : ` style="mix-blend-mode:${layer.blendMode}"`}${filters ? ` filter="url(#${filterId})"` : ''}>${clip ? `<g clip-path="url(#${clipId})">${content}</g>` : content}</g>`;
}

export function renderCompositionFrameSvg(
  project: Project,
  compositionId = project.mainCompositionId,
  frame = 0,
): { svg: string; composition: Composition; frame: number } {
  const composition = project.compositions.find((candidate) => candidate.id === compositionId);
  if (!composition) throw new Error(`Composition not found: ${compositionId}`);
  const normalizedFrame = Math.max(0, Math.min(getTotalFrames(composition), Math.round(frame)));
  const background =
    composition.backgroundColor === 'transparent'
      ? ''
      : `<rect width="100%" height="100%" fill="${escapeXml(composition.backgroundColor)}"/>`;
  const data = Object.fromEntries(
    composition.dataFields.map((field) => [field.key, field.defaultValue]),
  );
  const collectionByLayerId = new Map(
    composition.runtimeCollections.flatMap((collection) =>
      collection.prototypeLayerIds.map((layerId) => [layerId, collection] as const),
    ),
  );
  const emittedCollections = new Set<string>();
  const content = composition.layers
    .map((layer) => {
      const collection = collectionByLayerId.get(layer.id);
      if (!collection) {
        return layerSvg(layer, normalizedFrame, composition.frameRate, composition, data);
      }
      if (emittedCollections.has(collection.id)) return '';
      emittedCollections.add(collection.id);
      const field = composition.dataFields.find((candidate) => candidate.id === collection.fieldId);
      const items = field && Array.isArray(field.defaultValue) ? field.defaultValue : [];
      return items
        .slice(0, collection.capacity)
        .map((itemValue, index) =>
          collection.prototypeLayerIds
            .map((layerId) => {
              const prototype = composition.layers.find((candidate) => candidate.id === layerId);
              return prototype
                ? layerSvg(prototype, normalizedFrame, composition.frameRate, composition, data, {
                    itemValue,
                    collectionFieldId: collection.fieldId,
                    offsetX: collection.offsetPerItem.x * index,
                    offsetY: collection.offsetPerItem.y * index,
                    idSuffix: `-${collection.id}-${index}`,
                  })
                : '';
            })
            .join(''),
        )
        .join('');
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${composition.width}" height="${composition.height}" viewBox="0 0 ${composition.width} ${composition.height}" style="isolation:isolate">${background}${content}</svg>`;
  return { svg, composition, frame: normalizedFrame };
}
