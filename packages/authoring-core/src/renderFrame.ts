import { getElementFill, hasElementShaderPaint, svgPaint } from '@ograf-editor/scene-model';
import {
  layerCropPolygon,
  effectStackToSvg,
  effectStackPadding,
  parseEffectProperty,
  withEffectParameter,
} from '@ograf-editor/scene-model';
import { applyElementDataValue } from '@ograf-editor/scene-model';
import {
  getLayerEffectsAtFrame,
  getCompositionOutputRect,
  type SourceCrop,
  getLayerAnimatableProperties,
  getLayerPropertyWithLighting,
  computeKeyframeFrames,
  TRANSFORM_ANIMATION_PROPERTIES,
  type LayerTransform,
  tilingSvgContent,
  resolvePatternElement,
  svgMaskSourceContent,
  layerMaskSvg,
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
  textAnimationVisibleText,
  valueAtSourcePath,
  type Composition,
  type Element,
  type FieldValue,
  type Layer,
  type Project,
  sampleTicker,
  getTickerLayout,
  isShaderPaint,
  isMediaPaint,
} from '@ograf-editor/scene-model';

const escapeXml = (value: unknown) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

function croppedImageSvg(
  src: string,
  width: number,
  height: number,
  crop: SourceCrop | undefined,
  fit: 'contain' | 'cover' | 'fill',
  id: string,
): string {
  const preserve = fit === 'fill' ? 'none' : fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
  if (!crop)
    return `<image width="${width}" height="${height}" preserveAspectRatio="${preserve}" href="${escapeXml(src)}"/>`;
  const sourceWidth = crop.sourceAspectRatio ?? width / height;
  const x = crop.x * sourceWidth,
    y = crop.y,
    w = crop.width * sourceWidth,
    h = crop.height;
  const clipId = `${id}-source-crop`;
  return `<svg width="${width}" height="${height}" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="${preserve}" overflow="hidden"><defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><image width="${sourceWidth}" height="1" preserveAspectRatio="none" clip-path="url(#${clipId})" href="${escapeXml(src)}"/></svg>`;
}

