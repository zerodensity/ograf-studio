import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createComposition,
  createFieldDefinition,
  createLayerOfKind,
  createProject,
  type DesignSystem,
  type DesignToken,
} from '@ograf-editor/scene-model';
import {
  changedSharedBrandTokenIds,
  generateBrandKitCss,
  resolveTemplateSetBrandKit,
  sharedBrandKitFromProject,
  validateTemplateSetBrandKit,
} from './templateSetTheme';

const color: DesignToken = {
  id: 'master-accent',
  key: 'brand.accent',
  name: 'Accent',
  type: 'color',
  value: '#2266aa',
  description: '',
};
const font: DesignToken = {
  id: 'master-font',
  key: 'brand.font',
  name: 'Font',
  type: 'font-family',
  value: 'Brand Sans',
  description: '',
};
const kit: DesignSystem = { name: 'Master Brand Kit', tokens: [color, font] };

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const text = createLayerOfKind('text');
  if (text.element.type !== 'text') throw new Error('Expected text.');
  text.element.content = 'Headline';
  text.designTokenBindings = [
    { tokenId: 'local-accent', targetProperty: 'color' },
    { tokenId: 'local-font', targetProperty: 'fontFamily' },
  ];
  text.animationTracks.x = [
    { id: 'x-start', frame: 0, value: -100, easing: 'linear' },
    { id: 'x-end', frame: 20, value: 100, easing: 'cubic-out' },
  ];
  text.bindings = [{ fieldId: 'title-field', targetProperty: 'content' }];
  const field = createFieldDefinition('color', { id: 'accent-field' });
  field.defaultTokenId = 'local-accent';
  field.defaultValue = '#ff0000';
  composition.layers = [text];
  composition.dataFields = [
    field,
    createFieldDefinition('text', { id: 'title-field', defaultValue: 'Live title' }),
  ];
  composition.designSystem.tokens = [
    { ...color, id: 'local-accent', value: '#ff0000' },
    { ...font, id: 'local-font', value: 'Arial' },
    { ...color, id: 'local-only', key: 'local.other', value: '#00ff00' },
  ];
  composition.assets.push(
    createAsset({ kind: 'font', fontFamily: 'Brand Sans', dataUri: 'data:font/woff2;base64,AA==' }),
  );
  composition.components = [
    {
      id: 'component',
      name: 'Title component',
      layers: [structuredClone(text)],
      dataFields: [structuredClone(field)],
    },
  ];
  return { project, composition, text, field };
}

