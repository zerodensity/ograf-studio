import { describe, expect, it } from 'vitest';
import { createComposition } from '@ograf-editor/scene-model';
import { mapFigmaInterchange } from './figmaImport';
const solid = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
const bounds = { x: 10, y: 20, width: 100, height: 40 };
describe('Figma interchange import', () => {
  it('retains the selectable outer group and warns about flattened nested group boundaries', () => {
    const result = mapFigmaInterchange(
      {
        format: 'ograf-figma',
        version: 1,
        nodes: [
          {
            name: 'Outer',
            type: 'GROUP',
            bounds,
            children: [
              { name: 'A', type: 'RECTANGLE', bounds, fills: solid },
              {
                name: 'Inner',
                type: 'GROUP',
                bounds,
                children: [{ name: 'B', type: 'RECTANGLE', bounds, fills: solid }],
              },
            ],
          },
        ],
      },
      createComposition(),
    );
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0]!.groupId).toBeTruthy();
    expect(result.layers[1]!.groupId).toBe(result.layers[0]!.groupId);
    expect(result.warnings.join(' ')).toMatch(/independent group boundary is not retained/);
    expect(result.layers.map((layer) => layer.keyframes[0]!.transform)).toEqual([
      expect.objectContaining(bounds),
      expect.objectContaining(bounds),
    ]);
  });
  it('creates editable shapes and text and preserves unsupported nodes as images', () => {
    const result = mapFigmaInterchange(
      {
        format: 'ograf-figma',
        version: 1,
        nodes: [
          {
            name: 'Group',
            type: 'GROUP',
            bounds,
            blendMode: 'PASS_THROUGH',
            children: [
              { name: 'Box', type: 'RECTANGLE', bounds, fills: solid },
              {
                name: 'Title',
                type: 'TEXT',
                bounds,
                fills: solid,
                characters: 'Market',
                fontName: { family: 'Example', style: 'Bold' },
                fontSize: 20,
              },
              {
                name: 'Effect',
                type: 'RECTANGLE',
                bounds,
                fills: solid,
                unsupported: true,
                png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZkAAAAASUVORK5CYII=',
              },
            ],
          },
        ],
      },
      createComposition(),
      () => true,
    );
    expect(result.layers.map((layer) => layer.element.type)).toEqual([
      'rectangle',
      'text',
      'image',
    ]);
    expect(result.layers[0]?.groupId).toBe(result.layers[2]?.groupId);
    expect(result.layers[1]?.element).toMatchObject({
      type: 'text',
      content: 'Market',
      fontFamily: 'Example',
    });
    expect(result.warnings.join(' ')).toMatch(/preserved as an image/);
  });
  it('refuses unsupported nodes with no embedded image', () => {
    expect(() =>
      mapFigmaInterchange(
        {
          format: 'ograf-figma',
          version: 1,
          nodes: [{ name: 'Shadow', type: 'RECTANGLE', bounds, unsupported: true }],
        },
        createComposition(),
      ),
    ).toThrow(/PNG fallback/);
  });
  it('refuses unrelated or malformed JSON', () => {
    expect(() => mapFigmaInterchange({ document: {} }, createComposition())).toThrow(
      /Figma plugin/,
    );
  });
});
