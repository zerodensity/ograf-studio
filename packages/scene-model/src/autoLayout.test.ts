import { describe, expect, it } from 'vitest';
import { applyAutoLayoutTransforms, DEFAULT_LAYER_AUTO_LAYOUT } from './autoLayout';
import { createDefaultTransform } from './factory';

const node = (
  id: string,
  parentId: string | null,
  overrides: Partial<typeof DEFAULT_LAYER_AUTO_LAYOUT> = {},
  isVisible = true,
) => ({
  id,
  parentId,
  isVisible,
  autoLayout: { ...DEFAULT_LAYER_AUTO_LAYOUT, ...overrides },
});

describe('automatic layer layout', () => {
  it('flows children horizontally in paint order and hugs their content', () => {
    const transforms = new Map([
      ['panel', createDefaultTransform({ x: 100, y: 200, width: 500, height: 80 })],
      ['name', createDefaultTransform({ width: 120, height: 30 })],
      ['flag', createDefaultTransform({ width: 40, height: 20 })],
    ]);
    applyAutoLayoutTransforms(
      [
        node('panel', null, {
          direction: 'horizontal',
          gap: 12,
          paddingLeft: 16,
          paddingRight: 20,
          paddingTop: 10,
          paddingBottom: 10,
          align: 'center',
          hugWidth: true,
        }),
        node('name', 'panel'),
        node('flag', 'panel'),
      ],
      transforms,
    );

    expect(transforms.get('panel')).toMatchObject({ width: 208, height: 80 });
    expect(transforms.get('name')).toMatchObject({ x: 116, y: 225 });
    expect(transforms.get('flag')).toMatchObject({ x: 248, y: 230 });
  });

  it('collapses hidden children and carries nested descendants when a container moves', () => {
    const transforms = new Map([
      ['outer', createDefaultTransform({ x: 50, y: 60, width: 300, height: 200 })],
      ['inner', createDefaultTransform({ x: 0, y: 0, width: 100, height: 40 })],
      ['nested', createDefaultTransform({ x: 5, y: 6, width: 20, height: 10 })],
      ['hidden', createDefaultTransform({ width: 90, height: 20 })],
    ]);
    applyAutoLayoutTransforms(
      [
        node('outer', null, { direction: 'vertical', gap: 8, paddingLeft: 10, paddingTop: 12 }),
        node('inner', 'outer'),
        node('nested', 'inner'),
        node('hidden', 'outer', {}, false),
      ],
      transforms,
    );

    expect(transforms.get('inner')).toMatchObject({ x: 60, y: 72 });
    expect(transforms.get('nested')).toMatchObject({ x: 65, y: 78 });
    expect(transforms.get('hidden')).toMatchObject({ x: 100, y: 100 });
  });

  it('uses measured content sizes and clamps a hugged background width', () => {
    const transforms = new Map([
      ['background', createDefaultTransform({ x: 20, y: 30, width: 300, height: 50 })],
      ['headline', createDefaultTransform({ width: 80, height: 30 })],
    ]);
    applyAutoLayoutTransforms(
      [
        node('background', null, {
          direction: 'horizontal',
          paddingLeft: 12,
          paddingRight: 18,
          hugWidth: true,
          minWidth: 140,
          maxWidth: 220,
        }),
        node('headline', 'background'),
      ],
      transforms,
      new Map([['headline', { width: 260, height: 30 }]]),
    );

    expect(transforms.get('headline')).toMatchObject({ x: 32, width: 260 });
    expect(transforms.get('background')!.width).toBe(220);
  });
});
