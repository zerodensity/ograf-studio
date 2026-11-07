figma.showUI(__html__, { width: 360, height: 190, title: 'OGraf Studio Export' });
figma.ui.onmessage = async (message) => {
  if (message.type !== 'export') return;
  try {
    const selected = figma.currentPage.selection;
    if (!selected.length) throw new Error('Select one or more layers first.');
    let count = 0;
    const origins = selected.map((node) => node.absoluteBoundingBox).filter(Boolean);
    if (origins.length !== selected.length)
      throw new Error('Every selected layer needs visible bounds.');
    const originX = Math.min(...origins.map((box) => box.x));
    const originY = Math.min(...origins.map((box) => box.y));
    const convert = async (node, depth) => {
      if (++count > 512 || depth > 32)
        throw new Error('Export supports at most 512 nodes and 32 group levels.');
      const bounds = node.absoluteBoundingBox;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0)
        throw new Error(`Layer ${node.name} has no usable bounds.`);
      const fonts =
        node.type === 'TEXT' && node.fontName !== figma.mixed ? node.fontName : undefined;
      const fontSize =
        node.type === 'TEXT' && node.fontSize !== figma.mixed ? node.fontSize : undefined;
      const fills =
        'fills' in node && node.fills !== figma.mixed
          ? node.fills.map((fill) => ({
              type: fill.type,
              visible: fill.visible,
              opacity: fill.opacity,
              ...(fill.type === 'SOLID' ? { color: fill.color } : {}),
            }))
          : [];
      const unsupportedText =
        node.type === 'TEXT' &&
        (!fonts ||
          !fontSize ||
          !/^(regular|bold)$/i.test(fonts.style) ||
          node.textDecoration !== 'NONE' ||
          node.textCase !== 'ORIGINAL' ||
          node.lineHeight === figma.mixed ||
          node.lineHeight.unit !== 'AUTO' ||
          node.letterSpacing === figma.mixed ||
          node.letterSpacing.value !== 0);
      const unsupported =
        !node.absoluteTransform ||
        Math.abs(node.absoluteTransform[0][0] - 1) > 1e-6 ||
        Math.abs(node.absoluteTransform[0][1]) > 1e-6 ||
        Math.abs(node.absoluteTransform[1][0]) > 1e-6 ||
        Math.abs(node.absoluteTransform[1][1] - 1) > 1e-6 ||
        ('fills' in node && node.fills === figma.mixed) ||
        ('strokes' in node && (node.strokes === figma.mixed || node.strokes.length > 0)) ||
        ('effects' in node && node.effects.some((effect) => effect.visible !== false)) ||
        ('cornerRadius' in node &&
          (node.cornerRadius === figma.mixed || node.cornerRadius !== 0)) ||
        unsupportedText;
      const bytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 1 },
      });
      if (bytes.length < 24) throw new Error(`Could not read the PNG for ${node.name}.`);
      const pngWidth = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
      const pngHeight =
        ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
      const renderBounds = node.absoluteRenderBounds || bounds;
      const matches = (box) =>
        Math.abs(box.width - pngWidth) <= 2 && Math.abs(box.height - pngHeight) <= 2;
      const imageBounds = matches(renderBounds) ? renderBounds : matches(bounds) ? bounds : null;
      if (!imageBounds) throw new Error(`Cannot determine PNG placement for ${node.name}.`);
      const item = {
        name: node.name,
        type: node.type,
        visible: node.visible,
        opacity: node.opacity,
        blendMode: node.blendMode,
        rotation: node.rotation,
        bounds: {
          x: bounds.x - originX,
          y: bounds.y - originY,
          width: bounds.width,
          height: bounds.height,
        },
        imageBounds: {
          x: imageBounds.x - originX,
          y: imageBounds.y - originY,
          width: imageBounds.width,
          height: imageBounds.height,
        },
        clipsContent: node.clipsContent === true,
        unsupported,
        fills,
        png: `data:image/png;base64,${figma.base64Encode(bytes)}`,
      };
      if (node.type === 'TEXT')
        Object.assign(item, {
          characters: node.characters,
          fontName: fonts,
          fontSize,
          textAlignHorizontal: node.textAlignHorizontal,
        });
      if ('children' in node)
        item.children = await Promise.all(node.children.map((child) => convert(child, depth + 1)));
      return item;
    };
    const nodes = await Promise.all(selected.map((node) => convert(node, 0)));
    const json = JSON.stringify({ format: 'ograf-figma', version: 1, nodes });
    if (json.length > 64 * 1024 * 1024)
      throw new Error('Export exceeds 64 MB; select fewer layers.');
    figma.ui.postMessage({ type: 'download', json });
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