describe('shared Template Set Brand Kit', () => {
  it('adopts compatible semantic keys, materializes every composition and retains local content', () => {
    const { project } = fixture();
    project.compositions.push(createComposition({ name: 'Nested' }));
    const original = structuredClone(project);
    const resolved = resolveTemplateSetBrandKit(project, kit);
    const composition = resolved.compositions[0]!;
    const text = composition.layers[0]!;
    expect(composition.designSystem.tokens.map((token) => token.id)).toEqual([
      'master-accent',
      'master-font',
      'local-only',
    ]);
    expect(text.designTokenBindings).toEqual([
      { tokenId: color.id, targetProperty: 'color' },
      { tokenId: font.id, targetProperty: 'fontFamily' },
    ]);
    expect(text.element).toMatchObject({
      content: 'Headline',
      color: color.value,
      fontFamily: font.value,
    });
    expect(composition.dataFields[0]).toMatchObject({
      defaultTokenId: color.id,
      defaultValue: color.value,
    });
    expect(composition.components[0]!.layers[0]!.element).toMatchObject({
      color: color.value,
      fontFamily: font.value,
    });
    expect(composition.components[0]!.dataFields[0]).toMatchObject({
      defaultTokenId: color.id,
      defaultValue: color.value,
    });
    expect(resolved.compositions[1]!.designSystem.tokens).toEqual(kit.tokens);
    expect(text.animationTracks).toEqual(original.compositions[0]!.layers[0]!.animationTracks);
    expect(text.bindings).toEqual(original.compositions[0]!.layers[0]!.bindings);
    expect(text.keyframes).toEqual(original.compositions[0]!.layers[0]!.keyframes);
    expect(composition.assets).toEqual(original.compositions[0]!.assets);
    expect(composition.runtimeCollections).toEqual(original.compositions[0]!.runtimeCollections);
    expect(composition.dataFields[1]).toEqual(original.compositions[0]!.dataFields[1]);
    expect(project).toEqual(original);
    expect(resolved.compositions[1]!.designSystem.tokens[0]).not.toBe(kit.tokens[0]);
  });

  it('retains explicitly overridden local values even when a master is edited later', () => {
    const { project } = fixture();
    const overridden = resolveTemplateSetBrandKit(project, kit, [color.id]);
    expect(overridden.compositions[0]!.layers[0]!.element).toMatchObject({
      color: '#ff0000',
      fontFamily: font.value,
    });
    const updated = { ...kit, tokens: [{ ...color, value: '#ffffff' }, font] };
    const resolved = resolveTemplateSetBrandKit(overridden, updated, [color.id]);
    expect(resolved.compositions[0]!.designSystem.tokens[0]!.value).toBe('#ff0000');
    const inherited = resolveTemplateSetBrandKit(resolved, updated);
    expect(inherited.compositions[0]!.layers[0]!.element).toMatchObject({ color: '#ffffff' });
  });

  it('rejects incompatible semantic keys and identity collisions without mutating input', () => {
    const { project, composition } = fixture();
    composition.designSystem.tokens[0]!.type = 'text';
    const original = structuredClone(project);
    expect(() => resolveTemplateSetBrandKit(project, kit)).toThrow('incompatible local type');
    expect(project).toEqual(original);
    composition.designSystem.tokens[0]!.type = 'color';
    composition.designSystem.tokens[2]!.id = color.id;
    expect(() => resolveTemplateSetBrandKit(project, kit)).toThrow('identity collision');
    expect(() => resolveTemplateSetBrandKit(project, kit, ['not-shared'])).toThrow(
      'shared token IDs',
    );
  });

  it('renames a shared key by its stable identity after adoption', () => {
    const { project } = fixture();
    const adopted = resolveTemplateSetBrandKit(project, kit);
    const renamed = {
      ...kit,
      tokens: [{ ...color, key: 'brand.highlight', value: '#ffffff' }, font],
    };
    const resolved = resolveTemplateSetBrandKit(adopted, renamed);
    expect(resolved.compositions[0]!.designSystem.tokens[0]).toMatchObject({
      id: color.id,
      key: 'brand.highlight',
      value: '#ffffff',
    });
    expect(resolved.compositions[0]!.layers[0]!.designTokenBindings[0]!.tokenId).toBe(color.id);
    expect(resolved.compositions[0]!.dataFields[0]!.defaultTokenId).toBe(color.id);
  });

  it('accepts inherited stable-ID type changes when the token has no incompatible uses', () => {
    const adopted = resolveTemplateSetBrandKit(createProject(), kit);
    const numberToken = { ...color, type: 'number' as const, value: 24 };
    const resolved = resolveTemplateSetBrandKit(adopted, { ...kit, tokens: [numberToken, font] });
    expect(resolved.compositions[0]!.designSystem.tokens[0]).toEqual(numberToken);
    expect(() =>
      resolveTemplateSetBrandKit(adopted, { ...kit, tokens: [numberToken, font] }, [color.id]),
    ).toThrow('incompatible local type');
  });

  it('rejects inherited type changes with incompatible bound uses without mutating source', () => {
    const { project } = fixture();
    const adopted = resolveTemplateSetBrandKit(project, kit);
    const before = structuredClone(adopted);
    expect(() =>
      resolveTemplateSetBrandKit(adopted, {
        ...kit,
        tokens: [{ ...color, type: 'number', value: 24 }, font],
      }),
    ).toThrow('color');
    expect(adopted).toEqual(before);
  });

  it('preserves explicit object-property overrides in both layers and component snapshots', () => {
    const { project, composition } = fixture();
    composition.layers[0]!.designTokenBindings[0]!.overridden = true;
    composition.components[0]!.layers[0]!.designTokenBindings[0]!.overridden = true;
    const before = structuredClone(project);
    const resolved = resolveTemplateSetBrandKit(project, kit);
    expect(resolved.compositions[0]!.layers[0]!.element).toMatchObject({
      color:
        before.compositions[0]!.layers[0]!.element.type === 'text'
          ? before.compositions[0]!.layers[0]!.element.color
          : '',
    });
    expect(resolved.compositions[0]!.components[0]!.layers[0]!.element).toEqual({
      ...before.compositions[0]!.components[0]!.layers[0]!.element,
      fontFamily: font.value,
    });
    expect(resolved.compositions[0]!.layers[0]!.designTokenBindings[0]).toMatchObject({
      tokenId: color.id,
      overridden: true,
    });
  });

  it('keeps palette links and applies shared child overrides after parent derivation', () => {
    const { project, composition } = fixture();
    const shade = { ...color, id: 'master-shade', key: 'brand.shade', value: '#112233' };
    composition.designSystem.tokens.push({ ...shade, id: 'local-shade', value: '#aabbcc' });
    composition.designSystem.stylePackColors = [
      {
        sourceTokenId: 'local-accent',
        targetTokenId: 'local-shade',
        targets: [],
        factor: 0.5,
        alpha: 1,
      },
    ];
    const shadeText = createLayerOfKind('text');
    shadeText.designTokenBindings = [{ tokenId: 'local-shade', targetProperty: 'color' }];
    composition.layers.push(shadeText);
    const resolved = resolveTemplateSetBrandKit(
      project,
      { ...kit, tokens: [...kit.tokens, shade] },
      [shade.id],
    );
    const c = resolved.compositions[0]!;
    expect(c.designSystem.stylePackColors![0]).toMatchObject({
      sourceTokenId: color.id,
      targetTokenId: shade.id,
    });
    expect(c.designSystem.tokens.find((token) => token.id === shade.id)!.value).toBe('#aabbcc');
    expect(c.layers[1]!.element).toMatchObject({ color: '#aabbcc' });
  });

  it('extracts primitive master tokens without composition-specific pack metadata', () => {
    const { project, composition } = fixture();
    composition.designSystem.stylePackColors = [
      { sourceTokenId: 'local-accent', targets: [], factor: 1, alpha: 1 },
    ];
    const shared = sharedBrandKitFromProject(project);
    expect(Object.keys(shared)).toEqual(['name', 'tokens']);
    expect(shared.tokens).toEqual(composition.designSystem.tokens);
    shared.tokens[0]!.value = '#ffffff';
    expect(composition.designSystem.tokens[0]!.value).toBe('#ff0000');
  });

  it('detects actual local edits, including edits back to the current master value', () => {
    const { project } = fixture();
    const before = resolveTemplateSetBrandKit(project, kit, [color.id]);
    const after = structuredClone(before);
    after.compositions[0]!.designSystem.tokens[0]!.value = color.value;
    expect(changedSharedBrandTokenIds(before, after, kit)).toEqual([color.id]);
    const changedMaster = { ...kit, tokens: [{ ...color, value: '#ffffff' }, font] };
    expect(changedSharedBrandTokenIds(before, structuredClone(before), changedMaster)).toEqual([]);
    after.compositions[0]!.designSystem.tokens[1]!.name = 'Local display name';
    expect(changedSharedBrandTokenIds(before, after, kit)).toEqual([color.id]);
  });
});

