import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildComponentDefinition,
  createAsset,
  createFieldDefinition,
  createLayerOfKind,
  createProject,
  instantiateComponentDefinition,
  type Project,
} from '@ograf-editor/scene-model';
import { addProjectSetTemplate, createProjectSet, resolveProjectSetTemplate } from './projectSet';
import { preparePreservedTransferProject } from './templateTransferDependencies';

function imageSource(project: Project, color: string) {
  const composition = project.compositions[0]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="${color}"/></svg>`;
  const asset = createAsset({
    id: 'shared-logo',
    name: 'logo.svg',
    kind: 'image',
    mimeType: 'image/svg+xml',
    packagePath: 'assets/logo.svg',
    dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  });
  const layer = createLayerOfKind('image');
  if (layer.element.type !== 'image') throw new Error('Expected an image.');
  layer.element.src = 'asset:shared-logo';
  composition.assets.push(asset);
  composition.layers.push(layer);
  return { composition, asset, layer };
}

function embeddedFont(
  file: string,
  id: string,
  family: string,
  weight = '400',
  style: 'normal' | 'italic' | 'oblique' = 'normal',
) {
  const bytes = readFileSync(new URL(`../assets/font-library/${file}.ttf`, import.meta.url));
  return createAsset({
    id,
    name: 'same-name.ttf',
    kind: 'font',
    mimeType: 'font/ttf',
    dataUri: `data:font/ttf;base64,${bytes.toString('base64')}`,
    fontFamily: family,
    fontWeight: weight,
    fontStyle: style,
    licenseName: 'SIL Open Font License 1.1',
  });
}

describe('Keep appearance dependency preparation', () => {
  it('isolates referenced shared components and remaps their conflicting image without changing the existing members', () => {
    const source = createProject({ name: 'Source' });
    const { composition, asset, layer } = imageSource(source, 'cyan');
    const component = buildComponentDefinition(composition, [layer.id], 'Source logo', 'shared');
    component.scope = 'set';
    const unused = {
      ...structuredClone(component),
      id: 'source-unused',
      name: 'Unplaced shared source',
    };
    const local = {
      ...structuredClone(component),
      id: 'source-local',
      scope: 'local' as const,
      name: 'Local source',
    };
    composition.components = [component, unused, local];
    composition.layers = [];
    const first = instantiateComponentDefinition(composition, component);
    const second = instantiateComponentDefinition(composition, component, { x: 80, y: 80 });
    const overridden = second.layers[0]!;
    if (overridden.element.type !== 'image') throw new Error('Expected an image.');
    overridden.element.fit = 'contain';
    overridden.componentLink!.overridePaths = ['/element/fit'];
    composition.layers.push(...first.layers, ...second.layers);

    const metadata = createLayerOfKind('text');
    if (metadata.element.type !== 'text') throw new Error('Expected text.');
    metadata.element.content = 'asset:shared-logo';
    composition.layers.push(metadata);
    composition.dataFields.push(
      createFieldDefinition('image-url', { key: 'photo', defaultValue: 'asset:shared-logo' }),
    );
    const destinationProject = createProject({ name: 'Destination' });
    const destFixture = imageSource(destinationProject, 'red');
    const destComponent = buildComponentDefinition(
      destFixture.composition,
      [destFixture.layer.id],
      'Destination logo',
      'shared',
    );
    destComponent.scope = 'set';
    const destination = {
      ...createProjectSet('Destination', destinationProject),
      componentAssets: [destComponent],
    };
    const previous = structuredClone(destination);
    const sourceBefore = structuredClone(source);
    const prepared = preparePreservedTransferProject(source, destination);
    const incoming = prepared.compositions[0]!;
    const newComponent = incoming.components.find(({ name }) => name === 'Source logo')!;
    const newAsset = incoming.assets[0]!;
    expect(newComponent).toMatchObject({ scope: 'local' });
    expect(newComponent.id).not.toBe('shared');
    expect(incoming.components.map(({ id }) => id)).toEqual([newComponent.id, 'source-local']);
    expect(newAsset.id).not.toBe(asset.id);
    expect(newAsset).toMatchObject({ dataUri: asset.dataUri, name: asset.name });
    expect(newAsset.packagePath).toBeUndefined();
    const ref = `asset:${newAsset.id}`;
    expect(incoming.dataFields[0]!.defaultValue).toBe(ref);
    expect(incoming.layers[2]!.element).toMatchObject({ content: 'asset:shared-logo' });
    for (const [index, original] of [first, second].entries()) {
      const placed = incoming.layers[index]!;
      const originalLink = original.layers[0]!.componentLink!;
      expect(placed.componentLink).toMatchObject({
        ...originalLink,
        componentId: newComponent.id,
        baseline: { ...originalLink.baseline, element: { src: ref } },
      });
      expect(placed.element).toMatchObject({ src: ref });
    }
    expect(newComponent.layers[0]!.element).toMatchObject({ src: ref });
    expect(newComponent.resources).toContainEqual(newAsset);
    const candidate = addProjectSetTemplate(destination, prepared, prepared.name, false);
    const existing = resolveProjectSetTemplate(candidate, candidate.templates[0]!.id);
    const transferred = resolveProjectSetTemplate(candidate, candidate.templates[1]!.id);
    expect(existing).toEqual(resolveProjectSetTemplate(previous, previous.templates[0]!.id));
    expect(transferred.compositions[0]!.assets).toEqual(
      expect.arrayContaining([newAsset, destFixture.asset]),
    );
    expect(transferred.compositions[0]!.layers[0]!.element).toMatchObject({ src: ref });
    expect(source).toEqual(sourceBefore);
    expect(destination).toEqual(previous);
  });

  it('uses an independent family for colliding embedded fonts including text runs and Brand Kit presets', () => {
    const source = createProject({ name: 'Source' });
    const destination = createProject({ name: 'Destination' });
    const family = 'Shared, Family';
    const a = embeddedFont('lora', 'source-font', family, 'normal');
    const b = embeddedFont('inter', 'destination-font', family, '350 500');
    const from = source.compositions[0]!;
    from.assets.push(a);
    destination.compositions[0]!.assets.push(b);
    const text = createLayerOfKind('text');
    if (text.element.type !== 'text') throw new Error('Expected text.');
    text.element.content = 'Mirror';
    text.element.fontFamily = '"Shared, Family", serif';
    text.element.runs = [{ text: 'Mirror', fontFamily: "'Shared, Family', sans-serif" }];
    from.designSystem.tokens.push({
      id: 'body-font',
      key: 'body.font',
      name: 'Body font',
      type: 'font-family',
      value: text.element.fontFamily,
      description: '',
    });
    from.designSystem.typography = [
      {
        id: 'body-style',
        name: 'Body style',
        properties: {
          fontFamily: text.element.fontFamily,
          fontWeight: 400,
          fontSize: 36,
          lineHeight: 1.1,
          letterSpacing: 0,
          textTransform: 'none',
          textAlign: 'left',
        },
      },
    ];
    from.layers.push(text);
    const destSet = createProjectSet('Destination', destination);
    const before = structuredClone(destSet);
    const incoming = preparePreservedTransferProject(source, destSet).compositions[0]!;
    const alias = incoming.assets[0]!.fontFamily;
    expect(alias).toBeTruthy();
    expect(alias).not.toBe(family);
    expect(incoming.assets[0]).toMatchObject({
      name: a.name,
      dataUri: a.dataUri,
      licenseName: a.licenseName,
    });
    expect(incoming.layers[0]!.element).toMatchObject({
      fontFamily: `${alias}, serif`,
      runs: [{ text: 'Mirror', fontFamily: `${alias}, sans-serif` }],
    });
    expect(incoming.designSystem.tokens[0]!.value).toBe(`${alias}, serif`);
    expect(incoming.designSystem.typography![0]!.properties.fontFamily).toBe(`${alias}, serif`);
    expect(destSet).toEqual(before);
    expect(a.fontFamily).toBe(family);
  });

  it.each([
    ['normal', '700', 'normal'],
    ['400', 'bold', 'normal'],
    ['350 500', '600 800', 'normal'],
    ['400', '400', 'italic'],
  ] as const)('retains the family for distinct faces (%s and %s, %s)', (source, target, style) => {
    const family = 'Shared Face';
    const incoming = createProject();
    const destination = createProject();
    incoming.compositions[0]!.assets.push(embeddedFont('lora', 'source', family, source));
    destination.compositions[0]!.assets.push(
      embeddedFont('inter', 'destination', family, target, style),
    );
    const text = createLayerOfKind('text');
    if (text.element.type !== 'text') throw new Error('Expected text.');
    text.element.fontFamily = family;
    incoming.compositions[0]!.layers.push(text);
    const prepared = preparePreservedTransferProject(
      incoming,
      createProjectSet('Destination', destination),
    );
    expect(prepared.compositions[0]!.assets[0]!.fontFamily).toBe(family);
    expect(prepared.compositions[0]!.layers[0]!.element).toMatchObject({ fontFamily: family });
  });

  it('reports an unsupported reference collision before changing the source or destination', () => {
    const source = createProject({ name: 'Source' });
    const { layer } = imageSource(source, 'cyan');
    layer.visualRules.push({
      id: 'change-photo',
      name: 'Change photo',
      enabled: true,
      trigger: 'click',
      fieldId: '',
      sourcePath: [],
      operator: 'equals',
      actions: [{ type: 'property', targetProperty: 'src', value: 'asset:shared-logo' }],
    });
    const destinationProject = createProject({ name: 'Destination' });
    imageSource(destinationProject, 'red');
    const destination = createProjectSet('Destination', destinationProject);
    const sourceBefore = structuredClone(source);
    const destinationBefore = structuredClone(destination);
    expect(() => preparePreservedTransferProject(source, destination)).toThrow(
      /Keep appearance cannot remap an asset or font referenced by a rule/,
    );
    expect(source).toEqual(sourceBefore);
    expect(destination).toEqual(destinationBefore);
  });
});
