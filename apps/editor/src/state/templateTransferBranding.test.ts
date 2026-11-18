import { readFileSync } from 'node:fs';
import {
  createAsset,
  createDefaultTypographyPresets,
  createFieldDefinition,
  createProject,
  createTextLayer,
  type DesignSystem,
  type DesignToken,
} from '@ograf-editor/scene-model';
import { describe, expect, it } from 'vitest';
import {
  addProjectSetTemplate,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
} from './projectSet';
import {
  applyTemplateTransferBranding,
  type TemplateTransferSourceBrandKit,
} from './templateTransferBranding';
import { preparePreservedTransferProject } from './templateTransferDependencies';

function colorToken(id: string, key: string, value: string): DesignToken {
  return { id, name: 'Accent', key, type: 'color', value, description: '' };
}

function sourceFixture() {
  const accent = colorToken('source-blue', 'brand.primary', '#00ffff');
  const local = colorToken('source-local', 'brand.local', '#447799');
  const typography = createDefaultTypographyPresets('Barlow')[0]!;
  const background = { id: 'source-canvas', name: 'Blue canvas', paint: '#112233' };
  const kit: DesignSystem = {
    name: 'Source',
    tokens: [accent],
    typography: [typography],
    backgrounds: [background],
  };
  const project = createProject({ name: 'Incoming' });
  const composition = project.compositions[0]!;
  composition.designSystem = structuredClone({ ...kit, tokens: [accent, local] });
  composition.backgroundStyleId = background.id;
  composition.backgroundPaint = background.paint;
  const text = createTextLayer();
  if (text.element.type !== 'text') throw new Error('Expected text');
  text.element.fill = {
    type: 'linear',
    angle: 32,
    stops: [
      { offset: 0, color: '#00ffff', opacity: 0.9 },
      { offset: 1, color: '#447799', opacity: 0.3 },
    ],
  };
  text.element.fontFamily = 'Barlow';
  text.element.fontSize = 48;
  text.element.runs = [{ text: 'Special', fontFamily: 'Inter' }];
  text.typographyBinding = { presetId: typography.id, overrides: ['fontSize'] };
  text.designTokenBindings = [
    { tokenId: accent.id, targetProperty: 'fill.stops[0].color' },
    { tokenId: local.id, targetProperty: 'fill.stops[1].color' },
  ];
  const team = createFieldDefinition('color', {
    key: 'team',
    defaultValue: '#225500',
    defaultTokenId: accent.id,
  });
  composition.dataFields = [team];
  composition.layers = [text];
  return { project, sourceKit: { kit }, accent, local, typography, background };
}

function destinationFixture() {
  const primary = colorToken('destination-primary', 'brand.primary', '#ff0000');
  const typography = { ...createDefaultTypographyPresets('Arial')[0]!, id: 'target-headline' };
  const background = { id: 'target-canvas', name: 'Red canvas', paint: '#442211' };
  const project = createProject({ name: 'Destination member' });
  const layer = createTextLayer();
  if (layer.element.type !== 'text') throw new Error('Expected text');
  layer.element.color = '#ff0000';
  layer.designTokenBindings = [{ tokenId: primary.id, targetProperty: 'color' }];
  project.compositions[0]!.layers = [layer];
  project.compositions[0]!.designSystem.tokens.push(
    colorToken('destination-local', 'brand.primary.imported', '#003300'),
  );
  const destination = createProjectSet('Destination', project);
  destination.brandKit = {
    name: 'Destination',
    tokens: [primary],
    typography: [typography],
    backgrounds: [background],
  };
  return { destination, primary, typography, background };
}

function addResult(result: ReturnType<typeof applyTemplateTransferBranding>) {
  const set = addProjectSetTemplate(result.destination, result.project, 'Transferred', false, {
    inheritBrandKit: false,
    brandKitLinks: result.brandKitLinks,
  });
  const member = set.templates.at(-1)!;
  member.brandKitOverrides = result.brandKitOverrides;
  member.typographyOverrides = result.typographyOverrides;
  member.backgroundOverrides = result.backgroundOverrides;
  member.backgroundOverridden = result.backgroundOverridden;
  const resolved = resolveProjectSetTemplate(set, member.id);
  member.project = resolved;
  return { set, member, composition: resolved.compositions[0]! };
}

