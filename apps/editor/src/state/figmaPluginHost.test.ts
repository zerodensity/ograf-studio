import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

describe('Figma exporter host contract', () => {
  it('exports the selected node in the portable interchange with PNG placement', async () => {
    const bytes = new Uint8Array(24);
    bytes[19] = 20;
    bytes[23] = 10;
    const messages: Array<{ type: string; json?: string }> = [];
    const node = {
      name: 'Box',
      type: 'RECTANGLE',
      visible: true,
      opacity: 1,
      blendMode: 'NORMAL',
      rotation: 0,
      absoluteTransform: [
        [1, 0, 40],
        [0, 1, 80],
      ],
      absoluteBoundingBox: { x: 40, y: 80, width: 20, height: 10 },
      absoluteRenderBounds: { x: 40, y: 80, width: 20, height: 10 },
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      strokes: [],
      effects: [],
      cornerRadius: 0,
      exportAsync: async () => bytes,
    };
    const figma = {
      currentPage: { selection: [node] },
      mixed: Symbol('mixed'),
      ui: {
        onmessage: null as null | ((message: { type: string }) => Promise<void>),
        postMessage: (message: { type: string; json?: string }) => messages.push(message),
      },
      showUI: () => {},
      base64Encode: () => 'iVBORw0KGgoAAAA=',
    };
    runInNewContext(readFileSync('tools/figma-export/code.js', 'utf8'), { figma, __html__: '' });
    await figma.ui.onmessage!({ type: 'export' });
    expect(messages[0]?.type).toBe('download');
    const json = JSON.parse(messages[0]!.json!);
    expect(json.format).toBe('ograf-figma');
    expect(json.nodes[0]).toMatchObject({
      name: 'Box',
      bounds: { x: 0, y: 0, width: 20, height: 10 },
      imageBounds: { x: 0, y: 0, width: 20, height: 10 },
      unsupported: false,
    });
  });
});