describe('master Brand Kit validation and CSS', () => {
  it('checks malformed structures, duplicated IDs/keys and primitive type/value limits', () => {
    expect(validateTemplateSetBrandKit(kit)).toEqual([]);
    expect(validateTemplateSetBrandKit(null)).not.toHaveLength(0);
    expect(validateTemplateSetBrandKit({ name: '', tokens: 'bad' })).not.toHaveLength(0);
    expect(validateTemplateSetBrandKit({ ...kit, tokens: [color, { ...color }] })).toEqual(
      expect.arrayContaining([expect.stringContaining('Duplicate')]),
    );
    for (const invalid of [
      { ...color, value: 'url(https://example.com/image)' },
      { ...font, value: '' },
      { ...color, type: 'number', value: Infinity },
      { ...color, type: 'font-weight', value: 1001 },
      { ...color, type: 'font-weight', value: 12.5 },
      { ...color, type: 'paint', value: '#000000' },
      { ...color, key: 'accent; body{display:none}' },
      { ...color, extra: 'not supported' },
    ])
      expect(validateTemplateSetBrandKit({ name: 'Master', tokens: [invalid] })).not.toHaveLength(
        0,
      );
  });

  it('generates only escaped custom properties and keeps distinct safe token keys distinct', () => {
    const dangerous = '</style>"; } body { display:none } /*\\\nurl(https://example.com)';
    const css = generateBrandKitCss({
      name: 'Master',
      tokens: [
        color,
        font,
        { ...color, id: 'text', key: 'brand-accent', type: 'text', value: dangerous },
        { ...color, id: 'number', key: 'size', type: 'number', value: 24 },
      ],
    });
    expect(css).toContain('--brand\\2e accent: #2266aa;');
    expect(css).toContain('--brand-accent: "');
    expect(css).toContain('--brand\\2e font: "Brand Sans";');
    expect(css).toContain('--size: 24;');
    expect(css).not.toContain('</style>');
    expect(css).not.toContain('"; } body');
    expect(css).toContain('\\3c /style\\3e ');
    expect(() =>
      generateBrandKitCss({ name: 'Master', tokens: [{ ...color, key: 'unsafe;key' }] }),
    ).toThrow('safe identifiers');
  });
});