describe('Reviewed template Brand Kit policies', () => {
  it('adopts only approved roles and leaves local fields, gradient geometry, and overrides intact', async () => {
    const source = sourceFixture();
    const target = destinationFixture();
    const result = applyTemplateTransferBranding(
      source.project,
      target.destination,
      source.sourceKit,
      {
        policy: 'adopt-destination',
        mappings: [
          {
            kind: 'typography',
            sourceId: source.typography.id,
            action: 'link',
            destinationId: target.typography.id,
          },
          {
            kind: 'background',
            sourceId: source.background.id,
            action: 'link',
            destinationId: target.background.id,
          },
        ],
      },
    );
    const added = addResult(result);
    expect(added.member.brandKitLinks).toEqual({
      tokenIds: [target.primary.id],
      typographyIds: [target.typography.id],
      backgroundIds: [target.background.id],
    });
    expect(added.composition.layers[0]!.element).toMatchObject({
      fill: {
        type: 'linear',
        angle: 32,
        stops: [
          { offset: 0, color: '#ff0000', opacity: 0.9 },
          { offset: 1, color: '#447799', opacity: 0.3 },
        ],
      },
      fontFamily: 'Arial',
      fontSize: 48,
      runs: [{ text: 'Special', fontFamily: 'Inter' }],
    });
    expect(added.composition.backgroundStyleId).toBe(target.background.id);
    expect(added.composition.backgroundPaint).toBe('#442211');
    expect(added.composition.dataFields).toEqual(source.project.compositions[0]!.dataFields);
    expect(added.composition.layers[0]!.animationTracks).toEqual(
      source.project.compositions[0]!.layers[0]!.animationTracks,
    );
    expect(result.mappings).toContainEqual(
      expect.objectContaining({
        sourceId: source.accent.id,
        action: 'link',
        destinationId: target.primary.id,
        affectedCount: 1,
      }),
    );

    const archive = await createProjectSetArchive(added.set);
    const reopened = await openProjectSetArchive(await archive.arrayBuffer());
    expect(reopened.templates.at(-1)!.brandKitLinks).toEqual(added.member.brandKitLinks);
    reopened.brandKit!.tokens[0]!.value = '#22cc11';
    reopened.brandKit!.tokens.push(colorToken('unapproved', 'brand.local', '#ffffff'));
    const updated = resolveProjectSetTemplate(reopened, added.member.id).compositions[0]!;
    expect(updated.layers[0]!.element).toMatchObject({
      fill: {
        stops: [{ color: '#22cc11' }, { color: '#447799' }],
      },
    });
    expect(updated.dataFields).toEqual(source.project.compositions[0]!.dataFields);
  });

  it('retains explicit template overrides and only resets the selected role when requested', () => {
    const source = sourceFixture();
    const target = destinationFixture();
    const sourceKit: TemplateTransferSourceBrandKit = {
      kit: source.sourceKit.kit,
      overrides: { tokenIds: [source.accent.id], background: true },
    };
    const keep = addResult(
      applyTemplateTransferBranding(source.project, target.destination, sourceKit, {
        policy: 'adopt-destination',
      }),
    );
    expect(keep.member.brandKitOverrides).toEqual([target.primary.id]);
    expect(keep.composition.layers[0]!.element).toMatchObject({
      fill: { stops: [{ color: '#00ffff' }, { color: '#447799' }] },
    });
    const reset = addResult(
      applyTemplateTransferBranding(source.project, target.destination, sourceKit, {
        policy: 'adopt-destination',
        mappings: [
          {
            kind: 'token',
            sourceId: source.accent.id,
            action: 'link',
            destinationId: target.primary.id,
            resetOverrides: true,
          },
        ],
      }),
    );
    expect(reset.member.brandKitOverrides).toBeUndefined();
    expect(reset.composition.layers[0]!.element).toMatchObject({
      fill: { stops: [{ color: '#ff0000' }, { color: '#447799' }] },
    });
    expect(reset.composition.backgroundPaint).toBe('#112233');
  });

  it('lets several source roles explicitly follow the same destination definition', () => {
    const source = sourceFixture();
    const target = destinationFixture();
    const result = addResult(
      applyTemplateTransferBranding(source.project, target.destination, source.sourceKit, {
        policy: 'adopt-destination',
        mappings: [
          {
            kind: 'token',
            sourceId: source.local.id,
            action: 'link',
            destinationId: target.primary.id,
          },
        ],
      }),
    );
    expect(result.member.brandKitLinks?.tokenIds).toEqual([target.primary.id]);
    expect(result.composition.layers[0]!.element).toMatchObject({
      fill: { stops: [{ color: '#ff0000' }, { color: '#ff0000' }] },
    });
    expect(result.composition.dataFields).toEqual(source.project.compositions[0]!.dataFields);
  });

  it('brings source roles and embedded fonts under distinct destination identities', () => {
    const source = sourceFixture();
    const target = destinationFixture();
    const sharedFont = createAsset({
      id: 'shared-font',
      kind: 'font',
      name: 'type.ttf',
      fontFamily: 'Barlow',
      fontWeight: '700',
      mimeType: 'font/ttf',
      dataUri: `data:font/ttf;base64,${readFileSync(new URL('../assets/font-library/lora.ttf', import.meta.url)).toString('base64')}`,
    });
    const existingFont = {
      ...sharedFont,
      dataUri: `data:font/ttf;base64,${readFileSync(new URL('../assets/font-library/inter.ttf', import.meta.url)).toString('base64')}`,
    };
    target.destination.assets.push(existingFont);
    source.project.compositions[0]!.assets.push(sharedFont);
    const prepared = preparePreservedTransferProject(source.project, target.destination);
    const sourceBefore = structuredClone(prepared);
    const destinationBefore = structuredClone(target.destination);
    const result = applyTemplateTransferBranding(
      prepared,
      target.destination,
      { kit: source.sourceKit.kit, assets: [sharedFont] },
      { policy: 'bring-source-branding' },
    );
    expect(prepared).toEqual(sourceBefore);
    expect(target.destination).toEqual(destinationBefore);
    expect(result.destination.brandKit!.tokens).toEqual([
      target.primary,
      expect.objectContaining({ key: 'brand.primary.imported2', value: '#00ffff' }),
    ]);
    const copiedFont = result.destination.assets.find(
      ({ dataUri }) => dataUri === sharedFont.dataUri,
    )!;
    expect(copiedFont.id).not.toBe(existingFont.id);
    expect(copiedFont.fontFamily).not.toBe('Barlow');
    const oldMember = resolveProjectSetTemplate(
      result.destination,
      target.destination.templates[0]!.id,
    );
    expect(oldMember.compositions[0]!.layers[0]!.element).toMatchObject({ color: '#ff0000' });

    const added = addResult(result);
    expect(added.composition.layers[0]!.element).toMatchObject({
      fontFamily: copiedFont.fontFamily,
      fill: { stops: [{ color: '#00ffff' }, { color: '#447799' }] },
    });
    expect(added.member.brandKitLinks?.tokenIds[0]).toBe(
      result.destination.brandKit!.tokens[1]!.id,
    );
    expect(added.composition.assets.some(({ dataUri }) => dataUri === sharedFont.dataUri)).toBe(
      true,
    );
  });

  it('creates a destination-owned master kit when the destination has none', () => {
    const source = sourceFixture();
    const destination = createProjectSet('New set', createProject({ name: 'Unbranded' }));
    expect(destination.brandKit).toBeUndefined();
    const result = applyTemplateTransferBranding(source.project, destination, source.sourceKit, {
      policy: 'bring-source-branding',
    });
    expect(result.destination.brandKit).toMatchObject({
      name: source.sourceKit.kit.name,
      tokens: [expect.objectContaining({ key: source.accent.key, value: source.accent.value })],
    });
    expect(result.destination.brandKit!.tokens[0]!.id).not.toBe(source.accent.id);
    expect(destination.brandKit).toBeUndefined();
  });

  it('keeps incompatible token keys local and refuses to recover a master from resolved values', () => {
    const source = sourceFixture();
    const target = destinationFixture();
    target.destination.brandKit!.tokens[0] = { ...target.primary, type: 'number', value: 32 };
    const result = applyTemplateTransferBranding(source.project, target.destination, undefined, {
      policy: 'adopt-destination',
    });
    expect(result.brandKitLinks).toBeUndefined();
    expect(result.mappings).toContainEqual(
      expect.objectContaining({
        sourceId: source.accent.id,
        action: 'keep-local',
        conflicts: [expect.stringContaining('different token type')],
      }),
    );
    expect(() =>
      applyTemplateTransferBranding(source.project, target.destination, undefined, {
        policy: 'bring-source-branding',
      }),
    ).toThrow('no recoverable shared Brand Kit');
  });
});