function elementSvg(
  element: Element,
  width: number,
  height: number,
  frame: number,
  compositionFrameRate: number,
  svgId = 'diagnostic-path',
): string {
  if (hasElementShaderPaint(element))
    return `<rect width="${width}" height="${height}" fill="transparent"/>`;
  switch (element.type) {
    case 'ticker': {
      const clipId = `${svgId}-ticker-clip`,
        fadeId = `${svgId}-ticker-fade`,
        gradientId = `${svgId}-ticker-gradient`;
      const sample = sampleTicker(element, width, (frame / compositionFrameRate) * 1000);
      const layout = getTickerLayout(element, height);
      const left = Math.min(
        width / 2,
        element.direction === 'left' ? element.exitFade : element.entryFade,
      );
      const right = Math.min(
        width / 2,
        element.direction === 'left' ? element.entryFade : element.exitFade,
      );
      const background =
        element.background &&
        !isShaderPaint(element.background) &&
        !isMediaPaint(element.background)
          ? svgPaint(element.background, width, height, `${svgId}-background`)
          : undefined;
      const fade =
        left || right
          ? `<linearGradient id="${gradientId}"><stop offset="0" stop-color="white" stop-opacity="${left ? 0 : 1}"/><stop offset="${width ? left / width : 0}" stop-color="white"/><stop offset="${width ? 1 - right / width : 1}" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="${right ? 0 : 1}"/></linearGradient><mask id="${fadeId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="url(#${gradientId})"/></mask>`
          : '';
      const tracks = Array.from({ length: Math.min(128, sample.copies) }, (_, copy) =>
        element.items
          .map((item, index) => {
            const box = layout[index]!;
            const x = box.x + copy * sample.period + sample.offset;
            if (x + box.width <= 0 || x >= width) return '';
            const itemId = `${svgId}-item-${copy}-${index}`;
            const filters = item.effects ? effectStackToSvg(item.effects) : '';
            const content = elementSvg(
              item.element,
              box.width,
              box.height,
              frame,
              compositionFrameRate,
              itemId,
            );
            return `<g transform="translate(${x} ${(height - box.height) / 2})"${filters ? ` filter="url(#${itemId}-effect)"` : ''}>${filters ? `<defs><filter id="${itemId}-effect">${filters}</filter></defs>` : ''}${content}</g>`;
          })
          .join(''),
      ).join('');
      return `<defs><clipPath id="${clipId}"><rect width="${width}" height="${height}"/></clipPath>${fade}${background?.defs ?? ''}</defs>${background ? `<rect width="${width}" height="${height}" fill="${background.fill}"/>` : ''}<g clip-path="url(#${clipId})"${fade ? ` mask="url(#${fadeId})"` : ''} direction="${element.textDirection}" style="unicode-bidi:plaintext">${tracks}</g>`;
    }
    case 'pattern':
      return element.definition
        ? `<svg width="${width}" height="${height}" viewBox="0 0 ${element.definition.width} ${element.definition.height}" preserveAspectRatio="none">${tilingSvgContent(element, svgId, 0)}</svg>`
        : '';
    case 'rectangle':
      return typeof element.fill === 'string'
        ? `<path d="${roundedRectangleSvgPath(width, height, element.borderRadius)}" fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.strokeColor)}" stroke-width="${element.strokeWidth}"/>`
        : `<foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;box-sizing:border-box;background:${escapeXml(paintToCss(element.fill))};border:${element.strokeWidth}px solid ${escapeXml(element.strokeColor)};border-radius:${cornerRadiiToCss(element.borderRadius)}"></div></foreignObject>`;
    case 'ellipse':
      return typeof element.fill === 'string'
        ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.strokeColor)}" stroke-width="${element.strokeWidth}"/>`
        : `<foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;box-sizing:border-box;background:${escapeXml(paintToCss(element.fill))};border:${element.strokeWidth}px solid ${escapeXml(element.strokeColor)};border-radius:50%"></div></foreignObject>`;
    case 'text': {
      const paint = svgPaint(getElementFill(element)!, width, height, `${svgId}-text-fill`);
      const paintDefs = paint.defs ? `<defs>${paint.defs}</defs>` : '';
      const visibleText = textAnimationVisibleText(element, frame);
      const transformed =
        element.textTransform === 'uppercase'
          ? visibleText.toUpperCase()
          : element.textTransform === 'lowercase'
            ? visibleText.toLowerCase()
            : element.textTransform === 'capitalize'
              ? visibleText.replace(/\b\p{L}/gu, (character) => character.toUpperCase())
              : visibleText;
      const lines = transformed.split(/\r?\n/);
      const anchor =
        element.textAlign === 'center' ? 'middle' : element.textAlign === 'right' ? 'end' : 'start';
      const x =
        element.textAlign === 'center' ? width / 2 : element.textAlign === 'right' ? width : 0;
      const blockHeight = Math.max(1, lines.length) * element.fontSize * element.lineHeight;
      if (element.autoFit === 'squeeze') {
        const naturalWidth = Math.max(
          1,
          ...lines.map((line) => {
            const characters = Array.from(line).length;
            return (
              characters * element.fontSize * 0.6 +
              Math.max(0, characters - 1) * element.letterSpacing +
              element.strokeWidth
            );
          }),
        );
        const scaleX = width / naturalWidth;
        const scaleY = height / Math.max(1, blockHeight + element.strokeWidth);
        return `${paintDefs}<g transform="scale(${scaleX} ${scaleY})"><text x="0" y="${element.fontSize + element.baselineShift}" fill="${paint.fill}" stroke="${element.strokeWidth > 0 ? escapeXml(element.strokeColor) : 'none'}" stroke-width="${element.strokeWidth}" paint-order="stroke fill" font-family="${escapeXml(element.fontFamily)}" font-size="${element.fontSize}" font-weight="${element.fontWeight}" letter-spacing="${element.letterSpacing}" text-anchor="start">${lines.map((line, index) => `<tspan x="0" dy="${index === 0 ? 0 : element.fontSize * element.lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text></g>`;
      }
      const verticalOffset =
        element.verticalAlign === 'middle'
          ? Math.max(0, (height - blockHeight) / 2)
          : element.verticalAlign === 'bottom'
            ? Math.max(0, height - blockHeight)
            : 0;
      return `${paintDefs}<text x="${x}" y="${verticalOffset + element.baselineShift + element.fontSize}" fill="${paint.fill}" stroke="${element.strokeWidth > 0 ? escapeXml(element.strokeColor) : 'none'}" stroke-width="${element.strokeWidth}" paint-order="stroke fill" font-family="${escapeXml(element.fontFamily)}" font-size="${element.fontSize}" font-weight="${element.fontWeight}" letter-spacing="${element.letterSpacing}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : element.fontSize * element.lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text>`;
    }
    case 'image':
      return element.src
        ? croppedImageSvg(element.src, width, height, element.crop, element.fit ?? 'contain', svgId)
        : '';
    case 'path':
      return svgMaskSourceContent(element, width, height, svgId);
    case 'image-sequence': {
      const elapsedSeconds = frame / compositionFrameRate;
      const rawIndex = Math.floor(elapsedSeconds * element.fps);
      const index = element.loop
        ? rawIndex % Math.max(1, element.frames.length)
        : Math.min(rawIndex, Math.max(0, element.frames.length - 1));
      const src = element.frames[index];
      return src
        ? croppedImageSvg(src, width, height, element.crop, element.fit ?? 'contain', svgId)
        : '';
    }
    case 'shader':
      // WebGL pixels require the authoritative browser capture path.
      return `<rect width="${width}" height="${height}" fill="transparent"/>`;
    case 'chart':
      // Chart providers paint a Canvas; use browser capture for authoritative pixels.
      return `<rect width="${width}" height="${height}" fill="transparent"/>`;
    case 'lottie':
      // The authoritative DOM/canvas capture path renders the exact Lottie frame. This lightweight
      // pure-SVG authoring overview cannot run a Canvas2D player, so retain the layer bounds.
      return `<rect width="${width}" height="${height}" fill="transparent"/>`;
    case 'audio':
      // Audio has no diagnostic SVG pixels. Playback is handled by the authoritative browser runtime.
      return '';
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
  if (!layer.isVisible || layer.isGuide || layer.isMaskOnly) return '';
  const transform = { ...getLayerTransformAtFrame(layer, frame) };
  transform.x += options.offsetX ?? 0;
  transform.y += options.offsetY ?? 0;
  let effects = getLayerEffectsAtFrame(layer, frame);
  for (const binding of layer.bindings) {
    if (
      binding.targetProperty !== 'dropShadowColor' &&
      !parseEffectProperty(binding.targetProperty)
    )
      continue;
    const field = composition.dataFields.find((f) => f.id === binding.fieldId);
    const value = valueAtSourcePath(
      field && options.collectionFieldId === field.id
        ? options.itemValue
        : field
          ? data[field.key]
          : undefined,
      binding.sourcePath,
    );
    if (value !== undefined) {
      const mapped = binding.valueMap?.[String(value)] ?? value;
      effects =
        binding.targetProperty === 'dropShadowColor'
          ? { ...effects, dropShadowColor: String(mapped) }
          : withEffectParameter(effects, binding.targetProperty, mapped);
    }
  }
  const filterId = `filter-${escapeXml(layer.id)}${escapeXml(options.idSuffix ?? '')}`;
  const filters = effectStackToSvg(effects);
  const filterPadding = effectStackPadding(effects);
  const originX = transform.transformOriginX * transform.width;
  const originY = transform.transformOriginY * transform.height;
  const scale = Math.max(0, getLayerPropertyValueAtFrame(layer, 'scale', frame));
  const scaleTransform =
    scale === 1
      ? ''
      : ` translate(${originX} ${originY}) scale(${scale}) translate(${-originX} ${-originY})`;
  const inset = (property: 'clipLeft' | 'clipRight' | 'clipTop' | 'clipBottom') =>
    Math.min(1, Math.max(0, getLayerPropertyValueAtFrame(layer, property, frame)));
  const insetLeft = inset('clipLeft');
  const insetRight = inset('clipRight');
  const insetTop = inset('clipTop');
  const insetBottom = inset('clipBottom');
  const revealId = `reveal-${escapeXml(layer.id)}${escapeXml(options.idSuffix ?? '')}`;
  const reveal =
    insetLeft || insetRight || insetTop || insetBottom
      ? `<clipPath id="${revealId}"><rect x="${insetLeft * transform.width}" y="${insetTop * transform.height}" width="${Math.max(0, 1 - insetLeft - insetRight) * transform.width}" height="${Math.max(0, 1 - insetTop - insetBottom) * transform.height}"/></clipPath>`
      : '';
  const resolveElement = (candidate: Layer) =>
    resolveElementAssetReferences(
      candidate.bindings.reduce<Element>((resolved, binding) => {
        const field = composition.dataFields.find((candidate) => candidate.id === binding.fieldId);
        if (!field) return resolved;
        const root = options.collectionFieldId === field.id ? options.itemValue : data[field.key];
        const value = valueAtSourcePath(root, binding.sourcePath);
        if (value === undefined) return resolved;
        const mapped = binding.valueMap?.[String(value)] ?? value;
        return applyElementDataValue(resolved, binding.targetProperty, mapped);
      }, candidate.element),
      composition.assets,
    );
  const resolvedElement = resolvePatternElement(resolveElement(layer), composition.patterns);
  const element =
    resolvedElement.type === 'text'
      ? {
          ...resolvedElement,
          strokeWidth: getLayerPropertyValueAtFrame(layer, 'strokeWidth', frame),
          ...(resolvedElement.fill !== undefined
            ? {
                fill: getPaintAtFrame(
                  resolvedElement.fill,
                  getResolvedLayerAnimationTracks(layer),
                  frame,
                ),
              }
            : {}),
        }
      : (resolvedElement.type === 'rectangle' ||
            resolvedElement.type === 'ellipse' ||
            resolvedElement.type === 'path') &&
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
  const elementContent = elementSvg(
    element,
    transform.width,
    transform.height,
    frame,
    compositionFrameRate,
    `path-${escapeXml(layer.id)}${escapeXml(options.idSuffix ?? '')}`,
  );
  const content = reveal
    ? `<g clip-path="url(#${revealId})">${elementContent}</g>`
    : elementContent;
  const layerCropId = `layer-crop-${escapeXml(layer.id)}${escapeXml(options.idSuffix ?? '')}`;
  const cropPoints = layer.crop ? layerCropPolygon(layer.crop) : undefined;
  const cropClip = cropPoints
    ? `<clipPath id="${layerCropId}"><polygon points="${cropPoints.map((point) => `${point.x * transform.width},${point.y * transform.height}`).join(' ')}"/></clipPath>`
    : '';
  const croppedContent = cropClip ? `<g clip-path="url(#${layerCropId})">${content}</g>` : content;
  const maskId = 'mask-' + escapeXml(layer.id) + escapeXml(options.idSuffix ?? '');
  const mask = layer.mask
    ? layerMaskSvg(
        layer.id,
        new Map(
          composition.layers.map((source) => [
            source.id,
            {
              ...source,
              element: resolveElement(source),
              clipParentId:
                composition.layers.find(
                  (parent) => parent.id === source.parentId && parent.clipChildren,
                )?.id ?? null,
            },
          ]),
        ),
        new Map(
          composition.layers.map((source) => [
            source.id,
            {
              transform: {
                ...getLayerTransformAtFrame(source, frame),
                x: getLayerTransformAtFrame(source, frame).x + (options.offsetX ?? 0),
                y: getLayerTransformAtFrame(source, frame).y + (options.offsetY ?? 0),
              },
              effects: getLayerEffectsAtFrame(source, frame),
              paintTracks: getResolvedLayerAnimationTracks(source),
              paintFrame: frame,
            },
          ]),
        ),
        maskId,
      )
    : '';
  return `<defs>${filters ? `<filter id="${filterId}" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" x="${-filterPadding}" y="${-filterPadding}" width="${transform.width + 2 * filterPadding}" height="${transform.height + 2 * filterPadding}">${filters}</filter>` : ''}${clip}${reveal}${cropClip}${mask}</defs><g transform="translate(${transform.x} ${transform.y}) rotate(${transform.rotation} ${originX} ${originY})${scaleTransform}" opacity="${transform.opacity}"${layer.blendMode === 'normal' ? '' : ` style="mix-blend-mode:${layer.blendMode}"`}${filters ? ` filter="url(#${filterId})"` : ''}${mask ? ` mask="url(#${maskId})"` : ''}>${clip ? `<g clip-path="url(#${clipId})">${croppedContent}</g>` : croppedContent}</g>`;
}

