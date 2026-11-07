import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createMediaPaint,
  createProject,
  createTextLayer,
} from '@ograf-editor/scene-model';
import { createProjectSet, type ProjectSetDocument } from './projectSet';
import { createSharedAssetScope, sharedComponentUsage } from './sharedResourceUsage';

describe('shared asset scope', () => {
  it('identifies only resolved Brand Kit fonts and background resources as set assets', () => {
    const project = createProject();
    const set = createProjectSet('News', project);
    const templateId = set.templates[0]!.id;
    const compositionId = project.compositions[0]!.id;
    const font = createAsset({
      id: 'font',
      name: 'News font',
      kind: 'font',
      mimeType: 'font/woff2',
      dataUri: 'data:font/woff2;base64,AQID',
      fontFamily: 'News Sans',
    });
    const video = createAsset({
      id: 'video',
      name: 'News background',
      kind: 'media',
      mimeType: 'video/mp4',
      dataUri: 'data:video/mp4;base64,AQID',
    });
    set.assets = [font, video];
    set.brandKit = {
      name: 'News',
      tokens: [{ id: 'font-token', type: 'font-family', value: '"News Sans", sans-serif' }],
      backgrounds: [
        {
          id: 'background',
          name: 'Background',
          paint: createMediaPaint({ source: { kind: 'clip', src: 'asset:video' } }),
        },
      ],
    } as ProjectSetDocument['brandKit'];
    const classify = createSharedAssetScope(set, templateId, compositionId);
    expect(classify({ ...font, id: 'setfont-font' })).toBe('Set');
    expect(classify(video)).toBe('Set');
    expect(classify({ ...font, id: 'font' })).toBe('Local');
    expect(classify({ ...video, dataUri: 'data:video/mp4;base64,BAUG' })).toBe('Local');
    expect(
      createSharedAssetScope(
        { ...set, brandKit: undefined },
        templateId,
        compositionId,
      )({ ...font, id: 'setfont-font' }),
    ).toBe('Local');
  });

  it('respects slot overrides and fallbacks before other set resource indicators', () => {
    const project = createProject();
    const set = createProjectSet('News', project);
    const templateId = set.templates[0]!.id;
    const compositionId = project.compositions[0]!.id;
    const image = createAsset({
      id: 'logo',
      name: 'Logo',
      kind: 'image',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,AQID',
    });
    set.assetSlots = [
      {
        id: 'slot',
        key: 'logo',
        label: 'Logo',
        kind: 'image',
        required: false,
        assetId: 'source',
        bindings: [
          { id: 'binding', templateId, compositionId, templateAssetId: image.id, inherit: true },
        ],
      },
    ];
    expect(createSharedAssetScope(set, templateId, compositionId)(image)).toBe('Inherited');
    set.assetSlots[0]!.bindings[0]!.inherit = false;
    expect(createSharedAssetScope(set, templateId, compositionId)(image)).toBe('Local override');
    set.assetSlots[0]!.bindings[0]!.inherit = true;
    set.assetSlots[0]!.assetId = null;
    expect(createSharedAssetScope(set, templateId, compositionId)(image)).toBe('Local fallback');
    expect(createSharedAssetScope(null, null, compositionId)(image)).toBe('');
  });
});

describe('shared component usage', () => {
  it('counts instances once across source layers and reports both layer and field overrides', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const first = createTextLayer();
    const second = createTextLayer();
    const third = createTextLayer();
    first.componentLink = { componentId: 'c', instanceId: 'one', sourceLayerId: 'a' };
    second.componentLink = {
      componentId: 'c',
      instanceId: 'one',
      sourceLayerId: 'b',
      overridePaths: ['/opacity'],
    };
    third.componentLink = {
      componentId: 'c',
      instanceId: 'two',
      sourceLayerId: 'a',
      fieldOverridePaths: { name: ['/defaultValue'] },
    };
    composition.layers.push(first, second, third);
    expect(sharedComponentUsage(project, 'c')).toEqual({
      count: 2,
      overridden: 2,
      firstLayerId: first.id,
      firstCompositionId: composition.id,
    });
    expect(sharedComponentUsage(project, 'missing')).toEqual({
      count: 0,
      overridden: 0,
      firstLayerId: undefined,
      firstCompositionId: undefined,
    });
  });

  it('does not merge instances with matching ids in different compositions', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const first = createTextLayer();
    first.componentLink = { componentId: 'c', instanceId: 'one', sourceLayerId: 'a' };
    composition.layers.push(first);
    const other = structuredClone(composition);
    other.id = 'another-composition';
    project.compositions.push(other);
    expect(sharedComponentUsage(project, 'c').count).toBe(2);
  });
});