export function renderCompositionFrameSvg(
  project: Project,
  compositionId = project.mainCompositionId,
  frame = 0,
): { svg: string; composition: Composition; frame: number } {
  const sourceComposition = project.compositions.find(
    (candidate) => candidate.id === compositionId,
  );
  if (!sourceComposition) throw new Error(`Composition not found: ${compositionId}`);
  const normalizedFrame = Math.max(
    0,
    Math.min(getTotalFrames(sourceComposition), Math.round(frame)),
  );
  const firstStep = computeKeyframeFrames(sourceComposition).find(
    (key) => sourceComposition.keyframes.find((k) => k.id === key.keyframeId)?.role === 'step',
  )?.frame;
  const elapsed =
    firstStep !== undefined &&
    normalizedFrame >= firstStep &&
    normalizedFrame < getTotalFrames(sourceComposition)
      ? normalizedFrame - firstStep
      : undefined;
  const composition = {
    ...sourceComposition,
    layers: sourceComposition.layers.map((layer) => {
      if (!layer.lighting) return layer;
      const value = (property: Parameters<typeof getLayerPropertyWithLighting>[2]) =>
        getLayerPropertyWithLighting(
          layer,
          sourceComposition.patterns,
          property,
          normalizedFrame,
          elapsed,
        );
      const transform = Object.fromEntries(
        TRANSFORM_ANIMATION_PROPERTIES.map((p) => [p, value(p)]),
      ) as unknown as LayerTransform;
      return {
        ...layer,
        keyframes: layer.keyframes.map((key) => ({ ...key, transform })),
        loop: null,
        animationTracks: Object.fromEntries(
          getLayerAnimatableProperties(layer).map((p) => [
            p,
            [
              {
                id: `lighting-preview:${layer.id}:${p}`,
                frame: 0,
                value: value(p),
                easing: 'linear' as const,
              },
            ],
          ]),
        ),
      };
    }),
  };
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
  const output = getCompositionOutputRect(composition);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" height="${output.height}" viewBox="${output.x} ${output.y} ${output.width} ${output.height}" style="isolation:isolate">${background}${content}</svg>`;
  return { svg, composition, frame: normalizedFrame };
}
